# Technical Architecture

This document describes the technical stack, module boundaries, WebSocket protocol, and key implementation decisions in SPRMFUN.

---

## Technology Stack

| Concern | Technology | Version | Notes |
|---|---|---|---|
| Frontend framework | Next.js | ^16.1.6 | App Router; React 19 |
| Language | TypeScript | ^5 | Strict mode on frontend |
| Rendering | HTML5 Canvas | — | Raw 2D context; no UI library |
| Blockchain SDK | wagmi | 2 | React hooks for EVM |
| EVM library | ethers.js | ^6.13.0 | Provider, Wallet, Contract |
| Wallet UI | RainbowKit | ^2.2.10 | MetaMask, WalletConnect, etc. |
| Smart contract | Solidity | 0.8.24 | `evmVersion: cancun`, `viaIR: true` |
| Randomness | Chainlink VRF | v2.5 | Fuji VRF Coordinator |
| Real-time transport | `ws` | ^8.18.0 | Node.js WebSocket server |
| Chat | PubNub | ^10.2.7 | Browser SDK |
| HTTP queries | @tanstack/react-query | ^5.90.21 | Profile API data fetching |
| Icons | lucide-react | ^0.575.0 | |
| Profile DB | Supabase (PostgreSQL) | — | Optional; `pg` driver |
| Containerisation | Docker | — | Multi-stage build |
| Config | dotenv | ^17.3.1 | Loaded in `server.js` |

---

## Module Map

```
server.js (Node.js)
├── initEvm()                  ethers.js provider + signer + contracts
├── initBinance()              Binance WebSocket price feed
├── stepSim()                  30Hz game loop
├── resolveBet()               on-chain bet settlement
├── refreshVrfLocally()        Chainlink VRF epoch management
└── profileService             Supabase integration (optional)

app/ (Next.js)
├── layout.tsx                 WalletProvider (wagmi + RainbowKit)
├── page.tsx                   Main game page
├── faucet/page.tsx            Token faucet
├── profile/page.tsx           Profile stats page
└── api/profile/               Profile REST API routes

components/
├── StockGrid.tsx              Game canvas + WebSocket client
├── GameHUD.tsx                Bet modal + session wallet UI
├── BetSidebar.tsx             Deposit/withdraw + live bet feed
├── TopHeader.tsx              Wallet button + profile menu
├── MultiplierBar.tsx          Scrolling multiplier history
└── ChatSidebar.tsx / GlobalChat.tsx   PubNub chat

hooks/
├── useSessionWallet.ts        Session wallet state + transactions
├── useLiveGameStats.ts        WebSocket leaderboard/active players
├── useSprmBalance.ts          On-chain ERC-20 balance polling
├── useUsername.ts             Persistent random username
└── useProfileData.ts          Profile API + auth challenge flow

lib/
├── sessionWallet.ts           localStorage keypair helpers
├── username.ts                Username generation + storage
├── friendlyError.ts           Error message mapping
├── profile/clientAuth.ts      EVM challenge-signature auth flow
└── server/profile-service.js  Supabase queries + bet recording
```

---

## WebSocket Protocol

The game server broadcasts at ~30 FPS (every 33 ms). All messages are JSON.

### Server → Client

#### `init` — sent once on connection

```json
{
  "type": "init",
  "columns": [ { "id": "g12345", "x": 12500, "boxes": [ ... ] } ],
  "history": [ { "x": 100, "y": 0.12 }, ... ],
  "currentX": 15000,
  "price": 54.32,
  "vrfPaths": { "12500": 247, "13000": 183, ... }
}
```

#### `pointer` — every 33 ms

```json
{
  "type": "pointer",
  "y": -0.123,
  "currentX": 15050,
  "price": 54.35,
  "microVelocity": 12500,
  "timestamp": 1710123456789
}
```

`y` is normalised to [−1, +1] (maps to [row 0, row 499]).
`microVelocity` is short-EMA deviation × 1 000 000; used by the client for sub-grid sperm-head animation.

#### `grid` — when new columns are generated

```json
{
  "type": "grid",
  "columns": [
    {
      "id": "g12600",
      "x": 12600,
      "boxes": [
        { "id": "b12600-0", "multiplier": 1.23, "mult_num": 123, "mult_den": 100 },
        ...499 more
      ]
    }
  ]
}
```

#### `bet_resolved`

```json
{
  "type": "bet_resolved",
  "betId": "42",
  "user": "0xAbCd...1234",
  "won": true,
  "payout": 24.5,
  "colX": 12500,
  "row": 247
}
```

#### `bet_receipt` — after on-chain confirmation

```json
{
  "type": "bet_receipt",
  "betId": "42",
  "txHash": "0xabc...",
  "won": true
}
```

#### `leaderboard`

```json
{
  "type": "leaderboard",
  "entries": [
    { "address": "0x...", "shortAddr": "Ab12…XYZw", "wins": 14, "losses": 6, "totalBet": 500, "totalPayout": 720 }
  ]
}
```

#### `active_players`

```json
{
  "type": "active_players",
  "players": [
    { "address": "0x...", "shortAddr": "Ab12…XYZw", "pendingBets": 2, "lastBetAt": 1710123456000 }
  ],
  "count": 3
}
```

#### `house_bank`

```json
{ "type": "house_bank", "balance": 987654.32 }
```

#### `market_paused` / `market_resumed`

```json
{ "type": "market_paused", "reason": "price_feed_stale" }
{ "type": "market_resumed" }
```

#### `vrf_state`

```json
{
  "type": "vrf_state",
  "paths": [
    { "colX": 12500, "row": 247 },
    { "colX": 12550, "row": 251 }
  ]
}
```

#### `mult_history`

```json
{
  "type": "mult_history",
  "entries": [ { "colX": 12000, "mult": 3.5 }, ... ]
}
```

---

### Client → Server

#### `register_bet` (via HTTP POST, not WebSocket)

```
POST /register-bet
Content-Type: application/json

{
  "betId": "42",
  "user": "0xAbCd...1234",
  "box_x": 12500,
  "box_row": 247,
  "mult_num": 350,
  "bet_amount": 10.0
}
```

Response: `{ "ok": true }` or `{ "ok": false, "error": "market_paused" }`

#### `ghost_select` (WebSocket)

```json
{ "type": "ghost_select",   "colX": 12500, "row": 247, "shortAddr": "Ab12…XYZw" }
{ "type": "ghost_deselect", "colX": 12500, "row": 247, "shortAddr": "Ab12…XYZw" }
```

Ghost selections are broadcast to all other clients as a social signal of where other players are hovering.

---

## Custom DOM Events (StockGrid ↔ GameHUD)

StockGrid and GameHUD communicate via `window.dispatchEvent` / `window.addEventListener`. This avoids prop-drilling through the page layout.

| Event | Direction | Payload |
|---|---|---|
| `sprmfun:select` | StockGrid → GameHUD | `{ colX, row, multiplier, multNum, multDen }` |
| `sprmfun:deselect` | StockGrid → GameHUD | `{}` |
| `sprmfun:settings` | BetSidebar → GameHUD | `{ preset, quickBet }` |

---

## Smart Contract Interface

**File:** `avalanche-contracts/contracts/SprmfunGame.sol`
**Compiler:** Solidity 0.8.24, `evmVersion: cancun`, `viaIR: true`

### Key Functions

```solidity
// Place a bet — transfers `amount` SPRM from caller to contract
function placeBet(
    uint32 boxX,       // Column X pixel coordinate
    uint16 boxRow,     // Row index (0–499)
    uint16 multNum,    // Multiplier numerator (e.g. 350 = 3.50×)
    uint256 amount     // SPRM amount in wei (18 decimals)
) external returns (uint256 betId)

// Resolve a bet — only callable by resolverSigner
function resolveBet(
    uint256 betId,
    bool won,
    bytes calldata serverSig  // ECDSA sig over keccak256(betId, won, address(this))
) external

// Request Chainlink VRF entropy — called by server every 15 columns
function requestVrf() external returns (uint256 requestId)

// Chainlink callback — automatic, not called directly
function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override
```

### Key Events

```solidity
event BetPlaced(uint256 indexed betId, address indexed player, uint32 boxX, uint16 boxRow, uint16 multNum, uint256 amount)
event BetResolved(uint256 indexed betId, address indexed player, bool won, uint256 payout)
event VrfRequested(uint256 indexed epochId, uint256 indexed requestId)
event VrfFulfilled(uint256 indexed epochId, uint256 indexed requestId, bytes32 vrfResult)
```

---

## Rate Limiting

The `/register-bet` endpoint is rate-limited at **60 requests per minute per IP**.

Implemented with a simple in-memory `Map<ip, { count, resetAt }>` in `server.js`. No external dependency needed.

---

## Feed Staleness Detection

The server checks price feed freshness every tick (10 Hz loop):

```
if (Date.now() - lastPriceTick > PRICE_STALE_MS) {   // PRICE_STALE_MS = 5000
    bettingPaused = true
    broadcast({ type: "market_paused", reason: "price_feed_stale" })
}
```

- New bets are rejected with HTTP 503 `{ ok: false, error: "market_paused" }` while paused.
- Active pending bets resolve against the last valid pointer position when the feed recovers.
- A grey overlay and "FEED PAUSED" text are rendered on the client canvas.

---

## Build Pipeline

```bash
# Development
npm run dev       # node server.js → starts Next.js dev server + WS game server

# Production
npm run build     # next build
npm run start     # NODE_ENV=production node server.js

# Docker
docker build -t sprmfun .
docker run -p 3000:3000 sprmfun

# Profile DB migrations
npm run migrate:profile   # node scripts/profile-migrate.js
```

### Dockerfile

Multi-stage build:
1. `deps` — Install `node_modules`
2. `builder` — Run `next build`
3. `runner` — Copy `.next/` + `node_modules/`, start `server.js`

Port 3000 is exposed. The WebSocket game server runs on port 3001 internally (same process as Next.js via `server.js`).
