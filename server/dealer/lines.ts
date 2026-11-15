/**
 * AI-dealer: fixed lines for routine moments. No names, so each variant is voiced once and kept
 * on disk. (The welcome on sitting down, built in index.ts, has a name and is kept per name.) Also used for big moments when the fresh-line budget is spent.
 */
import type { DealerEvent } from './events';

export const FIXED: Partial<Record<DealerEvent['kind'], string[]>> = {
  spillstart: [
    'Velkommen til bordet. Jeg deler, dere taper. Lykke til.',
    'Da setter vi i gang. Hold kortene lavt og forventningene enda lavere.',
    'Kortene er stokket. Ta plass, så starter vi.',
  ],
  nivå: [
    'Blindsene går opp. Det blir dyrere å vente.',
    'Nytt nivå. Tålmodigheten har nettopp fått en prislapp.',
    'Blindsene øker. Nå begynner det å koste noe å være forsiktig.',
  ],
  pause: [
    'Pause. Strekk på bena, kortene venter på dere.',
    'Pause. Ingen rører sjetongene mens jeg ser bort.',
  ],
  flop: ['Flopp.', 'Her er floppen.', 'Tre kort på bordet.'],
  turn: ['Turn.', 'Og turn.', 'Fjerde kort.'],
  river: ['River.', 'Og river. Siste kort.', 'River. Nå er det opp til dere.'],
  'all-in': ['All-in. Nå blir det spennende.', 'Alt i potten. Da får vi se.'],
  showdown: ['Kortene på bordet. Vi har en vinner.', 'Showdown. Potten finner eieren sin.'],
  utslått: ['Tom for chips. Det skjer med de beste.', 'Der gikk den siste sjetongen.'],
  plass: ['Det var slutten for en av oss. Takk for spillet.'],
  seier: ['Vi har en vinner. Gratulerer, det var fortjent. Stort sett.'],
};

export function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}
