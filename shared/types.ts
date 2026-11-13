// Types shared by server and client.

export type Card = string; // rank + suit, e.g. "As", "Td", "7c"
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface BlindLevel {
  sb: number;
  bb: number;
  ante: number;
}

export interface RebuyRules {
  /** Rebuys are allowed at all. */
  enabled: boolean;
  /** Chips received per rebuy. 0 = player chooses (cash-game style). */
  amount: number;
  /** Rebuys allowed while the clock is at or below this level (1-based). 0 = whole game. */
  untilLevel: number;
  /** Max rebuys per player. 0 = unlimited. */
  maxPerPlayer: number;
  /** Only allowed when the player's stack is at or below this. 0 = only when busted. -1 = any time between hands. */
  maxStackToRebuy: number;
}

export interface AddOnRules {
  enabled: boolean;
  amount: number;
  /** Add-on is offered from the end of this level (1-based) until the next level ends. */
  atLevel: number;
}

/** A reusable rule set: blind structure, rebuys, timers. */
export interface RuleSet {
  id: string;
  name: string;
  /** Built-in presets cannot be deleted or overwritten. */
  builtIn?: boolean;
  startingStack: number;
  /** 0 = blinds never go up (cash game). */
  levelMinutes: number;
  levels: BlindLevel[];
  /** Optional break: every N levels, a break of M minutes. 0 = no breaks. */
  breakEveryLevels: number;
  breakMinutes: number;
  rebuy: RebuyRules;
  addOn: AddOnRules;
  /** Seconds a player has to act. 0 = no timer. */
  turnSeconds: number;
}

export interface TableSettings {
  name: string;
  maxSeats: number;
  requireApproval: boolean;
  rules: RuleSet;
}

export type PlayerStatus = 'watching' | 'pending' | 'seated';

export interface PublicPlayer {
  id: string;
  name: string;
  seat: number | null;
  requestedSeat: number | null;
  requestedBuyIn: number;
  stack: number;
  status: PlayerStatus;
  sittingOut: boolean;
  connected: boolean;
  isHost: boolean;
  camOn: boolean;
  micOn: boolean;
  rebuys: number;
  addOnTaken: boolean;
  // hand-specific
  inHand: boolean;
  hasCards: boolean;
  bet: number;
  folded: boolean;
  allIn: boolean;
  lastAction: string | null;
  shownCards: Card[] | null;
}

export interface PotView {
  amount: number;
  eligible: string[];
}

export interface WinnerView {
  playerId: string;
  amount: number;
  hand: string | null;
  cards: Card[];
}

export interface HandView {
  number: number;
  street: Street;
  board: Card[];
  pots: PotView[];
  /** Collected pot (excluding bets in front of players this street). */
  potTotal: number;
  currentBet: number;
  dealerSeat: number;
  sbSeat: number;
  bbSeat: number;
  toActId: string | null;
  turnEndsAt: number | null;
  turnMs: number | null;
  winners: WinnerView[] | null;
  blinds: BlindLevel;
}

export interface ClockView {
  running: boolean;
  /** 0-based */
  levelIndex: number;
  level: BlindLevel;
  next: BlindLevel | null;
  levelMs: number;
  remainingMs: number;
  onBreak: boolean;
  /** Server time when this snapshot was taken, for client-side interpolation. */
  at: number;
}

export interface LedgerRow {
  playerId: string;
  name: string;
  buyIn: number;
  cashOut: number;
  stack: number;
  net: number;
  rebuys: number;
}

export interface LogEntry {
  t: number;
  kind: 'action' | 'hand' | 'system' | 'chat';
  text: string;
  by?: string;
}

export interface Legal {
  canFold: boolean;
  canCheck: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  /** Chips already in front of the player this street. */
  bet: number;
}

export interface RebuyOffer {
  allowed: boolean;
  amount: number; // 0 = free choice
  reason: string | null;
  addOnAllowed: boolean;
  addOnAmount: number;
}

export interface TableView {
  id: string;
  settings: TableSettings;
  status: 'waiting' | 'running' | 'paused';
  players: PublicPlayer[];
  hand: HandView | null;
  clock: ClockView;
  ledger: LedgerRow[];
  log: LogEntry[];
  you: {
    playerId: string | null;
    isHost: boolean;
    holeCards: Card[];
    legal: Legal | null;
    rebuy: RebuyOffer | null;
  };
}

export interface RtcPeer {
  socketId: string;
  playerId: string;
}

export type Ack<T = unknown> = (res: { ok: true; data?: T } | { ok: false; error: string }) => void;
