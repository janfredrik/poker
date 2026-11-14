import type { Card } from '../shared/types';
import { RANKS, SUITS } from './cards';

// Rank masks let each trial score seven cards directly, without evaluating all 21 five-card subsets.
const highest = (mask: number) => 31 - Math.clz32(mask);
const bitCount = new Uint8Array(1 << 13);
const straightHigh = new Int8Array(1 << 13).fill(-1);
for (let mask = 1; mask < bitCount.length; mask++) {
  bitCount[mask] = 1 + bitCount[mask & (mask - 1)];
  const runs = mask & (mask >> 1) & (mask >> 2) & (mask >> 3) & (mask >> 4);
  if (runs) straightHigh[mask] = highest(runs) + 4;
  else if ((mask & 0x100f) === 0x100f) straightHigh[mask] = 3; // A-2-3-4-5
}

function topRanks(mask: number, count: number) {
  while (bitCount[mask] > count) mask &= mask - 1;
  return mask;
}

function encode(card: Card) {
  return SUITS.indexOf(card[1]) * 13 + RANKS.indexOf(card[0]);
}

// Within each category, compare the made ranks first, then a mask of the remaining kickers.
function scoreSeven(cards: number[]) {
  let ranks = 0, pairs = 0, trips = 0, quads = 0;
  const suits = [0, 0, 0, 0];
  for (const card of cards) {
    const bit = 1 << (card % 13);
    quads |= trips & bit;
    trips |= pairs & bit;
    pairs |= ranks & bit;
    ranks |= bit;
    suits[Math.floor(card / 13)] |= bit;
  }
  const category = 1 << 26;
  const group = 1 << 13;
  const flush = suits.find(mask => bitCount[mask] >= 5);
  if (flush && straightHigh[flush] >= 0) return 8 * category + straightHigh[flush];
  if (quads) return 7 * category + highest(quads) * group + topRanks(ranks ^ quads, 1);
  const trip = trips ? 1 << highest(trips) : 0;
  if (trip && (pairs ^ trip)) return 6 * category + highest(trip) * group + highest(pairs ^ trip);
  if (flush) return 5 * category + topRanks(flush, 5);
  if (straightHigh[ranks] >= 0) return 4 * category + straightHigh[ranks];
  if (trip) return 3 * category + highest(trip) * group + topRanks(ranks ^ trip, 2);
  if (bitCount[pairs] >= 2) {
    const bestPairs = topRanks(pairs, 2);
    return 2 * category + bestPairs * group + topRanks(ranks ^ bestPairs, 1);
  }
  if (pairs) return category + highest(pairs) * group + topRanks(ranks ^ pairs, 3);
  return topRanks(ranks, 5);
}

/** Main-pot equity (%) from public cards only. Tied best hands share each trial. */
export function allInEquity(players: { id: string; hole: Card[] }[], board: Card[], exposedDead: Card[] = []) {
  const hands = players.map(p => [...p.hole, ...board].map(encode));
  const known = new Set([...hands.flat(), ...exposedDead.map(encode)]);
  const unseen = Array.from({ length: 52 }, (_, i) => i).filter(c => !known.has(c));
  const shares = players.map(() => 0);
  const missing = 5 - board.length;
  let trials = 0;
  function evaluate(draw: number[]) {
    const scores = hands.map(hand => scoreSeven([...hand, ...draw]));
    const best = Math.max(...scores);
    const winners = scores.filter(score => score === best).length;
    for (let i = 0; i < scores.length; i++) if (scores[i] === best) shares[i] += 1 / winners;
    trials++;
  }
  if (missing === 0) evaluate([]);
  else if (missing === 1) {
    for (const river of unseen) evaluate([river]);
  } else if (missing === 2) {
    for (let i = 0; i < unseen.length; i++) {
      for (let j = i + 1; j < unseen.length; j++) evaluate([unseen[i], unseen[j]]);
    }
  } else {
    for (let trial = 0; trial < 4000; trial++) {
      // A partial Fisher–Yates gives a fresh uniform board from any starting order.
      for (let i = 0; i < missing; i++) {
        const j = i + Math.floor(Math.random() * (unseen.length - i));
        [unseen[i], unseen[j]] = [unseen[j], unseen[i]];
      }
      evaluate(unseen.slice(0, missing));
    }
  }
  return Object.fromEntries(players.map((p, i) => [p.id, 100 * shares[i] / trials]));
}
