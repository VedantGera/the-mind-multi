import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { RoomCode } from '../../shared/types';
import { EngineError, TheMindEngine } from './gameEngine';

export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const DEFAULT_RECONNECT_GRACE_MS = 60_000;

export interface PlayerSession {
  playerId: string;
  playerName: string;
  reconnectToken: string;
  socketId: string | null;
}

export interface RoomRecord {
  code: RoomCode;
  engine: TheMindEngine;
  sessions: Map<string, PlayerSession>;
  disconnectTimers: Map<string, NodeJS.Timeout>;
}

export interface PlayerExpiredEvent {
  roomCode: RoomCode;
  playerId: string;
  playerName: string;
  gameOver: boolean;
  roomDeleted: boolean;
  room: RoomRecord | null;
}

export interface RoomManagerOptions {
  reconnectGraceMs?: number;
  randomIntFn?: (minInclusive: number, maxExclusive: number) => number;
  tokenFactory?: () => string;
  playerIdFactory?: () => string;
  onPlayerExpired?: (event: PlayerExpiredEvent) => void;
}

export interface RoomBinding {
  room: RoomRecord;
  session: PlayerSession;
  reconnected: boolean;
}

/**
 * In-memory room registry. A deployment that needs horizontal scaling should
 * put this boundary behind a shared store and a Socket.IO adapter; the game
 * engine itself remains transport-independent.
 */
export class RoomManager {
  private readonly rooms = new Map<RoomCode, RoomRecord>();
  private readonly reconnectGraceMs: number;
  private readonly randomIntFn: (minInclusive: number, maxExclusive: number) => number;
  private readonly tokenFactory: () => string;
  private readonly playerIdFactory: () => string;
  private readonly onPlayerExpired?: (event: PlayerExpiredEvent) => void;

  public constructor(options: RoomManagerOptions = {}) {
    this.reconnectGraceMs = options.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
    this.randomIntFn = options.randomIntFn ?? randomInt;
    this.tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString('base64url'));
    this.playerIdFactory = options.playerIdFactory ?? randomUUID;
    this.onPlayerExpired = options.onPlayerExpired;
  }

  public createRoom(playerName: string, socketId: string): RoomBinding {
    const code = this.generateRoomCode();
    const room: RoomRecord = {
      code,
      engine: new TheMindEngine({ roomCode: code }),
      sessions: new Map(),
      disconnectTimers: new Map(),
    };
    const session = this.createSession(playerName, socketId);
    room.engine.addPlayer(session.playerId, playerName);
    room.sessions.set(session.playerId, session);
    this.rooms.set(code, room);
    return { room, session, reconnected: false };
  }

  public joinRoom(roomCode: string, playerName: string, socketId: string, reconnectToken?: string): RoomBinding {
    const normalizedCode = normalizeRoomCode(roomCode);
    const room = this.rooms.get(normalizedCode);
    if (!room) {
      throw new EngineError('ROOM_NOT_FOUND', 'That room does not exist.');
    }

    if (reconnectToken) {
      const existing = [...room.sessions.values()].find((session) => session.reconnectToken === reconnectToken);
      if (!existing) {
        throw new EngineError('RECONNECT_FAILED', 'The reconnect token is invalid or has expired.');
      }
      if (existing.socketId && existing.socketId !== socketId) {
        throw new EngineError('RECONNECT_FAILED', 'That player is already connected.');
      }
      this.clearDisconnectTimer(room, existing.playerId);
      existing.socketId = socketId;
      room.engine.setPlayerConnected(existing.playerId, true);
      return { room, session: existing, reconnected: true };
    }

    if (room.engine.getStatus() !== 'LOBBY') {
      throw new EngineError('ROOM_ALREADY_STARTED', 'This game has already started.');
    }
    if (room.sessions.size >= 4) {
      throw new EngineError('ROOM_FULL', 'That room already has four players.');
    }

    const session = this.createSession(playerName, socketId);
    room.engine.addPlayer(session.playerId, playerName);
    room.sessions.set(session.playerId, session);
    return { room, session, reconnected: false };
  }

  public disconnect(roomCode: string | undefined, playerId: string | undefined, socketId: string): RoomRecord | null {
    if (!roomCode || !playerId) {
      return null;
    }
    const room = this.rooms.get(roomCode);
    const session = room?.sessions.get(playerId);
    if (!room || !session || session.socketId !== socketId) {
      return null;
    }

    session.socketId = null;
    room.engine.setPlayerConnected(playerId, false);
    this.scheduleDisconnectExpiry(room, session);
    return room;
  }

  /**
   * Explicit leave removes lobby players immediately. Once a game has begun,
   * it follows the same grace-period path as a network disconnect so a brief
   * app suspension does not destroy a player's hidden hand.
   */
  public leave(roomCode: string | undefined, playerId: string | undefined, socketId: string): RoomRecord | null {
    if (!roomCode || !playerId) {
      return null;
    }
    const room = this.rooms.get(roomCode);
    const session = room?.sessions.get(playerId);
    if (!room || !session || session.socketId !== socketId) {
      return null;
    }

    this.clearDisconnectTimer(room, playerId);
    if (room.engine.getStatus() === 'LOBBY') {
      room.engine.removePlayer(playerId);
      room.sessions.delete(playerId);
      if (room.sessions.size === 0) {
        this.deleteRoom(room);
        return null;
      }
      return room;
    }

    session.socketId = null;
    room.engine.setPlayerConnected(playerId, false);
    this.scheduleDisconnectExpiry(room, session);
    return room;
  }

  public getRoom(roomCode: string | undefined): RoomRecord | null {
    if (!roomCode) {
      return null;
    }
    return this.rooms.get(normalizeRoomCode(roomCode)) ?? null;
  }

  public getRooms(): ReadonlyMap<RoomCode, RoomRecord> {
    return this.rooms;
  }

  public getRoomSessions(room: RoomRecord): PlayerSession[] {
    return [...room.sessions.values()];
  }

  public closeAll(): void {
    for (const room of this.rooms.values()) {
      this.deleteRoom(room);
    }
  }

  private createSession(playerName: string, socketId: string): PlayerSession {
    return {
      playerId: this.playerIdFactory(),
      playerName: playerName.trim(),
      reconnectToken: this.tokenFactory(),
      socketId,
    };
  }

  private generateRoomCode(): RoomCode {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      let code = '';
      for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
        const characterIndex = this.randomIntFn(0, ROOM_CODE_ALPHABET.length);
        code += ROOM_CODE_ALPHABET[characterIndex] ?? ROOM_CODE_ALPHABET[0];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new EngineError('INTERNAL_ERROR', 'Unable to allocate a unique room code.');
  }

  private scheduleDisconnectExpiry(room: RoomRecord, session: PlayerSession): void {
    this.clearDisconnectTimer(room, session.playerId);
    const timer = setTimeout(() => this.expireDisconnectedPlayer(room.code, session.playerId), this.reconnectGraceMs);
    timer.unref?.();
    room.disconnectTimers.set(session.playerId, timer);
  }

  private expireDisconnectedPlayer(roomCode: RoomCode, playerId: string): void {
    const room = this.rooms.get(roomCode);
    const session = room?.sessions.get(playerId);
    if (!room || !session || session.socketId !== null) {
      return;
    }

    this.clearDisconnectTimer(room, playerId);
    const playerName = session.playerName;
    const wasActive = room.engine.getStatus() === 'PLAYING' || room.engine.getStatus() === 'ROUND_SUCCESS';
    if (room.engine.getStatus() === 'LOBBY') {
      room.engine.removePlayer(playerId);
    } else if (wasActive) {
      room.engine.markGameOverForDisconnectedPlayer(playerId);
    }
    room.sessions.delete(playerId);

    const hasConnectedPlayers = [...room.sessions.values()].some((candidate) => candidate.socketId !== null);
    let roomDeleted = false;
    if (!hasConnectedPlayers) {
      this.deleteRoom(room);
      roomDeleted = true;
    }

    this.onPlayerExpired?.({
      roomCode,
      playerId,
      playerName,
      gameOver: wasActive,
      room: roomDeleted ? null : room,
      roomDeleted,
    });
  }

  private clearDisconnectTimer(room: RoomRecord, playerId: string): void {
    const timer = room.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      room.disconnectTimers.delete(playerId);
    }
  }

  private deleteRoom(room: RoomRecord): void {
    for (const playerId of room.disconnectTimers.keys()) {
      this.clearDisconnectTimer(room, playerId);
    }
    this.rooms.delete(room.code);
  }
}

export function normalizeRoomCode(value: string): RoomCode {
  return value.trim().toUpperCase();
}

export function isValidRoomCode(value: string): boolean {
  return /^[A-Z0-9]{4}$/.test(normalizeRoomCode(value));
}
