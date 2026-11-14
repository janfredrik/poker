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
  /** Rebuys allowed while the clock is at or below this level (1-based). 0 = no level limit. */
  untilLevel: number;
  /** Rebuys allowed for this many minutes of play after the start. 0 = no time limit. */
  untilMinutes: number;
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

/**
 * How the agreed real-money pot is split after the game. The app only calculates
 * the settlement; it never handles money.
 * Buy-ins go to 1st place. Rebuys (and add-ons) rotate over the paid places in the
 * order they were made: 1st rebuy to 1st place, 2nd to 2nd, … then round again.
 */
export interface PayoutRules {
  enabled: boolean;
  currency: string;
  buyIn: number;
  rebuy: number;
  addOn: number;
  /** Places that share the rebuy rotation. 1 = winner takes everything. */
  places: number;
}

export interface TimeBankRules {
  enabled: boolean;
  /** Seconds each player starts with. */
  startSeconds: number;
  /** Seconds added to every player's bank every `everyHands` hands. */
  addSeconds: number;
  everyHands: number;
  /** Bank cap in seconds. */
  maxSeconds: number;
}

/** A reusable rule set: blind structure, rebuys, timers, payouts. */
export interface RuleSet {
  rabbitHunt: boolean;
  id: string;
  name: string;
  /** Built-in presets cannot be deleted or overwritten. */
  builtIn?: boolean;
  startingStack: number;
  /** Level length. 0 = blinds never go up (cash game). The last level never ends. */
  levelMinutes: number;
  /** Players may leave with their chips (cash game). Off: once the game starts, leaving forfeits the stack. */
  cashOut: boolean;
  levels: BlindLevel[];
  /** Optional break: every N levels, a break of M minutes. 0 = no breaks. */
  breakEveryLevels: number;
  breakMinutes: number;
  rebuy: RebuyRules;
  addOn: AddOnRules;
  /** Seconds a player has to act. 0 = no timer. */
  turnSeconds: number;
  timeBank: TimeBankRules;
  payout: PayoutRules;
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
  /** Remaining time bank in ms. */
  timeBankMs: number;
  /** Finishing place in a tournament, once known. */
  place: number | null;
  // hand-specific
  inHand: boolean;
  hasCards: boolean;
  bet: number;
  folded: boolean;
  allIn: boolean;
  lastAction: string | null;
  shownCards: Card[] | null;
  /** Main-pot equity in percent during an all-in runout, with ties shared. */
  equity: number | null;
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
  rabbitCards: Card[];
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
  /** The acting player is using their time bank. */
  usingBank: boolean;
  winners: WinnerView[] | null;
  blinds: BlindLevel;
}

export interface ClockView {
  running: boolean;
  /** 0-based */
  levelIndex: number;
  level: BlindLevel;
  next: BlindLevel | null;
  /** On the last level of the structure: no clock, blinds stay. */
  final: boolean;
  levelMs: number;
  remainingMs: number;
  onBreak: boolean;
  /** Play time left in the rebuy period, null when there is no timed period or the game has not started. */
  rebuyEndsInMs: number | null;
  /** Server time when this snapshot was taken, for client-side interpolation. */
  at: number;
}

export interface LedgerRow {
  playerId: string;
  name: string;
  buyIn: number;
  cashOut: number;
  forfeited: number;
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

export interface PlaceView {
  place: number;
  playerId: string | null;
  name: string | null;
  prize: number;
}

export interface ResultsView {
  currency: string;
  entries: number;
  rebuys: number;
  addOns: number;
  pool: number;
  places: PlaceView[];
  /** Money each player put in, by player id. */
  paid: Record<string, number>;
}

export interface TableView {
  id: string;
  settings: TableSettings;
  status: 'waiting' | 'running' | 'paused' | 'finished';
  /** 1–3 while seats are being shuffled before the first hand, else 0. */
  shuffling: number;
  results: ResultsView | null;
  players: PublicPlayer[];
  hand: HandView | null;
  clock: ClockView;
  ledger: LedgerRow[];
  log: LogEntry[];
  you: {
    playerId: string | null;
    isHost: boolean;
    holeCards: Card[];
    canRabbitHunt: boolean;
    legal: Legal | null;
    rebuy: RebuyOffer | null;
  };
}

export interface RtcPeer {
  socketId: string;
  /** null for someone who opened the link but has not taken a seat yet. */
  playerId: string | null;
}

export type Ack<T = unknown> = (res: { ok: true; data?: T } | { ok: false; error: string }) => void;
