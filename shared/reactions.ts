export const reactions = {
  '👏': 'Fin hånd',
  '😂': 'Latter',
  '😮': 'Oi',
  '👍': 'Tommel opp',
  '😅': 'Puh',
  '❤️': 'Elsker det',
  '🔥': 'Hett',
  '😭': 'Bad beat',
  '🤯': 'Sjokk',
  '🤔': 'Hmm',
  '😎': 'Kjølig',
  '🙏': 'Vær så snill',
  '🤡': 'Klovn',
  '💀': 'Død',
  '🙈': 'Orker ikke se',
  '🐟': 'Fisk',
  '🦈': 'Hai',
  '🐔': 'Feiging',
  '🍀': 'Flaks',
  '💸': 'Der gikk pengene',
  '🤝': 'GG',
  '🍻': 'Skål',
  '💩': 'Dritt',
  '🤬': 'Banning',
} as const;

export type Reaction = keyof typeof reactions;
/** `toId` is set when the reaction is thrown at another player: it flies from `playerId`'s seat to theirs. */
export interface SeatReactionEvent { playerId: string; emoji: Reaction; toId?: string }

export function isReaction(value: unknown): value is Reaction {
  return typeof value === 'string' && Object.hasOwn(reactions, value);
}
