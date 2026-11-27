import type { Card as CardT } from '../../../shared/types';

const SUIT_PATHS: Record<string, string> = {
  // authored 24x24 suit glyphs
  s: 'M12 2.2c-.4 0-.8.2-1.1.5C8.7 5 3.6 9.4 3.6 13.4c0 2.6 2 4.5 4.4 4.5 1.3 0 2.4-.5 3.1-1.3-.2 1.9-.9 3.4-2.2 4.4-.3.2-.1.8.3.8h5.6c.4 0 .6-.6.3-.8-1.3-1-2-2.5-2.2-4.4.7.8 1.8 1.3 3.1 1.3 2.4 0 4.4-1.9 4.4-4.5 0-4-5.1-8.4-7.3-10.7-.3-.3-.7-.5-1.1-.5Z',
  h: 'M12 21.3c-.3 0-.6-.1-.8-.3C7.6 17.9 2.5 13.7 2.5 8.6 2.5 5.6 4.8 3.2 7.6 3.2c1.9 0 3.5 1 4.4 2.6.9-1.6 2.5-2.6 4.4-2.6 2.8 0 5.1 2.4 5.1 5.4 0 5.1-5.1 9.3-8.7 12.4-.2.2-.5.3-.8.3Z',
  d: 'M12 1.8c.3 0 .6.2.8.4l6.6 8.9c.4.5.4 1.3 0 1.8l-6.6 8.9c-.2.3-.5.4-.8.4s-.6-.2-.8-.4l-6.6-8.9c-.4-.5-.4-1.3 0-1.8l6.6-8.9c.2-.3.5-.4.8-.4Z',
  c: 'M12 2.4a4.6 4.6 0 0 0-4.2 6.5 4.6 4.6 0 1 0 2.6 7.8c-.3 1.8-1 3.2-2.2 4.2-.3.2-.1.8.3.8h7c.4 0 .6-.6.3-.8-1.2-1-1.9-2.4-2.2-4.2a4.6 4.6 0 1 0 2.6-7.8A4.6 4.6 0 0 0 12 2.4Z',
};

const RANK_LABEL: Record<string, string> = { T: '10' };
const SUIT_NAME: Record<string, string> = { s: 'spar', h: 'hjerter', d: 'ruter', c: 'kløver' };
const RANK_NAME: Record<string, string> = { A: 'ess', K: 'konge', Q: 'dame', J: 'knekt', T: 'ti' };

export function SuitIcon({ suit, className }: { suit: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={SUIT_PATHS[suit]} fill="currentColor" />
    </svg>
  );
}

interface Props {
  card?: CardT | null;
  size?: 'sm' | 'md' | 'lg';
  faceDown?: boolean;
  highlight?: boolean;
  dim?: boolean;
  empty?: boolean;
  delay?: number;
}

/** The run-out river: lands face down, waits a breath, then turns over. Plays once when it mounts. */
export function SqueezeCard({ card, highlight, dim }: { card: CardT; highlight?: boolean; dim?: boolean }) {
  return (
    <span className="squeeze">
      <span className="squeeze__turn">
        <PlayingCard card={card} size="md" highlight={highlight} dim={dim} />
        <span className="card card--md card--back squeeze__back" aria-hidden="true" />
      </span>
    </span>
  );
}

export function PlayingCard({ card, size = 'md', faceDown, highlight, dim, empty, delay = 0 }: Props) {
  if (empty) return <span className={`card card--${size} card--slot`} aria-hidden="true" />;
  if (faceDown || !card) {
    return <span className={`card card--${size} card--back`} style={{ animationDelay: `${delay}ms` }} aria-label="Kort med baksiden opp" />;
  }
  const rank = card[0];
  const suit = card[1];
  const red = suit === 'h' || suit === 'd';
  return (
    <span
      className={`card card--${size} card--face ${red ? 'is-red' : 'is-black'} ${highlight ? 'is-win' : ''} ${dim ? 'is-dim' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
      role="img"
      aria-label={`${SUIT_NAME[suit]} ${RANK_NAME[rank] ?? rank}`}
    >
      <span className="card__rank">{RANK_LABEL[rank] ?? rank}</span>
      <SuitIcon suit={suit} className="card__suit" />
      <SuitIcon suit={suit} className="card__pip" />
    </span>
  );
}
