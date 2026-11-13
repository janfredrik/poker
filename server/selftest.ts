// Engine self-test: plays thousands of random hands and checks invariants.
process.env.POKER_FAST = '1';
process.env.DATA_DIR = process.env.DATA_DIR ?? '/tmp/poker-selftest';
const { Table } = await import('./table');
const { bestHand } = await import('./cards');
const { BUILT_IN_RULESETS } = await import('../shared/presets');

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
    if (!h) { await sleep(2); if (!t.hand) break; continue; }
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

let totalHands = 0;
for (let i = 0; i < 400; i++) {
  const r = await run(i + 1, 2 + (i % 8), i % BUILT_IN_RULESETS.length);
  totalHands += r.hands;
}
console.log(`${totalHands} hands simulated, ${failures} failures`);
process.exit(failures ? 1 : 0);
export {};
