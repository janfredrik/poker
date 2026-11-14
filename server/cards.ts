import { randomInt } from 'node:crypto';
import type { Card } from '../shared/types';

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const RANK_PLURAL = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

/** Fresh deck, shuffled with a cryptographic Fisher–Yates. */
export function shuffledDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export interface HandValue {
  /** Comparable score: higher wins. */
  score: number;
  category: number;
  name: string;
  cards: Card[];
}

const rankOf = (c: Card) => RANKS.indexOf(c[0]);

function eval5(cards: Card[]): { cat: number; kick: number[] } {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const uniq = [...new Set(ranks)];
  let straightHigh = -1;
  if (uniq.length === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 12 && ranks[1] === 3) straightHigh = 3; // wheel A-2-3-4-5
  }
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // groups sorted by count desc, then rank desc
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map((g) => g[0]);

  if (straightHigh >= 0 && flush) return { cat: 8, kick: [straightHigh] };
  if (groups[0][1] === 4) return { cat: 7, kick: byGroup };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { cat: 6, kick: byGroup };
  if (flush) return { cat: 5, kick: ranks };
  if (straightHigh >= 0) return { cat: 4, kick: [straightHigh] };
  if (groups[0][1] === 3) return { cat: 3, kick: byGroup };
  if (groups[0][1] === 2 && groups[1][1] === 2) return { cat: 2, kick: byGroup };
  if (groups[0][1] === 2) return { cat: 1, kick: byGroup };
  return { cat: 0, kick: ranks };
}

function describe(cat: number, kick: number[]): string {
  const n = (i: number) => RANK_NAMES[kick[i]];
  const p = (i: number) => RANK_PLURAL[kick[i]];
  switch (cat) {
    case 8: return kick[0] === 12 ? 'Royal Flush' : `Straight Flush, ${n(0)} high`;
    case 7: return `Four ${p(0)}`;
    case 6: return `Full House, ${p(0)} full of ${p(1)}`;
    case 5: return `Flush, ${n(0)} high`;
    case 4: return `Straight, ${n(0)} high`;
    case 3: return `Three ${p(0)}`;
    case 2: return `Two Pair, ${p(0)} and ${p(1)}`;
    case 1: return `Pair of ${p(0)}`;
    default: return `${n(0)} High`;
  }
}

function combos<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}

/** Name of what someone holds right now: hole cards alone before the flop, best five once there are five or more cards. */
export function madeHandName(cards: Card[]): string | null {
  if (cards.length >= 5) return bestHand(cards).name;
  if (cards.length !== 2) return null;
  const [a, b] = cards.map(rankOf).sort((x, y) => y - x);
  return a === b ? `Pair of ${RANK_PLURAL[a]}` : `${RANK_NAMES[a]} High`;
}

/** Best five-card hand from 5–7 cards. */
export function bestHand(cards: Card[]): HandValue {
  let best: HandValue | null = null;
  for (const five of combos(cards, 5)) {
    const { cat, kick } = eval5(five);
    let score = cat;
    for (let i = 0; i < 5; i++) score = score * 15 + (kick[i] ?? 0);
    if (!best || score > best.score) best = { score, category: cat, name: describe(cat, kick), cards: five };
  }
  return best!;
}
