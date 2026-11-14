// Demo tables: the visitor plays against server-side bots. Nothing here is saved to disk.
import { BUILT_IN_RULESETS } from '../shared/presets';
import type { Card, Legal } from '../shared/types';
import { bestHand, RANKS } from './cards';
import { cleanName, GameError, Table } from './table';

const FAST = process.env.POKER_FAST === '1';
const BOT_NAMES = ['Stian', 'Mari', 'Ulrik', 'Kari', 'Ola', 'Siri', 'Per', 'Ingrid'];
export const MAX_DEMO_BOTS = 8;

export function createDemoTable(hostName: unknown, botCount: unknown): { table: Table; hostToken: string } {
  const bots = Math.min(MAX_DEMO_BOTS, Math.max(1, Math.round(Number(botCount)) || 3));
  const rules = structuredClone(BUILT_IN_RULESETS.find((r) => r.id === 'cash-10-20') ?? BUILT_IN_RULESETS[0]);
  const t = new Table({ name: 'Demobord', maxSeats: 9, requireApproval: false, rules });
  t.demo = true;
  let name = 'Du';
  try { name = cleanName(String(hostName ?? '')); } catch { /* keep the default */ }
  const host = t.createPlayer(name, true);
  t.addLog('system', `${host.name} åpnet et demobord med ${bots} ${bots === 1 ? 'bot' : 'bots'}.`);
  t.requestSeat(host, 1, host.name, rules.startingStack);
  const names = BOT_NAMES.filter((n) => n.toLowerCase() !== host.name.toLowerCase());
  // spread the bots around the table
  for (let i = 0; i < bots; i++) {
    const p = t.createPlayer(names[i]);
    p.bot = true;
    p.connections = 1;
    p.awaySince = null;
    p.camOn = true;
    t.requestSeat(p, 2 + Math.floor((i * 8) / bots), p.name, rules.startingStack);
  }
  return { table: t, hostToken: host.token };
}

const pending = new WeakMap<Table, { key: string; timer: NodeJS.Timeout }>();
const rebuying = new WeakSet<Table>();

/** Call after every change on a demo table: schedules the next bot move (or rebuy) if one is due. */
export function driveBots(t: Table) {
  if (!t.demo) return;
  scheduleRebuys(t);
  const h = t.hand;
  const hp = h && !h.finished && h.toAct != null ? h.players[h.toAct] : null;
  const bot = hp ? t.player(hp.id) : undefined;
  if (!h || !hp || !bot?.bot || t.status !== 'running') {
    const cur = pending.get(t);
    if (cur) { clearTimeout(cur.timer); pending.delete(t); }
    return;
  }
  const key = `${h.number}:${h.street}:${hp.id}:${h.currentBet}`;
  if (pending.get(t)?.key === key) return;
  const cur = pending.get(t);
  if (cur) clearTimeout(cur.timer);
  const think = FAST ? 1 : 900 + Math.random() * 1800;
  const timer = setTimeout(() => {
    pending.delete(t);
    const now = t.hand;
    const me = now?.players.find((x) => x.id === bot.id);
    const legal = t.legal(bot.id);
    if (!now || !me || !legal || t.status !== 'running') return;
    const a = decide(me.hole, now.board, legal, now.players.reduce((sum, x) => sum + x.contrib, 0));
    try { t.act(bot.id, a.type, a.amount); } catch (e) { if (!(e instanceof GameError)) console.error(e); }
  }, think);
  pending.set(t, { key, timer });
}

function scheduleRebuys(t: Table) {
  if (rebuying.has(t)) return;
  const broke = t.players.filter((p) => p.bot && p.status === 'seated' && p.stack === 0 && t.rebuyOffer(p)?.allowed);
  if (!broke.length) return;
  rebuying.add(t);
  setTimeout(() => {
    rebuying.delete(t);
    for (const p of broke) {
      try { if (p.stack === 0 && t.rebuyOffer(p)?.allowed) t.rebuy(p, t.rules.startingStack); } catch { /* try again next change */ }
    }
  }, FAST ? 1 : 1500);
}

/** 0 = weak, 1 = playable, 2 = strong. */
function strength(hole: Card[], board: Card[]): number {
  const [a, b] = hole.map((c) => RANKS.indexOf(c[0])).sort((x, y) => y - x);
  if (board.length === 0) {
    if (a === b) return a >= 8 ? 2 : 1;
    if (a >= 11 && b >= 9) return 2;
    if (a >= 9 && b >= 7) return 1;
    if (hole[0][1] === hole[1][1] && a - b <= 2) return 1;
    if (a === 12) return 1;
    return 0;
  }
  const cat = bestHand([...hole, ...board]).category;
  const boardCat = board.length >= 5 ? bestHand(board).category : 0;
  if (cat >= 2 && cat > boardCat) return 2;
  if (cat >= 1 && cat > boardCat) return 1;
  return 0;
}

function decide(hole: Card[], board: Card[], l: Legal, pot: number): { type: string; amount: number } {
  const s = strength(hole, board);
  const r = Math.random();
  const raiseTo = (frac: number) => Math.min(l.maxRaiseTo, Math.max(l.minRaiseTo, l.bet + Math.round((pot * frac) / 10) * 10));
  if (l.canCheck) {
    if (l.canRaise && (s === 2 ? r < 0.7 : s === 1 ? r < 0.25 : r < 0.08)) return { type: 'raise', amount: raiseTo(s === 2 ? 0.75 : 0.5) };
    return { type: 'check', amount: 0 };
  }
  const priceOk = l.callAmount <= Math.max(pot * 0.25, 1);
  if (s === 2) return l.canRaise && r < 0.35 ? { type: 'raise', amount: raiseTo(1) } : { type: 'call', amount: 0 };
  if (s === 1) return r < (priceOk ? 0.95 : 0.6) ? { type: 'call', amount: 0 } : { type: 'fold', amount: 0 };
  return r < (priceOk ? 0.45 : 0.1) ? { type: 'call', amount: 0 } : { type: 'fold', amount: 0 };
}
