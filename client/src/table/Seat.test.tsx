import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { formatChips } from '../../../shared/presets';
import { Seat } from './Seat';
import { player } from '../test/fixtures';

type Props = ComponentProps<typeof Seat>;
function renderSeat(over: Partial<Props> = {}) {
  const props: Props = {
    seatNo: 3, player: player({ id: 'p2', name: 'Mari Hansen', seat: 3, stack: 1500 }), isYou: false, acting: false,
    turnLeft: null, stream: null, speaking: false, winner: null, canSit: false, onSit: vi.fn(), ...over,
  };
  const r = render(<Seat {...props} />);
  return { ...r, props };
}

describe('Seat', () => {
  it('an empty seat you may take has a "Sitt her" button', () => {
    const { props } = renderSeat({ player: null, canSit: true });
    fireEvent.click(screen.getByRole('button', { name: 'Sitt her' }));
    expect(props.onSit).toHaveBeenCalledWith(3);
  });

  it('an empty seat you may not take only shows its number', () => {
    renderSeat({ player: null });
    expect(screen.getByText('Sete 3')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows name, stack, initials and two face-down cards for an opponent', () => {
    renderSeat();
    expect(screen.getByText('Mari Hansen')).toBeTruthy();
    expect(screen.getByText(formatChips(1500).replace(/\s/g, ' '))).toBeTruthy();
    expect(screen.getByText('MH')).toBeTruthy();
    expect(screen.getAllByLabelText('Kort med baksiden opp')).toHaveLength(2);
    expect(screen.queryByText('(du)')).toBeNull();
  });

  it('never shows face-down cards on your own seat, only your hole cards', () => {
    renderSeat({ isYou: true, holeCards: ['As', 'Kd'] });
    expect(screen.getByText('(du)')).toBeTruthy();
    expect(screen.queryByLabelText('Kort med baksiden opp')).toBeNull();
    expect(screen.getByRole('img', { name: 'spar ess' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'ruter konge' })).toBeTruthy();
  });

  it('shows cards an opponent turned over', () => {
    renderSeat({ player: player({ id: 'p2', name: 'Mari', shownCards: ['Th', '9c'] }) });
    expect(screen.getByRole('img', { name: 'hjerter ti' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'kløver 9' })).toBeTruthy();
  });

  it('labels the player state, most important first', () => {
    const cases: [Partial<Parameters<typeof player>[0]>, string][] = [
      [{ lastAction: 'Raise 60' }, 'Raise 60'],
      [{ allIn: true, lastAction: 'All-in' }, 'All-in'],
      [{ sittingOut: true, inHand: false, hasCards: false }, 'Står over'],
      [{ connected: false }, 'Frakoblet'],
      [{ stack: 0, inHand: false, hasCards: false }, 'Tom for chips'],
      [{ stack: 0, place: 4, inHand: false, hasCards: false }, 'Ute · 4. plass'],
    ];
    for (const [over, label] of cases) {
      const { unmount } = renderSeat({ player: player({ id: 'p2', name: 'Mari', ...over }) });
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  it('a folded player is marked folded', () => {
    const { container } = renderSeat({ player: player({ id: 'p2', name: 'Mari', folded: true, lastAction: 'Fold' }) });
    expect(container.querySelector('.seat')!.classList.contains('is-folded')).toBe(true);
    expect(screen.getByText('Fold').classList.contains('seat__tag--fold')).toBe(true);
  });

  it('a winner shows the amount instead of the last action', () => {
    renderSeat({
      player: player({ id: 'p2', name: 'Mari', lastAction: 'Call' }),
      winner: { playerId: 'p2', amount: 840, hand: 'Two Pair', cards: [] },
    });
    expect(screen.getByText(/^Vinner 840$/)).toBeTruthy();
    expect(screen.queryByText('Call')).toBeNull();
  });

  it('the acting seat gets the turn timer', () => {
    const { container } = renderSeat({ acting: true, turnLeft: 0.5 });
    expect(container.querySelector('.seat')!.classList.contains('is-acting')).toBe(true);
    expect(container.querySelector('.seat__timer')).toBeTruthy();
  });

  it('hands won show on the seat and in its accessible name', () => {
    renderSeat({ player: player({ id: 'p2', name: 'Mari', handsWon: 2 }) });
    expect(screen.getByRole('button', { name: /Mari, .* chips, 2 hender vunnet/ })).toBeTruthy();
  });
});
