import { io, Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ClientGameState,
  LifeLostPayload,
  RoomSessionPayload,
  RoundWonPayload,
} from '../../shared/types';
import { createGameServer, GameServerRuntime } from '../src/index';

const activeRuntimes: GameServerRuntime[] = [];

function waitForEvent<T>(socket: Socket, event: string, predicate: (payload: T) => boolean = () => true): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}.`));
    }, 3_000);
    const handler = (payload: T): void => {
      if (!predicate(payload)) return;
      clearTimeout(timeout);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

async function connectClient(url: string): Promise<Socket> {
  const socket = io(url, { transports: ['websocket'], forceNew: true });
  await waitForEvent<void>(socket, 'connect');
  return socket;
}

describe('Socket.IO protocol', () => {
  afterEach(async () => {
    for (const runtime of activeRuntimes.splice(0)) {
      await runtime.close();
    }
  });

  it('creates, joins, starts a room, masks hands, and emits a life-loss event', async () => {
    const runtime = createGameServer({ port: 0, reconnectGraceMs: 50 });
    activeRuntimes.push(runtime);
    await new Promise<void>((resolve) => runtime.httpServer.listen(0, resolve));
    const address = runtime.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('The test server did not receive a TCP address.');
    const url = `http://127.0.0.1:${address.port}`;

    const creator = await connectClient(url);
    const createdPromise = waitForEvent<RoomSessionPayload>(creator, 'ROOM_CREATED');
    creator.emit('CREATE_ROOM', { playerName: 'Alice' });
    const created = await createdPromise;

    const joiner = await connectClient(url);
    const joinedPromise = waitForEvent<RoomSessionPayload>(joiner, 'ROOM_JOINED');
    joiner.emit('JOIN_ROOM', { roomCode: created.roomCode, playerName: 'Bob' });
    const joined = await joinedPromise;

    expect(created.roomCode).toMatch(/^[A-Z0-9]{4}$/);
    expect(joined.state.players).toHaveLength(2);
    expect(joined.state.players.find((player) => player.id === created.playerId)).not.toHaveProperty('hand');

    const creatorPlaying = waitForEvent<ClientGameState>(creator, 'GAME_STATE_UPDATE', (state) => state.status === 'PLAYING');
    const joinerPlaying = waitForEvent<ClientGameState>(joiner, 'GAME_STATE_UPDATE', (state) => state.status === 'PLAYING');
    creator.emit('START_GAME', {});
    const [creatorState, joinerState] = await Promise.all([creatorPlaying, joinerPlaying]);

    expect(creatorState.myPlayer.hand).toHaveLength(1);
    expect(joinerState.myPlayer.hand).toHaveLength(1);
    expect(creatorState.players.find((player) => player.id === joined.playerId)).not.toHaveProperty('hand');

    const creatorCard = creatorState.myPlayer.hand[0];
    const joinerCard = joinerState.myPlayer.hand[0];
    if (creatorCard === undefined || joinerCard === undefined) throw new Error('The test hands were empty.');
    const highClient = creatorCard > joinerCard ? creator : joiner;
    const highCard = Math.max(creatorCard, joinerCard);
    const lifeLost = waitForEvent<LifeLostPayload>(highClient, 'LIFE_LOST');
    const roundWon = waitForEvent<RoundWonPayload>(creator, 'ROUND_WON');
    highClient.emit('PLAY_CARD', { card: highCard });

    const [lifeLostPayload, roundWonPayload] = await Promise.all([lifeLost, roundWon]);
    expect(lifeLostPayload.skippedCards).toEqual([Math.min(creatorCard, joinerCard)]);
    expect(lifeLostPayload.remainingLives).toBe(1);
    expect(roundWonPayload.level).toBe(1);
    expect(roundWonPayload.finalLevel).toBe(false);

    creator.disconnect();
    joiner.disconnect();
  });

  it('broadcasts a lobby update when an expired player is removed', async () => {
    const runtime = createGameServer({ port: 0, reconnectGraceMs: 25 });
    activeRuntimes.push(runtime);
    await new Promise<void>((resolve) => runtime.httpServer.listen(0, resolve));
    const address = runtime.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('The test server did not receive a TCP address.');
    const url = `http://127.0.0.1:${address.port}`;

    const creator = await connectClient(url);
    const createdPromise = waitForEvent<RoomSessionPayload>(creator, 'ROOM_CREATED');
    creator.emit('CREATE_ROOM', { playerName: 'Alice' });
    const created = await createdPromise;

    const joiner = await connectClient(url);
    const joinedPromise = waitForEvent<RoomSessionPayload>(joiner, 'ROOM_JOINED');
    joiner.emit('JOIN_ROOM', { roomCode: created.roomCode, playerName: 'Bob' });
    await joinedPromise;

    const removedState = waitForEvent<ClientGameState>(
      joiner,
      'GAME_STATE_UPDATE',
      (state) => state.status === 'LOBBY' && state.players.length === 1,
    );
    creator.disconnect();
    const state = await removedState;

    expect(state.players[0]?.name).toBe('Bob');
    expect(state.connectedPlayerCount).toBe(1);
    joiner.disconnect();
  });
});
