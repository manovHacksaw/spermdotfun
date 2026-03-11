# SPRMFUN — Live Multiplier Grid

SPRMFUN is a real-time, on-chain multiplier-grid betting game on the **Avalanche** blockchain. A live pointer scrolls across a 500-row grid, driven by the AVAX/USDT price feed. Players click cells in upcoming columns and stake SPRM tokens. When the pointer crosses a column, the server resolves every pending bet on-chain and pays out winners instantly.

---

## How It Works

1. The game server connects to Binance's AVAX/USDT price stream and translates price movements into vertical pointer movement across a 500-row grid.
2. Each column has a pre-determined winning row, decided by Chainlink VRF randomness (seeded every 15 columns).
3. Players place bets by clicking a cell in a future column. Bets are locked on-chain via the SPRM game contract.
4. When the pointer passes a column, the server evaluates all pending bets, signs a resolution payload, and calls `resolveBet()` on-chain. Winners are paid out immediately from the contract's house bank.

---

## Features

- **Real-time canvas grid** — 60 FPS client-side interpolation, 30 FPS server broadcast
- **Price-driven pointer** — AVAX/USDT price delta drives vertical movement with momentum physics
- **Chainlink VRF** — On-chain randomness determines each column's winning row
- **On-chain settlement** — Bets placed and resolved via `SprmGame.sol` on Avalanche Fuji
- **Session wallet** — Gasless instant bets using a client-side ephemeral keypair
- **SPRM token faucet** — 50 SPRM per 24 h on Fuji testnet
- **Global chat** — PubNub-powered real-time chat
- **Profile system** — Optional Supabase-backed stats, bet history, and referral tracking
- **Docker** — Multi-stage build for production deployment

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 19, React 19, TypeScript |
| Rendering | HTML5 Canvas (raw 2D context, no UI library) |
| Blockchain | Avalanche C-Chain (EVM), Solidity 0.8.24 |
| Token | ERC-20 (SPRM, 18 decimals) |
| Randomness | Chainlink VRF v2.5 |
| Wallet | RainbowKit + wagmi v2 + ethers.js v6 |
| Real-time | Node.js `ws` WebSocket server |
| Chat | PubNub |
| Containerisation | Docker (multi-stage) |

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- A browser wallet (MetaMask or any EVM wallet)
- Avalanche Fuji testnet funds (free from [faucet.avax.network](https://faucet.avax.network))

### 1 — Install dependencies

```bash
npm install
```

### 2 — Configure environment

Create a `.env.local` file (never commit it):

```dotenv
# Avalanche Fuji RPC
NEXT_PUBLIC_AVALANCHE_RPC=https://api.avax-test.network/ext/bc/C/rpc

# Game WebSocket (served by server.js on port 3001)
NEXT_PUBLIC_WS_URL=ws://localhost:3001

# Deployed contract addresses (Fuji)
NEXT_PUBLIC_CONTRACT_ADDRESS=0x9b0d5bA04F99808c953FDd782057c08B5d0F32Dc
NEXT_PUBLIC_SPRM_TOKEN_ADDRESS=0x9a30294499b8784b80096b6C6Dd87456972eCA70
NEXT_PUBLIC_SPRM_FAUCET_ADDRESS=0x50fEF1bCA8686302ca7Dac9D596aF121A288855B

# RainbowKit / WalletConnect
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<your-walletconnect-project-id>

# Server wallet — signs bet resolution payloads (keep secret)
SERVER_PRIVATE_KEY=0x<your-server-wallet-private-key>

# Chainlink VRF (Fuji)
VRF_ENABLED=true

# PubNub global chat (optional — chat panel hidden if absent)
NEXT_PUBLIC_PUBNUB_PUBLISH_KEY=<your-pubnub-publish-key>
NEXT_PUBLIC_PUBNUB_SUBSCRIBE_KEY=<your-pubnub-subscribe-key>

# Profile DB (optional — leaderboard works in-memory without this)
SUPABASE_DB_URL=postgresql://...
```

### 3 — Start the dev server

```bash
npm run dev    # Next.js on :3000 + WebSocket game server on :3001
```

Open [http://localhost:3000](http://localhost:3000).

### 4 — Get testnet tokens

Visit [http://localhost:3000/faucet](http://localhost:3000/faucet) to claim 50 SPRM from the deployed faucet contract.

---

## Production (Docker)

```bash
docker build -t sprmfun .

docker run -p 3000:3000 \
  -e SERVER_PRIVATE_KEY=0x... \
  -e NEXT_PUBLIC_CONTRACT_ADDRESS=0x... \
  -e NEXT_PUBLIC_SPRM_TOKEN_ADDRESS=0x... \
  -e VRF_ENABLED=true \
  sprmfun
```

---

## Project Structure

```
sprmfunv2/
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Root layout — Wagmi + RainbowKit providers
│   ├── page.tsx                # Home page — StockGrid, GameHUD, sidebars
│   ├── faucet/page.tsx         # SPRM faucet UI
│   ├── profile/page.tsx        # User profile page
│   └── api/                    # Next.js API routes
│       └── profile/            # Profile auth, stats, settings
├── components/
│   ├── StockGrid.tsx           # Canvas grid + WebSocket client (main game view)
│   ├── GameHUD.tsx             # Bet modal, session wallet, P/L display
│   ├── BetSidebar.tsx          # Live bet feed, deposit/withdraw UI
│   ├── TopHeader.tsx           # Wallet connect, volume, profile menu
│   ├── MultiplierBar.tsx       # Scrolling multiplier history ticker
│   ├── ChatSidebar.tsx         # PubNub global chat
│   ├── GlobalChat.tsx          # Chat component
│   ├── LeftRail.tsx            # Mobile sidebar toggle
│   ├── WalletProvider.tsx      # RainbowKit + Fuji network config
│   └── theme/spermTheme.ts     # Design tokens
├── context/
│   └── SessionWalletContext.tsx
├── hooks/
│   ├── useSessionWallet.ts     # Session wallet lifecycle
│   ├── useLiveGameStats.ts     # WebSocket leaderboard/active players
│   ├── useSprmBalance.ts       # On-chain SPRM balance polling
│   ├── useUsername.ts          # Persistent random username
│   └── useProfileData.ts      # Profile stats + auth
├── lib/
│   ├── sessionWallet.ts        # Session keypair localStorage persistence
│   ├── username.ts             # Random username generation
│   ├── friendlyError.ts        # Error message mapping
│   ├── profile/                # Profile client utilities
│   └── server/                 # Backend services (profile DB, vault)
├── avalanche-contracts/        # Solidity contracts + Hardhat
│   └── contracts/SprmfunGame.sol
├── scripts/
│   ├── profile-migrate.js      # Run DB migrations
│   └── profile-schema.sql      # Supabase schema
├── server.js                   # Node.js game server (WebSocket + HTTP)
├── Dockerfile
└── next.config.js
```

---

## Deployed Contracts (Fuji Testnet)

| Contract | Address |
|---|---|
| SprmGame | `0x9b0d5bA04F99808c953FDd782057c08B5d0F32Dc` |
| SprmToken (ERC-20) | `0x9a30294499b8784b80096b6C6Dd87456972eCA70` |
| SprmFaucet | `0x50fEF1bCA8686302ca7Dac9D596aF121A288855B` |
| Treasury / resolverSigner | `0x2D4575003f6017950C2f7a10aFb17bf2fBb648d2` |

---

## Docs

| Document | Description |
|---|---|
| [System Architecture](docs/system-architecture.md) | High-level component diagram and data flows |
| [Technical Architecture](docs/technical-architecture.md) | Stack details, module map, WebSocket protocol |
| [System Design](docs/system-design.md) | Grid model, VRF design, betting mechanics, token economics |
| [User Flow](docs/user-flow.md) | Step-by-step user journeys |
| [File Structure](docs/file-structure.md) | Annotated file tree with responsibilities |
| [Core Functions](docs/core-functions.md) | All major functions — inputs, outputs, side effects |

---

## Environment Variables Reference

| Variable | Where used | Purpose |
|---|---|---|
| `NEXT_PUBLIC_AVALANCHE_RPC` | Browser + server | Avalanche Fuji JSON-RPC endpoint |
| `NEXT_PUBLIC_WS_URL` | Browser | WebSocket URL for game server |
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | Browser + server | SprmGame contract address |
| `NEXT_PUBLIC_SPRM_TOKEN_ADDRESS` | Browser + server | SPRM ERC-20 token address |
| `NEXT_PUBLIC_SPRM_FAUCET_ADDRESS` | Browser | SprmFaucet contract address |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Browser | RainbowKit WalletConnect project ID |
| `SERVER_PRIVATE_KEY` | server.js only | Signs `resolveBet` payloads — keep secret |
| `VRF_ENABLED` | server.js | Enable Chainlink VRF (`true`) or local fallback (`false`) |
| `NEXT_PUBLIC_PUBNUB_PUBLISH_KEY` | Browser | PubNub publish key (optional) |
| `NEXT_PUBLIC_PUBNUB_SUBSCRIBE_KEY` | Browser | PubNub subscribe key (optional) |
| `SUPABASE_DB_URL` | server.js | PostgreSQL connection for profile DB (optional) |
| `NODE_ENV` | server.js | `production` enables Next.js optimised build |

> Never commit `.env.local` or private keys to version control.

---

## Licence

Private — all rights reserved.
