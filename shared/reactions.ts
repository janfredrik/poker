export const reactions = {
  '👏': 'Fin hånd',
  '😂': 'Latter',
  '😮': 'Oi',
  '👍': 'Tommel opp',
  '😅': 'Puh',
  '❤️': 'Elsker det',
} as const;

export type Reaction = keyof typeof reactions;
export interface SeatReactionEvent { playerId: string; emoji: Reaction }

export function isReaction(value: unknown): value is Reaction {
  return typeof value === 'string' && Object.hasOwn(reactions, value);
}
