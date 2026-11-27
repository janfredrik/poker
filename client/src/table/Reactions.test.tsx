import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { SeatReactionEvent } from '../../../shared/reactions';
import { socket } from '../lib/socket';
import { Seat } from './Seat';
import { SeatReaction } from './Reactions';
import { player } from '../test/fixtures';

type Props = ComponentProps<typeof Seat>;
function renderSeat(over: Partial<Props> = {}) {
  const props: Props = {
    seatNo: 2, player: player({ id: 'p2', name: 'Mari', seat: 2 }), isYou: false, acting: false,
    turnLeft: null, stream: null, speaking: false, winner: null, canSit: false, onSit: vi.fn(), ...over,
  };
  return { ...render(<Seat {...props} />), props };
}

/** Deliver a 'reaction' event to every listener the components registered on the mocked socket. */
function deliver(event: SeatReactionEvent) {
  for (const [name, fn] of vi.mocked(socket.on).mock.calls) if (name === 'reaction') act(() => (fn as (e: SeatReactionEvent) => void)(event));
}

describe('throwing reactions', () => {
  it("tapping another player's camera opens a menu that throws the emoji at them", () => {
    vi.mocked(socket.volatile.emit).mockClear();
    renderSeat({ canThrow: true });
    fireEvent.click(screen.getByRole('button', { name: /^Mari/ }));
    expect(screen.getByText('Kast på Mari')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skål' }));
    expect(socket.volatile.emit).toHaveBeenCalledWith('reaction', { emoji: '🍻', to: 'p2' });
    expect(screen.queryByText('Kast på Mari')).toBeNull();
  });

  it('your own seat and spectators get no throw menu', () => {
    renderSeat({ canThrow: true, isYou: true });
    fireEvent.click(screen.getByRole('button', { name: /^Mari/ }));
    expect(screen.queryByText(/Kast på/)).toBeNull();
    renderSeat({ canThrow: false });
    fireEvent.click(screen.getAllByRole('button', { name: /^Mari/ })[1]);
    expect(screen.queryByText(/Kast på/)).toBeNull();
  });

  it('the host can still reach the player list from the menu', () => {
    const onOpen = vi.fn();
    renderSeat({ canThrow: true, onOpen });
    fireEvent.click(screen.getByRole('button', { name: /^Mari/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Spillere og innstillinger' }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('a thrown reaction lands on the target seat, not the thrower', () => {
    vi.useFakeTimers();
    vi.mocked(socket.on).mockClear();
    const { container } = render(<><div data-seat="p1"><SeatReaction playerId="p1" name="Jani" /></div><div data-seat="p2"><SeatReaction playerId="p2" name="Mari" /></div></>);
    const bubble = (id: string) => container.querySelector(`[data-seat="${id}"] .seat__reaction-bubble`);
    deliver({ playerId: 'p1', emoji: '🔥', toId: 'p2' });
    expect(bubble('p2')).toBeNull(); // still in the air
    act(() => { vi.advanceTimersByTime(1000); });
    expect(bubble('p2')?.textContent).toContain('🔥');
    expect(bubble('p1')).toBeNull();
    vi.useRealTimers();
  });
});
