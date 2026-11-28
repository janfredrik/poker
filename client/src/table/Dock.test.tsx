import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { formatChips } from '../../../shared/presets';
import type { TableView } from '../../../shared/types';
import { Dock } from './Dock';
import { hand, legal, player, view } from '../test/fixtures';

function renderDock(v: TableView, busy = false) {
  const props = {
    onAction: vi.fn(), onRebuy: vi.fn(), onAddOn: vi.fn(), onSitOut: vi.fn(), onShow: vi.fn(),
  };
  const r = render(<Dock view={v} busy={busy} canReact={false} {...props} />);
  const rerender = (next: TableView) => r.rerender(<Dock view={next} busy={busy} canReact={false} {...props} />);
  return { ...props, rerender };
}

const button = (name: RegExp) => screen.getByRole('button', { name });
const noButton = (name: RegExp) => expect(screen.queryByRole('button', { name })).toBeNull();

describe('Dock on your turn', () => {
  it('facing a bet: fold, call the amount and raise from the minimum', () => {
    const { onAction } = renderDock(view());
    expect(screen.getByText('Beløp for call')).toBeTruthy();
    button(/^Fold/);
    noButton(/^Check/);
    fireEvent.click(button(/^Call 10/));
    expect(onAction).toHaveBeenLastCalledWith('call');
    fireEvent.click(button(/^Raise/));
    fireEvent.click(button(/^Raise til 40/));
    expect(onAction).toHaveBeenLastCalledWith('raise', 40);
  });

  it('when checking is free: Check, a Bet button, and Fold asks twice', () => {
    const v = view({ hand: hand({ street: 'flop', currentBet: 0 }), you: { legal: legal({ canCheck: true, callAmount: 0, minRaiseTo: 20, bet: 0 }) } });
    const { onAction } = renderDock(v);
    noButton(/^Call/);
    fireEvent.click(button(/^Check/));
    expect(onAction).toHaveBeenLastCalledWith('check');
    fireEvent.click(button(/^Bet/));
    button(/^Bet 20/);

    onAction.mockClear();
    fireEvent.click(button(/^Fold/));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(button(/^Fold likevel\?/));
    expect(onAction).toHaveBeenCalledWith('fold');
  });

  it('a call that covers your whole stack is labelled all-in, with no raise', () => {
    const v = view({
      players: [player({ stack: 300, bet: 0 }), player({ id: 'p2', name: 'Mari', seat: 2, bet: 800 })],
      hand: hand({ currentBet: 800 }),
      you: { legal: legal({ callAmount: 300, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0, bet: 0 }) },
    });
    renderDock(v);
    expect(button(/^All-in 300/).textContent).toContain('hele stacken');
    noButton(/^Raise/);
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('raise presets and typed amounts stay between min and max', () => {
    const { onAction } = renderDock(view());
    fireEvent.click(button(/^Raise/));
    fireEvent.click(button(/^All-in$/));
    fireEvent.click(button(new RegExp(`^All-in ${formatChips(1000)}`)));
    expect(onAction).toHaveBeenLastCalledWith('raise', 1000);

    const input = screen.getByRole('textbox', { name: 'Beløp' });
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAction).toHaveBeenLastCalledWith('raise', 40);
    fireEvent.change(input, { target: { value: '99999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAction).toHaveBeenLastCalledWith('raise', 1000);
  });

  it('the + and − steps move one big blind and stop at the minimum', () => {
    renderDock(view());
    fireEvent.click(button(/^Raise/));
    const minus = button(/Én big blind mindre/);
    expect((minus as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button(/Én big blind mer/));
    button(/^Raise til 60/);
    fireEvent.click(minus);
    button(/^Raise til 40/);
  });

  it('keyboard: C calls, F folds (or checks when that is free)', () => {
    const { onAction } = renderDock(view());
    fireEvent.keyDown(window, { key: 'c' });
    expect(onAction).toHaveBeenLastCalledWith('call');
    fireEvent.keyDown(window, { key: 'f' });
    expect(onAction).toHaveBeenLastCalledWith('fold');
  });

  it('the raise controls stay folded until Raise or R opens them, and Escape folds them again', () => {
    const { onAction } = renderDock(view());
    expect(screen.queryByRole('slider')).toBeNull();
    noButton(/^Pot$/);
    fireEvent.keyDown(window, { key: 'r' });
    expect(screen.getByRole('slider')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(button(/^Raise/));
    expect(onAction).not.toHaveBeenCalled();
    button(/^Pot$/);
  });

  it('all-in says it is the whole stack, on both the call and the raise', () => {
    renderDock(view());
    fireEvent.click(button(/^Raise/));
    fireEvent.click(button(/^All-in$/));
    expect(button(new RegExp(`^All-in ${formatChips(1000)}`)).textContent).toContain('hele stacken');
  });

  it('when checking is free the headline is your stack, not words', () => {
    renderDock(view({ hand: hand({ street: 'flop', currentBet: 0 }), you: { legal: legal({ canCheck: true, callAmount: 0, minRaiseTo: 20, bet: 0 }) } }));
    expect(screen.getByText('Din tur · stack')).toBeTruthy();
    expect(screen.queryByText('Check eller bet')).toBeNull();
  });

  it('buttons are disabled while an action is on its way', () => {
    renderDock(view(), true);
    for (const name of [/^Fold/, /^Call/, /^Raise/]) expect((button(name) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Dock while waiting', () => {
  const waiting = (over: Parameters<typeof view>[0] = {}) => view({ hand: hand({ toActId: 'p2' }), you: { legal: null }, ...over });

  it('shows whose turn it is and offers check/fold and call ahead of time', () => {
    renderDock(waiting());
    expect(screen.getByText('Mari sin tur')).toBeTruthy();
    noButton(/^Fold/);
    expect(screen.getByRole('checkbox', { name: 'Check/fold' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Call 10' })).toBeTruthy();
  });

  it('check/fold picked early folds as soon as the turn comes with a bet to face', () => {
    const { onAction, rerender } = renderDock(waiting());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Check/fold' }));
    act(() => rerender(view()));
    expect(onAction).toHaveBeenCalledWith('fold');
  });

  it('a pre-picked call lapses if someone bets more before your turn', () => {
    const { onAction, rerender } = renderDock(waiting());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Call 10' }));
    act(() => rerender(view({ hand: hand({ currentBet: 60 }), you: { legal: legal({ callAmount: 50, minRaiseTo: 100 }) } })));
    expect(onAction).not.toHaveBeenCalled();
  });

  it('after folding there is nothing to pre-pick', () => {
    renderDock(waiting({ players: [player({ folded: true, inHand: true }), player({ id: 'p2', name: 'Mari', seat: 2 })] }));
    expect(screen.getByText('Fold')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Check/fold' })).toBeNull();
  });

  it('offers a rebuy when the server allows one', () => {
    const v = view({
      hand: null,
      players: [player({ stack: 0, inHand: false, hasCards: false }), player({ id: 'p2', name: 'Mari', seat: 2 })],
      you: { legal: null, holeCards: [], rebuy: { allowed: true, amount: 2000, reason: null, addOnAllowed: false, addOnAmount: 0 } },
    });
    const { onRebuy } = renderDock(v);
    fireEvent.click(button(new RegExp(`^Rebuy ${formatChips(2000)}`)));
    expect(onRebuy).toHaveBeenCalled();
  });
});

describe('Dock for someone without a seat', () => {
  it('a spectator sees no action buttons', () => {
    renderDock(view({ you: { playerId: null, holeCards: [], legal: null } }));
    expect(screen.getByText('Tilskuer')).toBeTruthy();
    noButton(/^Fold|^Call|^Check|^Raise/);
    expect(screen.queryByRole('checkbox', { name: 'Stå over' })).toBeNull();
  });

  it('a pending request waits for the host', () => {
    renderDock(view({
      players: [player({ status: 'pending', seat: null, inHand: false, hasCards: false })],
      you: { holeCards: [], legal: null },
    }));
    expect(screen.getByText('Venter på godkjenning fra verten')).toBeTruthy();
  });
});
