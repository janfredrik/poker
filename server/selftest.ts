// Engine self-test: plays thousands of random hands and checks invariants.
import { deepStrictEqual, throws } from 'node:assert/strict';
process.env.POKER_FAST = '1';
process.env.DATA_DIR = process.env.DATA_DIR ?? '/tmp/poker-selftest';
const { Table } = await import('./table');
const { bestHand } = await import('./cards');
const { BUILT_IN_RULESETS } = await import('../shared/presets');
const rs = (id: string) => BUILT_IN_RULESETS.find((r) => r.id === id)!;

let failures = 0;
const assert = (c: unknown, msg: string) => { if (!c) { failures++; console.error('FAIL:', msg); } };

// evaluator sanity
const cmp = (a: string, b: string) => bestHand(a.split(' ')).score - bestHand(b.split(' ')).score;
assert(cmp('As Ks Qs Js Ts 2d 3c', 'Ah Ad Ac As Kd 2c 3h') > 0, 'royal > quads');
assert(cmp('Ah 2d 3c 4s 5h Kd Qc', '2h 3d 4c 5s 6h Kd Qc') < 0, 'wheel < six-high straight');
assert(cmp('Kh Kd 7c 7s 2h 3d 9c', 'Kh Kd 7c 7s 2h 3d Ac') < 0, 'kicker counts in two pair');
assert(bestHand('Ah Kh Qh Jh Th'.split(' ')).name === 'Royal Flush', 'royal name');
assert(bestHand('9c 9d 9h 4s 4d'.split(' ')).name === 'Full House, Nines full of Fours', 'full house name');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Check the fast runout scoring against the showdown evaluator, including board ties.
{
  const { allInEquity } = await import('./equity');
  const { shuffledDeck } = await import('./cards');
  for (let i = 0; i < 300; i++) {
    const deck = shuffledDeck();
    const board = deck.splice(0, 5);
    const players = Array.from({ length: 9 }, (_, j) => ({ id: String(j), hole: deck.splice(0, 2) }));
    const scores = players.map(p => bestHand([...board, ...p.hole]).score);
    const best = Math.max(...scores);
    const winners = scores.filter(s => s === best).length;
    const equity = allInEquity(players, board);
    players.forEach((p, j) => {
      const expected = scores[j] === best ? 100 / winners : 0;
      assert(Math.abs(equity[p.id] - expected) < 1e-9, 'equity agrees with showdown');
    });
  }
  const players = [{ id: 'a', hole: ['As', 'Ad'] }, { id: 'b', hole: ['Kc', 'Kd'] }];
  const turn = allInEquity(players, ['2h', '4s', '7c', '9h']);
  assert(Math.abs(turn.b - 100 * 2 / 44) < 1e-9, 'exactly two winning rivers for kings');
  const tie = allInEquity(players, ['9h', 'Th', 'Jh', 'Qh', 'Kh']);
  assert(tie.a === 50 && tie.b === 50, 'shared straight flush splits equity');
}

// A shove alone must not reveal equity. The last call starts the public runout.
{
  const rules = { ...rs('cash-10-20'), turnSeconds: 0 };
  const t = new Table({ name: 'equity', maxSeats: 3, requireApproval: false, rules });
  const ps = ['A', 'B', 'C'].map((name, i) => t.createPlayer(name, i === 0));
  ps.forEach((p, i) => { p.connections = 1; t.requestSeat(p, i + 1, p.name, 1000); });
  t.start(ps[0].id);
  while (!t.hand) await sleep(1);
  const h = t.hand;
  const actor = () => h.players[h.toAct!].id;
  const folded = actor();
  t.act(folded, 'fold');
  t.act(actor(), 'allin');
  assert(t.view(null).players.every(p => p.equity === null && p.shownCards === null), 'odds hidden with a decision pending');
  t.act(actor(), 'call');
  const boards = new Set<number>();
  const check = () => {
    const view = t.view(null);
    if (h.finished) return;
    boards.add(h.board.length);
    const live = view.players.filter(p => p.id !== folded);
    assert(live.every(p => p.equity != null && p.shownCards?.length === 2), 'public odds accompany exposed hands');
    assert(Math.abs(live.reduce((s, p) => s + (p.equity ?? 0), 0) - 100) < 1e-8, 'runout equities sum to 100');
    assert(view.players.find(p => p.id === folded)?.equity === null, 'folded seat has no equity');
    for (const p of live) assert(t.view(p.id).players.find(x => x.id === p.id)?.equity === p.equity, 'viewers share the same calculation');
  };
  check();
  t.onChange = check;
  while (!h.finished) await sleep(1);
  assert([...boards].join(',') === '0,3,4', 'odds published before each remaining street');
  assert(t.view(null).players.every(p => p.equity === null), 'showdown clears odds');
  t.dispose();
}

async function run(seed: number, nPlayers: number, rulesIdx: number) {
  const rules = BUILT_IN_RULESETS[rulesIdx];
  const t = new Table({ name: 'test', maxSeats: 9, requireApproval: false, rules: { ...rules, turnSeconds: 0 } });
  const players = Array.from({ length: nPlayers }, (_, i) => t.createPlayer(`P${i}`, i === 0));
  players.forEach((p, i) => { p.connections = 1; t.requestSeat(p, i + 1, `P${i}`, 1000 + i * 137); });
  const total = () => t.players.reduce((s, p) => s + p.stack, 0) + (t.hand && !t.hand.finished ? t.hand.players.reduce((s, x) => s + x.contrib, 0) : 0);
  const start = t.players.reduce((s, p) => s + p.buyIn, 0);
  t.start(players[0].id);
  let hands = 0, actions = 0;
  let rnd = seed;
  const rand = () => { rnd = (rnd * 1103515245 + 12345) % 2 ** 31; return rnd / 2 ** 31; };
  for (let guard = 0; guard < 20000 && hands < 300; guard++) {
    await sleep(0);
    const h = t.hand;
    if (!h) { for (let w = 0; w < 50 && !t.hand; w++) await sleep(2); if (!t.hand) break; continue; }
    if (h.finished) { await sleep(3); if (t.hand === h) { hands++; break; } hands++; continue; }
    if (h.toAct == null) { await sleep(2); continue; }
    const id = h.players[h.toAct].id;
    const legal = t.legal(id)!;
    assert(legal, 'legal exists for actor');
    const r = rand();
    try {
      if (r < 0.15) t.act(id, 'fold');
      else if (r < 0.55) t.act(id, legal.canCheck ? 'check' : 'call');
      else if (r < 0.9 && legal.canRaise) t.act(id, 'raise', legal.minRaiseTo + Math.floor(rand() * (legal.maxRaiseTo - legal.minRaiseTo + 1) * 0.3));
      else if (legal.canRaise) t.act(id, 'allin');
      else t.act(id, 'call');
      actions++;
    } catch (e) { assert(false, `action threw: ${(e as Error).message}`); break; }
    assert(total() === start, `chips conserved (hand ${h.number}): ${total()} vs ${start}`);
    if (total() !== start) break;
    for (const p of t.players) assert(p.stack >= 0, 'no negative stacks');
  }
  t.dispose();
  return { hands, actions, alive: t.players.filter((p) => p.stack > 0).length };
}

// clock: levels advance, the last level never ends; tournaments forfeit chips on leave
{
  const rules = { ...rs('home-tourney'), levels: rs('home-tourney').levels.slice(0, 3), breakEveryLevels: 0, levelMinutes: 1, turnSeconds: 0 };
  const t = new Table({ name: 'clock', maxSeats: 9, requireApproval: false, rules });
  const a = t.createPlayer('A', true), b = t.createPlayer('B');
  a.connections = b.connections = 1;
  t.requestSeat(a, 1, 'A', 0); t.requestSeat(b, 2, 'B', 0);
  t.start(a.id);
  const t0 = Date.now();
  t.tick(t0 + 61_000); assert(t.clock.levelIndex === 1, 'level 2 after 1 min');
  t.tick(t0 + 125_000); assert(t.clock.levelIndex === 2, 'level 3 after 2 min');
  t.tick(t0 + 10 * 3600_000); assert(t.clock.levelIndex === 2, 'final level never ends');
  assert(t.view(a.id).clock.final === true && t.view(a.id).clock.next === null, 'final level flagged');
  t.dispose();
  const t2 = new Table({ name: 'leave', maxSeats: 9, requireApproval: false, rules: { ...rules, levelMinutes: 15 } });
  const c = t2.createPlayer('C', true), d = t2.createPlayer('D'), e = t2.createPlayer('E');
  for (const [i, p] of [c, d, e].entries()) { p.connections = 1; t2.requestSeat(p, i + 1, p.name, 0); }
  t2.start(c.id);
  t2.pause(c.id);
  await sleep(5);
  const stack = d.stack;
  t2.leaveSeat(d);
  assert(d.cashOut === 0 && d.forfeited === stack, 'tournament leave forfeits stack');
  assert(t2.view(c.id).ledger.find((r) => r.playerId === d.id)!.net === -d.buyIn, 'ledger shows full loss');
  t2.dispose();
  const t3 = new Table({ name: 'cash', maxSeats: 9, requireApproval: false, rules: { ...rs('cash-10-20'), turnSeconds: 0 } });
  const f = t3.createPlayer('F', true), g = t3.createPlayer('G');
  f.connections = g.connections = 1;
  t3.requestSeat(f, 1, 'F', 2000); t3.requestSeat(g, 2, 'G', 2000);
  t3.start(f.id); t3.pause(f.id); await sleep(5);
  const gs = g.stack; t3.leaveSeat(g);
  assert(g.cashOut === gs && g.forfeited === 0, 'cash game leave cashes out');
  t3.dispose();
}

// Rabbit hunts use the same deck and burns as a normal flop, turn and river.
for (const boardSize of [0, 3, 4, 5]) {
  const rules = { ...rs('cash-10-20'), rabbitHunt: true };
  const t = new Table({ name: 'Rabbit hunt', maxSeats: 2, requireApproval: false, rules });
  const a = t.createPlayer('A', true), b = t.createPlayer('B');
  for (const [i, p] of [a, b].entries()) {
    p.connections = 1;
    t.requestSeat(p, i + 1, p.name, 2000);
  }
  t.start(a.id);
  for (let i = 0; i < 100 && !t.hand; i++) await sleep(2);
  const h = t.hand!;
  const upcoming = [...h.deck].reverse();
  const expectedBoard = [1, 2, 3, 5, 7].map((i) => upcoming[i]);
  throws(() => t.rabbitHunt(a.id, h.number), /unavailable/);
  while (h.board.length < boardSize) {
    const id = h.players[h.toAct!].id;
    t.act(id, t.legal(id)!.canCheck ? 'check' : 'call');
  }
  deepStrictEqual(h.board, expectedBoard.slice(0, boardSize));
  t.act(h.players[h.toAct!].id, 'fold');
  deepStrictEqual(t.view(null).hand!.rabbitCards, []);
  if (boardSize === 5) {
    throws(() => t.rabbitHunt(a.id, h.number), /unavailable/);
  } else {
    rules.rabbitHunt = false;
    throws(() => t.rabbitHunt(a.id, h.number), /unavailable/);
    rules.rabbitHunt = true;
    throws(() => t.rabbitHunt('spectator', h.number), /unavailable/);
    throws(() => t.rabbitHunt(a.id, h.number - 1), /unavailable/);
    const stacks = t.players.map((p) => p.stack);
    const winners = structuredClone(h.winners);
    assert(t.view(a.id).you.canRabbitHunt, 'participant can request rabbit hunt');
    t.rabbitHunt(a.id, h.number);
    t.rabbitHunt(b.id, h.number);
    const spectator = t.view(null);
    deepStrictEqual(spectator.hand!.rabbitCards, expectedBoard.slice(boardSize));
    deepStrictEqual(spectator.hand!.board, expectedBoard.slice(0, boardSize));
    deepStrictEqual(spectator.hand!.winners, winners);
    deepStrictEqual(t.players.map((p) => p.stack), stacks);
    assert(spectator.players.every((p) => !p.shownCards), 'rabbit hunt keeps hole cards private');
    assert(t.log.filter((e) => e.text.startsWith('Rabbit hunt')).length === 1, 'two requests reveal only once');
  }
  t.dispose();
}

// Completed hands feed the season stats. A forced blind, an uncalled raise and
// a split showdown exercise the distinctions amounts alone cannot reconstruct.
{
  for (const split of [false, true]) {
    const rules = { ...rs('cash-10-20'), turnSeconds: 0 };
    const t = new Table({ name: 'stats', maxSeats: 2, requireApproval: false, rules });
    const ps = ['A', 'B'].map((name, i) => t.createPlayer(name, i === 0));
    ps.forEach((p, i) => { p.connections = 1; t.requestSeat(p, i + 1, p.name, 2000); });
    t.start(ps[0].id);
    while (!t.hand) await sleep(1);
    const h = t.hand;
    const small = t.player(h.players[h.toAct!].id)!;
    const big = ps.find((p) => p !== small)!;
    t.act(small.id, 'raise', 100);
    const interrupted = Table.restore(structuredClone(t.snapshot()));
    assert(interrupted.players.every((p) => !p.stats?.hands), 'void hand is excluded from stats');
    interrupted.dispose();
    if (split) {
      // Both players play the royal flush on the board.
      h.deck = ['Ah', '2c', 'Kh', '3c', 'Qh', 'Jh', 'Th', '4c'];
      h.players[0].hole = ['2s', '3s'];
      h.players[1].hole = ['2d', '3d'];
      t.act(big.id, 'call');
      while (!h.finished) t.act(h.players[h.toAct!].id, 'check');
    } else {
      t.act(big.id, 'fold');
    }
    deepStrictEqual(small.stats, { hands: 1, vpipHands: 1, pfrHands: 1, showdownsWon: split ? 1 : 0, biggestPot: split ? 100 : 40 });
    deepStrictEqual(big.stats, { hands: 1, vpipHands: split ? 1 : 0, pfrHands: 0, showdownsWon: split ? 1 : 0, biggestPot: split ? 100 : 0 });
    const restored = Table.restore(structuredClone(t.snapshot()));
    deepStrictEqual(restored.players.map((p) => p.stats), ps.map((p) => p.stats));
    restored.dispose();
    t.dispose();
  }
}

// payouts: buy-ins to 1st, rebuys rotate over 3 places
{
  const { payoutAmounts } = await import('../shared/presets');
  const pr = { enabled: true, currency: 'kr', buyIn: 300, rebuy: 300, addOn: 300, places: 3 };
  const a0 = payoutAmounts(5, [], pr);
  assert(a0[0] === 1500 && a0[1] === 0 && a0[2] === 0, 'no rebuys: winner takes all');
  const a4 = payoutAmounts(5, ['rebuy', 'rebuy', 'rebuy', 'rebuy'], pr);
  assert(a4[0] === 2100 && a4[1] === 300 && a4[2] === 300, `4 rebuys rotate: ${a4}`);
  const a6 = payoutAmounts(6, Array(6).fill('rebuy'), pr);
  assert(a6[0] === 2400 && a6[1] === 600 && a6[2] === 600, `6 rebuys rotate: ${a6}`);
}

// a full tournament ends with places 1..n and a winner
{
  const rules = { ...rs('friday-300'), turnSeconds: 0, rebuy: { ...rs('friday-300').rebuy, enabled: false } };
  const t = new Table({ name: 'tour', maxSeats: 9, requireApproval: false, rules });
  const ps = [0, 1, 2, 3].map((i) => t.createPlayer(`T${i}`, i === 0));
  ps.forEach((p, i) => { p.connections = 1; t.requestSeat(p, i + 1, p.name, 0); });
  t.start(ps[0].id);
  for (let g = 0; g < 20000 && t.status !== 'finished'; g++) {
    await sleep(0);
    const h = t.hand;
    if (!h || h.finished || h.toAct == null) { await sleep(1); continue; }
    const id = h.players[h.toAct].id;
    t.act(id, 'allin');
  }
  assert(t.status === 'finished', 'tournament finishes');
  const places = ps.map((p) => p.place).sort();
  assert(JSON.stringify(places) === '[1,2,3,4]', `places assigned: ${places}`);
  const res = t.view(ps[0].id).results!;
  assert(res.pool === 1200 && res.places[0].prize === 1200 && res.places[0].playerId === ps.find((p) => p.place === 1)!.id, 'winner gets the pool');
  const { formatResults } = await import('../client/src/lib/results');
  const [winner, second, third, fourth] = [...ps].sort((a, b) => a.place! - b.place!);
  t.leaveSeat(fourth);
  fourth.connections = 0;
  const view = t.view(winner.id);
  const summary = formatResults(view);
  for (const p of [second, third, fourth]) {
    assert(summary.includes(`${p.name} pays me (${winner.name}) 300 kr`), 'each loser pays the winner, including departed players');
  }
  assert(!formatResults(t.view(null)).includes('pays me'), 'spectator copy names the recipients');
  assert(!formatResults({ ...view, results: null }).includes('Settlement'), 'standings only with payouts off');
  // Net amounts +200, +100, -300 and 0 require a split payment.
  const split = formatResults({ ...view, results: { ...res,
    paid: { [winner.id]: 300, [second.id]: 300, [third.id]: 300, [fourth.id]: 0 },
    pool: 900, places: res.places.map((p, i) => ({ ...p, prize: [500, 400, 0][i] })),
  } });
  assert(split.includes(`${third.name} pays me (${winner.name}) 200 kr\n${third.name} pays ${second.name} 100 kr`), 'split payment settles both net winners');
  assert(split.split(' pays ').length === 3, 'break-even players owe nothing');
  const { rankedResults, seasonStandings } = await import('../shared/results');
  const rows = rankedResults(view);
  deepStrictEqual(rows.map((p) => p.net), [900, -300, -300, -300]);
  const night = { id: t.id, name: 'Friday', finishedAt: t.finishedAt!, year: 2026, currency: 'kr', players: rows };
  const player = rows[0];
  const stats = { hands: 10, vpipHands: 3, pfrHands: 2, showdownsWon: 1, biggestPot: 800 };
  const season = seasonStandings([
    { ...night, players: [{ ...player, stats }] },
    { ...night, id: 'rematch', players: [{ ...player, name: player.name.toLowerCase(), place: 2, net: -300,
      stats: { hands: 2, vpipHands: 2, pfrHands: 1, showdownsWon: 1, biggestPot: 100 } }] },
  ]);
  assert(season.length === 1 && season[0].games === 2 && season[0].wins === 1 && season[0].net === 600, 'season aggregates across tables by name');
  deepStrictEqual(season[0].stats, { hands: 12, vpipHands: 5, pfrHands: 3, showdownsWon: 2, biggestPot: 800 });
  t.dispose();
}

// Pausing mid-hand freezes the acting player's clock; resuming continues where it stopped.
{
  const { GameError } = await import('./table');
  const t = new Table({ name: 'pause', maxSeats: 3, requireApproval: false, rules: { ...rs('cash-10-20'), turnSeconds: 30 } });
  const ps = ['A', 'B', 'C'].map((name, i) => t.createPlayer(name, i === 0));
  ps.forEach((p, i) => { p.connections = 1; p.awaySince = null; t.requestSeat(p, i + 1, p.name, 1000); });
  t.start(ps[0].id);
  while (!t.hand || t.hand.toAct == null) await sleep(1);
  const h = t.hand;
  const actor = h.players[h.toAct!].id;
  t.pause(ps[0].id);
  const v = t.view(actor);
  assert(v.hand!.turnEndsAt === null && v.hand!.frozenMs! > 29_000, 'paused turn clock is frozen');
  assert(v.you.legal === null, 'no actions offered while paused');
  throws(() => t.act(actor, 'fold'), GameError, 'cannot act while paused');
  await sleep(30);
  t.start(ps[0].id);
  const left = t.hand!.turnEndsAt! - Date.now();
  assert(t.hand === h && h.players[h.toAct!].id === actor && left > 29_000 && left <= v.hand!.frozenMs!, 'resume keeps the same turn and time left');
  t.act(actor, 'call');
  assert(h.players.find((x) => x.id === actor)!.acted, 'can act after resume');

  // A player who has been gone a while is checked/folded almost at once instead of stalling the table.
  const next = h.players[h.toAct!];
  const away = t.player(next.id)!;
  away.connections = 0; away.awaySince = Date.now() - 60_000;
  t.connectionChanged(away);
  assert(t.view(null).players.find((p) => p.id === away.id)!.connected === false, 'disconnected player shown as disconnected');
  await sleep(20);
  assert(next.acted || next.folded || t.hand !== h, 'long-gone player times out quickly');

  // The others may take over as host once the host has been disconnected for a minute.
  const [host, other] = ps;
  host.connections = 0; host.awaySince = Date.now() - 5_000;
  assert(!t.canClaimHost(other.id), 'cannot claim host right after they drop');
  throws(() => t.claimHost(other.id), GameError);
  host.awaySince = Date.now() - 61_000;
  assert(t.view(other.id).you.canClaimHost && !t.view(host.id).you.canClaimHost, 'claim offered to the others only');
  t.claimHost(other.id);
  assert(other.isHost && !host.isHost, 'host taken over');
  t.dispose();
}

// Demo tables: bots play every hand themselves, rebuy when broke, and chips are conserved.
{
  const { createDemoTable, driveBots } = await import('./demo');
  const { table: t } = createDemoTable('Jani', 4);
  assert(t.demo && t.players.filter((p) => p.bot).length === 4, 'demo seats four bots');
  assert(t.players.every((p) => p.status === 'seated'), 'everyone is seated');
  // let a bot stand in for the visitor too
  const host = t.players.find((p) => p.isHost)!;
  host.bot = true; host.connections = 1;
  t.onChange = () => driveBots(t);
  t.start(host.id);
  for (let i = 0; i < 3000 && t.handNumber < 30; i++) await sleep(1);
  assert(t.handNumber >= 30, `bots keep dealing hands (got ${t.handNumber})`);
  const inPlay = t.players.reduce((s, p) => s + p.stack, 0) + (t.hand && !t.hand.finished ? t.hand.players.reduce((s, x) => s + x.contrib, 0) : 0);
  assert(inPlay === t.players.reduce((s, p) => s + p.buyIn, 0), 'demo chips conserved');
  assert(t.view(null).players.filter((p) => p.bot).length === 5, 'view marks bots');
  t.status = 'paused';
  t.dispose();
}

let totalHands = 0;
for (let i = 0; i < 400; i++) {
  const r = await run(i + 1, 2 + (i % 8), i % BUILT_IN_RULESETS.length);
  totalHands += r.hands;
}
console.log(`${totalHands} hands simulated, ${failures} failures`);
process.exit(failures ? 1 : 0);
export {};
