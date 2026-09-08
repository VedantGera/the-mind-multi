import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import type {
  ClientGameState,
  ErrorPayload,
  GameOverPayload,
  JoinRoomPayload,
  RoomSessionPayload,
  RoundWonPayload,
  StarTriggeredPayload,
} from '../../../shared/types';
import { createGameSocket, GameSocket } from '../network/socket';
import {
  clearPersistedSession,
  loadPersistedSession,
  PersistedSession,
  savePersistedSession,
} from '../storage/sessionStorage';

const configuredServerUrl = Constants.expoConfig?.extra?.serverUrl;
const DEFAULT_SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL
  ?? (typeof configuredServerUrl === 'string' ? configuredServerUrl : undefined)
  ?? 'http://localhost:3000';

export type FeedbackKind = 'LIFE_LOST' | 'STAR_TRIGGERED' | 'ROUND_WON' | 'GAME_OVER';

export interface GameFeedback {
  id: number;
  kind: FeedbackKind;
  message: string;
}

export interface GameSessionState {
  connected: boolean;
  restoring: boolean;
  session: PersistedSession | null;
  gameState: ClientGameState | null;
  error: ErrorPayload | null;
  feedback: GameFeedback | null;
}

export interface GameSessionActions {
  createRoom: (playerName: string) => void;
  joinRoom: (roomCode: string, playerName: string) => void;
  startGame: () => void;
  playCard: (card: number) => void;
  voteStar: (vote: boolean) => void;
  nextLevel: () => void;
  leaveRoom: () => void;
  clearError: () => void;
  clearFeedback: () => void;
}

export function useGameSession(serverUrl: string = DEFAULT_SERVER_URL): GameSessionState & GameSessionActions {
  const socketRef = useRef<GameSocket | null>(null);
  const sessionRef = useRef<PersistedSession | null>(null);
  const feedbackIdRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [session, setSession] = useState<PersistedSession | null>(null);
  const [gameState, setGameState] = useState<ClientGameState | null>(null);
  const [error, setError] = useState<ErrorPayload | null>(null);
  const [feedback, setFeedback] = useState<GameFeedback | null>(null);

  const showFeedback = useCallback((kind: FeedbackKind, message: string): void => {
    feedbackIdRef.current += 1;
    setFeedback({ id: feedbackIdRef.current, kind, message });
  }, []);

  useEffect(() => {
    const socket = createGameSocket(serverUrl);
    socketRef.current = socket;
    let active = true;

    const applySessionPayload = (payload: RoomSessionPayload): void => {
      const persisted: PersistedSession = {
        roomCode: payload.roomCode,
        playerId: payload.playerId,
        reconnectToken: payload.reconnectToken,
        playerName: payload.state.myPlayer.name,
      };
      sessionRef.current = persisted;
      setSession(persisted);
      setGameState(payload.state);
      setError(null);
      void savePersistedSession(persisted);
    };

    const onConnect = (): void => {
      setConnected(true);
      const persisted = sessionRef.current;
      if (persisted) {
        socket.emit('JOIN_ROOM', {
          roomCode: persisted.roomCode,
          playerName: persisted.playerName,
          reconnectToken: persisted.reconnectToken,
        });
      }
    };
    const onDisconnect = (): void => setConnected(false);
    const onConnectError = (connectError: Error): void => {
      setError({ code: 'INTERNAL_ERROR', message: connectError.message || 'Unable to connect to the game server.' });
    };
    const onRoomCreated = (payload: RoomSessionPayload): void => applySessionPayload(payload);
    const onRoomJoined = (payload: RoomSessionPayload): void => applySessionPayload(payload);
    const onStateUpdate = (nextState: ClientGameState): void => setGameState(nextState);
    const onLifeLost = (payload: { skippedCards: number[] }): void => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showFeedback('LIFE_LOST', `Life lost. Skipped cards: ${payload.skippedCards.join(', ') || 'none'}.`);
    };
    const onStarTriggered = (payload: StarTriggeredPayload): void => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showFeedback('STAR_TRIGGERED', `Ninja Star revealed ${payload.revealedCards.length} card(s).`);
    };
    const onRoundWon = (payload: RoundWonPayload): void => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const rewardText = [
        payload.reward.starsAwarded > 0 ? `+${payload.reward.starsAwarded} star` : '',
        payload.reward.livesAwarded > 0 ? `+${payload.reward.livesAwarded} life` : '',
      ].filter(Boolean).join(' and ');
      showFeedback('ROUND_WON', payload.finalLevel ? 'All levels cleared!' : `Level ${payload.level} cleared${rewardText ? ` — ${rewardText}` : ''}.`);
    };
    const onGameOver = (payload: GameOverPayload): void => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showFeedback('GAME_OVER', payload.message);
    };
    const onError = (nextError: ErrorPayload): void => {
      setError(nextError);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (nextError.code === 'ROOM_NOT_FOUND' || nextError.code === 'RECONNECT_FAILED') {
        sessionRef.current = null;
        setSession(null);
        setGameState(null);
        void clearPersistedSession();
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('ROOM_CREATED', onRoomCreated);
    socket.on('ROOM_JOINED', onRoomJoined);
    socket.on('GAME_STATE_UPDATE', onStateUpdate);
    socket.on('LIFE_LOST', onLifeLost);
    socket.on('STAR_TRIGGERED', onStarTriggered);
    socket.on('ROUND_WON', onRoundWon);
    socket.on('GAME_OVER', onGameOver);
    socket.on('ERROR', onError);

    void loadPersistedSession()
      .then((persisted) => {
        if (!active) {
          return;
        }
        sessionRef.current = persisted;
        setSession(persisted);
        setRestoring(false);
        if (persisted) {
          socket.connect();
        }
      })
      .catch(() => {
        if (active) {
          setRestoring(false);
          setError({ code: 'INTERNAL_ERROR', message: 'Unable to restore the previous session.' });
        }
      });

    return () => {
      active = false;
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [serverUrl, showFeedback]);

  const ensureSocket = useCallback((): GameSocket | null => {
    const socket = socketRef.current;
    if (!socket) {
      setError({ code: 'INTERNAL_ERROR', message: 'The networking layer is not ready yet.' });
      return null;
    }
    if (!socket.connected) {
      socket.connect();
    }
    return socket;
  }, []);

  const createRoom = useCallback((playerName: string): void => {
    const socket = ensureSocket();
    if (!socket) return;
    setError(null);
    socket.emit('CREATE_ROOM', { playerName: playerName.trim() });
  }, [ensureSocket]);

  const joinRoom = useCallback((roomCode: string, playerName: string): void => {
    const existingSession = sessionRef.current;
    const existingSocket = socketRef.current;
    if (existingSession && existingSocket?.connected) {
      existingSocket.emit('LEAVE_ROOM', { reason: 'USER_REQUESTED' });
    }
    sessionRef.current = null;
    setSession(null);
    setGameState(null);
    void clearPersistedSession();

    const socket = ensureSocket();
    if (!socket) return;
    setError(null);
    const payload: JoinRoomPayload = {
      roomCode: roomCode.trim().toUpperCase(),
      playerName: playerName.trim(),
    };
    socket.emit('JOIN_ROOM', payload);
  }, [ensureSocket]);

  const startGame = useCallback((): void => {
    ensureSocket()?.emit('START_GAME', {});
  }, [ensureSocket]);

  const playCard = useCallback((card: number): void => {
    void Haptics.selectionAsync();
    ensureSocket()?.emit('PLAY_CARD', { card });
  }, [ensureSocket]);

  const voteStar = useCallback((vote: boolean): void => {
    ensureSocket()?.emit('VOTE_STAR', { vote });
  }, [ensureSocket]);

  const nextLevel = useCallback((): void => {
    ensureSocket()?.emit('NEXT_LEVEL', {});
  }, [ensureSocket]);

  const leaveRoom = useCallback((): void => {
    socketRef.current?.emit('LEAVE_ROOM', { reason: 'USER_REQUESTED' });
    sessionRef.current = null;
    setSession(null);
    setGameState(null);
    setFeedback(null);
    setError(null);
    void clearPersistedSession();
  }, []);

  const clearError = useCallback((): void => setError(null), []);
  const clearFeedback = useCallback((): void => setFeedback(null), []);

  return {
    connected,
    restoring,
    session,
    gameState,
    error,
    feedback,
    createRoom,
    joinRoom,
    startGame,
    playCard,
    voteStar,
    nextLevel,
    leaveRoom,
    clearError,
    clearFeedback,
  };
}
