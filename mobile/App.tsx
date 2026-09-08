import { View } from 'react-native';
import { LobbyScreen } from './src/screens/LobbyScreen';
import { GameBoardScreen } from './src/screens/GameBoardScreen';
import { useGameSession } from './src/hooks/useGameSession';

export default function App(): JSX.Element {
  const session = useGameSession();
  const gameState = session.gameState;

  if (gameState && gameState.status !== 'LOBBY') {
    return (
      <GameBoardScreen
        error={session.error}
        feedback={session.feedback}
        onClearError={session.clearError}
        onClearFeedback={session.clearFeedback}
        onLeaveRoom={session.leaveRoom}
        onNextLevel={session.nextLevel}
        onPlayCard={session.playCard}
        onVoteStar={session.voteStar}
        state={gameState}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <LobbyScreen
        connected={session.connected}
        error={session.error}
        initialPlayerName={session.session?.playerName ?? ''}
        onClearError={session.clearError}
        onCreateRoom={session.createRoom}
        onJoinRoom={session.joinRoom}
        onLeaveRoom={session.leaveRoom}
        onStartGame={session.startGame}
        restoring={session.restoring}
        state={gameState}
      />
    </View>
  );
}
