import { describe, expect, it } from 'vitest';
import { TheMindEngine } from '../src/gameEngine';

function engineWithPlayers(count = 2): TheMindEngine {
  const engine = new TheMindEngine({ random: () => 0.5 });
  for (let index = 0; index < count; index += 1) {
    engine.addPlayer(`p${index + 1}`, `Player ${index + 1}`);
  }
  return engine;
}

function completeCurrentRound(engine: TheMindEngine): void {
  while (engine.getGameState().status === 'PLAYING') {
    const state = engine.getGameState();
    const next = state.players
      .flatMap((player) => player.hand.map((card) => ({ playerId: player.id, card })))
      .sort((left, right) => left.card - right.card)[0];
    if (!next) {
      throw new Error('The round did not contain a playable card.');
    }
    engine.playCard(next.playerId, next.card);
  }
}

describe('TheMindEngine', () => {
  it('starts a two-player game with the configured resources and masked views', () => {
    const engine = engineWithPlayers(2);

    engine.startGame();

    const state = engine.getGameState();
    expect(state.status).toBe('PLAYING');
    expect(state.level).toBe(1);
    expect(state.lives).toBe(2);
    expect(state.stars).toBe(1);
    expect(state.players.every((player) => player.hand.length === 1)).toBe(true);
    expect(new Set(state.players.flatMap((player) => player.hand)).size).toBe(2);

    const firstView = engine.getClientState('p1');
    expect(firstView.myPlayer.hand).toEqual(state.players[0]?.hand);
    expect(firstView.players.find((player) => player.id === 'p2')?.cardCount).toBe(1);
    expect(firstView.players.find((player) => player.id === 'p2')).not.toHaveProperty('hand');
  });

  it('exposes skipped cards and decrements a life on an out-of-order play', () => {
    const engine = engineWithPlayers(2);
    engine.startGame();
    const initial = engine.getGameState();
    const first = initial.players.find((player) => player.id === 'p1');
    const second = initial.players.find((player) => player.id === 'p2');
    expect(first?.hand[0]).toBeDefined();
    expect(second?.hand[0]).toBeDefined();

    const lowPlayer = (first?.hand[0] ?? 0) < (second?.hand[0] ?? 0) ? 'p1' : 'p2';
    const highPlayer = lowPlayer === 'p1' ? 'p2' : 'p1';
    const lowCard = engine.getGameState().players.find((player) => player.id === lowPlayer)?.hand[0] ?? 0;
    const highCard = engine.getGameState().players.find((player) => player.id === highPlayer)?.hand[0] ?? 0;

    const result = engine.playCard(highPlayer, highCard);

    expect(result.kind).toBe('LIFE_LOST');
    if (result.kind === 'LIFE_LOST') {
      expect(result.skippedCards).toEqual([lowCard]);
      expect(result.remainingLives).toBe(1);
    }
    expect(engine.getGameState().discardPile).toEqual([lowCard, highCard]);
    expect(engine.getGameState().players.every((player) => player.hand.length === 0)).toBe(true);
  });

  it('triggers a star only after every connected player votes yes', () => {
    const engine = engineWithPlayers(2);
    engine.startGame();
    const before = engine.getGameState();
    const expectedLowest = before.players.map((player) => Math.min(...player.hand)).sort((a, b) => a - b);

    const firstVote = engine.voteStar('p1', true);
    expect(firstVote.kind).toBe('VOTE_RECORDED');
    expect(engine.getGameState().stars).toBe(1);

    const trigger = engine.voteStar('p2', true);
    expect(trigger.kind).toBe('STAR_TRIGGERED');
    if (trigger.kind === 'STAR_TRIGGERED') {
      expect(trigger.revealedCards).toEqual(expectedLowest);
      expect(trigger.remainingStars).toBe(0);
    }
    expect(engine.getGameState().discardPile).toEqual(expectedLowest);
  });

  it('awards a star when Level 2 is completed', () => {
    const engine = engineWithPlayers(2);
    engine.startGame();
    completeCurrentRound(engine);
    expect(engine.getGameState().status).toBe('ROUND_SUCCESS');

    const result = engine.nextLevel('p1');

    expect(result.kind).toBe('LEVEL_STARTED');
    expect(engine.getGameState().level).toBe(2);
    completeCurrentRound(engine);
    expect(engine.getGameState().stars).toBe(2);
  });

  it('rejects games outside the supported two-to-four player range', () => {
    const engine = new TheMindEngine();
    engine.addPlayer('only', 'Only Player');

    expect(() => engine.startGame()).toThrow(/at least 2 connected players/i);
  });
});
