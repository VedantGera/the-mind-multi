import { randomInt } from 'node:crypto';
import {
  CardValue,
  ClientGameState,
  ErrorPayload,
  GameState,
  GameStatus,
  PenaltyReveal,
  Player,
  PublicPlayerView,
  RoundWonPayload,
  StarReveal,
} from '../../shared/types';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const DECK_SIZE = 100;

const RULES_BY_PLAYER_COUNT: Readonly<Record<number, { lives: number; stars: number; maxLevel: number }>> = {
  2: { lives: 2, stars: 1, maxLevel: 12 },
  3: { lives: 3, stars: 1, maxLevel: 10 },
  4: { lives: 4, stars: 1, maxLevel: 8 },
};

const STAR_REWARD_LEVELS = new Set([2, 5, 8]);
const LIFE_REWARD_LEVELS = new Set([3, 6, 9]);

type EngineErrorCode = ErrorPayload['code'];

export class EngineError extends Error {
  public readonly code: EngineErrorCode;

  public constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}

export interface TheMindEngineOptions {
  roomCode?: string;
  /** Injected in tests; production uses a cryptographically seeded source. */
  random?: () => number;
}

export interface StartGameResult {
  kind: 'GAME_STARTED';
  state: GameState;
}

export interface LevelStartedResult {
  kind: 'LEVEL_STARTED';
  level: number;
  state: GameState;
}

export interface GameCompletedResult {
  kind: 'GAME_COMPLETED';
  level: number;
  state: GameState;
}

export type NextLevelResult = LevelStartedResult | GameCompletedResult;

export interface CardPlayedResult {
  kind: 'CARD_PLAYED';
  playerId: string;
  playedCard: CardValue;
  skippedCards: CardValue[];
  roundWon?: RoundWonPayload;
}

export interface LifeLostResult {
  kind: 'LIFE_LOST';
  playerId: string;
  playedCard: CardValue;
  skippedCards: CardValue[];
  penalties: PenaltyReveal[];
  remainingLives: number;
  roundWon?: RoundWonPayload;
}

export interface EngineGameOverResult {
  kind: 'GAME_OVER';
  playerId: string;
  playedCard: CardValue;
  skippedCards: CardValue[];
  penalties: PenaltyReveal[];
  remainingLives: number;
}

export type PlayCardResult = CardPlayedResult | LifeLostResult | EngineGameOverResult;

export interface VoteRecordedResult {
  kind: 'VOTE_RECORDED';
  playerId: string;
  vote: boolean;
  votesReceived: number;
  votesRequired: number;
}

export interface StarTriggeredResult {
  kind: 'STAR_TRIGGERED';
  reveals: StarReveal[];
  revealedCards: CardValue[];
  remainingStars: number;
  roundWon?: RoundWonPayload;
}

export type VoteStarResult = VoteRecordedResult | StarTriggeredResult;

/**
 * Authoritative rules engine for one room.
 *
 * The engine has no socket or transport dependencies. Keeping all rule
 * transitions here makes it straightforward to unit-test and prevents a
 * client from changing any hidden card, resource, or round state.
 */
export class TheMindEngine {
  private readonly roomCode: string;
  private readonly random: () => number;
  private readonly players = new Map<string, Player>();
  private status: GameStatus = 'LOBBY';
  private level = 1;
  private maxLevel = 0;
  private lives = 0;
  private stars = 0;
  private discardPile: CardValue[] = [];
  private starVotes = new Map<string, boolean>();

  public constructor(options: TheMindEngineOptions = {}) {
    this.roomCode = options.roomCode ?? '';
    this.random = options.random ?? (() => randomInt(0, 1_000_000) / 1_000_000);
  }

  public addPlayer(id: string, name: string): Player {
    if (this.status !== 'LOBBY') {
      throw new EngineError('ROOM_ALREADY_STARTED', 'Players cannot join after the game has started.');
    }
    if (this.players.has(id)) {
      throw new EngineError('INVALID_INPUT', 'That player id is already in the room.');
    }
    if (this.players.size >= MAX_PLAYERS) {
      throw new EngineError('ROOM_FULL', `A room cannot have more than ${MAX_PLAYERS} players.`);
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 24) {
      throw new EngineError('INVALID_PLAYER_NAME', 'Player names must be between 1 and 24 characters.');
    }

    const player: Player = {
      id,
      name: trimmedName,
      isHost: this.players.size === 0,
      connected: true,
      hand: [],
    };
    this.players.set(id, player);
    this.recalculateLobbyRules();
    return this.clonePlayer(player);
  }

  /** Remove a player before a game starts. Active games use reconnect grace. */
  public removePlayer(id: string): void {
    if (this.status !== 'LOBBY') {
      throw new EngineError('INVALID_STATE', 'Players cannot be removed from an active game.');
    }
    if (!this.players.delete(id)) {
      throw new EngineError('PLAYER_NOT_FOUND', 'Player is not in this room.');
    }
    this.reassignHostIfNeeded();
    this.recalculateLobbyRules();
  }

  public setPlayerConnected(id: string, connected: boolean): void {
    const player = this.requirePlayer(id);
    player.connected = connected;
    if (!connected) {
      this.starVotes.delete(id);
    }
    this.reassignHostIfNeeded();
  }

  public setHost(id: string): void {
    this.requirePlayer(id);
    for (const player of this.players.values()) {
      player.isHost = player.id === id;
    }
  }

  public getHostId(): string | null {
    return [...this.players.values()].find((player) => player.isHost)?.id ?? null;
  }

  public hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  public getPlayer(id: string): Player {
    return this.clonePlayer(this.requirePlayer(id));
  }

  public getPlayerCount(): number {
    return this.players.size;
  }

  public getConnectedPlayerCount(): number {
    return this.getConnectedPlayers().length;
  }

  public getStatus(): GameStatus {
    return this.status;
  }

  public startGame(): StartGameResult {
    if (this.status !== 'LOBBY') {
      throw new EngineError('INVALID_STATE', 'The game has already started.');
    }
    const connectedPlayers = this.getConnectedPlayers();
    if (connectedPlayers.length < MIN_PLAYERS) {
      throw new EngineError('NOT_ENOUGH_PLAYERS', `At least ${MIN_PLAYERS} connected players are required.`);
    }
    if (connectedPlayers.length > MAX_PLAYERS || connectedPlayers.length !== this.players.size) {
      throw new EngineError('INVALID_STATE', 'All players must be connected before starting.');
    }

    const rules = RULES_BY_PLAYER_COUNT[connectedPlayers.length];
    if (!rules) {
      throw new EngineError('INVALID_STATE', 'No rules are configured for this player count.');
    }

    this.level = 1;
    this.maxLevel = rules.maxLevel;
    this.lives = rules.lives;
    this.stars = rules.stars;
    this.status = 'PLAYING';
    this.dealLevel();

    return { kind: 'GAME_STARTED', state: this.getGameState() };
  }

  public playCard(playerId: string, card: CardValue): PlayCardResult {
    this.assertPlaying();
    const player = this.requireConnectedPlayer(playerId);
    this.assertCardValue(card);

    const cardIndex = player.hand.indexOf(card);
    if (cardIndex === -1) {
      throw new EngineError('CARD_NOT_IN_HAND', 'You can only play a card currently in your hand.');
    }
    player.hand.splice(cardIndex, 1);

    const penalties: PenaltyReveal[] = [];
    for (const otherPlayer of this.players.values()) {
      if (otherPlayer.id === player.id) {
        continue;
      }
      const skipped = otherPlayer.hand.filter((otherCard) => otherCard < card);
      if (skipped.length === 0) {
        continue;
      }
      otherPlayer.hand = otherPlayer.hand.filter((otherCard) => otherCard >= card);
      penalties.push({ playerId: otherPlayer.id, cards: skipped.sort((a, b) => a - b) });
    }

    const skippedCards = penalties
      .flatMap((penalty) => penalty.cards)
      .sort((left, right) => left - right);
    this.discardPile.push(...skippedCards, card);

    if (skippedCards.length === 0) {
      const roundWon = this.completeRoundIfEmpty();
      return { kind: 'CARD_PLAYED', playerId, playedCard: card, skippedCards, roundWon };
    }

    this.lives -= 1;
    this.starVotes.clear();
    if (this.lives <= 0) {
      this.status = 'GAME_OVER';
      return {
        kind: 'GAME_OVER',
        playerId,
        playedCard: card,
        skippedCards,
        penalties,
        remainingLives: this.lives,
      };
    }

    const roundWon = this.completeRoundIfEmpty();
    return {
      kind: 'LIFE_LOST',
      playerId,
      playedCard: card,
      skippedCards,
      penalties,
      remainingLives: this.lives,
      roundWon,
    };
  }

  public voteStar(playerId: string, vote: boolean): VoteStarResult {
    this.assertPlaying();
    this.requireConnectedPlayer(playerId);
    if (this.stars < 1) {
      throw new EngineError('INVALID_ACTION', 'There are no Ninja Stars remaining.');
    }

    if (vote) {
      this.starVotes.set(playerId, true);
    } else {
      this.starVotes.delete(playerId);
    }

    const connectedPlayers = this.getConnectedPlayers();
    const votesReceived = connectedPlayers.reduce(
      (count, player) => count + (this.starVotes.get(player.id) === true ? 1 : 0),
      0,
    );
    if (votesReceived !== connectedPlayers.length) {
      return {
        kind: 'VOTE_RECORDED',
        playerId,
        vote,
        votesReceived,
        votesRequired: connectedPlayers.length,
      };
    }

    const reveals: StarReveal[] = [];
    for (const player of this.players.values()) {
      if (player.hand.length === 0) {
        continue;
      }
      const lowest = Math.min(...player.hand);
      const lowestIndex = player.hand.indexOf(lowest);
      player.hand.splice(lowestIndex, 1);
      reveals.push({ playerId: player.id, card: lowest });
    }
    reveals.sort((left, right) => left.card - right.card);
    const revealedCards = reveals.map((reveal) => reveal.card);
    this.discardPile.push(...revealedCards);
    this.stars -= 1;
    this.starVotes.clear();

    const roundWon = this.completeRoundIfEmpty();
    return {
      kind: 'STAR_TRIGGERED',
      reveals,
      revealedCards,
      remainingStars: this.stars,
      roundWon,
    };
  }

  public nextLevel(requestingPlayerId: string): NextLevelResult {
    if (this.status !== 'ROUND_SUCCESS') {
      throw new EngineError('INVALID_STATE', 'The next level is available only after a successful round.');
    }
    const requester = this.requireConnectedPlayer(requestingPlayerId);
    if (!requester.isHost) {
      throw new EngineError('UNAUTHORIZED', 'Only the host can start the next level.');
    }
    if (this.level >= this.maxLevel) {
      this.status = 'COMPLETED';
      return { kind: 'GAME_COMPLETED', level: this.level, state: this.getGameState() };
    }
    if (this.getConnectedPlayerCount() !== this.players.size) {
      throw new EngineError('PLAYER_NOT_CONNECTED', 'All players must reconnect before the next level starts.');
    }

    this.level += 1;
    this.status = 'PLAYING';
    this.dealLevel();
    return { kind: 'LEVEL_STARTED', level: this.level, state: this.getGameState() };
  }

  public markGameOverForDisconnectedPlayer(playerId: string): void {
    const player = this.requirePlayer(playerId);
    if (player.connected) {
      throw new EngineError('INVALID_ACTION', 'Only disconnected players can forfeit a game.');
    }
    if (this.status === 'PLAYING' || this.status === 'ROUND_SUCCESS') {
      this.status = 'GAME_OVER';
      this.starVotes.clear();
    }
  }

  public getGameState(): GameState {
    const starVotes: Record<string, boolean> = {};
    for (const player of this.players.values()) {
      starVotes[player.id] = this.starVotes.get(player.id) === true;
    }

    return {
      roomCode: this.roomCode,
      status: this.status,
      level: this.level,
      maxLevel: this.maxLevel,
      lives: this.lives,
      stars: this.stars,
      discardPile: [...this.discardPile],
      players: [...this.players.values()].map((player) => this.clonePlayer(player)),
      starVotes,
    };
  }

  public getClientState(targetPlayerId: string): ClientGameState {
    const target = this.requirePlayer(targetPlayerId);
    const players: PublicPlayerView[] = [...this.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.isHost,
      connected: player.connected,
      cardCount: player.hand.length,
    }));
    const starVotes: Record<string, boolean> = {};
    for (const player of this.players.values()) {
      starVotes[player.id] = this.starVotes.get(player.id) === true;
    }

    return {
      roomCode: this.roomCode,
      status: this.status,
      level: this.level,
      maxLevel: this.maxLevel,
      lives: this.lives,
      stars: this.stars,
      discardTop: this.discardPile.at(-1) ?? null,
      discardCount: this.discardPile.length,
      players,
      myPlayer: {
        id: target.id,
        name: target.name,
        isHost: target.isHost,
        connected: target.connected,
        hand: [...target.hand].sort((a, b) => a - b),
      },
      starVotes,
      myStarVote: this.starVotes.get(target.id) === true,
      connectedPlayerCount: this.getConnectedPlayerCount(),
    };
  }

  private getConnectedPlayers(): Player[] {
    return [...this.players.values()].filter((player) => player.connected);
  }

  private dealLevel(): void {
    const deck = this.shuffle(this.createDeck());
    for (const player of this.players.values()) {
      player.hand = [];
    }

    let deckIndex = 0;
    for (const player of this.players.values()) {
      for (let cardIndex = 0; cardIndex < this.level; cardIndex += 1) {
        const card = deck[deckIndex];
        if (card === undefined) {
          throw new EngineError('INTERNAL_ERROR', 'The deck ran out of cards while dealing.');
        }
        player.hand.push(card);
        deckIndex += 1;
      }
      player.hand.sort((left, right) => left - right);
    }
    this.discardPile = [];
    this.starVotes.clear();
  }

  private completeRoundIfEmpty(): RoundWonPayload | undefined {
    if ([...this.players.values()].some((player) => player.hand.length > 0)) {
      return undefined;
    }

    const completedLevel = this.level;
    const starsAwarded = STAR_REWARD_LEVELS.has(completedLevel) ? 1 : 0;
    const livesAwarded = LIFE_REWARD_LEVELS.has(completedLevel) ? 1 : 0;
    this.stars += starsAwarded;
    this.lives += livesAwarded;
    const finalLevel = completedLevel >= this.maxLevel;
    this.status = finalLevel ? 'COMPLETED' : 'ROUND_SUCCESS';

    return {
      level: completedLevel,
      finalLevel,
      reward: {
        completedLevel,
        livesAwarded,
        starsAwarded,
        lives: this.lives,
        stars: this.stars,
      },
    };
  }

  private recalculateLobbyRules(): void {
    const rules = RULES_BY_PLAYER_COUNT[this.players.size];
    this.maxLevel = rules?.maxLevel ?? 0;
  }

  private reassignHostIfNeeded(): void {
    const currentHost = [...this.players.values()].find((player) => player.isHost);
    if (currentHost?.connected) {
      return;
    }
    const nextHost = [...this.players.values()].find((player) => player.connected);
    if (!nextHost && currentHost) {
      return;
    }
    if (nextHost) {
      this.setHost(nextHost.id);
    }
  }

  private assertPlaying(): void {
    if (this.status !== 'PLAYING') {
      throw new EngineError('INVALID_STATE', 'Cards and stars can only be used during an active level.');
    }
  }

  private assertCardValue(card: CardValue): void {
    if (!Number.isInteger(card) || card < 1 || card > DECK_SIZE) {
      throw new EngineError('INVALID_CARD', `Cards must be whole numbers from 1 to ${DECK_SIZE}.`);
    }
  }

  private requirePlayer(id: string): Player {
    const player = this.players.get(id);
    if (!player) {
      throw new EngineError('PLAYER_NOT_FOUND', 'Player is not in this room.');
    }
    return player;
  }

  private requireConnectedPlayer(id: string): Player {
    const player = this.requirePlayer(id);
    if (!player.connected) {
      throw new EngineError('PLAYER_NOT_CONNECTED', 'Reconnect before taking an action.');
    }
    return player;
  }

  private createDeck(): CardValue[] {
    return Array.from({ length: DECK_SIZE }, (_, index) => index + 1);
  }

  private shuffle(cards: CardValue[]): CardValue[] {
    for (let index = cards.length - 1; index > 0; index -= 1) {
      const randomValue = Math.min(Math.max(this.random(), 0), 0.9999999999999999);
      const swapIndex = Math.floor(randomValue * (index + 1));
      const current = cards[index];
      const replacement = cards[swapIndex];
      if (current === undefined || replacement === undefined) {
        throw new EngineError('INTERNAL_ERROR', 'The deck shuffle produced an invalid index.');
      }
      cards[index] = replacement;
      cards[swapIndex] = current;
    }
    return cards;
  }

  private clonePlayer(player: Player): Player {
    return { ...player, hand: [...player.hand] };
  }
}
