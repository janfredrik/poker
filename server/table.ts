import { randomBytes, randomUUID } from 'node:crypto';
import { bestHand, shuffledDeck } from './cards';
import { formatChips as fc } from '../shared/presets';
import type {
  BlindLevel, Card, ClockView, HandView, LedgerRow, Legal, LogEntry, PlayerStatus,
  PublicPlayer, RebuyOffer, Street, TableSettings, TableView, WinnerView,
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
  rebuys: number;
  addOnTaken: boolean;
  camOn: boolean;
  micOn: boolean;
  /** runtime only */
  connections: number;
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
}

interface Hand {
  number: number;
  deck: Card[];
  board: Card[];
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
  winners: WinnerView[] | null;
  finished: boolean;
  runout: boolean;
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
  lastActive: number;
  settings: TableSettings;
  status: 'waiting' | 'running' | 'paused';
  players: Player[];
  clock: Clock;
  handNumber: number;
  lastDealerSeat: number | null;
  log: LogEntry[];
  hand: Hand | null;
}

export class GameError extends Error {}

const LOG_LIMIT = 200;
const FAST = process.env.POKER_FAST === '1';
const NEXT_HAND_DELAY = FAST ? 1 : 4500;
const SHOWDOWN_DELAY = FAST ? 1 : 7000;
const RUNOUT_STEP = FAST ? 1 : 1400;
const DISCONNECTED_TURN_MS = 20000;

export class Table {
  id: string;
  createdAt: number;
  lastActive: number;
  settings: TableSettings;
  status: 'waiting' | 'running' | 'paused' = 'waiting';
  players: Player[] = [];
  clock: Clock = { levelIndex: 0, onBreak: false, elapsedMs: 0, runningSince: null };
  handNumber = 0;
  lastDealerSeat: number | null = null;
  log: LogEntry[] = [];
  hand: Hand | null = null;

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
      id: this.id, createdAt: this.createdAt, lastActive: this.lastActive, settings: this.settings,
      status: this.status, players: this.players.map((p) => ({ ...p, connections: 0 })),
      clock: { ...this.clock }, handNumber: this.handNumber, lastDealerSeat: this.lastDealerSeat,
      log: this.log, hand: this.hand,
    };
  }

  static restore(s: TableSnapshot): Table {
    const t = new Table(s.settings, s.id);
    t.createdAt = s.createdAt;
    t.lastActive = s.lastActive;
    t.players = s.players.map((p) => ({ ...p, connections: 0, camOn: false, micOn: false }));
    t.handNumber = s.handNumber;
    t.lastDealerSeat = s.lastDealerSeat;
    t.log = s.log ?? [];
    // freeze the clock where it was
    const c = s.clock;
    t.clock = { ...c, elapsedMs: c.elapsedMs + (c.runningSince ? s.lastActive - c.runningSince : 0), runningSince: null };
    t.status = s.status === 'waiting' ? 'waiting' : 'paused';
    if (s.hand && !s.hand.finished) {
      // A restart interrupted a hand: void it and give every player their chips back.
      for (const hp of s.hand.players) {
        const p = t.players.find((x) => x.id === hp.id);
        if (p) p.stack += hp.contrib;
      }
      t.addLog('system', `Server restarted during hand #${s.hand.number}. The hand was voided and all bets returned.`);
    }
    if (t.status === 'paused') t.addLog('system', 'Game paused after a server restart. The host can resume.');
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
    if (!this.player(id)?.isHost) throw new GameError('Only the host can do that.');
  }

  private seatTaken(seat: number) {
    return this.players.some((p) => (p.status === 'seated' && p.seat === seat) || (p.status === 'pending' && p.requestedSeat === seat));
  }

  private name(id: string) { return this.player(id)?.name ?? 'Someone'; }

  private isTournament() { return this.rules.levelMinutes > 0; }

  /* ---------------- clock ---------------- */

  levelAt(index: number): BlindLevel {
    const lv = this.rules.levels;
    if (index < lv.length) return lv[index];
    const last = lv[lv.length - 1];
    const k = 2 ** (index - lv.length + 1);
    return { sb: last.sb * k, bb: last.bb * k, ante: last.ante * k };
  }

  private phaseMs(): number {
    if (this.clock.onBreak) return this.rules.breakMinutes * 60000;
    return this.rules.levelMinutes * 60000;
  }

  private phaseElapsed(now = Date.now()): number {
    return this.clock.elapsedMs + (this.clock.runningSince ? now - this.clock.runningSince : 0);
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
    if (this.status !== 'running' || this.rules.levelMinutes <= 0 || this.clock.runningSince == null) return;
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
          this.addLog('system', `Break: ${this.rules.breakMinutes} minutes. The current hand plays out first.`);
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
    this.addLog('system', `Blinds up: level ${this.clock.levelIndex + 1}, ${fc(l.sb)}/${fc(l.bb)}${l.ante ? ` ante ${fc(l.ante)}` : ''}.`);
    const ru = this.rules.rebuy;
    if (ru.enabled && ru.untilLevel > 0 && this.clock.levelIndex + 1 === ru.untilLevel + 1) {
      this.addLog('system', 'Rebuy period is over.');
    }
  }

  /* ---------------- joining & seating ---------------- */

  createPlayer(name: string, isHost = false): Player {
    const p: Player = {
      id: randomUUID(), token: randomBytes(18).toString('base64url'), name: cleanName(name),
      seat: null, requestedSeat: null, requestedBuyIn: 0, stack: 0, status: 'watching', sittingOut: false,
      isHost, buyIn: 0, cashOut: 0, rebuys: 0, addOnTaken: false, camOn: false, micOn: false, connections: 0,
    };
    this.players.push(p);
    return p;
  }

  private validBuyIn(amount: number): number {
    if (this.isTournament()) return this.rules.startingStack;
    const n = Math.round(Number(amount));
    if (!Number.isFinite(n) || n <= 0) throw new GameError('Enter a buy-in above zero.');
    if (n > 1e9) throw new GameError('That buy-in is too large.');
    return n;
  }

  requestSeat(p: Player, seat: number, name: string, buyIn: number) {
    if (p.status === 'seated') throw new GameError('You already have a seat.');
    if (!Number.isInteger(seat) || seat < 1 || seat > this.settings.maxSeats) throw new GameError('Pick a seat at the table.');
    if (this.seatTaken(seat) && p.requestedSeat !== seat) throw new GameError('That seat was just taken. Pick another.');
    const nm = cleanName(name);
    if (this.players.some((o) => o.id !== p.id && o.status !== 'watching' && o.name.toLowerCase() === nm.toLowerCase())) {
      throw new GameError(`Someone at the table is already called ${nm}.`);
    }
    p.name = nm;
    const amount = this.validBuyIn(buyIn);
    if (this.settings.requireApproval && !p.isHost) {
      p.status = 'pending';
      p.requestedSeat = seat;
      p.requestedBuyIn = amount;
      this.addLog('system', `${p.name} asks to sit in seat ${seat} with ${fc(amount)}.`);
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
    this.addLog('system', `${p.name} sits in seat ${seat} with ${fc(amount)}.`);
    this.maybeStartHand();
  }

  approve(hostId: string, playerId: string) {
    this.requireHost(hostId);
    const p = this.player(playerId);
    if (!p || p.status !== 'pending' || p.requestedSeat == null) throw new GameError('That request is gone.');
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
    this.addLog('system', `${p.name}'s seat request was declined.`);
    this.touch();
  }

  /** Leave the seat and cash out the current stack. */
  leaveSeat(p: Player, reason = 'leaves the table') {
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
        this.addLog('action', `${p.name} folds`);
        this.advance();
      }
    }
    p.cashOut += p.stack;
    this.addLog('system', `${p.name} ${reason} with ${fc(p.stack)}.`);
    p.stack = 0;
    p.seat = null;
    p.status = 'watching';
    p.sittingOut = false;
    this.touch();
  }

  kick(hostId: string, playerId: string) {
    this.requireHost(hostId);
    const p = this.player(playerId);
    if (!p || p.isHost) throw new GameError('You cannot remove that player.');
    this.leaveSeat(p, 'was removed by the host');
  }

  setSittingOut(p: Player, value: boolean) {
    if (p.status !== 'seated') return;
    p.sittingOut = value;
    this.addLog('system', value ? `${p.name} sits out from the next hand.` : `${p.name} is back.`);
    if (!value) this.maybeStartHand();
    this.touch();
  }

  rename(p: Player, name: string) {
    const nm = cleanName(name);
    if (nm !== p.name) {
      this.addLog('system', `${p.name} is now ${nm}.`);
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
    if (!r.enabled) reason = 'Rebuys are off for this game.';
    else if (r.untilLevel > 0 && this.isTournament() && levelNo > r.untilLevel) reason = `Rebuys closed after level ${r.untilLevel}.`;
    else if (r.maxPerPlayer > 0 && p.rebuys >= r.maxPerPlayer) reason = `You have used all ${r.maxPerPlayer} rebuys.`;
    else if (r.maxStackToRebuy === 0 && p.stack > 0) reason = 'You can rebuy when you are out of chips.';
    else if (r.maxStackToRebuy > 0 && p.stack > r.maxStackToRebuy) reason = `You can rebuy at ${fc(r.maxStackToRebuy)} or less.`;
    else if (inLiveHand) reason = 'You can rebuy after this hand.';
    const a = this.rules.addOn;
    const addOnAllowed = a.enabled && !p.addOnTaken && !inLiveHand && levelNo >= a.atLevel && levelNo <= a.atLevel + 1;
    return { allowed: reason == null, amount: r.amount, reason, addOnAllowed, addOnAmount: a.amount };
  }

  rebuy(p: Player, amount: number) {
    const offer = this.rebuyOffer(p);
    if (!offer) throw new GameError('Take a seat first.');
    if (!offer.allowed) throw new GameError(offer.reason ?? 'Rebuy not allowed right now.');
    const amt = offer.amount > 0 ? offer.amount : Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1e9) throw new GameError('Enter a rebuy amount above zero.');
    p.stack += amt;
    p.buyIn += amt;
    p.rebuys++;
    p.sittingOut = false;
    this.addLog('system', `${p.name} rebuys for ${fc(amt)}.`);
    this.maybeStartHand();
    this.touch();
  }

  addOn(p: Player) {
    const offer = this.rebuyOffer(p);
    if (!offer?.addOnAllowed) throw new GameError('The add-on is not available right now.');
    p.stack += offer.addOnAmount;
    p.buyIn += offer.addOnAmount;
    p.addOnTaken = true;
    this.addLog('system', `${p.name} takes the add-on for ${fc(offer.addOnAmount)}.`);
    this.touch();
  }

  adjustStack(hostId: string, playerId: string, newStack: number) {
    this.requireHost(hostId);
    const p = this.player(playerId);
    if (!p || p.status !== 'seated') throw new GameError('That player is not seated.');
    const hp = this.handPlayer(p.id);
    if (hp && this.hand && !this.hand.finished && !hp.folded) throw new GameError('Wait until this hand is over.');
    const n = Math.round(Number(newStack));
    if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new GameError('Enter a stack of zero or more.');
    const delta = n - p.stack;
    p.stack = n;
    p.buyIn += delta;
    this.addLog('system', `Host set ${p.name}'s stack to ${fc(n)} (${delta >= 0 ? '+' : ''}${fc(delta)}).`);
    this.maybeStartHand();
    this.touch();
  }

  /* ---------------- host controls ---------------- */

  start(hostId: string) {
    this.requireHost(hostId);
    if (this.status === 'running') return;
    const wasPaused = this.status === 'paused';
    this.status = 'running';
    if (this.rules.levelMinutes > 0) this.startClock();
    this.addLog('system', wasPaused ? 'Game resumed.' : 'Game started. Shuffle up and deal.');
    if (!wasPaused) this.announceLevelStart();
    this.maybeStartHand();
    this.touch();
  }

  private announceLevelStart() {
    const l = this.levelAt(this.clock.levelIndex);
    this.addLog('system', `Level ${this.clock.levelIndex + 1}: ${fc(l.sb)}/${fc(l.bb)}${l.ante ? ` ante ${fc(l.ante)}` : ''}.`);
  }

  pause(hostId: string) {
    this.requireHost(hostId);
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.stopClock();
    if (this.nextHandTimer) { clearTimeout(this.nextHandTimer); this.nextHandTimer = null; }
    this.addLog('system', this.hand && !this.hand.finished ? 'Host paused the game. This hand plays out first.' : 'Host paused the game.');
    this.touch();
  }

  setLevel(hostId: string, levelIndex: number) {
    this.requireHost(hostId);
    const n = Math.max(0, Math.min(200, Math.round(levelIndex)));
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
    if (oldMs !== s.rules.levelMinutes && this.clock.elapsedMs > this.phaseMs()) this.clock.elapsedMs = 0;
    this.addLog('system', `Host updated the rules: ${s.rules.name}.`);
    this.touch();
  }

  transferHost(hostId: string, playerId: string) {
    this.requireHost(hostId);
    const to = this.player(playerId);
    if (!to) throw new GameError('Player not found.');
    for (const p of this.players) p.isHost = p.id === to.id;
    this.addLog('system', `${to.name} is now the host.`);
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
    if (this.status !== 'running' || this.clock.onBreak) return;
    if (this.hand && !this.hand.finished) return;
    if (this.nextHandTimer) return;
    if (this.eligibleForHand().length < 2) return;
    // small delay so seat changes settle and the previous result stays readable
    const delay = FAST || this.hand?.finished ? 0 : 800;
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

    const blinds = this.levelAt(this.clock.levelIndex);
    const deck = shuffledDeck();
    const players: HandPlayer[] = seated.map((p) => ({
      id: p.id, seat: p.seat!, hole: [], bet: 0, contrib: 0, folded: false, allIn: false,
      acted: false, raiseSeen: 0, lastAction: null, shown: false,
    }));
    const h: Hand = {
      number: this.handNumber, deck, board: [], street: 'preflop', players, dealerSeat, sbSeat, bbSeat, blinds,
      currentBet: 0, lastRaiseSize: blinds.bb, fullRaiseCount: 0, toAct: null, turnEndsAt: null, turnMs: null,
      winners: null, finished: false, runout: false,
    };
    this.hand = h;
    this.addLog('hand', `Hand #${h.number} · ${fc(blinds.sb)}/${fc(blinds.bb)}${blinds.ante ? ` · ante ${fc(blinds.ante)}` : ''} · dealer ${this.name(players.find((x) => x.seat === dealerSeat)!.id)}`);

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
      this.addLog('action', `${p.name} posts ${label.toLowerCase()} ${fc(a)}`);
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

  private startTurn() {
    const h = this.hand!;
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.timers.delete(this.turnTimer); this.turnTimer = null; }
    if (h.toAct == null) { h.turnEndsAt = null; h.turnMs = null; return; }
    const hp = h.players[h.toAct];
    const p = this.player(hp.id);
    let ms: number | null = this.rules.turnSeconds > 0 ? this.rules.turnSeconds * 1000 : null;
    if (p && p.connections === 0) ms = Math.min(ms ?? DISCONNECTED_TURN_MS, DISCONNECTED_TURN_MS);
    h.turnMs = ms;
    h.turnEndsAt = ms ? Date.now() + ms : null;
    if (ms) {
      const handNo = h.number;
      const who = hp.id;
      this.turnTimer = this.later(ms, () => {
        const cur = this.hand;
        if (!cur || cur.number !== handNo || cur.finished || cur.toAct == null || cur.players[cur.toAct].id !== who) return;
        const me = cur.players[cur.toAct];
        if (me.bet >= cur.currentBet) this.applyAction(me, 'check', 0, true);
        else this.applyAction(me, 'fold', 0, true);
        this.touch();
      });
    }
  }

  /** Re-arm the timer when someone (dis)connects on their turn. */
  connectionChanged(p: Player) {
    const h = this.hand;
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
    if (!h || h.finished || h.toAct == null) throw new GameError('There is nothing to act on.');
    const hp = h.players[h.toAct];
    if (hp.id !== playerId) throw new GameError('It is not your turn.');
    this.applyAction(hp, type, amount);
    this.touch();
  }

  private applyAction(hp: HandPlayer, type: string, amount = 0, timedOut = false) {
    const h = this.hand!;
    const p = this.player(hp.id)!;
    const legal = this.legal(hp.id)!;
    const pay = (x: number) => {
      const a = Math.min(x, p.stack);
      p.stack -= a;
      hp.bet += a;
      hp.contrib += a;
      if (p.stack === 0) hp.allIn = true;
    };
    const suffix = timedOut ? ' (timed out)' : '';

    if (type === 'allin') {
      if (legal.canRaise && legal.maxRaiseTo > h.currentBet) { type = 'raise'; amount = legal.maxRaiseTo; }
      else type = legal.canCheck ? 'check' : 'call';
    }

    switch (type) {
      case 'fold':
        if (legal.canCheck && !timedOut) {
          // folding when you can check is allowed but almost always a misclick; treat as check-fold? No: honour it.
        }
        hp.folded = true;
        hp.lastAction = 'Fold';
        this.addLog('action', `${p.name} folds${suffix}`);
        break;
      case 'check':
        if (!legal.canCheck) throw new GameError(`You need to call ${fc(legal.callAmount)} or fold.`);
        hp.lastAction = 'Check';
        this.addLog('action', `${p.name} checks${suffix}`);
        break;
      case 'call': {
        if (legal.callAmount === 0) { hp.lastAction = 'Check'; this.addLog('action', `${p.name} checks`); break; }
        pay(legal.callAmount);
        hp.lastAction = hp.allIn ? 'All-in' : 'Call';
        this.addLog('action', `${p.name} calls ${fc(legal.callAmount)}${hp.allIn ? ' and is all-in' : ''}`);
        break;
      }
      case 'raise':
      case 'bet': {
        if (!legal.canRaise) throw new GameError('You cannot raise here.');
        let to = Math.round(Number(amount));
        if (!Number.isFinite(to)) throw new GameError('Enter an amount.');
        to = Math.min(to, legal.maxRaiseTo);
        if (to < legal.minRaiseTo && to < legal.maxRaiseTo) throw new GameError(`The minimum is ${fc(legal.minRaiseTo)}.`);
        const wasBet = h.currentBet === 0;
        const raiseSize = to - h.currentBet;
        pay(to - hp.bet);
        if (raiseSize >= h.lastRaiseSize) {
          h.lastRaiseSize = raiseSize;
          h.fullRaiseCount++;
        }
        h.currentBet = Math.max(h.currentBet, to);
        hp.lastAction = hp.allIn ? 'All-in' : wasBet ? 'Bet' : 'Raise';
        this.addLog('action', `${p.name} ${wasBet ? 'bets' : 'raises to'} ${fc(to)}${hp.allIn ? ' (all-in)' : ''}`);
        break;
      }
      default:
        throw new GameError('Unknown action.');
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
      if (!h.runout) {
        h.runout = true;
        for (const x of notFolded) x.shown = true;
        this.addLog('hand', 'All in. Cards are turned over.');
      }
      this.later(RUNOUT_STEP, () => {
        if (this.hand !== h) return;
        this.dealStreet();
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
    h.deck.pop(); // burn
    if (h.street === 'preflop') { h.board.push(h.deck.pop()!, h.deck.pop()!, h.deck.pop()!); h.street = 'flop'; }
    else if (h.street === 'flop') { h.board.push(h.deck.pop()!); h.street = 'turn'; }
    else if (h.street === 'turn') { h.board.push(h.deck.pop()!); h.street = 'river'; }
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
    this.addLog('hand', `${this.name(winner.id)} wins ${fc(total)}`);
    this.finishHand(NEXT_HAND_DELAY);
  }

  private showdown() {
    const h = this.hand!;
    h.street = 'showdown';
    const contenders = h.players.filter((x) => !x.folded);
    for (const x of contenders) x.shown = true;
    const values = new Map(contenders.map((x) => [x.id, bestHand([...x.hole, ...h.board])]));
    const pots = this.computePots();
    const won = new Map<string, { amount: number; hand: string; cards: Card[] }>();
    // seat order starting left of the dealer for odd chips
    const order = [...h.players].sort((a, b) => ((a.seat - h.dealerSeat + 100) % 100) - ((b.seat - h.dealerSeat + 100) % 100));
    for (const pot of pots) {
      const elig = pot.eligible.filter((id) => values.has(id));
      if (!elig.length) continue;
      const best = Math.max(...elig.map((id) => values.get(id)!.score));
      const winners = order.filter((x) => elig.includes(x.id) && values.get(x.id)!.score === best);
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      for (const w of winners) {
        const amt = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
        const v = values.get(w.id)!;
        const prev = won.get(w.id);
        won.set(w.id, { amount: (prev?.amount ?? 0) + amt, hand: v.name, cards: v.cards });
      }
    }
    for (const x of contenders) {
      const v = values.get(x.id)!;
      this.addLog('hand', `${this.name(x.id)} shows ${x.hole.join(' ')} (${v.name})`);
    }
    h.winners = [];
    for (const [id, w] of won) {
      const p = this.player(id);
      if (p) p.stack += w.amount;
      h.winners.push({ playerId: id, amount: w.amount, hand: w.hand, cards: w.cards });
      this.addLog('hand', `${this.name(id)} wins ${fc(w.amount)} with ${w.hand}`);
    }
    this.finishHand(SHOWDOWN_DELAY);
  }

  private finishHand(delay: number) {
    const h = this.hand!;
    h.finished = true;
    h.toAct = null;
    h.turnEndsAt = null;
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    // bust-outs sit out until they rebuy
    for (const hp of h.players) {
      const p = this.player(hp.id);
      if (p && p.status === 'seated' && p.stack === 0) {
        this.addLog('system', `${p.name} is out of chips.`);
      }
    }
    if (this.nextHandTimer) clearTimeout(this.nextHandTimer);
    this.nextHandTimer = this.later(delay, () => {
      this.nextHandTimer = null;
      if (this.status === 'running' && !this.clock.onBreak && this.eligibleForHand().length >= 2) this.startHand();
      else { this.touch(); }
    });
  }

  /** Voluntarily show cards after the hand (e.g. after winning uncontested). */
  show(playerId: string) {
    const hp = this.handPlayer(playerId);
    if (!hp || !this.hand?.finished) throw new GameError('You can show your cards after the hand.');
    hp.shown = true;
    this.addLog('hand', `${this.name(playerId)} shows ${hp.hole.join(' ')}`);
    this.touch();
  }

  /* ---------------- views ---------------- */

  private clockView(): ClockView {
    const levelMs = this.phaseMs();
    const remainingMs = this.rules.levelMinutes > 0 ? Math.max(0, levelMs - this.phaseElapsed()) : 0;
    const idx = this.clock.levelIndex;
    return {
      running: this.clock.runningSince != null,
      levelIndex: idx,
      level: this.levelAt(idx),
      next: this.rules.levelMinutes > 0 ? this.levelAt(this.clock.onBreak ? idx + 1 : idx + 1) : null,
      levelMs,
      remainingMs,
      onBreak: this.clock.onBreak,
      at: Date.now(),
    };
  }

  private ledger(): LedgerRow[] {
    return this.players
      .filter((p) => p.buyIn > 0 || p.cashOut > 0)
      .map((p) => ({
        playerId: p.id, name: p.name, buyIn: p.buyIn, cashOut: p.cashOut, stack: p.stack,
        net: p.cashOut + p.stack - p.buyIn, rebuys: p.rebuys,
      }))
      .sort((a, b) => b.net - a.net);
  }

  view(forId: string | null): TableView {
    const h = this.hand;
    const me = this.player(forId);
    const players: PublicPlayer[] = this.players
      .filter((p) => p.status !== 'watching' || p.connections > 0 || p.isHost)
      .map((p) => {
        const hp = h?.players.find((x) => x.id === p.id);
        return {
          id: p.id, name: p.name, seat: p.seat, requestedSeat: p.requestedSeat, requestedBuyIn: p.requestedBuyIn,
          stack: p.stack, status: p.status, sittingOut: p.sittingOut, connected: p.connections > 0, isHost: p.isHost,
          camOn: p.camOn, micOn: p.micOn, rebuys: p.rebuys, addOnTaken: p.addOnTaken,
          inHand: !!hp, hasCards: !!hp && !hp.folded, bet: hp?.bet ?? 0, folded: hp?.folded ?? false,
          allIn: hp?.allIn ?? false, lastAction: hp?.lastAction ?? null,
          shownCards: hp && hp.shown ? hp.hole : null,
        };
      });
    const hand: HandView | null = h ? {
      number: h.number, street: h.street, board: h.board,
      pots: h.finished ? [] : this.collectedPots(),
      potTotal: h.finished ? 0 : h.players.reduce((s, x) => s + x.contrib - x.bet, 0),
      currentBet: h.currentBet, dealerSeat: h.dealerSeat, sbSeat: h.sbSeat, bbSeat: h.bbSeat,
      toActId: h.toAct != null ? h.players[h.toAct].id : null, turnEndsAt: h.turnEndsAt, turnMs: h.turnMs,
      winners: h.winners, blinds: h.blinds,
    } : null;
    return {
      id: this.id, settings: this.settings, status: this.status, players, hand,
      clock: this.clockView(), ledger: this.ledger(), log: this.log.slice(-120),
      you: {
        playerId: me?.id ?? null,
        isHost: !!me?.isHost,
        holeCards: (me && h?.players.find((x) => x.id === me.id)?.hole) || [],
        legal: me ? this.legal(me.id) : null,
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
  if (!n) throw new GameError('Enter a name.');
  return n;
}
