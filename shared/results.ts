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
}

export function emptyStats(): PlayerStats {
  return { hands: 0, vpipHands: 0, pfrHands: 0, showdownsWon: 0, biggestPot: 0 };
}

export interface SeasonNight {
  id: string;
  name: string;
  finishedAt: number;
  year: number;
  currency: string | null;
  players: (ReturnType<typeof rankedResults>[number] & { stats?: PlayerStats })[];
}

export function seasonStandings(nights: SeasonNight[]) {
  interface Standing { key: string; name: string; games: number; wins: number; net: number; stats: PlayerStats }
  const totals = new Map<string, Standing>();
  for (const night of nights) {
    const names = night.players.map((p) => p.name.trim().normalize().toLowerCase());
    night.players.forEach((p, index) => {
      const duplicate = names.indexOf(names[index]) !== names.lastIndexOf(names[index]);
      // Equal display names at one table cannot be attributed across games.
      const key = duplicate ? JSON.stringify([night.id, p.id]) : JSON.stringify(names[index]);
      const name = duplicate ? `${p.name} (#${p.place})` : p.name;
      const row = totals.get(key) ?? { key, name, games: 0, wins: 0, net: 0, stats: emptyStats() };
      row.games++;
      if (p.place === 1) row.wins++;
      row.net += p.net ?? 0;
      if (p.stats) {
        row.stats.hands += p.stats.hands;
        row.stats.vpipHands += p.stats.vpipHands;
        row.stats.pfrHands += p.stats.pfrHands;
        row.stats.showdownsWon += p.stats.showdownsWon;
        row.stats.biggestPot = Math.max(row.stats.biggestPot, p.stats.biggestPot);
      }
      totals.set(key, row);
    });
  }
  return [...totals.values()].sort((a, b) => b.net - a.net || b.wins - a.wins || a.name.localeCompare(b.name, 'nb'));
}
