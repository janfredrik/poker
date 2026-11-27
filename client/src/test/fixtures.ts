// Builders for TableView fixtures: a realistic default you override per test.
import { BUILT_IN_RULESETS } from '../../../shared/presets';
import type { HandView, Legal, PublicPlayer, TableView } from '../../../shared/types';

export function player(over: Partial<PublicPlayer> = {}): PublicPlayer {
  return {
    id: 'p1', name: 'Jani', seat: 1, requestedSeat: null, requestedBuyIn: 0, stack: 1000,
    status: 'seated', sittingOut: false, connected: true, awaySince: null, isHost: false, bot: false,
    camOn: false, micOn: false, rebuys: 0, addOnTaken: false, timeBankMs: 0, place: null, handsWon: 0,
    inHand: true, hasCards: true, bet: 0, folded: false, allIn: false, lastAction: null, shownCards: null, equity: null,
    ...over,
  };
}

export function hand(over: Partial<HandView> = {}): HandView {
  return {
    rabbitCards: [], number: 1, street: 'preflop', board: [], pots: [], potTotal: 0, currentBet: 20,
    dealerSeat: 1, sbSeat: 1, bbSeat: 2, toActId: 'p1', turnEndsAt: null, turnMs: null, usingBank: false,
    frozenMs: null, winners: null, blinds: { sb: 10, bb: 20, ante: 0 },
    ...over,
  };
}

export function legal(over: Partial<Legal> = {}): Legal {
  return { canFold: true, canCheck: false, callAmount: 10, canRaise: true, minRaiseTo: 40, maxRaiseTo: 1000, bet: 10, ...over };
}

/** You (p1, seat 1) against Mari (p2, seat 2), preflop, your turn facing the big blind. */
export function view(over: { you?: Partial<TableView['you']>; players?: PublicPlayer[]; hand?: HandView | null } & Partial<Omit<TableView, 'you' | 'players' | 'hand'>> = {}): TableView {
  const rules = structuredClone(BUILT_IN_RULESETS.find((r) => r.id === 'cash-10-20') ?? BUILT_IN_RULESETS[0]);
  rules.timeBank.enabled = false;
  const { you, players, hand: h, ...rest } = over;
  return {
    id: 'TEST', status: 'running', shuffling: 0, results: null, ledger: [], log: [],
    settings: { name: 'Testbord', maxSeats: 9, requireApproval: false, rules },
    players: players ?? [player({ bet: 10 }), player({ id: 'p2', name: 'Mari', seat: 2, bet: 20 })],
    hand: h === undefined ? hand() : h,
    clock: { running: true, levelIndex: 0, level: { sb: 10, bb: 20, ante: 0 }, next: null, final: true, levelMs: 0, remainingMs: 0, onBreak: false, rebuyEndsInMs: null, at: 0 },
    you: {
      playerId: 'p1', isHost: false, holeCards: ['As', 'Kd'], madeHand: null, canRabbitHunt: false,
      legal: legal(), rebuy: null, canClaimHost: false,
      ...you,
    },
    ...rest,
  };
}
