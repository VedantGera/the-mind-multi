import * as SecureStore from 'expo-secure-store';
import type { RoomCode } from '../../../shared/types';

const SESSION_STORAGE_KEY = 'the-mind-online/session-v1';

export interface PersistedSession {
  roomCode: RoomCode;
  playerId: string;
  reconnectToken: string;
  playerName: string;
}

export async function loadPersistedSession(): Promise<PersistedSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedSession(parsed)) {
      await clearPersistedSession();
      return null;
    }
    return parsed;
  } catch {
    await clearPersistedSession();
    return null;
  }
}

export async function savePersistedSession(session: PersistedSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export async function clearPersistedSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
}

function isPersistedSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.roomCode === 'string' &&
    /^[A-Z0-9]{4}$/.test(candidate.roomCode) &&
    typeof candidate.playerId === 'string' &&
    typeof candidate.reconnectToken === 'string' &&
    typeof candidate.playerName === 'string'
  );
}
