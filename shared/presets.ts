import type { BlindLevel, PayoutRules, RuleSet, TimeBankRules } from './types';

const NO_BANK: TimeBankRules = { enabled: false, startSeconds: 60, addSeconds: 15, everyHands: 10, maxSeconds: 120 };
const BANK: TimeBankRules = { enabled: true, startSeconds: 60, addSeconds: 15, everyHands: 10, maxSeconds: 120 };
const NO_PAYOUT: PayoutRules = { enabled: false, currency: 'kr', buyIn: 300, rebuy: 300, addOn: 300, places: 3 };

/** Build a blind ladder from a starting small blind using a familiar progression. */
export function ladder(startSb: number, count: number, anteFromLevel = 0): BlindLevel[] {
  const steps = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 250, 300, 400, 500];
  const out: BlindLevel[] = [];
  for (let i = 0; i < count && i < steps.length; i++) {
    const sb = startSb * steps[i];
    const bb = sb * 2;
    out.push({ sb, bb, ante: anteFromLevel > 0 && i + 1 >= anteFromLevel ? bb : 0 });
  }
  return out;
}

export const BUILT_IN_RULESETS: RuleSet[] = [
  {
    id: 'friday-300',
    rabbitHunt: false,
    name: 'Standard tournament',
    builtIn: true,
    startingStack: 2000,
    levelMinutes: 20,
    cashOut: false,
    levels: [
      [10, 20], [20, 40], [30, 60], [40, 80], [50, 100], [60, 120], [75, 150], [100, 200],
      [125, 250], [150, 300], [200, 400], [300, 600], [400, 800], [600, 1200], [800, 1600], [1000, 2000],
    ].map(([sb, bb]) => ({ sb, bb, ante: 0 })),
    breakEveryLevels: 0,
    breakMinutes: 0,
    rebuy: { enabled: true, amount: 2000, untilLevel: 0, untilMinutes: 60, maxPerPlayer: 2, maxStackToRebuy: 0 },
    addOn: { enabled: false, amount: 0, atLevel: 0 },
    turnSeconds: 30,
    timeBank: BANK,
    payout: { enabled: true, currency: 'kr', buyIn: 300, rebuy: 300, addOn: 300, places: 3 },
  },
  {
    id: 'cash-10-20',
    rabbitHunt: false,
    name: 'Cash game 10/20',
    builtIn: true,
    startingStack: 2000,
    levelMinutes: 0,
    cashOut: true,
    levels: [{ sb: 10, bb: 20, ante: 0 }],
    breakEveryLevels: 0,
    breakMinutes: 0,
    rebuy: { enabled: true, amount: 0, untilLevel: 0, untilMinutes: 0, maxPerPlayer: 0, maxStackToRebuy: -1 },
    addOn: { enabled: false, amount: 0, atLevel: 0 },
    turnSeconds: 0,
    timeBank: NO_BANK,
    payout: NO_PAYOUT,
  },
  {
    id: 'home-tourney',
    rabbitHunt: false,
    name: 'Home tournament (15 min levels)',
    builtIn: true,
    startingStack: 5000,
    levelMinutes: 15,
    cashOut: false,
    levels: ladder(25, 16, 6),
    breakEveryLevels: 4,
    breakMinutes: 5,
    rebuy: { enabled: true, amount: 5000, untilLevel: 4, untilMinutes: 0, maxPerPlayer: 2, maxStackToRebuy: 0 },
    addOn: { enabled: true, amount: 5000, atLevel: 4 },
    turnSeconds: 30,
    timeBank: BANK,
    payout: NO_PAYOUT,
  },
  {
    id: 'turbo',
    rabbitHunt: false,
    name: 'Turbo (8 min levels)',
    builtIn: true,
    startingStack: 3000,
    levelMinutes: 8,
    cashOut: false,
    levels: ladder(25, 14, 5),
    breakEveryLevels: 0,
    breakMinutes: 0,
    rebuy: { enabled: true, amount: 3000, untilLevel: 3, untilMinutes: 0, maxPerPlayer: 1, maxStackToRebuy: 0 },
    addOn: { enabled: false, amount: 0, atLevel: 0 },
    turnSeconds: 20,
    timeBank: { ...BANK, startSeconds: 30, addSeconds: 10, maxSeconds: 60 },
    payout: NO_PAYOUT,
  },
  {
    id: 'freezeout',
    rabbitHunt: false,
    name: 'Freezeout (20 min, no rebuys)',
    builtIn: true,
    startingStack: 10000,
    levelMinutes: 20,
    cashOut: false,
    levels: ladder(25, 18, 5),
    breakEveryLevels: 0,
    breakMinutes: 0,
    rebuy: { enabled: false, amount: 0, untilLevel: 0, untilMinutes: 0, maxPerPlayer: 0, maxStackToRebuy: 0 },
    addOn: { enabled: false, amount: 0, atLevel: 0 },
    turnSeconds: 30,
    timeBank: BANK,
    payout: NO_PAYOUT,
  },
];

/** Defensive normalisation of a rule set coming from a client or from disk. */
export function sanitizeRules(input: Partial<RuleSet> | undefined, fallback: RuleSet = BUILT_IN_RULESETS[0]): RuleSet {
  const r = { ...fallback, ...(input ?? {}) } as RuleSet;
  const int = (v: unknown, min: number, max: number, d: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  const levels = (Array.isArray(r.levels) ? r.levels : fallback.levels)
    .slice(0, 60)
    .map((l) => {
      const sb = int(l?.sb, 1, 1e9, 1);
      const bb = Math.max(sb, int(l?.bb, 1, 1e9, sb * 2));
      return { sb, bb, ante: int(l?.ante, 0, 1e9, 0) };
    });
  return {
    id: String(r.id || 'custom').slice(0, 64),
    name: String(r.name || 'Custom rules').slice(0, 60),
    builtIn: false,
    rabbitHunt: r.rabbitHunt === true,
    startingStack: int(r.startingStack, 1, 1e9, 2000),
    levelMinutes: int(r.levelMinutes, 0, 240, 0),
    cashOut: typeof r.cashOut === 'boolean' ? r.cashOut : int(r.levelMinutes, 0, 240, 0) === 0,
    levels: levels.length ? levels : [{ sb: 10, bb: 20, ante: 0 }],
    breakEveryLevels: int(r.breakEveryLevels, 0, 60, 0),
    breakMinutes: int(r.breakMinutes, 0, 60, 0),
    rebuy: {
      enabled: !!r.rebuy?.enabled,
      amount: int(r.rebuy?.amount, 0, 1e9, 0),
      untilLevel: int(r.rebuy?.untilLevel, 0, 60, 0),
      maxPerPlayer: int(r.rebuy?.maxPerPlayer, 0, 100, 0),
      maxStackToRebuy: int(r.rebuy?.maxStackToRebuy, -1, 1e9, 0),
      untilMinutes: int(r.rebuy?.untilMinutes, 0, 1440, 0),
    },
    addOn: {
      enabled: !!r.addOn?.enabled,
      amount: int(r.addOn?.amount, 0, 1e9, 0),
      atLevel: int(r.addOn?.atLevel, 0, 60, 0),
    },
    turnSeconds: int(r.turnSeconds, 0, 600, 0),
    timeBank: {
      enabled: !!r.timeBank?.enabled,
      startSeconds: int(r.timeBank?.startSeconds, 0, 3600, 60),
      addSeconds: int(r.timeBank?.addSeconds, 0, 3600, 15),
      everyHands: int(r.timeBank?.everyHands, 0, 1000, 10),
      maxSeconds: int(r.timeBank?.maxSeconds, 0, 3600, 120),
    },
    payout: {
      enabled: !!r.payout?.enabled,
      currency: String(r.payout?.currency ?? 'kr').slice(0, 6),
      buyIn: int(r.payout?.buyIn, 0, 1e7, 300),
      rebuy: int(r.payout?.rebuy, 0, 1e7, 300),
      addOn: int(r.payout?.addOn, 0, 1e7, 300),
      places: int(r.payout?.places, 1, 9, 3),
    },
  };
}

export function formatChips(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Prize per place: all buy-ins to 1st; rebuys and add-ons rotate over the paid places
 * in the order they were made (1st to 1st place, 2nd to 2nd, … then round again).
 * `events` lists each rebuy ('rebuy') or add-on ('addon') in order.
 */
export function payoutAmounts(entries: number, events: ('rebuy' | 'addon')[], p: PayoutRules, players = entries): number[] {
  const places = Math.max(1, Math.min(p.places, Math.max(1, players)));
  const out = Array.from({ length: places }, () => 0);
  out[0] = entries * p.buyIn;
  events.forEach((e, i) => { out[i % places] += e === 'addon' ? p.addOn : p.rebuy; });
  return out;
}
