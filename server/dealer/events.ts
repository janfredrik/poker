/**
 * AI-dealer: turns new log lines into things worth saying. This is the only file that knows the
 * log texts written by server/table.ts; the self-test plays a hand to catch it if they change.
 */
import type { LogEntry } from '../../shared/types';

export type DealerEvent =
  | { kind: 'spillstart' }
  | { kind: 'hand'; number: number }
  | { kind: 'nivå'; level: number; blinds: string }
  | { kind: 'pause'; minutes: number }
  | { kind: 'flop' | 'turn' | 'river'; cards: string }
  | { kind: 'all-in'; name: string }
  | { kind: 'showdown'; name: string; amount: string; hand: string }
  | { kind: 'utslått'; name: string }
  | { kind: 'plass'; name: string; place: number }
  | { kind: 'seier'; name: string }
  | { kind: 'velkommen'; name: string };

/** Big moments get a fresh line from the brain; the rest use fixed lines. */
export const BIG: ReadonlySet<DealerEvent['kind']> = new Set(['all-in', 'showdown', 'utslått', 'plass', 'seier']);

/** Higher speaks first when several things happen at once. */
export const PRIORITY: Record<DealerEvent['kind'], number> = {
  seier: 9, plass: 8, utslått: 7, showdown: 6, 'all-in': 5, spillstart: 4, nivå: 3, pause: 3, river: 2, velkommen: 2, turn: 1, flop: 1, hand: 0,
};

export function parseEvents(entries: LogEntry[]): DealerEvent[] {
  const out: DealerEvent[] = [];
  let allInSeen = false;
  for (const e of entries) {
    const s = e.text;
    let m: RegExpMatchArray | null;
    if (e.kind === 'chat') continue;
    if (e.kind === 'system') {
      if (s.startsWith('Spillet har startet.')) out.push({ kind: 'spillstart' });
      else if ((m = s.match(/^Nivå (\d+) · nye blinds (.+)\.$/))) out.push({ kind: 'nivå', level: Number(m[1]), blinds: m[2] });
      else if ((m = s.match(/^Pause i (\d+) min\./))) out.push({ kind: 'pause', minutes: Number(m[1]) });
      else if ((m = s.match(/^(.+) er tom for chips/))) out.push({ kind: 'utslått', name: m[1] });
      else if ((m = s.match(/^(.+) ender på (\d+)\. plass\.$/))) out.push({ kind: 'plass', name: m[1], place: Number(m[2]) });
      else if ((m = s.match(/^(.+) vinner turneringen!$/))) out.push({ kind: 'seier', name: m[1] });
      else if ((m = s.match(/^(.+) setter seg i sete \d+ med /))) out.push({ kind: 'velkommen', name: m[1] });
    } else if (e.kind === 'hand') {
      if ((m = s.match(/^Hånd nr\. (\d+) ·/))) { out.push({ kind: 'hand', number: Number(m[1]) }); allInSeen = false; }
      else if ((m = s.match(/^(Flop|Turn|River): (.+)$/))) out.push({ kind: m[1].toLowerCase() as 'flop' | 'turn' | 'river', cards: m[2] });
      else if ((m = s.match(/^(.+) vinner (\d[\d\s.,]*) med (.+)$/))) out.push({ kind: 'showdown', name: m[1], amount: m[2], hand: m[3] });
    } else if (e.kind === 'action') {
      if (!allInSeen && (m = s.match(/^(.+?) (?:caller .+ og er all-in|(?:better|raiser til) .+ \(all-in\))$/))) {
        out.push({ kind: 'all-in', name: m[1] });
        allInSeen = true;
      }
    }
  }
  return out;
}

/** What the brain is told happened, in Norwegian. */
export function describe(e: DealerEvent): string {
  switch (e.kind) {
    case 'all-in': return `${e.name} går all-in.`;
    case 'showdown': return `Showdown: ${e.name} vinner ${e.amount} med ${e.hand}.`;
    case 'utslått': return `${e.name} er tom for chips.`;
    case 'plass': return `${e.name} er ute av turneringen på ${e.place}. plass.`;
    case 'seier': return `${e.name} har vunnet turneringen.`;
    case 'nivå': return `Blindsene går opp til ${e.blinds} (nivå ${e.level}).`;
    case 'pause': return `Pause i ${e.minutes} minutter.`;
    case 'flop': case 'turn': case 'river': return `${e.kind}: ${e.cards}.`;
    case 'spillstart': return 'Spillet starter.';
    case 'hand': return `Hånd nr. ${e.number} deles ut.`;
    case 'velkommen': return `${e.name} setter seg ved bordet.`;
  }
}

const VOWEL = /[aeiouyæøåéèêóòôäöüáà]/i;

/**
 * The name as she would say it, or null if it would sound odd read aloud (digits, symbols,
 * emoji, letter soup), in which case she just says "Velkommen til bordet".
 */
export function speakableName(raw: string): string | null {
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 24) return null;
  if (!/^[\p{L}' -]+$/u.test(name)) return null;
  const words = name.split(/[ -]/).filter(Boolean);
  if (!words.length || words.length > 3) return null;
  for (const w of words) {
    const letters = w.replace(/'/g, '');
    if (letters.length < 2 || !VOWEL.test(letters)) return null;
    if (/(.)\1\1/i.test(letters)) return null; // "Ooolaaa"
    if (/[^aeiouyæøåéèêóòôäöüáà']{5,}/i.test(letters)) return null; // "Xkcdq"
  }
  // "KARI" is read letter by letter; say it like a name.
  return name === name.toUpperCase()
    ? name.toLowerCase().replace(/(^|[ '-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
    : name;
}
