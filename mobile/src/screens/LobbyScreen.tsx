import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { ClientGameState, ErrorPayload } from '../../../shared/types';

export interface LobbyScreenProps {
  state: ClientGameState | null;
  initialPlayerName: string;
  connected: boolean;
  restoring: boolean;
  error: ErrorPayload | null;
  onCreateRoom: (playerName: string) => void;
  onJoinRoom: (roomCode: string, playerName: string) => void;
  onStartGame: () => void;
  onLeaveRoom: () => void;
  onClearError: () => void;
}

export function LobbyScreen({
  state,
  initialPlayerName,
  connected,
  restoring,
  error,
  onCreateRoom,
  onJoinRoom,
  onStartGame,
  onLeaveRoom,
  onClearError,
}: LobbyScreenProps): JSX.Element {
  const [playerName, setPlayerName] = useState(initialPlayerName);
  const [joinCode, setJoinCode] = useState('');
  const [joinVisible, setJoinVisible] = useState(false);

  useEffect(() => {
    if (initialPlayerName) {
      setPlayerName(initialPlayerName);
    }
  }, [initialPlayerName]);

  const canSubmitName = playerName.trim().length > 0 && playerName.trim().length <= 24;
  const canJoin = canSubmitName && /^[A-Z0-9]{4}$/.test(joinCode);
  const isInRoom = state?.status === 'LOBBY';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.kicker}>COOPERATIVE CARD GAME</Text>
          <Text style={styles.title}>THE MIND</Text>
          <Text style={styles.subtitle}>Find the silence between the numbers.</Text>

          {error ? (
            <Pressable accessibilityRole="alert" onPress={onClearError} style={styles.errorBanner}>
              <Text style={styles.errorTitle}>{error.code.replaceAll('_', ' ')}</Text>
              <Text style={styles.errorText}>{error.message}</Text>
              <Text style={styles.errorDismiss}>Tap to dismiss</Text>
            </Pressable>
          ) : null}

          {isInRoom && state ? (
            <View style={styles.roomPanel}>
              <Text style={styles.panelLabel}>ROOM CODE</Text>
              <Text selectable style={styles.roomCode}>{state.roomCode}</Text>
              <Text style={styles.waitingText}>
                {connected ? 'Share this code with your team.' : 'Reconnecting to the room…'}
              </Text>
              <View style={styles.playerList}>
                {state.players.map((player) => (
                  <View key={player.id} style={styles.playerRow}>
                    <View style={[styles.connectionDot, !player.connected && styles.connectionDotOff]} />
                    <Text style={styles.playerName}>{player.name}</Text>
                    {player.isHost ? <Text style={styles.hostBadge}>HOST</Text> : null}
                  </View>
                ))}
              </View>
              {state.myPlayer.isHost ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={state.connectedPlayerCount < 2 || !connected}
                  onPress={onStartGame}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (state.connectedPlayerCount < 2 || !connected) && styles.buttonDisabled,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>
                    {state.connectedPlayerCount < 2 ? 'Waiting for a teammate' : 'Start Game'}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.waitingText}>The host will start when everyone is ready.</Text>
              )}
              <Pressable accessibilityRole="button" onPress={onLeaveRoom} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Leave Room</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.formPanel}>
              <Text style={styles.inputLabel}>PLAYER NAME</Text>
              <TextInput
                accessibilityLabel="Player name"
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={24}
                onChangeText={setPlayerName}
                placeholder="Enter your name"
                placeholderTextColor="#7b8194"
                style={styles.input}
                value={playerName}
              />
              <Pressable
                accessibilityRole="button"
                disabled={!canSubmitName || restoring}
                onPress={() => onCreateRoom(playerName)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (!canSubmitName || restoring) && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>{restoring ? 'Restoring session…' : 'Create Game'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!canSubmitName || restoring}
                onPress={() => setJoinVisible(true)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  (!canSubmitName || restoring) && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Join Game</Text>
              </Pressable>
              <Text style={styles.connectionText}>{connected ? 'Server connected' : 'Connecting when needed'}</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        animationType="fade"
        onRequestClose={() => setJoinVisible(false)}
        transparent
        visible={joinVisible}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Join a Game</Text>
            <Text style={styles.modalSubtitle}>Enter the 4-character room code.</Text>
            <TextInput
              accessibilityLabel="Room code"
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              maxLength={4}
              onChangeText={(value) => setJoinCode(value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
              placeholder="AB12"
              placeholderTextColor="#7b8194"
              style={[styles.input, styles.codeInput]}
              value={joinCode}
            />
            <Pressable
              accessibilityRole="button"
              disabled={!canJoin}
              onPress={() => {
                setJoinVisible(false);
                onJoinRoom(joinCode, playerName);
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                !canJoin && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>Join</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setJoinVisible(false)} style={styles.modalCancel}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#10131d' },
  keyboardView: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  kicker: { color: '#8f98b5', fontSize: 12, fontWeight: '700', letterSpacing: 2, textAlign: 'center' },
  title: { color: '#f6f7fb', fontSize: 48, fontWeight: '900', letterSpacing: 6, marginTop: 8, textAlign: 'center' },
  subtitle: { color: '#aeb5c9', fontSize: 16, marginBottom: 36, marginTop: 8, textAlign: 'center' },
  formPanel: { backgroundColor: '#191e2c', borderColor: '#2b3349', borderRadius: 22, borderWidth: 1, padding: 20 },
  roomPanel: { backgroundColor: '#191e2c', borderColor: '#2b3349', borderRadius: 22, borderWidth: 1, padding: 20 },
  panelLabel: { color: '#8f98b5', fontSize: 11, fontWeight: '800', letterSpacing: 2, textAlign: 'center' },
  roomCode: { color: '#e4bd67', fontSize: 42, fontWeight: '900', letterSpacing: 8, marginVertical: 4, textAlign: 'center' },
  waitingText: { color: '#aeb5c9', fontSize: 14, marginBottom: 18, textAlign: 'center' },
  inputLabel: { color: '#aeb5c9', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  input: { backgroundColor: '#10131d', borderColor: '#353e58', borderRadius: 12, borderWidth: 1, color: '#f6f7fb', fontSize: 17, paddingHorizontal: 14, paddingVertical: 13 },
  codeInput: { fontSize: 28, fontWeight: '800', letterSpacing: 8, textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: '#e4bd67', borderRadius: 12, justifyContent: 'center', marginTop: 14, minHeight: 52, paddingHorizontal: 16 },
  primaryButtonText: { color: '#201b12', fontSize: 16, fontWeight: '800' },
  secondaryButton: { alignItems: 'center', borderColor: '#59627d', borderRadius: 12, borderWidth: 1, justifyContent: 'center', marginTop: 12, minHeight: 50, paddingHorizontal: 16 },
  secondaryButtonText: { color: '#d2d7e6', fontSize: 15, fontWeight: '700' },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { transform: [{ scale: 0.98 }] },
  connectionText: { color: '#7b8194', fontSize: 12, marginTop: 16, textAlign: 'center' },
  playerList: { borderTopColor: '#2b3349', borderTopWidth: 1, marginBottom: 4, paddingTop: 4 },
  playerRow: { alignItems: 'center', flexDirection: 'row', minHeight: 42 },
  connectionDot: { backgroundColor: '#71d39a', borderRadius: 5, height: 10, marginRight: 10, width: 10 },
  connectionDotOff: { backgroundColor: '#6b7184' },
  playerName: { color: '#f6f7fb', flex: 1, fontSize: 16 },
  hostBadge: { color: '#e4bd67', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  errorBanner: { backgroundColor: '#3a2028', borderColor: '#9e4e5c', borderRadius: 12, borderWidth: 1, marginBottom: 18, padding: 12 },
  errorTitle: { color: '#ffb7bf', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  errorText: { color: '#ffdfe3', fontSize: 14, marginTop: 4 },
  errorDismiss: { color: '#ffb7bf', fontSize: 11, marginTop: 8 },
  modalBackdrop: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.72)', flex: 1, justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#191e2c', borderColor: '#353e58', borderRadius: 20, borderWidth: 1, padding: 22, width: '100%' },
  modalTitle: { color: '#f6f7fb', fontSize: 24, fontWeight: '800' },
  modalSubtitle: { color: '#aeb5c9', fontSize: 14, marginBottom: 16, marginTop: 6 },
  modalCancel: { alignItems: 'center', marginTop: 8, padding: 12 },
});
