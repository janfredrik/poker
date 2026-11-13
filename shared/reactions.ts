export const reactions = {
  '👏': 'Nice hand',
  '😂': 'Laugh',
  '😮': 'Wow',
  '👍': 'Thumbs up',
  '😅': 'Phew',
  '❤️': 'Love it',
} as const;

export type Reaction = keyof typeof reactions;
export interface SeatReactionEvent { playerId: string; emoji: Reaction }

export function isReaction(value: unknown): value is Reaction {
  return typeof value === 'string' && Object.hasOwn(reactions, value);
}
