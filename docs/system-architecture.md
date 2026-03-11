# System Architecture

This document describes the high-level architecture of SPRMFUN: the major subsystems, how they communicate, and where each responsibility lives.

---

## Overview

SPRMFUN has three runtime processes:

| Process | Port | Technology | Responsibility |
|---|---|---|---|
| **Game server** | 3001 (WS) | Node.js `server.js` | Price feed, game loop, bet registration, on-chain resolution |
| **Next.js server** | 3000 (HTTP) | Next.js 19 | Frontend, API routes (profile) |
| **Avalanche node** | external | Fuji RPC | Smart contract state, token balances, VRF |

In production, `server.js` starts the Next.js custom HTTP server on port 3000 and the WebSocket game server on port 3001. Both share the same Node.js process.

---

## High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          Browser                                 │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  StockGrid   │  │   GameHUD    │  │  BetSidebar /        │  │
│  │  (canvas)    │  │  (bet modal) │  │  TopHeader /         │  │
│  └──────┬───────┘  └──────┬───────┘  │  ChatSidebar         │  │
│         │                 │          └──────────────────────┘  │
│         │  WebSocket      │  wagmi / ethers.js                  │
└─────────┼─────────────────┼──────────────────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────┐   ┌─────────────────────────────────────────┐
│  server.js      │   │         Avalanche Fuji (EVM)            │
│                 │   │                                         │
│  WebSocket      │   │  ┌──────────────┐  ┌────────────────┐  │
│  game server    │──▶│  │  SprmGame    │  │  SprmToken     │  │
│  :3001          │   │  │  (contract)  │  │  (ERC-20)      │  │
│                 │   │  └──────────────┘  └────────────────┘  │
│  ┌──────────┐   │   │                                         │
│  │ Price    │   │   │  ┌──────────────────────────────────┐  │
│  │ feed     │   │   │  │  Chainlink VRF v2.5              │  │
│  │ (Binance │   │   │  │  (randomness oracle)             │  │
│  │  WS)     │   │   │  └──────────────────────────────────┘  │
│  └──────────┘   │   └─────────────────────────────────────────┘
│                 │
│  ┌──────────┐   │   ┌──────────────────┐
│  │ Profile  │──▶│   │  Supabase        │
│  │ service  │   │   │  (PostgreSQL)    │
│  └──────────┘   │   │  optional        │
└─────────────────┘   └──────────────────┘
```

---

## Data Flow: Bet Lifecycle

```
Player clicks cell
        │
        ▼
  StockGrid fires
  sprmfun:select event
        │
        ▼
  GameHUD shows
  confirmation modal
        │
        ▼
  User confirms ──► wagmi: call contract.placeBet()
                           (transfers SPRM to contract)
        │
        ▼
  On tx confirmed:
  POST /register-bet ──► server.js stores in pendingBets
        │
        ▼
  Game pointer
  crosses column
        │
        ▼
  server.js resolveBet()
    ├── Determine win/lose (pointer row vs bet row ±2 forgiveness)
    ├── Sign payload: keccak256(betId, won, contractAddress)
    ├── Call contract.resolveBet(betId, won, serverSig)
    └── Broadcast bet_resolved via WebSocket
        │
        ▼
  StockGrid / GameHUD
  show win/lose popup
```

---

## Data Flow: Price → Pointer

```
Binance WS (AVAX/USDT ticker)
        │
        ▼
  server.js: currentAvaxPrice updated
        │
        ▼
  stepSim() at 30 Hz:
    priceDelta = currentPrice - prevPrice
    velocity += priceDelta × PRICE_CHAOS_FACTOR × INERTIA
    velocity *= FRICTION
    simY = clamp(simY + velocity, -50, +50)
    ── VRF steering bias applied when column approaching exit
        │
        ▼
  Broadcast {type:"pointer", y, currentX, price}
        │
        ▼
  StockGrid: 60 Hz interpolation
    alpha = elapsed / 100ms
    drawY = lerp(prevY, currY, alpha)
```

---

## Data Flow: VRF Randomness

```
server.js crosses VRF_REFRESH_COLS (15) columns
        │
        ▼
  If VRF_ENABLED=true:
    contract.requestVrf() ──► Chainlink VRF Coordinator
                                      │
                              (async, ~1–2 blocks)
                                      ▼
                       contract.fulfillRandomWords()
                       emits VrfFulfilled(epochId, requestId, vrfResult)
        │
        ▼
  server.js subscribeVrfEvents() receives vrfResult
        │
        ▼
  For each column c in [startColX, startColX + 15 × 50px]:
    winRow = deriveWinningRow(vrfResult, c)
    vrfPath[c] = winRow
        │
        ▼
  Broadcast {type:"vrf_state", paths: [...]}
        │
        ▼
  Pointer steering: when pointer enters column c,
    steerTarget = rowToY(winRow)
    elastic pull applied over ~60% of column width
```

---

## In-Memory State (server.js)

All game state is held in memory and rebuilt from the live price feed on restart. There is no persistent game-state database — only the optional Supabase profile DB for player statistics.

| Variable | Type | Contents |
|---|---|---|
| `currentAvaxPrice` | number | Latest AVAX/USDT price |
| `simY` | number | Pointer Y position (−50 to +50) |
| `simVelocity` | number | Current vertical velocity |
| `serverCurrentX` | number | Pointer X pixel position |
| `allColumns` | Column[] | All generated columns (max 400) |
| `historyBuffer` | Point[] | Recent pointer trail (max 2800) |
| `pendingBets` | Map | betId → bet details |
| `vrfPath` | Map | colX → winning row |
| `columnRowRange` | Map | colX → {minRow, maxRow} visited |
| `leaderboard` | Map | address → player stats |
| `bettingPaused` | boolean | True when price feed is stale >5 s |

---

## Session Wallet Architecture

The session wallet enables gasless instant bets without MetaMask prompts per bet.

```
User's main wallet (MetaMask)
        │
        ├── Sends 0.05 AVAX ──► Session wallet (ephemeral keypair in localStorage)
        │
        └── Transfers SPRM ──► Session wallet SPRM balance
                                        │
                                        ▼
                              Session wallet auto-approves
                              MAX_UINT256 on game contract
                                        │
                                        ▼
                              Per bet: session key signs tx locally
                              (no MetaMask popup, instant UX)
                                        │
                                        ▼
                              contract.placeBet() called from session wallet
```

The session private key is stored in `localStorage` under `sprmfun:session_evm_key`. It never leaves the browser.

---

## Profile System (Optional)

If `SUPABASE_DB_URL` is not set, the server runs in-memory-only mode with no persistent stats.

When enabled:
- `lib/server/profile-service.js` connects to Supabase on startup
- Resolved bets are enqueued and flushed to `profile_transactions` every 2.5 s
- Profile API routes (`/api/profile/*`) serve auth, stats, settings, and leaderboard
- Auth uses EVM personal_sign challenge: browser signs a nonce, server verifies with `ethers.verifyMessage()`
