# The Mind Online

A production-oriented real-time multiplayer implementation of **The Mind** for iOS and Android.

The server is authoritative: clients never receive another player's card values. Each Socket.IO connection receives a personalized `ClientGameState`; room-wide events contain only information that is intentionally public, such as skipped cards after a mistake or cards revealed by a Ninja Star.

## Project layout

```text
shared/types.ts                 Shared state and Socket.IO protocol types
server/src/gameEngine.ts        Authoritative rules engine
server/src/roomManager.ts       Room codes, host ownership, reconnect grace
server/src/index.ts             Express + Socket.IO server
server/tests/                   Engine, room, and protocol integration tests
mobile/App.tsx                  Expo application entry
mobile/src/hooks/               Socket session and SecureStore persistence
mobile/src/screens/             Lobby and game-board screens
```

## Rules implemented

- One deck containing unique values 1–100.
- Two to four players per room.
- Player-count limits and level caps:
  - 2 players: 2 lives, 1 star, levels 1–12.
  - 3 players: 3 lives, 1 star, levels 1–10.
  - 4 players: 4 lives, 1 star, levels 1–8.
- Completion rewards at levels 2, 5, 8 (star) and 3, 6, 9 (life).
- Turnless play with server-side out-of-order checking.
- Ninja Star consensus among currently connected players.
- Four-character uppercase alphanumeric room codes.
- Reconnect tokens stored in Expo SecureStore and a 60-second server grace period by default.
- If a player does not reconnect during an active game, the game ends rather than silently changing the hidden-card state.

## Local development

From the repository root:

```bash
npm install
npm run dev:server
```

The server listens on `PORT` (default `3000`). Verify it with:

```bash
curl http://127.0.0.1:3000/healthz
```

Expected response:

```json
{"status":"ok"}
```

Start the Expo app in a second terminal:

```bash
EXPO_PUBLIC_SERVER_URL=http://127.0.0.1:3000 npm run start --workspace mobile
```

For a physical phone, use the computer's LAN address instead of `127.0.0.1`, for example:

```bash
EXPO_PUBLIC_SERVER_URL=http://192.168.1.20:3000 npm run start --workspace mobile
```

Then use `npm run ios --workspace mobile` or `npm run android --workspace mobile` after the native toolchains are installed.

## Web client

The same client runs in a browser. It uses `localStorage` for the reconnect session and connects directly to the Render Socket.IO server.

Build the static site locally:

```bash
npm run build:web
```

The existing Render Web Service builds and serves this client at its root URL:

```text
https://the-mind-multi.onrender.com/
```

Friends can open that URL from Safari, Chrome, or any desktop browser—no Expo Go or Mac is required.

## Verification commands

```bash
npm test --workspace server
npm run typecheck --workspace server
npm run build --workspace server
npm run typecheck --workspace mobile
```

The mobile bundle can be exercised without a simulator:

```bash
cd mobile
npx expo install --check
npx expo export --platform ios --platform android --output-dir /tmp/the-mind-export
```

## Production deployment

Set explicit configuration in the server environment:

```bash
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://your-mobile-web-origin.example
RECONNECT_GRACE_MS=60000
```

Terminate TLS at the load balancer or reverse proxy and expose the server through HTTPS/WSS. Do not use `http://localhost` in a production mobile build.

This implementation intentionally stores rooms in one process-local `Map`, matching the requested lightweight architecture. A horizontally scaled deployment must add a shared room/state store and a Socket.IO adapter (typically Redis), plus sticky or adapter-backed connection routing. Without that, two server replicas can assign the same room to different processes.

## Security notes

- The reconnect token is generated with `crypto.randomBytes` and is never accepted as a player id.
- Room codes are validated server-side and generated with collision checks.
- Names, cards, votes, and room codes are validated before entering the engine.
- The server never broadcasts `GameState` directly. `getClientState(targetPlayerId)` masks every opponent hand.
- The client does not decide whether a card is legal, whether a life was lost, or whether a star triggered.
- Configure `CORS_ORIGIN` explicitly in production; development defaults to permissive CORS for local devices.

## Protocol flow

1. `CREATE_ROOM` or `JOIN_ROOM` establishes a session.
2. The server emits `ROOM_CREATED` or `ROOM_JOINED` with the reconnect token and the caller's masked state.
3. `START_GAME` is host-only.
4. `PLAY_CARD`, `VOTE_STAR`, and `NEXT_LEVEL` are validated by the engine.
5. A state update is sent individually to every connected socket after each accepted action.
6. `LIFE_LOST`, `STAR_TRIGGERED`, `ROUND_WON`, and `GAME_OVER` are room-wide public events.

See `shared/types.ts` for the exact TypeScript event signatures.
