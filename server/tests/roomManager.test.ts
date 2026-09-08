import { afterEach, describe, expect, it } from 'vitest';
import { RoomManager } from '../src/roomManager';

const managers: RoomManager[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.closeAll();
});

describe('RoomManager', () => {
  it('restores a disconnected player with the reconnect token', () => {
    const manager = new RoomManager({ reconnectGraceMs: 100, tokenFactory: () => 'token-a' });
    managers.push(manager);
    const created = manager.createRoom('Alice', 'socket-a');
    const joined = manager.joinRoom(created.room.code, 'Bob', 'socket-b', undefined);

    manager.disconnect(created.room.code, created.session.playerId, 'socket-a');
    const restored = manager.joinRoom(
      created.room.code,
      'ignored-name-on-reconnect',
      'socket-a-reconnected',
      created.session.reconnectToken,
    );

    expect(restored.reconnected).toBe(true);
    expect(restored.session.playerId).toBe(created.session.playerId);
    expect(restored.room.engine.getPlayer(created.session.playerId).connected).toBe(true);
    expect(restored.room.engine.getPlayer(joined.session.playerId).name).toBe('Bob');
  });

  it('forfeits an active game after the reconnect grace period', async () => {
    let expiration: { gameOver: boolean; roomDeleted: boolean } | undefined;
    const manager = new RoomManager({
      reconnectGraceMs: 10,
      onPlayerExpired: (event) => {
        expiration = { gameOver: event.gameOver, roomDeleted: event.roomDeleted };
      },
    });
    managers.push(manager);
    const created = manager.createRoom('Alice', 'socket-a');
    const joined = manager.joinRoom(created.room.code, 'Bob', 'socket-b');
    created.room.engine.startGame();

    manager.disconnect(created.room.code, created.session.playerId, 'socket-a');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(expiration).toEqual({ gameOver: true, roomDeleted: false });
    expect(created.room.engine.getStatus()).toBe('GAME_OVER');
    expect(manager.getRoom(created.room.code)).not.toBeNull();
    expect(created.room.engine.getPlayer(joined.session.playerId).connected).toBe(true);
  });

  it('tears down a room after every disconnected session expires', async () => {
    let roomDeleted = false;
    const manager = new RoomManager({
      reconnectGraceMs: 10,
      onPlayerExpired: (event) => {
        roomDeleted = event.roomDeleted;
      },
    });
    managers.push(manager);
    const created = manager.createRoom('Alice', 'socket-a');

    manager.disconnect(created.room.code, created.session.playerId, 'socket-a');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(roomDeleted).toBe(true);
    expect(manager.getRoom(created.room.code)).toBeNull();
  });
});
