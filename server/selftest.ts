// Engine self-test: plays thousands of random hands and checks invariants.
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
