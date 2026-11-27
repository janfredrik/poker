import type { TableView } from './types';

/** Final places and settlement amounts, including entrants outside the prize places. */
export function rankedResults({ players, results }: Pick<TableView, 'players' | 'results'>) {
  return players.flatMap((p) => {
    if (p.place == null) return [];
    const prize = results?.places.find((place) => place.playerId === p.id)?.prize ?? 0;
    const paid = results?.paid[p.id] ?? null;
    return [{ id: p.id, name: p.name, place: p.place, paid, prize, net: paid == null ? null : prize - paid }];
  }).sort((a, b) => a.place - b.place);
}

export interface PlayerStats {
  hands: number;
  vpipHands: number;
  pfrHands: number;
  showdownsWon: number;
  biggestPot: number;
  /** Hands this player took chips from (missing in older saves). */
  handsWon?: number;
  /** The counters below are missing on nights that began before they were recorded. */
  flopsSeen?: number;
  /** Hands that reached a showdown against at least one other player. */
  showdowns?: number;
  /** showdownsWon counted over the same hands as showdowns. */
  showdownsWonTracked?: number;
  postflopAggr?: number;
  postflopCalls?: number;
}

export function emptyStats(): PlayerStats {
  return { hands: 0, vpipHands: 0, pfrHands: 0, showdownsWon: 0, biggestPot: 0, handsWon: 0,
    flopsSeen: 0, showdowns: 0, showdownsWonTracked: 0, postflopAggr: 0, postflopCalls: 0 };
}

/** Rates as fractions, or null when a sample is empty or was never recorded. */
export function statRates(s: PlayerStats) {
  const rate = (n: number | undefined, d: number | undefined) => (n == null || !d ? null : n / d);
  return {
    vpip: rate(s.vpipHands, s.hands),
    pfr: rate(s.pfrHands, s.hands),
    won: rate(s.handsWon, s.hands),
    wtsd: rate(s.showdowns, s.flopsSeen),
    wsd: rate(s.showdownsWonTracked, s.showdowns),
    af: s.postflopAggr == null ? null : s.postflopCalls ? s.postflopAggr / s.postflopCalls : s.postflopAggr ? Infinity : null,
  };
}

/** A loose read of playing style from VPIP and PFR, once there are enough hands to say anything. */
export function playStyle(s: PlayerStats): string | null {
  if (s.hands < 40 || !s.vpipHands) return null;
  const vpip = s.vpipHands / s.hands;
  const aggressive = s.pfrHands / s.vpipHands >= 0.5;
  return `${vpip < 0.25 ? 'Tight' : 'Løs'}, ${aggressive ? 'aggressiv' : 'passiv'}`;
}

export interface SeasonNight {
  id: string;
  name: string;
  finishedAt: number;
  year: number;
  currency: string | null;
  /** Play time excluding pauses. Missing on nights archived before it was recorded. */
  playedMs?: number;
  /** rebuys, addOn, knockouts and bestHand are missing on nights archived before they were recorded. */
  players: (ReturnType<typeof rankedResults>[number] & {
    stats?: PlayerStats; rebuys?: number; addOn?: boolean;
    /** Night player ids this player busted, one per bust. */
    knockouts?: string[];
    /** Strongest hand shown down; score compares across nights. */
    bestHand?: { score: number; name: string; cards: string[] } | null;
  })[];
}

export function seasonStandings(nights: SeasonNight[]) {
  interface Standing {
    key: string; name: string; games: number; wins: number; net: number; rebuys: number; addOns: number;
    /** Finishes with a prize. */ cashes: number; knockouts: number; stats: PlayerStats;
    bestHand: { score: number; name: string; cards: string[]; night: string } | null;
  }
  const totals = new Map<string, Standing>();
  for (const night of nights) {
    const names = night.players.map((p) => p.name.trim().normalize().toLowerCase());
    night.players.forEach((p, index) => {
      const duplicate = names.indexOf(names[index]) !== names.lastIndexOf(names[index]);
      // Equal display names at one table cannot be attributed across games.
      const key = duplicate ? JSON.stringify([night.id, p.id]) : JSON.stringify(names[index]);
      const name = duplicate ? `${p.name} (#${p.place})` : p.name;
      const row = totals.get(key) ?? { key, name, games: 0, wins: 0, net: 0, rebuys: 0, addOns: 0, cashes: 0, knockouts: 0, bestHand: null,
        stats: { hands: 0, vpipHands: 0, pfrHands: 0, showdownsWon: 0, biggestPot: 0, handsWon: 0 } as PlayerStats };
      row.games++;
      if (p.place === 1) row.wins++;
      row.net += p.net ?? 0;
      row.rebuys += p.rebuys ?? 0;
      if (p.addOn) row.addOns++;
      if (p.prize > 0) row.cashes++;
      row.knockouts += p.knockouts?.length ?? 0;
      if (p.bestHand && p.bestHand.score > (row.bestHand?.score ?? -1)) row.bestHand = { ...p.bestHand, night: night.name };
      if (p.stats) {
        row.stats.hands += p.stats.hands;
        row.stats.vpipHands += p.stats.vpipHands;
        row.stats.pfrHands += p.stats.pfrHands;
        row.stats.showdownsWon += p.stats.showdownsWon;
        row.stats.handsWon = (row.stats.handsWon ?? 0) + (p.stats.handsWon ?? 0);
        row.stats.biggestPot = Math.max(row.stats.biggestPot, p.stats.biggestPot);
        if (p.stats.showdowns != null) {
          const add = (k: 'flopsSeen' | 'showdowns' | 'showdownsWonTracked' | 'postflopAggr' | 'postflopCalls') => { row.stats[k] = (row.stats[k] ?? 0) + (p.stats![k] ?? 0); };
          add('flopsSeen'); add('showdowns'); add('showdownsWonTracked'); add('postflopAggr'); add('postflopCalls');
        }
      }
      totals.set(key, row);
    });
  }
  return [...totals.values()].sort((a, b) => b.net - a.net || b.wins - a.wins || a.name.localeCompare(b.name, 'nb'));
}
