import type { BlindLevel, RuleSet } from './types';

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
    id: 'cash-10-20',
    name: 'Cash game 10/20',
    builtIn: true,
    startingStack: 2000,
    levelMinutes: 0,
    levels: [{ sb: 10, bb: 20, ante: 0 }],
    breakEveryLevels: 0,
    breakMinutes: 0,
    rebuy: { enabled: true, amount: 0, untilLevel: 0, maxPerPlayer: 0, maxStackToRebuy: -1 },
    addOn: { enabled: false, amount: 0, atLevel: 0 },
    turnSeconds: 0,
  },
  {
    id: 'home-tourney',
    name: 'Home tournament (15 min levels)',
    builtIn: true,
    startingStack: 5000,
    levelMinutes: 15,
    levels: ladder(25, 16, 6),
    breakEveryLevels: 4,
    breakMinutes: 5,
    rebuy: { enabled: true, amount: 5000, untilLevel: 4, maxPerPlayer: 2, maxStackToRebuy: 0 },
    addOn: { enabled: true, amount: 5000, atLevel: 4 },
    turnSeconds: 30,
  },
  {
    id: 'turbo',
    name: 'Turbo (8 min levels)',
    builtIn: true,
    startingStack: 3000,
    levelMinutes: 8,
    levels: ladder(25, 14, 5),
    breakEveryLevels: 0,
    breakMinutes: 0,
    rebuy: { enabled: true, amount: 3000, untilLevel: 3, maxPerPlayer: 1, maxStackToRebuy: 0 },
    addOn: { enabled: false, amount: 0, atLevel: 0 },
    turnSeconds: 20,
  },
  {
    id: 'freezeout',
    name: 'Freezeout (20 min, no rebuys)',
    builtIn: true,
    startingStack: 10000,
    levelMinutes: 20,
    levels: ladder(25, 18, 5),
    breakEveryLevels: 0,
    breakMinutes: 0,
    rebuy: { enabled: false, amount: 0, untilLevel: 0, maxPerPlayer: 0, maxStackToRebuy: 0 },
    addOn: { enabled: false, amount: 0, atLevel: 0 },
    turnSeconds: 30,
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
    startingStack: int(r.startingStack, 1, 1e9, 2000),
    levelMinutes: int(r.levelMinutes, 0, 240, 0),
    levels: levels.length ? levels : [{ sb: 10, bb: 20, ante: 0 }],
    breakEveryLevels: int(r.breakEveryLevels, 0, 60, 0),
    breakMinutes: int(r.breakMinutes, 0, 60, 0),
    rebuy: {
      enabled: !!r.rebuy?.enabled,
      amount: int(r.rebuy?.amount, 0, 1e9, 0),
      untilLevel: int(r.rebuy?.untilLevel, 0, 60, 0),
      maxPerPlayer: int(r.rebuy?.maxPerPlayer, 0, 100, 0),
      maxStackToRebuy: int(r.rebuy?.maxStackToRebuy, -1, 1e9, 0),
    },
    addOn: {
      enabled: !!r.addOn?.enabled,
      amount: int(r.addOn?.amount, 0, 1e9, 0),
      atLevel: int(r.addOn?.atLevel, 0, 60, 0),
    },
    turnSeconds: int(r.turnSeconds, 0, 600, 0),
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
