import { useEffect, useRef } from 'react';
import {
  Animated,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import type { ClientGameState, ErrorPayload } from '../../../shared/types';
import type { GameFeedback } from '../hooks/useGameSession';

export interface GameBoardScreenProps {
  state: ClientGameState;
  feedback: GameFeedback | null;
  error: ErrorPayload | null;
  onPlayCard: (card: number) => void;
  onVoteStar: (vote: boolean) => void;
  onNextLevel: () => void;
  onLeaveRoom: () => void;
  onClearError: () => void;
  onClearFeedback: () => void;
}

export function GameBoardScreen({
  state,
  feedback,
  error,
  onPlayCard,
  onVoteStar,
  onNextLevel,
  onLeaveRoom,
  onClearError,
  onClearFeedback,
}: GameBoardScreenProps): JSX.Element {
  const shake = useRef(new Animated.Value(0)).current;
  const otherPlayers = state.players.filter((player) => player.id !== state.myPlayer.id);
  const canPlay = state.status === 'PLAYING';
  const canVoteStar = canPlay && state.stars > 0;
  const isRoundSuccess = state.status === 'ROUND_SUCCESS';
  const isFinal = state.status === 'COMPLETED';
  const isGameOver = state.status === 'GAME_OVER';

  useEffect(() => {
    if (!feedback) return;
    if (feedback.kind === 'LIFE_LOST' || feedback.kind === 'GAME_OVER') {
      Animated.sequence([
        Animated.timing(shake, { duration: 55, toValue: -8, useNativeDriver: true }),
        Animated.timing(shake, { duration: 55, toValue: 8, useNativeDriver: true }),
        Animated.timing(shake, { duration: 55, toValue: -5, useNativeDriver: true }),
        Animated.timing(shake, { duration: 55, toValue: 5, useNativeDriver: true }),
        Animated.timing(shake, { duration: 55, toValue: 0, useNativeDriver: true }),
      ]).start();
    }
  }, [feedback, shake]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <View>
            <Text style={styles.roomLabel}>ROOM {state.roomCode}</Text>
            <Text style={styles.levelText}>LEVEL {state.level}<Text style={styles.levelMax}> / {state.maxLevel}</Text></Text>
          </View>
          <View style={styles.resourceRow}>
            <View style={styles.resourceGroup}>
              <Text style={styles.resourceIcon}>♥</Text>
              <Text style={styles.resourceCount}>{state.lives}</Text>
            </View>
            <View style={styles.resourceGroup}>
              <Text style={styles.resourceIcon}>★</Text>
              <Text style={styles.resourceCount}>{state.stars}</Text>
            </View>
          </View>
        </View>

        {error ? (
          <Pressable accessibilityRole="alert" onPress={onClearError} style={styles.errorBanner}>
            <Text style={styles.errorText}>{error.message}</Text>
            <Text style={styles.dismissText}>Tap to dismiss</Text>
          </Pressable>
        ) : null}

        {feedback ? (
          <Pressable
            accessibilityRole="alert"
            onPress={onClearFeedback}
            style={[
              styles.feedbackBanner,
              feedback.kind === 'LIFE_LOST' || feedback.kind === 'GAME_OVER'
                ? styles.feedbackDanger
                : styles.feedbackSuccess,
            ]}
          >
            <Text style={styles.feedbackText}>{feedback.message}</Text>
          </Pressable>
        ) : null}

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View style={[styles.mainArea, { transform: [{ translateX: shake }] }]}>
            <View style={styles.playersPanel}>
              <Text style={styles.sectionLabel}>YOUR TEAM</Text>
              {otherPlayers.length === 0 ? (
                <Text style={styles.mutedText}>Waiting for teammates…</Text>
              ) : (
                otherPlayers.map((player) => (
                  <View key={player.id} style={styles.otherPlayer}>
                    <View style={[styles.avatar, !player.connected && styles.avatarOffline]}>
                      <Text style={styles.avatarText}>{player.name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={styles.playerDetails}>
                      <Text style={styles.otherPlayerName} numberOfLines={1}>{player.name}</Text>
                      <Text style={styles.cardCountText}>
                        {player.connected ? `${player.cardCount} card${player.cardCount === 1 ? '' : 's'}` : 'reconnecting…'}
                      </Text>
                    </View>
                    {state.starVotes[player.id] ? <Text style={styles.voteMark}>✓</Text> : null}
                  </View>
                ))
              )}
            </View>

            <View style={styles.pilePanel}>
              <Text style={styles.sectionLabel}>DISCARD PILE · {state.discardCount}</Text>
              <View style={styles.pileShadow}>
                <View style={styles.pileCard}>
                  <Text style={styles.pileCardText}>{state.discardTop ?? '—'}</Text>
                </View>
              </View>
              <Text style={styles.pileHint}>{canPlay ? 'Play when the moment feels right.' : 'The team is between levels.'}</Text>
            </View>
          </Animated.View>

          <View style={styles.handPanel}>
            <View style={styles.handHeader}>
              <Text style={styles.sectionLabel}>YOUR HAND</Text>
              <Text style={styles.handCount}>{state.myPlayer.hand.length} cards</Text>
            </View>
            <View style={styles.handWrap}>
              {state.myPlayer.hand.length === 0 ? (
                <Text style={styles.mutedText}>Your hand is empty. Stay focused.</Text>
              ) : (
                state.myPlayer.hand.map((card) => (
                  <Pressable
                    accessibilityLabel={`Play card ${card}`}
                    accessibilityRole="button"
                    disabled={!canPlay}
                    key={card}
                    onPress={() => onPlayCard(card)}
                    style={({ pressed }) => [
                      styles.handCard,
                      !canPlay && styles.handCardDisabled,
                      pressed && styles.handCardPressed,
                    ]}
                  >
                    <Text style={styles.handCardText}>{card}</Text>
                  </Pressable>
                ))
              )}
            </View>
          </View>
        </ScrollView>

        <View style={styles.actionBar}>
          {canPlay ? (
            <Pressable
              accessibilityLabel={state.myStarVote ? 'Cancel Ninja Star vote' : 'Vote to use a Ninja Star'}
              accessibilityRole="button"
              disabled={!canVoteStar}
              onPress={() => onVoteStar(!state.myStarVote)}
              style={({ pressed }) => [
                styles.starButton,
                state.myStarVote && styles.starButtonActive,
                !canVoteStar && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.starButtonIcon}>★</Text>
              <Text style={styles.starButtonText}>{state.myStarVote ? 'Vote Submitted' : 'Throwing Star'}</Text>
            </Pressable>
          ) : null}
          {isRoundSuccess && state.myPlayer.isHost ? (
            <Pressable accessibilityRole="button" onPress={onNextLevel} style={styles.primaryAction}>
              <Text style={styles.primaryActionText}>Start Level {state.level + 1}</Text>
            </Pressable>
          ) : null}
          {(isFinal || isGameOver) ? (
            <Pressable accessibilityRole="button" onPress={onLeaveRoom} style={styles.primaryAction}>
              <Text style={styles.primaryActionText}>{isFinal ? 'Return to Lobby' : 'Leave Game'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#10131d', flex: 1 },
  screen: { flex: 1 },
  topBar: { alignItems: 'center', borderBottomColor: '#2b3349', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 15 },
  roomLabel: { color: '#7b8194', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  levelText: { color: '#f6f7fb', fontSize: 25, fontWeight: '900', marginTop: 2 },
  levelMax: { color: '#7b8194', fontSize: 14, fontWeight: '600' },
  resourceRow: { flexDirection: 'row', gap: 16 },
  resourceGroup: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  resourceIcon: { color: '#e4bd67', fontSize: 22 },
  resourceCount: { color: '#f6f7fb', fontSize: 18, fontWeight: '800' },
  content: { padding: 20, paddingBottom: 20 },
  mainArea: { gap: 16 },
  playersPanel: { backgroundColor: '#191e2c', borderColor: '#2b3349', borderRadius: 16, borderWidth: 1, padding: 15 },
  sectionLabel: { color: '#8f98b5', fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  mutedText: { color: '#7b8194', fontSize: 14, paddingVertical: 14 },
  otherPlayer: { alignItems: 'center', flexDirection: 'row', marginTop: 13 },
  avatar: { alignItems: 'center', backgroundColor: '#4a5475', borderRadius: 17, height: 34, justifyContent: 'center', width: 34 },
  avatarOffline: { backgroundColor: '#424656' },
  avatarText: { color: '#f6f7fb', fontSize: 14, fontWeight: '800' },
  playerDetails: { flex: 1, marginLeft: 10 },
  otherPlayerName: { color: '#f6f7fb', fontSize: 15, fontWeight: '700' },
  cardCountText: { color: '#8f98b5', fontSize: 12, marginTop: 2 },
  voteMark: { color: '#71d39a', fontSize: 20, fontWeight: '800' },
  pilePanel: { alignItems: 'center', paddingVertical: 8 },
  pileShadow: { backgroundColor: '#1b2234', borderRadius: 17, marginTop: 14, padding: 8, transform: [{ rotate: '-3deg' }] },
  pileCard: { alignItems: 'center', backgroundColor: '#f6f7fb', borderRadius: 12, height: 148, justifyContent: 'center', width: 106 },
  pileCardText: { color: '#1a2030', fontSize: 46, fontWeight: '900' },
  pileHint: { color: '#7b8194', fontSize: 12, marginTop: 10 },
  handPanel: { backgroundColor: '#191e2c', borderColor: '#2b3349', borderRadius: 16, borderWidth: 1, marginTop: 20, padding: 15 },
  handHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  handCount: { color: '#7b8194', fontSize: 12 },
  handWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 15 },
  handCard: { alignItems: 'center', backgroundColor: '#f6f7fb', borderRadius: 11, elevation: 3, height: 64, justifyContent: 'center', minWidth: 56, paddingHorizontal: 10, shadowColor: '#000', shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.25, shadowRadius: 4 },
  handCardText: { color: '#1a2030', fontSize: 20, fontWeight: '900' },
  handCardDisabled: { opacity: 0.5 },
  handCardPressed: { transform: [{ translateY: 3 }, { scale: 0.97 }] },
  actionBar: { borderTopColor: '#2b3349', borderTopWidth: 1, padding: 16 },
  starButton: { alignItems: 'center', backgroundColor: '#2b3349', borderColor: '#59627d', borderRadius: 13, borderWidth: 1, flexDirection: 'row', justifyContent: 'center', minHeight: 54 },
  starButtonActive: { backgroundColor: '#4e4224', borderColor: '#e4bd67' },
  starButtonIcon: { color: '#e4bd67', fontSize: 22, marginRight: 8 },
  starButtonText: { color: '#f6f7fb', fontSize: 16, fontWeight: '800' },
  primaryAction: { alignItems: 'center', backgroundColor: '#e4bd67', borderRadius: 13, justifyContent: 'center', minHeight: 54 },
  primaryActionText: { color: '#201b12', fontSize: 16, fontWeight: '800' },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { transform: [{ scale: 0.98 }] },
  errorBanner: { backgroundColor: '#3a2028', borderColor: '#9e4e5c', borderRadius: 10, borderWidth: 1, marginHorizontal: 20, marginTop: 12, padding: 10 },
  errorText: { color: '#ffdfe3', fontSize: 13 },
  dismissText: { color: '#ffb7bf', fontSize: 10, marginTop: 4 },
  feedbackBanner: { borderRadius: 10, marginHorizontal: 20, marginTop: 12, padding: 11 },
  feedbackDanger: { backgroundColor: '#3a2028', borderColor: '#9e4e5c', borderWidth: 1 },
  feedbackSuccess: { backgroundColor: '#203a35', borderColor: '#4a9d80', borderWidth: 1 },
  feedbackText: { color: '#f6f7fb', fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
