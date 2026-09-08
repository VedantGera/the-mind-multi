import cors from 'cors';
import express, { Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  CreateRoomPayload,
  ErrorPayload,
  GameOverPayload,
  JoinRoomPayload,
  LeaveRoomPayload,
  NextLevelPayload,
  PlayCardPayload,
  RoomSessionPayload,
  ServerToClientEvents,
  SocketData,
  StartGamePayload,
  VoteStarPayload,
} from '../../shared/types';
import {
  EngineError,
  LifeLostResult,
  StarTriggeredResult,
  TheMindEngine,
} from './gameEngine';
import {
  isValidRoomCode,
  PlayerSession,
  RoomManager,
  RoomManagerOptions,
  RoomRecord,
} from './roomManager';

export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type GameIo = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface GameServerOptions extends RoomManagerOptions {
  port?: number;
  corsOrigins?: string[];
}

export interface GameServerRuntime {
  app: express.Express;
  httpServer: HttpServer;
  io: GameIo;
  roomManager: RoomManager;
  port: number;
  close: () => Promise<void>;
}

/** Build the HTTP and Socket.IO layers without starting a listening port. */
export function createGameServer(options: GameServerOptions = {}): GameServerRuntime {
  const app = express();
  const httpServer = createServer(app);
  const configuredCorsOrigins = options.corsOrigins ?? parseCorsOrigins(process.env.CORS_ORIGIN);
  const corsOrigin: string[] | boolean = configuredCorsOrigins.length > 0
    ? configuredCorsOrigins
    : process.env.NODE_ENV === 'production'
      ? false
      : true;
  const io: GameIo = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 16 * 1024,
  });

  app.disable('x-powered-by');
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '16kb' }));
  app.get('/healthz', (_request: Request, response: Response) => {
    response.status(200).json({ status: 'ok' });
  });

  let roomManager: RoomManager;
  const reconnectGraceMs = options.reconnectGraceMs
    ?? parsePositiveInteger(process.env.RECONNECT_GRACE_MS ?? '60000', 'RECONNECT_GRACE_MS');
  const broadcastState = (room: RoomRecord): void => {
    for (const session of roomManager.getRoomSessions(room)) {
      if (!session.socketId) {
        continue;
      }
      io.to(session.socketId).emit('GAME_STATE_UPDATE', room.engine.getClientState(session.playerId));
    }
  };

  roomManager = new RoomManager({
    ...options,
    reconnectGraceMs,
    onPlayerExpired: (event) => {
      if (!event.room) {
        return;
      }
      if (event.gameOver) {
        const payload: GameOverPayload = {
          reason: 'PLAYER_DISCONNECTED',
          remainingLives: event.room.engine.getGameState().lives,
          message: `${event.playerName} did not reconnect in time.`,
        };
        io.to(event.roomCode).emit('GAME_OVER', payload);
      }
      broadcastState(event.room);
    },
  });

  const emitError = (socket: GameSocket, error: unknown, requestId?: string): void => {
    const payload: ErrorPayload = error instanceof EngineError
      ? { code: error.code, message: error.message, requestId }
      : { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.', requestId };
    socket.emit('ERROR', payload);
    if (!(error instanceof EngineError)) {
      console.error(error);
    }
  };

  const requireRoomContext = (socket: GameSocket): { room: RoomRecord; playerId: string; session: PlayerSession } => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) {
      throw new EngineError('UNAUTHORIZED', 'Join or create a room before taking that action.');
    }
    const room = roomManager.getRoom(roomCode);
    const session = room?.sessions.get(playerId);
    if (!room || !session || session.socketId !== socket.id) {
      throw new EngineError('UNAUTHORIZED', 'This socket is not attached to an active room session.');
    }
    return { room, playerId, session };
  };

  const attachSocketToRoom = async (socket: GameSocket, room: RoomRecord, session: PlayerSession): Promise<void> => {
    await socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerId = session.playerId;
    socket.data.reconnectToken = session.reconnectToken;
  };

  const makeSessionPayload = (room: RoomRecord, session: PlayerSession): RoomSessionPayload => ({
    roomCode: room.code,
    playerId: session.playerId,
    reconnectToken: session.reconnectToken,
    state: room.engine.getClientState(session.playerId),
  });

  io.on('connection', (socket: GameSocket) => {
    socket.on('CREATE_ROOM', (payload: CreateRoomPayload) => {
      void (async () => {
        try {
          assertSocketDetached(socket);
          const playerName = requirePlayerName(payload?.playerName);
          const binding = roomManager.createRoom(playerName, socket.id);
          await attachSocketToRoom(socket, binding.room, binding.session);
          socket.emit('ROOM_CREATED', makeSessionPayload(binding.room, binding.session));
          broadcastState(binding.room);
        } catch (error) {
          emitError(socket, error);
        }
      })();
    });

    socket.on('JOIN_ROOM', (payload: JoinRoomPayload) => {
      void (async () => {
        try {
          assertSocketDetached(socket);
          const roomCode = requireRoomCode(payload?.roomCode);
          const playerName = requirePlayerName(payload?.playerName);
          const binding = roomManager.joinRoom(roomCode, playerName, socket.id, payload?.reconnectToken);
          await attachSocketToRoom(socket, binding.room, binding.session);
          socket.emit('ROOM_JOINED', makeSessionPayload(binding.room, binding.session));
          broadcastState(binding.room);
        } catch (error) {
          emitError(socket, error);
        }
      })();
    });

    socket.on('START_GAME', (payload: StartGamePayload) => {
      try {
        const { room, playerId } = requireRoomContext(socket);
        assertHost(room.engine, playerId);
        room.engine.startGame();
        broadcastState(room);
      } catch (error) {
        emitError(socket, error, getRequestId(payload));
      }
    });

    socket.on('PLAY_CARD', (payload: PlayCardPayload) => {
      try {
        const { room, playerId } = requireRoomContext(socket);
        const result = room.engine.playCard(playerId, requireCard(payload?.card));
        if (result.kind === 'LIFE_LOST' || result.kind === 'GAME_OVER') {
          const lifeLost = toLifeLostPayload(result);
          io.to(room.code).emit('LIFE_LOST', lifeLost);
        }
        if (result.kind === 'GAME_OVER') {
          io.to(room.code).emit('GAME_OVER', {
            reason: 'LIVES_DEPLETED',
            remainingLives: result.remainingLives,
            message: 'The team ran out of lives.',
          } satisfies GameOverPayload);
        }
        if (result.kind !== 'GAME_OVER' && result.roundWon) {
          io.to(room.code).emit('ROUND_WON', result.roundWon);
        }
        broadcastState(room);
      } catch (error) {
        emitError(socket, error);
      }
    });

    socket.on('VOTE_STAR', (payload: VoteStarPayload) => {
      try {
        const { room, playerId } = requireRoomContext(socket);
        const result = room.engine.voteStar(playerId, requireBoolean(payload?.vote));
        if (result.kind === 'STAR_TRIGGERED') {
          io.to(room.code).emit('STAR_TRIGGERED', toStarTriggeredPayload(result));
          if (result.roundWon) {
            io.to(room.code).emit('ROUND_WON', result.roundWon);
          }
        }
        broadcastState(room);
      } catch (error) {
        emitError(socket, error);
      }
    });

    socket.on('NEXT_LEVEL', (payload: NextLevelPayload) => {
      try {
        const { room, playerId } = requireRoomContext(socket);
        room.engine.nextLevel(playerId);
        broadcastState(room);
      } catch (error) {
        emitError(socket, error, getRequestId(payload));
      }
    });

    socket.on('LEAVE_ROOM', (payload: LeaveRoomPayload) => {
      try {
        const roomCode = socket.data.roomCode;
        const playerId = socket.data.playerId;
        const room = roomManager.leave(roomCode, playerId, socket.id);
        if (room) {
          broadcastState(room);
          void socket.leave(room.code);
        }
        clearSocketSession(socket);
        void payload;
      } catch (error) {
        emitError(socket, error);
      }
    });

    socket.on('disconnect', () => {
      const room = roomManager.disconnect(socket.data.roomCode, socket.data.playerId, socket.id);
      if (room) {
        broadcastState(room);
      }
    });
  });

  const port = options.port ?? parsePort(process.env.PORT ?? '3000');
  return {
    app,
    httpServer,
    io,
    roomManager,
    port,
    close: async () => {
      roomManager.closeAll();
      await new Promise<void>((resolve) => {
        io.close(() => {
          if (!httpServer.listening) {
            resolve();
            return;
          }
          httpServer.close(() => resolve());
        });
      });
    },
  };
}

export function startServer(options: GameServerOptions = {}): GameServerRuntime {
  const runtime = createGameServer(options);
  runtime.httpServer.listen(runtime.port, '0.0.0.0', () => {
    console.log(`The Mind server listening on port ${runtime.port}`);
  });
  return runtime;
}

function assertSocketDetached(socket: GameSocket): void {
  if (socket.data.roomCode || socket.data.playerId) {
    throw new EngineError('INVALID_STATE', 'Leave the current room before joining another one.');
  }
}

function assertHost(engine: TheMindEngine, playerId: string): void {
  if (engine.getHostId() !== playerId) {
    throw new EngineError('UNAUTHORIZED', 'Only the host can perform that action.');
  }
}

function toLifeLostPayload(result: LifeLostResult | Extract<ReturnType<TheMindEngine['playCard']>, { kind: 'GAME_OVER' }>) {
  return {
    offendingPlayerId: result.playerId,
    playedCard: result.playedCard,
    skippedCards: result.skippedCards,
    penalties: result.penalties,
    remainingLives: result.remainingLives,
  };
}

function toStarTriggeredPayload(result: StarTriggeredResult) {
  return {
    revealedCards: result.revealedCards,
    reveals: result.reveals,
    remainingStars: result.remainingStars,
  };
}

function requirePlayerName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new EngineError('INVALID_PLAYER_NAME', 'A player name is required.');
  }
  const name = value.trim();
  if (name.length < 1 || name.length > 24) {
    throw new EngineError('INVALID_PLAYER_NAME', 'Player names must be between 1 and 24 characters.');
  }
  return name;
}

function requireRoomCode(value: unknown): string {
  if (typeof value !== 'string' || !isValidRoomCode(value)) {
    throw new EngineError('INVALID_ROOM_CODE', 'Room codes are exactly four letters or digits.');
  }
  return value.trim().toUpperCase();
}

function requireCard(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new EngineError('INVALID_CARD', 'A whole-number card value is required.');
  }
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new EngineError('INVALID_INPUT', 'A boolean vote is required.');
  }
  return value;
}

function getRequestId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }
  const requestId = (payload as { requestId?: unknown }).requestId;
  return typeof requestId === 'string' && requestId.length <= 64 ? requestId : undefined;
}

function clearSocketSession(socket: GameSocket): void {
  delete socket.data.roomCode;
  delete socket.data.playerId;
  delete socket.data.reconnectToken;
}

function parseCorsOrigins(value: string | undefined): string[] {
  return value
    ? value.split(',').map((origin) => origin.trim()).filter((origin) => origin.length > 0)
    : [];
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }
  return parsed;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }
  return port;
}

if (require.main === module) {
  startServer();
}
