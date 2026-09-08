/**
 * Shared protocol and state contracts for the server and mobile client.
 *
 * The server's internal `Player.hand` and `GameState.players[*].hand` fields
 * are authoritative data. They must never be sent to a different player. The
 * server uses `TheMindEngine.getClientState()` to build the masked client view.
 */

export type CardValue = number;
export type PlayerId = string;
export type RoomCode = string;

export type GameStatus =
  | 'LOBBY'
  | 'PLAYING'
  | 'ROUND_SUCCESS'
  | 'GAME_OVER'
  | 'COMPLETED';

/** Full server-side player record. Never serialize this directly to clients. */
export interface Player {
  id: PlayerId;
  name: string;
  isHost: boolean;
  connected: boolean;
  hand: CardValue[];
}

/** Full authoritative game state held by the server. */
export interface GameState {
  roomCode: RoomCode;
  status: GameStatus;
  level: number;
  maxLevel: number;
  lives: number;
  stars: number;
  discardPile: CardValue[];
  players: Player[];
  starVotes: Record<PlayerId, boolean>;
}

/** Player representation safe to send to every client in the room. */
export interface PublicPlayerView {
  id: PlayerId;
  name: string;
  isHost: boolean;
  connected: boolean;
  cardCount: number;
}

/** Personalized state sent to exactly one connected player. */
export interface ClientGameState {
  roomCode: RoomCode;
  status: GameStatus;
  level: number;
  maxLevel: number;
  lives: number;
  stars: number;
  discardTop: CardValue | null;
  discardCount: number;
  players: PublicPlayerView[];
  myPlayer: {
    id: PlayerId;
    name: string;
    isHost: boolean;
    connected: boolean;
    hand: CardValue[];
  };
  starVotes: Record<PlayerId, boolean>;
  myStarVote: boolean;
  connectedPlayerCount: number;
}

export interface CreateRoomPayload {
  playerName: string;
}

export interface JoinRoomPayload {
  roomCode: RoomCode;
  playerName: string;
  /** Present only when restoring a player's existing session. */
  reconnectToken?: string;
}

export interface StartGamePayload {
  /** Kept as an object so the protocol can grow without changing the event signature. */
  requestId?: string;
}

export interface PlayCardPayload {
  card: CardValue;
}

export interface VoteStarPayload {
  vote: boolean;
}

export interface NextLevelPayload {
  requestId?: string;
}

export interface LeaveRoomPayload {
  reason?: 'USER_REQUESTED' | 'DISCONNECT';
}

export interface RoomSessionPayload {
  roomCode: RoomCode;
  playerId: PlayerId;
  reconnectToken: string;
  state: ClientGameState;
}

export interface StarReveal {
  playerId: PlayerId;
  card: CardValue;
}

export interface PenaltyReveal {
  playerId: PlayerId;
  cards: CardValue[];
}

export interface RewardSummary {
  completedLevel: number;
  livesAwarded: number;
  starsAwarded: number;
  lives: number;
  stars: number;
}

export interface RoundWonPayload {
  level: number;
  reward: RewardSummary;
  finalLevel: boolean;
}

export interface LifeLostPayload {
  offendingPlayerId: PlayerId;
  playedCard: CardValue;
  skippedCards: CardValue[];
  penalties: PenaltyReveal[];
  remainingLives: number;
}

export interface StarTriggeredPayload {
  revealedCards: CardValue[];
  reveals: StarReveal[];
  remainingStars: number;
}

export type GameOverReason =
  | 'LIVES_DEPLETED'
  | 'PLAYER_DISCONNECTED'
  | 'SERVER_SHUTDOWN';

export interface GameOverPayload {
  reason: GameOverReason;
  remainingLives: number;
  message: string;
}

export interface ErrorPayload {
  code:
    | 'INVALID_INPUT'
    | 'ROOM_NOT_FOUND'
    | 'ROOM_FULL'
    | 'ROOM_ALREADY_STARTED'
    | 'INVALID_ROOM_CODE'
    | 'INVALID_PLAYER_NAME'
    | 'UNAUTHORIZED'
    | 'INVALID_STATE'
    | 'INVALID_ACTION'
    | 'PLAYER_NOT_FOUND'
    | 'PLAYER_NOT_CONNECTED'
    | 'INVALID_CARD'
    | 'CARD_NOT_IN_HAND'
    | 'NOT_ENOUGH_PLAYERS'
    | 'RECONNECT_FAILED'
    | 'INTERNAL_ERROR';
  message: string;
  requestId?: string;
}

/** Socket.IO's client-to-server event map. */
export interface ClientToServerEvents {
  CREATE_ROOM: (payload: CreateRoomPayload) => void;
  JOIN_ROOM: (payload: JoinRoomPayload) => void;
  START_GAME: (payload: StartGamePayload) => void;
  PLAY_CARD: (payload: PlayCardPayload) => void;
  VOTE_STAR: (payload: VoteStarPayload) => void;
  NEXT_LEVEL: (payload: NextLevelPayload) => void;
  LEAVE_ROOM: (payload: LeaveRoomPayload) => void;
}

/** Socket.IO's server-to-client event map. */
export interface ServerToClientEvents {
  ROOM_CREATED: (payload: RoomSessionPayload) => void;
  ROOM_JOINED: (payload: RoomSessionPayload) => void;
  GAME_STATE_UPDATE: (payload: ClientGameState) => void;
  LIFE_LOST: (payload: LifeLostPayload) => void;
  STAR_TRIGGERED: (payload: StarTriggeredPayload) => void;
  ROUND_WON: (payload: RoundWonPayload) => void;
  GAME_OVER: (payload: GameOverPayload) => void;
  ERROR: (payload: ErrorPayload) => void;
}

export interface SocketData {
  playerId?: PlayerId;
  roomCode?: RoomCode;
  reconnectToken?: string;
}
