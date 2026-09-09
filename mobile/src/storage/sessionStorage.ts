import { Platform } from 'react-native';
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
  const raw = await readRawSession();
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
  const serialized = JSON.stringify(session);
  const browserStorage = getBrowserStorage();
  if (browserStorage) {
    try {
      browserStorage.setItem(SESSION_STORAGE_KEY, serialized);
    } catch {
      // Private browsing or storage quotas should not prevent playing.
    }
    return;
  }
  await SecureStore.setItemAsync(SESSION_STORAGE_KEY, serialized);
}

export async function clearPersistedSession(): Promise<void> {
  const browserStorage = getBrowserStorage();
  if (browserStorage) {
    try {
      browserStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore unavailable browser storage.
    }
    return;
  }
  await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
}

async function readRawSession(): Promise<string | null> {
  const browserStorage = getBrowserStorage();
  if (browserStorage) {
    try {
      return browserStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(SESSION_STORAGE_KEY);
}

function getBrowserStorage(): Storage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
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
