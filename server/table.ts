import { randomBytes, randomUUID } from 'node:crypto';
import { emptyStats, type PlayerStats } from '../shared/results';
import { bestHand, madeHandName, shuffledDeck } from './cards';
import { allInEquity } from './equity';
import { formatChips as fc, payoutAmounts, sanitizeRules } from '../shared/presets';
import type {
  BlindLevel, Card, ClockView, HandView, LedgerRow, Legal, LogEntry, PlayerStatus,
  PublicPlayer, RebuyOffer, ResultsView, Street, TableSettings, TableView, WinnerView,
} from '../shared/types';

/* ------------------------------------------------------------------ */
/* Internal state                                                      */
/* ------------------------------------------------------------------ */

export interface Player {
  id: string;
  token: string;
  name: string;
  seat: number | null;
  requestedSeat: number | null;
  requestedBuyIn: number;
  stack: number;
  status: PlayerStatus;
  sittingOut: boolean;
  isHost: boolean;
  buyIn: number;
  cashOut: number;
  /** Chips that left play without being cashed out (tournament leave/removal). */
  forfeited: number;
  rebuys: number;
  addOnTaken: boolean;
  /** Has bought in to this game (counts as an entry for payouts). */
  entered: boolean;
  timeBankMs: number;
  place: number | null;
  camOn: boolean;
  micOn: boolean;
  stats?: PlayerStats;
  /** Ids of players this player busted, one entry per bust (rebuys can repeat a name). */
  knockouts?: string[];
  /** Strongest hand this player showed down. */
  bestHand?: { score: number; name: string; cards: Card[] };
  /** Played by the server (demo tables). */
  bot?: boolean;
  /** runtime only */
  connections: number;
  /** runtime only: when the last connection dropped (or the server started), null while connected */
  awaySince?: number | null;
}

interface HandPlayer {
  id: string;
  seat: number;
  hole: Card[];
  bet: number;
  contrib: number;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  raiseSeen: number;
  lastAction: string | null;
  shown: boolean;
  vpip?: boolean;
  pfr?: boolean;
  wonShowdown?: boolean;
  sawFlop?: boolean;
  wentToShowdown?: boolean;
  /** Bets and raises after the flop, for the aggression factor. */
  postflopAggr?: number;
  postflopCalls?: number;
}

interface Hand {
  number: number;
  deck: Card[];
  board: Card[];
  rabbitCards: Card[];
  street: Street;
  players: HandPlayer[]; // ordered by seat
  dealerSeat: number;
  sbSeat: number;
  bbSeat: number;
  blinds: BlindLevel;
  currentBet: number;
  lastRaiseSize: number;
  fullRaiseCount: number;
  toAct: number | null; // index into players
  turnEndsAt: number | null;
  turnMs: number | null;
  usingBank: boolean;
  bankStartedAt: number | null;
  /** Turn time left when the game was paused mid-turn (the timer is stopped while paused). */
  frozenMs?: number | null;
  winners: WinnerView[] | null;
  finished: boolean;
  runout: boolean;
  equity?: Record<string, number>;
  /** Who won each pot at showdown, to credit knockouts. */
  potWinners?: { eligible: string[]; winners: string[] }[];
}

interface Clock {
  levelIndex: number;
  onBreak: boolean;
  elapsedMs: number; // elapsed in current phase before runningSince
  runningSince: number | null;
}

export interface TableSnapshot {
  id: string;
  createdAt: number;
  finishedAt?: number;
  lastActive: number;
  settings: TableSettings;
  status: 'waiting' | 'running' | 'paused' | 'finished';
  players: Player[];
  clock: Clock;
  handNumber: number;
  lastDealerSeat: number | null;
  log: LogEntry[];
  hand: Hand | null;
  eliminated?: string[];
  buyEvents?: { playerId: string; kind: 'rebuy' | 'addon' }[];
  playedMs?: number;
}

export class GameError extends Error {}

const LOG_LIMIT = 200;
const FAST = process.env.POKER_FAST === '1';
const NEXT_HAND_DELAY = FAST ? 1 : 4500;
const SHOWDOWN_DELAY = FAST ? 1 : 7000;
// all-in run-out pacing: time to read the shown hands, then each street, with a longer wait before the river
const RUNOUT_FIRST = FAST ? 1 : 3000;
const RUNOUT_STEP = FAST ? 1 : 2500;
const RUNOUT_RIVER = FAST ? 1 : 3500;
/** The run-out river lands face down and is turned over on the clients before the showdown. */
const RUNOUT_SQUEEZE = FAST ? 1 : 1700;
/** A disconnected player gets this long (counted from when they dropped) before they auto check/fold. */
const DISCONNECTED_TURN_MS = 20000;
/** …but never less than this once it is their turn, so the table can see what happens. */
const DISCONNECTED_MIN_TURN_MS = FAST ? 1 : 3000;
/** How long the host must be gone before another player may take over as host. */
export const HOST_CLAIM_AFTER_MS = 60000;

function drawCommunityCards(deck: Card[], dealt: number): Card[] {
  deck.pop(); // burn before each street
  return dealt === 0 ? [deck.pop()!, deck.pop()!, deck.pop()!] : [deck.pop()!];
}

export class Table {
  id: string;
  createdAt: number;
  finishedAt?: number;
  lastActive: number;
  settings: TableSettings;
  status: 'waiting' | 'running' | 'paused' | 'finished' = 'waiting';
  /** Player ids in the order they were knocked out (first out first). */
  eliminated: string[] = [];
  /** Every rebuy and add-on in order, for the payout rotation. */
  buyEvents: { playerId: string; kind: 'rebuy' | 'addon' }[] = [];
  /** Play time (excluding pauses) since the first start. */
  playedMs = 0;
  playingSince: number | null = null;
  shuffling = 0;
  players: Player[] = [];
  clock: Clock = { levelIndex: 0, onBreak: false, elapsedMs: 0, runningSince: null };
  handNumber = 0;
  lastDealerSeat: number | null = null;
  log: LogEntry[] = [];
  hand: Hand | null = null;
  /** Demo table against bots: kept in memory only, never saved or counted in the season. */
  demo = false;

  private timers = new Set<NodeJS.Timeout>();
  private turnTimer: NodeJS.Timeout | null = null;
  private nextHandTimer: NodeJS.Timeout | null = null;
  onChange: () => void = () => {};

  constructor(settings: TableSettings, id?: string) {
    this.id = id ?? randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').toLowerCase();
    this.createdAt = Date.now();
    this.lastActive = Date.now();
    this.settings = settings;
  }

  /* ---------------- persistence ---------------- */

  snapshot(): TableSnapshot {
    return {
      id: this.id, createdAt: this.createdAt, finishedAt: this.finishedAt, lastActive: this.lastActive, settings: this.settings,
      status: this.status, players: this.players.map((p) => ({ ...p, connections: 0 })),
      clock: { ...this.clock }, handNumber: this.handNumber, lastDealerSeat: this.lastDealerSeat,
      log: this.log, hand: this.hand,
      eliminated: this.eliminated, buyEvents: this.buyEvents, playedMs: this.played(),
    };
  }

  static restore(s: TableSnapshot): Table {
    const t = new Table({ ...s.settings, rules: sanitizeRules(s.settings.rules) }, s.id);
    t.createdAt = s.createdAt;
    t.lastActive = s.lastActive;
    if (s.status === 'finished') {
      t.finishedAt = s.finishedAt ?? s.log?.find((e) => e.kind === 'system' && e.text.endsWith(' wins the tournament!'))?.t ?? s.lastActive;
    }
    t.players = s.players.map((p) => ({
      ...p, forfeited: p.forfeited ?? 0, entered: p.entered ?? p.buyIn > 0, timeBankMs: p.timeBankMs ?? 0, place: p.place ?? null,
      connections: 0, awaySince: Date.now(), camOn: false, micOn: false,
    }));
    t.eliminated = s.eliminated ?? [];
    t.buyEvents = s.buyEvents ?? [];
    t.playedMs = s.playedMs ?? 0;
    t.handNumber = s.handNumber;
    t.lastDealerSeat = s.lastDealerSeat;
    t.log = s.log ?? [];
    // freeze the clock where it was
    const c = s.clock;
    t.clock = { ...c, elapsedMs: c.elapsedMs + (c.runningSince ? s.lastActive - c.runningSince : 0), runningSince: null };
    t.status = s.status === 'waiting' || s.status === 'finished' ? s.status : 'paused';
    if (s.hand && !s.hand.finished) {
      // A restart interrupted a hand: void it and give every player their chips back.
      for (const hp of s.hand.players) {
        const p = t.players.find((x) => x.id === hp.id);
        if (p) p.stack += hp.contrib;
      }
      t.addLog('system', `Serveren startet på nytt under hånd nr. ${s.hand.number}. Hånden ble annullert og alle innsatser ble tilbakeført.`);
    }
    if (t.status === 'paused') t.addLog('system', 'Spillet er satt på pause etter omstart. Verten kan starte det igjen.');
    return t;
  }

  /* ---------------- helpers ---------------- */

  private touch() {
    this.lastActive = Date.now();
    this.onChange();
  }

  addLog(kind: LogEntry['kind'], text: string, by?: string) {
    this.log.push({ t: Date.now(), kind, text, by });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  get rules() { return this.settings.rules; }

  player(id: string | null | undefined): Player | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined;
  }

  byToken(token: string | undefined | null): Player | undefined {
    return token ? this.players.find((p) => p.token === token) : undefined;
  }

  private requireHost(id: string) {
    if (!this.player(id)?.isHost) throw new GameError('Bare verten kan gjøre dette.');
  }

  private seatTaken(seat: number) {
    return this.players.some((p) => (p.status === 'seated' && p.seat === seat) || (p.status === 'pending' && p.requestedSeat === seat));
  }

  private name(id: string) { return this.player(id)?.name ?? 'En spiller'; }

  private isTournament() { return this.rules.levelMinutes > 0; }

  /* ---------------- clock ---------------- */

  /** Blinds for a level. The last level in the structure lasts for the rest of the game. */
  levelAt(index: number): BlindLevel {
    const lv = this.rules.levels;
    return lv[Math.min(index, lv.length - 1)];
  }

  private isFinalLevel(index = this.clock.levelIndex) {
    return index >= this.rules.levels.length - 1;
  }

  /** Length of the current phase in ms; Infinity on the final level. */
  private phaseMs(): number {
    if (this.clock.onBreak) return this.rules.breakMinutes * 60000;
    if (this.isFinalLevel()) return Infinity;
    return this.rules.levelMinutes * 60000;
  }

  private phaseElapsed(now = Date.now()): number {
    return this.clock.elapsedMs + (this.clock.runningSince ? now - this.clock.runningSince : 0);
  }

  /** Play time since the first start, excluding pauses. */
  played(now = Date.now()) {
    return this.playedMs + (this.playingSince ? now - this.playingSince : 0);
  }

  private startClock() {
    if (this.clock.runningSince == null) this.clock.runningSince = Date.now();
  }

  private stopClock() {
    if (this.clock.runningSince != null) {
      this.clock.elapsedMs = this.phaseElapsed();
      this.clock.runningSince = null;
    }
  }

  /** Called every second by the server loop. */
  tick(now = Date.now()) {
    // let the other players know when they may take over from a host who dropped
    const host = this.players.find((p) => p.isHost);
    if (host && host.connections === 0 && host.awaySince != null) {
      const away = now - host.awaySince;
      if (away >= HOST_CLAIM_AFTER_MS && away < HOST_CLAIM_AFTER_MS + 1000) this.onChange();
    }
    if (this.status === 'running' && this.isTournament() && this.players.some((p) => p.status === 'seated' && p.stack === 0 && p.place == null)) {
      if (this.checkEliminations()) this.touch();
    }
    if (this.status !== 'running' || this.rules.levelMinutes <= 0 || this.clock.runningSince == null) return;
    if (!this.clock.onBreak && this.isFinalLevel()) return;
    let changed = false;
    while (this.phaseElapsed(now) >= this.phaseMs()) {
      const overflow = this.phaseElapsed(now) - this.phaseMs();
      if (this.clock.onBreak) {
        this.clock.onBreak = false;
        this.clock.levelIndex++;
        this.announceLevel();
      } else {
        const levelNo = this.clock.levelIndex + 1;
        const every = this.rules.breakEveryLevels;
        if (every > 0 && this.rules.breakMinutes > 0 && levelNo % every === 0) {
          this.clock.onBreak = true;
          this.addLog('system', `Pause i ${this.rules.breakMinutes} min. Hånden som pågår, spilles ferdig først.`);
        } else {
          this.clock.levelIndex++;
          this.announceLevel();
        }
      }
      this.clock.elapsedMs = overflow;
      this.clock.runningSince = now;
      changed = true;
    }
    if (changed) {
      if (!this.clock.onBreak) this.maybeStartHand();
      this.touch();
    }
  }

  private announceLevel() {
    const l = this.levelAt(this.clock.levelIndex);
    this.addLog('system', `Nivå ${this.clock.levelIndex + 1} · nye blinds ${fc(l.sb)}/${fc(l.bb)}${l.ante ? ` ante ${fc(l.ante)}` : ''}.`);
    const ru = this.rules.rebuy;
    if (ru.enabled && ru.untilLevel > 0 && this.clock.levelIndex + 1 === ru.untilLevel + 1) {
      this.addLog('system', 'Rebuy-perioden er over.');
    }
    if (this.isFinalLevel()) this.addLog('system', 'Blinds øker ikke mer. Siste nivå varer til spillet er over.');
  }

  /* ---------------- joining & seating ---------------- */

  createPlayer(name: string, isHost = false): Player {
    const p: Player = {
      id: randomUUID(), token: randomBytes(18).toString('base64url'), name: cleanName(name),
      seat: null, requestedSeat: null, requestedBuyIn: 0, stack: 0, status: 'watching', sittingOut: false,
      isHost, buyIn: 0, cashOut: 0, forfeited: 0, rebuys: 0, addOnTaken: false, entered: false, timeBankMs: 0, place: null, camOn: false, micOn: false, connections: 0, awaySince: Date.now(),
    };
    this.players.push(p);
    return p;
  }

  private validBuyIn(amount: number): number {
    if (this.isTournament()) return this.rules.startingStack;
    const n = Math.round(Number(amount));
    if (!Number.isFinite(n) || n <= 0) throw new GameError('Oppgi en buy-in større enn null.');
    if (n > 1e9) throw new GameError('For høy buy-in.');
    return n;
  }

  requestSeat(p: Player, seat: number, name: string, buyIn: number) {
    if (p.status === 'seated') throw new GameError('Du har allerede et sete.');
    if (!Number.isInteger(seat) || seat < 1 || seat > this.settings.maxSeats) throw new GameError('Velg et sete ved bordet.');
    if (this.seatTaken(seat) && p.requestedSeat !== seat) throw new GameError('Setet ble nettopp tatt. Velg et annet.');
    const nm = cleanName(name);
    if (this.players.some((o) => o.id !== p.id && o.status !== 'watching' && o.name.toLowerCase() === nm.toLowerCase())) {
      throw new GameError(`En annen spiller ved bordet heter allerede ${nm}.`);
    }
    p.name = nm;
    const amount = this.validBuyIn(buyIn);
    if (this.settings.requireApproval && !p.isHost) {
      p.status = 'pending';
      p.requestedSeat = seat;
      p.requestedBuyIn = amount;
      this.addLog('system', `${p.name} ber om sete ${seat} med ${fc(amount)} chips.`);
    } else {
      this.seat(p, seat, amount);
    }
    this.touch();
  }

  private seat(p: Player, seat: number, amount: number) {
    p.status = 'seated';
    p.seat = seat;
    p.requestedSeat = null;
    p.requestedBuyIn = 0;
    p.stack += amount;
    p.buyIn += amount;
    p.sittingOut = false;
    p.place = null;
    if (!p.entered) { p.entered = true; p.timeBankMs = this.rules.timeBank.startSeconds * 1000; }
    this.addLog('system', `${p.name} setter seg i sete ${seat} med ${fc(amount)} chips.`);
    this.maybeStartHand();
  }

  approve(hostId: string, playerId: string) {
    this.requireHost(hostId);
    const p = this.player(playerId);
    if (!p || p.status !== 'pending' || p.requestedSeat == null) throw new GameError('Forespørselen er ikke lenger tilgjengelig.');
    this.seat(p, p.requestedSeat, p.requestedBuyIn);
    this.touch();
  }

  reject(hostId: string, playerId: string) {
    this.requireHost(hostId);
    const p = this.player(playerId);
    if (!p || p.status !== 'pending') return;
    p.status = 'watching';
    p.requestedSeat = null;
    p.requestedBuyIn = 0;
    this.addLog('system', `Verten avslo forespørselen fra ${p.name}.`);
    this.touch();
  }

  /** Whether leaving the table pays out the stack. Tournaments keep chips in play once the game has started. */
  canCashOut() {
    return this.rules.cashOut || this.status === 'waiting';
  }

  /** Leave the seat. Cashes out the stack when the rules allow it, otherwise the chips go out of play. */
  leaveSeat(p: Player, reason = 'forlater bordet') {
    if (p.status === 'pending') {
      p.status = 'watching';
      p.requestedSeat = null;
      this.touch();
      return;
    }
    if (p.status !== 'seated') return;
    const hp = this.handPlayer(p.id);
    if (hp && !hp.folded && this.hand && !this.hand.finished) {
      if (this.hand.toAct != null && this.hand.players[this.hand.toAct].id === p.id) {
        this.applyAction(hp, 'fold');
      } else {
        hp.folded = true;
        hp.lastAction = 'Fold';
        this.addLog('action', `${p.name} folder`);
        this.advance();
      }
    }
    if (this.status === 'waiting') {
      p.buyIn -= p.stack;
      p.entered = false;
      this.addLog('system', `${p.name} ${reason}.`);
    } else if (this.canCashOut()) {
      p.cashOut += p.stack;
      this.addLog('system', `${p.name} ${reason} med ${fc(p.stack)} chips.`);
    } else {
      p.forfeited += p.stack;
      this.addLog('system', `${p.name} ${reason}. ${fc(p.stack)} chips tas ut av spill fordi bordet ikke har cash-out.`);
    }
    const wasEntered = p.entered && this.status !== 'waiting';
    p.stack = 0;
    p.seat = null;
    p.status = 'watching';
    p.sittingOut = false;
    if (wasEntered && this.isTournament() && p.place == null) {
      this.eliminate([p]);
      this.checkEliminations();
    }
    this.touch();
  }

  kick(hostId: string, playerId: string) {
    this.requireHost(hostId);
    const p = this.player(playerId);
    if (!p || p.isHost) throw new GameError('Du kan ikke fjerne denne spilleren.');
    this.leaveSeat(p, 'ble fjernet av verten');
  }

  setSittingOut(p: Player, value: boolean) {
    if (p.status !== 'seated') return;
    p.sittingOut = value;
    this.addLog('system', value ? `${p.name} står over inntil videre.` : `${p.name} er tilbake.`);
    if (!value) this.maybeStartHand();
    this.touch();
  }

  rename(p: Player, name: string) {
    const nm = cleanName(name);
    if (nm !== p.name) {
      this.addLog('system', `${p.name} heter nå ${nm}.`);
      p.name = nm;
      this.touch();
    }
  }

  setMedia(p: Player, camOn: boolean, micOn: boolean) {
    p.camOn = !!camOn;
    p.micOn = !!micOn;
    this.onChange();
  }

  /* ---------------- rebuys & stacks ---------------- */

  rebuyOffer(p: Player): RebuyOffer | null {
    if (p.status !== 'seated') return null;
    const r = this.rules.rebuy;
    const levelNo = this.clock.levelIndex + 1;
    const inLiveHand = !!this.handPlayer(p.id) && !!this.hand && !this.hand.finished && !this.handPlayer(p.id)!.folded;
    let reason: string | null = null;
    if (!r.enabled) reason = 'Dette spillet har ingen rebuys.';
    else if (r.untilLevel > 0 && this.isTournament() && levelNo > r.untilLevel) reason = 'Rebuy-perioden er over.';
    else if (r.untilMinutes > 0 && this.status !== 'waiting' && this.played() > r.untilMinutes * 60000) reason = 'Rebuy-perioden er over.';
    else if (p.place != null) reason = 'Du er ute av turneringen.';
    else if (r.maxPerPlayer > 0 && p.rebuys >= r.maxPerPlayer) reason = `Du har nådd grensen på ${r.maxPerPlayer} ${r.maxPerPlayer === 1 ? 'rebuy' : 'rebuys'}.`;
    else if (r.maxStackToRebuy === 0 && p.stack > 0) reason = 'Du kan gjøre rebuy når du er tom for chips.';
    else if (r.maxStackToRebuy > 0 && p.stack > r.maxStackToRebuy) reason = `Du kan gjøre rebuy når du har ${fc(r.maxStackToRebuy)} chips eller færre.`;
    else if (inLiveHand) reason = 'Du kan gjøre rebuy etter denne hånden.';
    const a = this.rules.addOn;
    const addOnAllowed = a.enabled && !p.addOnTaken && !inLiveHand && levelNo >= a.atLevel && levelNo <= a.atLevel + 1;
    return { allowed: reason == null, amount: r.amount, reason, addOnAllowed, addOnAmount: a.amount };
  }

  rebuy(p: Player, amount: number) {
    const offer = this.rebuyOffer(p);
    if (!offer) throw new GameError('Velg et sete ved bordet først.');
    if (!offer.allowed) throw new GameError(offer.reason ?? 'Du kan ikke gjøre rebuy nå.');
    const amt = offer.amount > 0 ? offer.amount : Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1e9) throw new GameError('Oppgi et rebuy-beløp større enn null.');
    p.stack += amt;
    p.buyIn += amt;
    p.rebuys++;
    p.sittingOut = false;
    this.buyEvents.push({ playerId: p.id, kind: 'rebuy' });
    this.addLog('system', `${p.name} gjør rebuy for ${fc(amt)} chips.`);
    this.maybeStartHand();
    this.touch();
  }

  addOn(p: Player) {
    const offer = this.rebuyOffer(p);
    if (!offer?.addOnAllowed) throw new GameError('Add-on er ikke tilgjengelig nå.');
    p.stack += offer.addOnAmount;
    p.buyIn += offer.addOnAmount;
    p.addOnTaken = true;
    this.buyEvents.push({ playerId: p.id, kind: 'addon' });
    this.addLog('system', `${p.name} tar en add-on på ${fc(offer.addOnAmount)} chips.`);
    this.touch();
  }

  adjustStack(hostId: string, playerId: string, newStack: number) {
    this.requireHost(hostId);
    const p = this.player(playerId);
    if (!p || p.status !== 'seated') throw new GameError('Spilleren har ikke noe sete ved bordet.');
    const hp = this.handPlayer(p.id);
    if (hp && this.hand && !this.hand.finished && !hp.folded) throw new GameError('Vent til hånden er ferdig.');
    const n = Math.round(Number(newStack));
    if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new GameError('Oppgi en stack på null eller mer.');
    const delta = n - p.stack;
    p.stack = n;
    p.buyIn += delta;
    this.addLog('system', `${p.name} fikk stacken justert av verten til ${fc(n)} (${delta >= 0 ? '+' : ''}${fc(delta)}).`);
    this.maybeStartHand();
    this.touch();
  }

  /* ---------------- host controls ---------------- */

  start(hostId: string) {
    this.requireHost(hostId);
    if (this.status === 'running') return;
    if (this.status === 'finished') throw new GameError('Spillet er over. Åpne et nytt bord for å spille igjen.');
    const wasPaused = this.status === 'paused';
    if (!wasPaused && this.players.filter((p) => p.status === 'seated' && p.stack > 0).length < 2) {
      throw new GameError('Minst to spillere må ha chips før spillet kan starte.');
    }
    this.status = 'running';
    if (this.rules.levelMinutes > 0) this.startClock();
    if (this.playingSince == null) this.playingSince = Date.now();
    this.addLog('system', wasPaused ? 'Spillet fortsetter.' : 'Spillet har startet. Trekker seter …');
    if (!wasPaused) {
      this.announceLevelStart();
      this.shuffleSeats();
    } else if (this.hand && !this.hand.finished) {
      this.thawTurn(this.hand);
    } else {
      this.maybeStartHand();
    }
    this.touch();
  }

  /** Shuffle the seated players around the table three times, then deal. */
  private shuffleSeats() {
    const STEP = FAST ? 1 : 1300;
    const step = (n: number) => {
      if (this.status !== 'running') { this.shuffling = 0; this.touch(); return; }
      const seated = this.players.filter((p) => p.status === 'seated' && p.seat != null);
      const seats = seated.map((p) => p.seat!);
      for (let i = seats.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [seats[i], seats[j]] = [seats[j], seats[i]];
      }
      // make sure something visibly moves
      if (seats.length > 1 && seated.every((p, i) => p.seat === seats[i])) seats.push(seats.shift()!);
      seated.forEach((p, i) => { p.seat = seats[i]; });
      this.shuffling = n;
      this.touch();
      if (n < 3) this.later(STEP, () => step(n + 1));
      else this.later(STEP, () => {
        this.shuffling = 0;
        this.addLog('system', `Spillere etter setenummer: ${seated.slice().sort((a, b) => a.seat! - b.seat!).map((p) => p.name).join(', ')}. Kortene deles ut.`);
        this.maybeStartHand();
        this.touch();
      });
    };
    step(1);
  }

  private announceLevelStart() {
    const l = this.levelAt(this.clock.levelIndex);
    this.addLog('system', `Nivå ${this.clock.levelIndex + 1} · ${fc(l.sb)}/${fc(l.bb)}${l.ante ? ` ante ${fc(l.ante)}` : ''}.`);
  }

  pause(hostId: string) {
    this.requireHost(hostId);
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.stopClock();
    if (this.playingSince != null) { this.playedMs = this.played(); this.playingSince = null; }
    if (this.nextHandTimer) { clearTimeout(this.nextHandTimer); this.nextHandTimer = null; }
    const h = this.hand;
    const midHand = !!h && !h.finished;
    if (h && midHand) this.freezeTurn(h);
    this.addLog('system', midHand ? 'Verten har satt spillet på pause. Hånden fortsetter når verten starter igjen.' : 'Verten har satt spillet på pause.');
    this.touch();
  }

  /** Stop the acting player's clock and remember how much of it is left. */
  private freezeTurn(h: Hand) {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.timers.delete(this.turnTimer); this.turnTimer = null; }
    if (h.toAct == null) { h.frozenMs = null; return; }
    if (h.usingBank && h.bankStartedAt != null) {
      const p = this.player(h.players[h.toAct].id);
      if (p) p.timeBankMs = Math.max(0, p.timeBankMs - (Date.now() - h.bankStartedAt));
      h.bankStartedAt = null;
    }
    h.frozenMs = h.turnEndsAt != null ? Math.max(0, h.turnEndsAt - Date.now()) : null;
    h.turnEndsAt = null;
  }

  /** Restart the acting player's clock with the time they had left when the game was paused. */
  private thawTurn(h: Hand) {
    const left = h.frozenMs;
    h.frozenMs = null;
    if (h.toAct == null) return;
    const hp = h.players[h.toAct];
    const p = this.player(hp.id);
    if (p && p.connections === 0) { this.startTurn(); return; }
    if (h.usingBank && p) {
      h.bankStartedAt = Date.now();
      this.armTurn(hp.id, p.timeBankMs, () => { p.timeBankMs = 0; h.usingBank = false; this.timeOut(); });
      return;
    }
    this.startTurn(left ?? undefined);
  }

  /** Any seated player may take over as host once the host has been disconnected for a while. */
  canClaimHost(playerId: string | null): boolean {
    const me = this.player(playerId);
    if (!me || me.isHost || me.status !== 'seated') return false;
    const host = this.players.find((p) => p.isHost);
    if (!host) return true;
    return host.connections === 0 && Date.now() - (host.awaySince ?? 0) >= HOST_CLAIM_AFTER_MS;
  }

  claimHost(playerId: string) {
    if (!this.canClaimHost(playerId)) throw new GameError('Verten er fortsatt her. Be verten om å gi deg rollen.');
    const to = this.player(playerId)!;
    const from = this.players.find((p) => p.isHost);
    for (const p of this.players) p.isHost = p.id === to.id;
    this.addLog('system', from ? `${to.name} overtok som vert mens ${from.name} var borte.` : `${to.name} er nå vert.`);
    this.touch();
  }

  setLevel(hostId: string, levelIndex: number) {
    this.requireHost(hostId);
    const n = Math.max(0, Math.min(this.rules.levels.length - 1, Math.round(levelIndex)));
    this.clock.levelIndex = n;
    this.clock.onBreak = false;
    this.clock.elapsedMs = 0;
    if (this.clock.runningSince != null) this.clock.runningSince = Date.now();
    this.announceLevelStart();
    this.touch();
  }

  updateSettings(hostId: string, s: TableSettings) {
    this.requireHost(hostId);
    const oldMs = this.rules.levelMinutes;
    this.settings = s;
    if (this.status === 'running') {
      if (s.rules.levelMinutes > 0) this.startClock();
      else this.stopClock();
    }
    if (this.clock.levelIndex > s.rules.levels.length - 1) this.clock.levelIndex = s.rules.levels.length - 1;
    if (oldMs !== s.rules.levelMinutes && this.clock.elapsedMs > this.phaseMs()) this.clock.elapsedMs = 0;
    this.addLog('system', `Verten oppdaterte reglene til «${s.rules.name}».`);
    this.touch();
  }

  transferHost(hostId: string, playerId: string) {
    this.requireHost(hostId);
    const to = this.player(playerId);
    if (!to) throw new GameError('Fant ikke spilleren.');
    for (const p of this.players) p.isHost = p.id === to.id;
    this.addLog('system', `${to.name} er nå vert.`);
    this.touch();
  }

  /* ---------------- hand flow ---------------- */

  private handPlayer(id: string): HandPlayer | undefined {
    return this.hand?.players.find((h) => h.id === id);
  }

  private eligibleForHand(): Player[] {
    return this.players
      .filter((p) => p.status === 'seated' && !p.sittingOut && p.stack > 0 && p.seat != null)
      .sort((a, b) => a.seat! - b.seat!);
  }

  private maybeStartHand() {
    if (this.status !== 'running' || this.clock.onBreak || this.shuffling) return;
    if (this.hand && !this.hand.finished) return;
    if (this.nextHandTimer) return;
    if (this.eligibleForHand().length < 2) return;
    // small delay so seat changes settle and the previous result stays readable
    const delay = FAST || this.hand?.finished ? 0 : 1500;
    this.nextHandTimer = this.later(delay, () => { this.nextHandTimer = null; this.startHand(); });
  }

  private startHand() {
    if (this.status !== 'running' || this.clock.onBreak) return;
    const seated = this.eligibleForHand();
    if (seated.length < 2) { this.hand = null; this.touch(); return; }

    const seats = seated.map((p) => p.seat!);
    const nextSeat = (from: number) => seats.find((s) => s > from) ?? seats[0];
    const dealerSeat = this.lastDealerSeat == null ? seats[Math.floor(Math.random() * seats.length)] : nextSeat(this.lastDealerSeat);
    const headsUp = seats.length === 2;
    const sbSeat = headsUp ? dealerSeat : nextSeat(dealerSeat);
    const bbSeat = nextSeat(sbSeat);
    this.lastDealerSeat = dealerSeat;
    this.handNumber++;
    const tb = this.rules.timeBank;
    if (tb.enabled && tb.everyHands > 0 && tb.addSeconds > 0 && this.handNumber > 1 && (this.handNumber - 1) % tb.everyHands === 0) {
      for (const p of this.players) if (p.status === 'seated') p.timeBankMs = Math.min(tb.maxSeconds * 1000, p.timeBankMs + tb.addSeconds * 1000);
      this.addLog('system', `Alle fikk ${tb.addSeconds} s ekstra i tidsbanken.`);
    }

    const blinds = this.levelAt(this.clock.levelIndex);
    const deck = shuffledDeck();
    const players: HandPlayer[] = seated.map((p) => ({
      id: p.id, seat: p.seat!, hole: [], bet: 0, contrib: 0, folded: false, allIn: false,
      acted: false, raiseSeen: 0, lastAction: null, shown: false,
    }));
    const h: Hand = {
      number: this.handNumber, deck, board: [], rabbitCards: [], street: 'preflop', players, dealerSeat, sbSeat, bbSeat, blinds,
      currentBet: 0, lastRaiseSize: blinds.bb, fullRaiseCount: 0, toAct: null, turnEndsAt: null, turnMs: null, usingBank: false, bankStartedAt: null,
      winners: null, finished: false, runout: false,
    };
    this.hand = h;
    this.addLog('hand', `Hånd nr. ${h.number} · ${fc(blinds.sb)}/${fc(blinds.bb)}${blinds.ante ? ` · ante ${fc(blinds.ante)}` : ''} · dealer ${this.name(players.find((x) => x.seat === dealerSeat)!.id)}`);

    // antes go straight to the pot
    if (blinds.ante > 0) {
      for (const hp of players) {
        const p = this.player(hp.id)!;
        const a = Math.min(blinds.ante, p.stack);
        p.stack -= a;
        hp.contrib += a;
        if (p.stack === 0) hp.allIn = true;
      }
    }
    const post = (seat: number, amount: number, label: string) => {
      const hp = players.find((x) => x.seat === seat)!;
      const p = this.player(hp.id)!;
      const a = Math.min(amount, p.stack);
      p.stack -= a;
      hp.bet += a;
      hp.contrib += a;
      if (p.stack === 0) hp.allIn = true;
      hp.lastAction = label;
      this.addLog('action', `${p.name} legger ${label.toLowerCase()} på ${fc(a)}`);
    };
    post(sbSeat, blinds.sb, 'SB');
    post(bbSeat, blinds.bb, 'BB');
    h.currentBet = blinds.bb;

    // deal two cards each, starting left of the dealer
    const startIdx = players.findIndex((x) => x.seat === sbSeat);
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < players.length; i++) players[(startIdx + i) % players.length].hole.push(deck.pop()!);
    }

    const bbIdx = players.findIndex((x) => x.seat === bbSeat);
    h.toAct = this.nextNeeding(bbIdx);
    if (h.toAct == null) this.advance();
    else this.startTurn();
    this.touch();
  }

  private needsAction(hp: HandPlayer): boolean {
    const h = this.hand!;
    if (hp.folded || hp.allIn) return false;
    return !hp.acted || hp.bet < h.currentBet;
  }

  /** Index of the next player after `fromIdx` (exclusive) who must act, or null. */
  private nextNeeding(fromIdx: number): number | null {
    const h = this.hand!;
    const n = h.players.length;
    const live = h.players.filter((x) => !x.folded && !x.allIn);
    // If only one player can still act and they have matched the bet, nobody needs to act.
    if (live.length === 1 && live[0].bet >= h.currentBet && h.players.filter((x) => !x.folded).length > 1) {
      // they may still need to act if facing nothing but haven't acted? No: no one left to bet against.
      return null;
    }
    for (let i = 1; i <= n; i++) {
      const idx = (fromIdx + i) % n;
      if (this.needsAction(h.players[idx])) return idx;
    }
    return null;
  }

  /** Start the clock for whoever is to act. `leftMs` resumes a turn that was paused part-way. */
  private startTurn(leftMs?: number) {
    const h = this.hand!;
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.timers.delete(this.turnTimer); this.turnTimer = null; }
    h.usingBank = false;
    h.bankStartedAt = null;
    h.frozenMs = null;
    if (h.toAct == null) { h.turnEndsAt = null; h.turnMs = null; return; }
    const hp = h.players[h.toAct];
    const p = this.player(hp.id);
    const full: number | null = this.rules.turnSeconds > 0 ? this.rules.turnSeconds * 1000 : null;
    let ms = full;
    let left = leftMs != null && full != null ? Math.min(leftMs, full) : full;
    const away = !!p && p.connections === 0;
    if (away) {
      // The grace period runs from when they dropped, so a player who stays gone does not stall every hand.
      const grace = Math.max(DISCONNECTED_MIN_TURN_MS, DISCONNECTED_TURN_MS - (Date.now() - (p.awaySince ?? Date.now())));
      ms = Math.min(full ?? DISCONNECTED_TURN_MS, DISCONNECTED_TURN_MS);
      left = Math.min(left ?? grace, grace);
    }
    if (this.status === 'paused') {
      // e.g. the next street was dealt after the host paused: wait for resume before the clock runs
      h.turnMs = ms;
      h.turnEndsAt = null;
      h.frozenMs = left;
      return;
    }
    this.armTurn(hp.id, left, () => {
      // regular time is up: dip into the time bank if there is one
      const bank = p?.timeBankMs ?? 0;
      if (this.rules.timeBank.enabled && !away && bank > 0) {
        h.usingBank = true;
        h.bankStartedAt = Date.now();
        this.addLog('action', `${p!.name} bruker tidsbanken sin`);
        this.armTurn(hp.id, bank, () => { if (p) p.timeBankMs = 0; h.usingBank = false; this.timeOut(); });
        this.touch();
      } else this.timeOut();
    }, ms);
  }

  /** `ms` is how long until `onExpire`; `totalMs` is the full length of the clock shown to players. */
  private armTurn(who: string, ms: number | null, onExpire: () => void, totalMs: number | null = ms) {
    const h = this.hand!;
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.timers.delete(this.turnTimer); this.turnTimer = null; }
    h.turnMs = totalMs ?? ms;
    h.turnEndsAt = ms != null ? Date.now() + ms : null;
    if (ms == null) return;
    const handNo = h.number;
    this.turnTimer = this.later(ms, () => {
      const cur = this.hand;
      if (!cur || cur.number !== handNo || cur.finished || cur.toAct == null || cur.players[cur.toAct].id !== who) return;
      onExpire();
    });
  }

  private timeOut() {
    const cur = this.hand;
    if (!cur || cur.finished || cur.toAct == null) return;
    const me = cur.players[cur.toAct];
    if (me.bet >= cur.currentBet) this.applyAction(me, 'check', 0, true);
    else this.applyAction(me, 'fold', 0, true);
    this.touch();
  }

  /** Re-arm the timer when someone (dis)connects on their turn. */
  connectionChanged(p: Player) {
    if (p.connections === 0) p.awaySince ??= Date.now();
    else p.awaySince = null;
    const h = this.hand;
    if (this.status === 'paused') return;
    if (h && !h.finished && h.toAct != null && h.players[h.toAct].id === p.id) {
      if (p.connections === 0 || this.rules.turnSeconds === 0) this.startTurn();
    }
  }

  legal(playerId: string): Legal | null {
    const h = this.hand;
    if (!h || h.finished || h.toAct == null) return null;
    const hp = h.players[h.toAct];
    if (hp.id !== playerId) return null;
    const p = this.player(playerId)!;
    const toCall = Math.max(0, h.currentBet - hp.bet);
    const callAmount = Math.min(toCall, p.stack);
    const maxRaiseTo = hp.bet + p.stack;
    const othersCanAct = h.players.some((x) => x.id !== hp.id && !x.folded && !x.allIn);
    const reopened = !hp.acted || hp.raiseSeen < h.fullRaiseCount;
    const canRaise = p.stack > toCall && reopened && othersCanAct;
    const minRaiseTo = Math.min(maxRaiseTo, h.currentBet + h.lastRaiseSize);
    return { canFold: true, canCheck: toCall === 0, callAmount, canRaise, minRaiseTo, maxRaiseTo, bet: hp.bet };
  }

  act(playerId: string, type: string, amount = 0) {
    const h = this.hand;
    if (!h || h.finished || h.toAct == null) throw new GameError('Du har ingen valg å ta akkurat nå.');
    const hp = h.players[h.toAct];
    if (hp.id !== playerId) throw new GameError('Det er ikke din tur.');
    if (this.status === 'paused') throw new GameError('Spillet er satt på pause.');
    this.applyAction(hp, type, amount);
    this.touch();
  }

  private applyAction(hp: HandPlayer, type: string, amount = 0, timedOut = false) {
    const h = this.hand!;
    const p = this.player(hp.id)!;
    if (h.usingBank && h.bankStartedAt != null && h.toAct != null && h.players[h.toAct].id === hp.id) {
      p.timeBankMs = Math.max(0, p.timeBankMs - (Date.now() - h.bankStartedAt));
      h.usingBank = false;
      h.bankStartedAt = null;
    }
    const legal = this.legal(hp.id)!;
    const pay = (x: number) => {
      const a = Math.min(x, p.stack);
      p.stack -= a;
      hp.bet += a;
      hp.contrib += a;
      if (p.stack === 0) hp.allIn = true;
    };
    const suffix = timedOut ? ' (tiden gikk ut)' : '';

    if (type === 'allin') {
      if (legal.canRaise && legal.maxRaiseTo > h.currentBet) { type = 'raise'; amount = legal.maxRaiseTo; }
      else type = legal.canCheck ? 'check' : 'call';
    }

    switch (type) {
      case 'fold':
        // Folding when you could check is allowed; the client asks for a second click first.
        hp.folded = true;
        hp.lastAction = 'Fold';
        this.addLog('action', `${p.name} folder${suffix}`);
        break;
      case 'check':
        if (!legal.canCheck) throw new GameError(`Velg call på ${fc(legal.callAmount)} eller fold.`);
        hp.lastAction = 'Check';
        this.addLog('action', `${p.name} checker${suffix}`);
        break;
      case 'call': {
        if (legal.callAmount === 0) { hp.lastAction = 'Check'; this.addLog('action', `${p.name} checker`); break; }
        pay(legal.callAmount);
        if (h.street === 'preflop') hp.vpip = true;
        else hp.postflopCalls = (hp.postflopCalls ?? 0) + 1;
        hp.lastAction = hp.allIn ? 'All-in' : 'Call';
        this.addLog('action', `${p.name} caller ${fc(legal.callAmount)}${hp.allIn ? ' og er all-in' : ''}`);
        break;
      }
      case 'raise':
      case 'bet': {
        if (!legal.canRaise) throw new GameError('Du kan ikke raise nå.');
        let to = Math.round(Number(amount));
        if (!Number.isFinite(to)) throw new GameError('Oppgi et beløp.');
        to = Math.min(to, legal.maxRaiseTo);
        if (to < legal.minRaiseTo && to < legal.maxRaiseTo) throw new GameError(`Minstebeløpet er ${fc(legal.minRaiseTo)}.`);
        const wasBet = h.currentBet === 0;
        const raiseSize = to - h.currentBet;
        pay(to - hp.bet);
        if (h.street === 'preflop') { hp.vpip = true; hp.pfr = true; } else hp.postflopAggr = (hp.postflopAggr ?? 0) + 1;
        if (raiseSize >= h.lastRaiseSize) {
          h.lastRaiseSize = raiseSize;
          h.fullRaiseCount++;
        }
        h.currentBet = Math.max(h.currentBet, to);
        hp.lastAction = hp.allIn ? 'All-in' : wasBet ? 'Bet' : 'Raise';
        this.addLog('action', `${p.name} ${wasBet ? 'better' : 'raiser til'} ${fc(to)}${hp.allIn ? ' (all-in)' : ''}`);
        break;
      }
      default:
        throw new GameError('Ukjent handling.');
    }
    hp.acted = true;
    hp.raiseSeen = h.fullRaiseCount;
    this.advance();
  }

  private advance() {
    const h = this.hand!;
    if (h.finished) return;
    const notFolded = h.players.filter((x) => !x.folded);
    if (notFolded.length === 1) { this.winUncontested(notFolded[0]); return; }

    const from = h.toAct ?? 0;
    const next = this.nextNeeding(from);
    if (next != null) {
      h.toAct = next;
      this.startTurn();
      return;
    }
    // street complete
    h.toAct = null;
    this.startTurn();
    this.collectBets();
    if (h.street === 'river') { this.showdown(); return; }

    const canAct = notFolded.filter((x) => !x.allIn);
    if (canAct.length <= 1) {
      // all-in: reveal and run it out
      const first = !h.runout;
      if (!h.runout) {
        h.runout = true;
        for (const x of notFolded) x.shown = true;
        this.addLog('hand', 'All-in. Kortene vises.');
      }
      h.equity = allInEquity(notFolded, h.board, h.players.filter(x => x.folded && x.shown).flatMap(x => x.hole));
      const boardLength = h.board.length;
      const wait = first ? RUNOUT_FIRST : boardLength === 4 ? RUNOUT_RIVER : RUNOUT_STEP;
      this.later(wait, () => {
        if (this.hand !== h || h.finished || h.board.length !== boardLength) return;
        this.dealStreet();
        if (h.board.length === 5) {
          this.touch();
          this.later(RUNOUT_SQUEEZE, () => {
            if (this.hand !== h || h.finished) return;
            this.advance();
            this.touch();
          });
          return;
        }
        this.advance();
        this.touch();
      });
      return;
    }
    this.dealStreet();
    const dealerIdx = h.players.findIndex((x) => x.seat === h.dealerSeat);
    h.toAct = this.nextNeeding(dealerIdx >= 0 ? dealerIdx : this.indexBeforeSeat(h.dealerSeat));
    this.startTurn();
  }

  private indexBeforeSeat(seat: number): number {
    const h = this.hand!;
    let idx = h.players.length - 1;
    for (let i = 0; i < h.players.length; i++) if (h.players[i].seat < seat) idx = i;
    return idx;
  }

  private collectBets() {
    const h = this.hand!;
    for (const x of h.players) { x.bet = 0; x.acted = false; x.raiseSeen = 0; if (!x.folded && !x.allIn) x.lastAction = null; }
    h.currentBet = 0;
    h.lastRaiseSize = h.blinds.bb;
    h.fullRaiseCount = 0;
  }

  private dealStreet() {
    const h = this.hand!;
    h.board.push(...drawCommunityCards(h.deck, h.board.length));
    h.street = h.board.length === 3 ? 'flop' : h.board.length === 4 ? 'turn' : 'river';
    if (h.street === 'flop') for (const x of h.players) if (!x.folded) x.sawFlop = true;
    this.addLog('hand', `${h.street[0].toUpperCase()}${h.street.slice(1)}: ${h.board.join(' ')}`);
  }

  computePots(): { amount: number; eligible: string[] }[] {
    const h = this.hand!;
    const levels = [...new Set(h.players.map((x) => x.contrib).filter((c) => c > 0))].sort((a, b) => a - b);
    const pots: { amount: number; eligible: string[] }[] = [];
    let prev = 0;
    for (const lvl of levels) {
      let amount = 0;
      for (const x of h.players) amount += Math.max(0, Math.min(x.contrib, lvl) - prev);
      const eligible = h.players.filter((x) => !x.folded && x.contrib >= lvl).map((x) => x.id);
      const last = pots[pots.length - 1];
      if (last && sameSet(last.eligible, eligible)) last.amount += amount;
      else if (amount > 0) pots.push({ amount, eligible });
      prev = lvl;
    }
    // pots nobody is eligible for (everyone folded above that level) go to the previous pot
    for (let i = pots.length - 1; i > 0; i--) {
      if (pots[i].eligible.length === 0) { pots[i - 1].amount += pots[i].amount; pots.splice(i, 1); }
    }
    return pots;
  }

  private winUncontested(winner: HandPlayer) {
    const h = this.hand!;
    const total = h.players.reduce((s, x) => s + x.contrib, 0);
    const p = this.player(winner.id);
    if (p) p.stack += total;
    for (const x of h.players) x.bet = 0;
    h.winners = [{ playerId: winner.id, amount: total, hand: null, cards: [] }];
    this.addLog('hand', `${this.name(winner.id)} vinner ${fc(total)}`);
    this.finishHand(NEXT_HAND_DELAY);
  }

  private showdown() {
    const h = this.hand!;
    h.street = 'showdown';
    const contenders = h.players.filter((x) => !x.folded);
    for (const x of contenders) { x.shown = true; if (contenders.length > 1) x.wentToShowdown = true; }
    const values = new Map(contenders.map((x) => [x.id, bestHand([...x.hole, ...h.board])]));
    const pots = this.computePots();
    const won = new Map<string, { amount: number; hand: string; cards: Card[] }>();
    // seat order starting left of the dealer for odd chips
    h.potWinners = [];
    const dealerIndex = h.players.findIndex(p => p.seat === h.dealerSeat);
    const order = [...h.players.slice(dealerIndex + 1), ...h.players.slice(0, dealerIndex + 1)];
    for (const pot of pots) {
      const elig = pot.eligible.filter((id) => values.has(id));
      if (!elig.length) continue;
      const best = Math.max(...elig.map((id) => values.get(id)!.score));
      const winners = order.filter((x) => elig.includes(x.id) && values.get(x.id)!.score === best);
      h.potWinners.push({ eligible: elig, winners: winners.map((w) => w.id) });
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      for (const w of winners) {
        const amt = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
        if (elig.length > 1 && amt > 0) w.wonShowdown = true;
        const v = values.get(w.id)!;
        const prev = won.get(w.id);
        won.set(w.id, { amount: (prev?.amount ?? 0) + amt, hand: v.name, cards: v.cards });
      }
    }
    for (const x of contenders) {
      const v = values.get(x.id)!;
      const p = this.player(x.id);
      if (p && contenders.length > 1 && v.score > (p.bestHand?.score ?? -1)) p.bestHand = { score: v.score, name: v.name, cards: v.cards };
      this.addLog('hand', `${this.name(x.id)} viser ${x.hole.join(' ')} (${v.name})`);
    }
    h.winners = [];
    for (const [id, w] of won) {
      const p = this.player(id);
      if (p) p.stack += w.amount;
      h.winners.push({ playerId: id, amount: w.amount, hand: w.hand, cards: w.cards });
      this.addLog('hand', `${this.name(id)} vinner ${fc(w.amount)} med ${w.hand}`);
    }
    this.finishHand(SHOWDOWN_DELAY);
  }

  private finishHand(delay: number) {
    const h = this.hand!;
    h.finished = true;
    delete h.equity;
    h.toAct = null;
    h.turnEndsAt = null;
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    // Commit only completed hands. On restore, an interrupted hand and its flags are voided.
    for (const hp of h.players) {
      const stats = this.player(hp.id)!.stats ??= emptyStats();
      // Nights that began before these counters existed never start them, so their rates share one denominator.
      if (stats.hands === 0 || stats.showdowns != null) {
        stats.flopsSeen = (stats.flopsSeen ?? 0) + (hp.sawFlop ? 1 : 0);
        stats.showdowns = (stats.showdowns ?? 0) + (hp.wentToShowdown ? 1 : 0);
        stats.showdownsWonTracked = (stats.showdownsWonTracked ?? 0) + (hp.wonShowdown ? 1 : 0);
        stats.postflopAggr = (stats.postflopAggr ?? 0) + (hp.postflopAggr ?? 0);
        stats.postflopCalls = (stats.postflopCalls ?? 0) + (hp.postflopCalls ?? 0);
      }
      stats.hands++;
      if (hp.vpip) stats.vpipHands++;
      if (hp.pfr) stats.pfrHands++;
      if (hp.wonShowdown) stats.showdownsWon++;
      const award = h.winners?.find((w) => w.playerId === hp.id);
      if (award && award.amount > 0) stats.handsWon = (stats.handsWon ?? 0) + 1;
      if (award) {
        const matched = Math.max(...h.players.filter((other) => other !== hp).map((other) => other.contrib));
        const uncalled = Math.max(0, hp.contrib - matched);
        stats.biggestPot = Math.max(stats.biggestPot, award.amount - uncalled);
      }
    }
    // bust-outs sit out until they rebuy
    for (const hp of h.players) {
      const p = this.player(hp.id);
      if (p && p.stack === 0) {
        // Credit the winners of the last pot the busted player could win; a split pot credits each winner.
        const pot = [...h.potWinners ?? []].reverse().find((x) => x.eligible.includes(hp.id));
        const knockers = (pot?.winners ?? h.winners?.map((w) => w.playerId) ?? []).filter((id) => id !== hp.id);
        for (const id of knockers) { const k = this.player(id); if (k) (k.knockouts ??= []).push(hp.id); }
      }
      if (p && p.status === 'seated' && p.stack === 0) {
        const offer = this.rebuyOffer(p);
        this.addLog('system', offer?.allowed ? `${p.name} er tom for chips og kan gjøre rebuy.` : `${p.name} er tom for chips.`);
      }
    }
    if (this.isTournament()) this.checkEliminations(h);
    this.scheduleNextHand(delay);
  }

  private scheduleNextHand(delay: number) {
    if (this.nextHandTimer) { clearTimeout(this.nextHandTimer); this.timers.delete(this.nextHandTimer); }
    this.nextHandTimer = this.later(delay, () => {
      this.nextHandTimer = null;
      if (this.status === 'running' && !this.clock.onBreak && !this.shuffling && this.eligibleForHand().length >= 2) this.startHand();
      else { this.touch(); }
    });
  }

  /** Voluntarily show cards after the hand (e.g. after winning uncontested). */
  show(playerId: string) {
    const hp = this.handPlayer(playerId);
    if (!hp || !this.hand?.finished) throw new GameError('Du kan vise kortene dine etter hånden.');
    hp.shown = true;
    this.addLog('hand', `${this.name(playerId)} viser ${hp.hole.join(' ')}`);
    this.touch();
  }

  private allowsRabbitHunt(playerId: string | null): boolean {
    const h = this.hand;
    return !!(this.rules.rabbitHunt && h?.finished && h.board.length < 5 &&
      h.winners?.length === 1 && h.winners[0].hand === null &&
      h.players.some((p) => p.id === playerId));
  }

  rabbitHunt(playerId: string, handNumber: number) {
    const h = this.hand;
    if (!h || h.number !== handNumber || !this.allowsRabbitHunt(playerId)) {
      throw new GameError('Rabbit hunt er ikke tilgjengelig for denne hånden.');
    }
    if (h.rabbitCards.length) return;
    const deck = [...h.deck];
    while (h.board.length + h.rabbitCards.length < 5) {
      h.rabbitCards.push(...drawCommunityCards(deck, h.board.length + h.rabbitCards.length));
    }
    this.addLog('hand', `Rabbit hunt · hånd nr. ${h.number} · ${this.name(playerId)} viser ${h.rabbitCards.join(' ')}`);
    if (this.status === 'running') this.scheduleNextHand(NEXT_HAND_DELAY);
    this.touch();
  }

  /* ---------------- tournament results ---------------- */

  private entrants() { return this.players.filter((p) => p.entered); }

  private eliminate(list: Player[]) {
    for (const p of list) {
      if (p.place != null) continue;
      p.place = this.entrants().filter((x) => x.place == null).length;
      this.eliminated.push(p.id);
      this.addLog('system', `${p.name} ender på ${p.place}. plass.`);
    }
  }

  /**
   * Knock out busted players who can no longer rebuy, and crown the winner when one
   * player is left. Returns true when anything changed.
   */
  private checkEliminations(hand?: Hand): boolean {
    if (!this.isTournament() || this.status === 'waiting' || this.status === 'finished') return false;
    const contrib = (id: string) => hand?.players.find((x) => x.id === id)?.contrib ?? 0;
    const out = this.players
      .filter((p) => p.entered && p.place == null && p.status === 'seated' && p.stack === 0)
      .filter((p) => !(this.hand && !this.hand.finished && this.hand.players.some((x) => x.id === p.id && !x.folded)))
      .filter((p) => !this.rebuyOffer(p)?.allowed)
      .sort((a, b) => contrib(a.id) - contrib(b.id)); // smaller stack going in finishes lower
    let changed = false;
    if (out.length) { this.eliminate(out); changed = true; }
    const alive = this.entrants().filter((p) => p.place == null);
    const waitingOnRebuy = alive.some((p) => p.stack === 0);
    if (alive.length === 1 && !waitingOnRebuy && this.eliminated.length > 0) {
      const w = alive[0];
      w.place = 1;
      this.status = 'finished';
      this.finishedAt = Date.now();
      this.stopClock();
      if (this.playingSince != null) { this.playedMs = this.played(); this.playingSince = null; }
      if (this.nextHandTimer) { clearTimeout(this.nextHandTimer); this.nextHandTimer = null; }
      this.addLog('system', `${w.name} vinner turneringen!`);
      changed = true;
    }
    return changed;
  }

  private results(): ResultsView | null {
    const pr = this.rules.payout;
    if (!pr.enabled) return null;
    const entries = this.entrants().length;
    const events = this.buyEvents.map((e) => e.kind);
    const amounts = payoutAmounts(entries, events, pr, entries);
    const paid: Record<string, number> = {};
    for (const p of this.entrants()) paid[p.id] = pr.buyIn;
    for (const e of this.buyEvents) paid[e.playerId] = (paid[e.playerId] ?? 0) + (e.kind === 'addon' ? pr.addOn : pr.rebuy);
    return {
      currency: pr.currency,
      entries,
      rebuys: events.filter((e) => e === 'rebuy').length,
      addOns: events.filter((e) => e === 'addon').length,
      pool: amounts.reduce((a, b) => a + b, 0),
      paid,
      places: amounts.map((prize, i) => {
        const p = this.players.find((x) => x.place === i + 1);
        return { place: i + 1, playerId: p?.id ?? null, name: p?.name ?? null, prize };
      }),
    };
  }

  /* ---------------- views ---------------- */

  private clockView(): ClockView {
    const idx = this.clock.levelIndex;
    const timed = this.rules.levelMinutes > 0;
    const final = timed && !this.clock.onBreak && this.isFinalLevel(idx);
    const levelMs = timed && !final ? this.phaseMs() : 0;
    const remainingMs = levelMs ? Math.max(0, levelMs - this.phaseElapsed()) : 0;
    return {
      running: this.clock.runningSince != null,
      levelIndex: idx,
      level: this.levelAt(idx),
      next: timed && !this.isFinalLevel(idx) ? this.levelAt(idx + 1) : null,
      final,
      levelMs,
      remainingMs,
      onBreak: this.clock.onBreak,
      rebuyEndsInMs: this.rules.rebuy.enabled && this.rules.rebuy.untilMinutes > 0 && this.status !== 'waiting' && this.status !== 'finished'
        ? Math.max(0, this.rules.rebuy.untilMinutes * 60000 - this.played()) : null,
      at: Date.now(),
    };
  }

  private ledger(): LedgerRow[] {
    return this.players
      .filter((p) => p.buyIn > 0 || p.cashOut > 0 || p.forfeited > 0)
      .map((p) => ({
        playerId: p.id, name: p.name, buyIn: p.buyIn, cashOut: p.cashOut, forfeited: p.forfeited, stack: p.stack,
        net: p.cashOut + p.stack - p.buyIn, rebuys: p.rebuys,
      }))
      .sort((a, b) => b.net - a.net);
  }

  view(forId: string | null): TableView {
    const h = this.hand;
    const me = this.player(forId);
    const myHole = (me && h?.players.find((x) => x.id === me.id)?.hole) || [];
    const players: PublicPlayer[] = this.players
      .filter((p) => p.status !== 'watching' || p.connections > 0 || p.isHost || (this.status === 'finished' && p.entered))
      .map((p) => {
        const hp = h?.players.find((x) => x.id === p.id);
        return {
          id: p.id, name: p.name, seat: p.seat, requestedSeat: p.requestedSeat, requestedBuyIn: p.requestedBuyIn,
          stack: p.stack, status: p.status, sittingOut: p.sittingOut, connected: p.connections > 0, isHost: p.isHost, bot: !!p.bot,
          awaySince: p.connections > 0 ? null : p.awaySince ?? null,
          camOn: p.camOn, micOn: p.micOn, rebuys: p.rebuys, addOnTaken: p.addOnTaken,
          timeBankMs: h && h.usingBank && h.bankStartedAt != null && h.toAct != null && h.players[h.toAct].id === p.id
            ? Math.max(0, p.timeBankMs - (Date.now() - h.bankStartedAt)) : p.timeBankMs,
          place: p.place, handsWon: p.stats?.handsWon ?? 0,
          inHand: !!hp, hasCards: !!hp && !hp.folded, bet: hp?.bet ?? 0, folded: hp?.folded ?? false,
          allIn: hp?.allIn ?? false, lastAction: hp?.lastAction ?? null,
          shownCards: hp && hp.shown ? hp.hole : null,
          equity: h?.equity?.[p.id] ?? null,
        };
      });
    const hand: HandView | null = h ? {
      number: h.number, street: h.street, board: h.board, rabbitCards: h.rabbitCards,
      pots: h.finished ? [] : this.collectedPots(),
      potTotal: h.finished ? 0 : h.players.reduce((s, x) => s + x.contrib - x.bet, 0),
      currentBet: h.currentBet, dealerSeat: h.dealerSeat, sbSeat: h.sbSeat, bbSeat: h.bbSeat,
      toActId: h.toAct != null ? h.players[h.toAct].id : null, turnEndsAt: h.turnEndsAt, turnMs: h.turnMs, usingBank: h.usingBank,
      frozenMs: h.frozenMs ?? null,
      winners: h.winners, blinds: h.blinds,
    } : null;
    return {
      id: this.id, settings: this.settings, status: this.status, shuffling: this.shuffling, results: this.results(), players, hand,
      clock: this.clockView(), ledger: this.ledger(), log: this.log.slice(-120),
      you: {
        playerId: me?.id ?? null,
        isHost: !!me?.isHost,
        holeCards: myHole,
        // After a rabbit hunt this is what the player would have made with the revealed cards.
        madeHand: myHole.length ? madeHandName([...myHole, ...(h?.board ?? []), ...(h?.rabbitCards ?? [])]) : null,
        canRabbitHunt: this.allowsRabbitHunt(forId) && !h?.rabbitCards.length,
        legal: me && this.status !== 'paused' ? this.legal(me.id) : null,
        canClaimHost: this.canClaimHost(forId),
        rebuy: me ? this.rebuyOffer(me) : null,
      },
    };
  }

  /** Pots built from what has been pulled into the middle (excludes current-street bets). */
  private collectedPots(): { amount: number; eligible: string[] }[] {
    const h = this.hand!;
    const saved = h.players.map((x) => x.contrib);
    for (const x of h.players) x.contrib -= x.bet;
    const pots = this.computePots();
    h.players.forEach((x, i) => { x.contrib = saved[i]; });
    return pots;
  }
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function cleanName(name: string): string {
  const n = String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18);
  if (!n) throw new GameError('Skriv inn et navn.');
  return n;
}
