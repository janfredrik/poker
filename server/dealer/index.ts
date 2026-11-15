/**
 * AI-dealer: an optional drawn dealer who comments on the game and answers when spoken to.
 * She sees only the public view, can't do anything in the game and is off by default.
 * This is the only file the rest of the server imports. To remove her, see DEALER.md.
 */
import type { Express } from 'express';
import type { Server, Socket } from 'socket.io';
import type { Ack, LogEntry } from '../../shared/types';
import { GameError, type Player, type Table } from '../table';
import { askBrain } from './brain';
import { dealerAvailable, dealerCanListen } from './config';
import { buildContext, publicView } from './context';
import { BIG, describe, parseEvents, PRIORITY, speakableName, type DealerEvent } from './events';
import { FIXED, pick } from './lines';
import { transcribe } from './stt';
import { fixedAudio, freshAudio, readAudio } from './tts';

export interface DealerSay {
  id: string;
  text: string;
  /** null when the voice could not be made: show the bubble only. */
  audioUrl: string | null;
  /** Set when she answers someone who spoke to her. */
  replyTo?: { name: string; text: string };
}

const FAST = process.env.POKER_FAST === '1';
const HOUR = 60 * 60 * 1000;
/** Gather what happens in one burst (showdown, bust-out, place) before choosing what to say. */
const GATHER_MS = FAST ? 5 : 1200;
const FRESH_GAP_MS = 20_000;
const MAX_FRESH_PER_HOUR = Math.max(0, Number(process.env.DEALER_MAX_PER_HOUR) || 60);
const ASK_GAP_MS = 10_000;
/** People often sit down one after another; let each get a welcome without her talking over herself. */
const WELCOME_GAP_MS = FAST ? 0 : 2500;
/** A fresh line that arrives later than this is no longer about what is on the table. */
const STALE_MS = 6000;
const ASK_STALE_MS = 15_000;
const MAX_WAV_BYTES = 600_000;

interface State {
  last: LogEntry | null;
  queue: DealerEvent[];
  timer: NodeJS.Timeout | null;
  handNumber: number;
  lastSpokeAt: number;
  lastFreshAt: number;
  freshTimes: number[];
  asks: Map<string, number>;
  /** Names already welcomed, so a rebuy or a seat change isn't greeted again. */
  welcomed: Set<string>;
  seq: number;
}

const states = new Map<string, State>();
let io: Pick<Server, 'to'> | null = null;

function state(t: Table): State {
  let s = states.get(t.id);
  if (!s) {
    s = { last: t.log.at(-1) ?? null, queue: [], timer: null, handNumber: t.handNumber, lastSpokeAt: 0, lastFreshAt: 0, freshTimes: [], asks: new Map(), welcomed: new Set(), seq: 0 };
    states.set(t.id, s);
  }
  return s;
}

const enabled = (t: Table) => !!t.settings.dealer && !t.demo && dealerAvailable();

export function mountDealer(app: Express, server: Pick<Server, 'to'>) {
  io = server;
  app.get('/api/dealer/audio/:id', (req, res) => {
    const audio = readAudio(String(req.params.id));
    if (!audio) { res.status(404).end(); return; }
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' }).send(audio);
  });
}

export function dealerForget(tableId: string) {
  const s = states.get(tableId);
  if (s?.timer) clearTimeout(s.timer);
  states.delete(tableId);
}

/** Call after every change: reads the new log lines and decides whether she says something. */
export function dealerOnChange(t: Table) {
  if (!enabled(t)) { if (states.has(t.id)) dealerForget(t.id); return; }
  const st = state(t);
  const end = t.log.at(-1) ?? null;
  if (end === st.last) return;
  const from = st.last ? t.log.lastIndexOf(st.last) : -1;
  const fresh = from >= 0 ? t.log.slice(from + 1) : t.log.slice(-5);
  st.last = end;
  for (const e of parseEvents(fresh)) {
    if (e.kind === 'hand') { st.handNumber = e.number; st.queue = st.queue.filter((q) => !['flop', 'turn', 'river', 'all-in'].includes(q.kind)); continue; }
    if (e.kind === 'velkommen') { if (st.welcomed.has(e.name)) continue; st.welcomed.add(e.name); }
    st.queue.push(e);
  }
  if (st.queue.length && !st.timer) st.timer = setTimeout(() => { st.timer = null; void flush(t, st); }, GATHER_MS);
}

function freshAllowed(st: State, now: number) {
  st.freshTimes = st.freshTimes.filter((x) => now - x < HOUR);
  return st.freshTimes.length < MAX_FRESH_PER_HOUR;
}

async function flush(t: Table, st: State) {
  const batch = st.queue;
  st.queue = [];
  if (!batch.length || !enabled(t)) return;
  const main = batch.reduce((a, b) => (PRIORITY[b.kind] > PRIORITY[a.kind] ? b : a));
  const now = Date.now();
  const street = main.kind === 'flop' || main.kind === 'turn' || main.kind === 'river';
  if (street && (now - st.lastSpokeAt < 15_000 || Math.random() > 0.35)) return;
  if (BIG.has(main.kind) && now - st.lastFreshAt >= FRESH_GAP_MS && freshAllowed(st, now)) {
    st.lastFreshAt = now;
    st.freshTimes.push(now);
    const hand = st.handNumber;
    const task = `Dette skjedde akkurat: ${batch.map(describe).join(' ')}\nSi én eller to korte setninger til bordet om dette: ${describe(main)}`;
    const text = await askBrain(buildContext(publicView(t)), task);
    if (text) {
      const audio = await freshAudio(text);
      if (Date.now() - now > STALE_MS || st.handNumber !== hand || !enabled(t)) return;
      say(t, st, text, audio);
      return;
    }
  }
  const gap = BIG.has(main.kind) ? 8000 : main.kind === 'velkommen' ? WELCOME_GAP_MS : 4000;
  if (now - st.lastSpokeAt < gap) return;
  const text = main.kind === 'velkommen' ? welcome(batch) : pick(FIXED[main.kind] ?? []);
  if (!text) return;
  const audio = await fixedAudio(text);
  if (Date.now() - now > STALE_MS || !enabled(t)) return;
  say(t, st, text, audio);
}

/** "Velkommen til bordet, Kari og Ola." Names are voiced once and kept, like the fixed lines. */
function welcome(batch: DealerEvent[]) {
  const names = [...new Set(batch.flatMap((e) => (e.kind === 'velkommen' ? [e.name] : [])))];
  const spoken = names.map(speakableName);
  if (names.length > 3 || spoken.some((n) => !n)) return 'Velkommen til bordet.';
  const list = spoken.length > 1 ? `${spoken.slice(0, -1).join(', ')} og ${spoken.at(-1)}` : spoken[0];
  return `Velkommen til bordet, ${list}.`;
}

function say(t: Table, st: State, text: string, audioId: string | null, replyTo?: DealerSay['replyTo']) {
  st.lastSpokeAt = Date.now();
  const msg: DealerSay = { id: `${t.id}-${++st.seq}`, text, audioUrl: audioId ? `/api/dealer/audio/${audioId}` : null, replyTo };
  io?.to(t.id).emit('dealer:say', msg);
}

function guard<T>(ack: Ack<T> | undefined, fn: () => T) {
  try { ack?.({ ok: true, data: fn() }); }
  catch (e) {
    if (!(e instanceof GameError)) console.error(e);
    ack?.({ ok: false, error: e instanceof GameError ? e.message : 'Noe gikk galt på serveren.' });
  }
}

export function dealerSocket(s: Socket, ctx: { table: () => Table; me: () => { t: Table; p: Player } }) {
  s.on('dealer:info', (_: unknown, ack: Ack<{ available: boolean; canListen: boolean }>) => guard(ack, () => ({
    available: dealerAvailable(), canListen: dealerCanListen(),
  })));

  s.on('dealer:toggle', (on: unknown, ack: Ack) => guard(ack, () => {
    const { t, p } = ctx.me();
    if (!p.isHost) throw new GameError('Bare verten kan slå dealeren av eller på.');
    if (t.demo) throw new GameError('Dealeren er ikke med på demobord.');
    if (!dealerAvailable()) throw new GameError('Dealeren er ikke satt opp på denne serveren.');
    if (t.status !== 'waiting') throw new GameError('Dealeren kan bare slås av eller på før spillet starter.');
    const value = !!on;
    if (!!t.settings.dealer === value) return;
    t.settings = { ...t.settings, dealer: value };
    dealerForget(t.id);
    t.addLog('system', value ? 'Verten slo på AI-dealeren.' : 'Verten slo av AI-dealeren.');
    t.onChange();
  }));

  s.on('dealer:ask', (audio: unknown, ack: Ack<{ heard: string }>) => {
    let t: Table, p: Player, st: State, wav: Buffer;
    try {
      ({ t, p } = ctx.me());
      if (p.status !== 'seated') throw new GameError('Ta et sete for å snakke med dealeren.');
      if (!enabled(t) || !dealerCanListen()) throw new GameError('Dealeren lytter ikke ved dette bordet.');
      wav = Buffer.isBuffer(audio) ? audio : audio instanceof ArrayBuffer ? Buffer.from(audio) : audio instanceof Uint8Array ? Buffer.from(audio) : Buffer.alloc(0);
      if (wav.length < 1000 || wav.length > MAX_WAV_BYTES || wav.toString('ascii', 0, 4) !== 'RIFF') throw new GameError('Opptaket kom ikke frem. Prøv igjen.');
      st = state(t);
      const now = Date.now();
      if (now - (st.asks.get(p.id) ?? 0) < ASK_GAP_MS) throw new GameError('Gi dealeren et øyeblikk før du spør igjen.');
      if (!freshAllowed(st, now)) throw new GameError('Dealeren tar en pust i bakken. Prøv igjen senere.');
      st.asks.set(p.id, now);
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      if (typeof ack === 'function') ack({ ok: false, error: e instanceof GameError ? e.message : 'Noe gikk galt på serveren.' });
      return;
    }
    void (async () => {
      const started = Date.now();
      const heard = await transcribe(wav);
      if (!heard) { if (typeof ack === 'function') ack({ ok: false, error: 'Dealeren hørte ikke hva du sa.' }); return; }
      if (typeof ack === 'function') ack({ ok: true, data: { heard } });
      st.freshTimes.push(Date.now());
      const text = await askBrain(buildContext(publicView(t)), `${p.name} snakker til deg: «${heard.slice(0, 300)}»\nSvar ${p.name} kort, i én eller to setninger.`);
      if (!text) return;
      const id = await freshAudio(text);
      if (Date.now() - started > ASK_STALE_MS || !enabled(t)) return;
      say(t, st, text, id, { name: p.name, text: heard.slice(0, 300) });
    })();
  });
}
