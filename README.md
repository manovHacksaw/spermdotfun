# SPRMFUN — Live Multiplier Grid

SPRMFUN is a real-time, on-chain multiplier-grid betting game deployed to the [Avalanche](https://avax.network) C‑Chain. A live pointer scrolls across a 10‑row grid; players click cells in future columns and stake SPRM tokens. When the pointer crosses a column, the server resolves every pending bet on-chain and pays out winners immediately.

---

## Features

- **Real-time canvas grid** rendered at ~30 fps via `requestAnimationFrame`
- **Avalanche smart contract** (Solidity) for trustless bet placement and payout
- **Server-side VRF** (SHA-256 based) determines each column's winning row
- **SPRM token faucet** — players can claim free tokens on localnet / devnet
- **Global chat** powered by PubNub; hover a username to see their SPRM balance
- **Background music** with mute toggle
- **Docker** multi-stage build for production deployment

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript |
| Rendering | HTML5 Canvas (no UI library) |
| Blockchain | Avalanche C‑Chain (Solidity) |
| Token | SPL Token (SPRM, 9 decimals) |
| Real-time | Node.js `ws` WebSocket server |
| Chat | PubNub |
| Wallet | Ethers-compatible (MetaMask, etc.) |
| Containerisation | Docker (multi-stage) |

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- An Avalanche-compatible wallet private key (e.g. MetaMask) or a JSON keystore file
- A running Avalanche local node (Anvil/Hardhat/Avash) **or** a devnet RPC endpoint

### 1 — Install dependencies

```bash
npm install
```

### 2 — Configure environment

Create a `.env.local` file (never commit it):

```dotenv
# Avalanche RPC used by the browser wallet adapter
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899

# WebSocket URL broadcast by the game server
NEXT_PUBLIC_WS_URL=ws://localhost:3001

# PubNub keys for global chat (optional — chat is hidden when keys are absent)
NEXT_PUBLIC_PUBNUB_PUBLISH_KEY=<your-pubnub-publish-key>
NEXT_PUBLIC_PUBNUB_SUBSCRIBE_KEY=<your-pubnub-subscribe-key>

# Server-side RPC (used by server.js and scripts)
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
ANCHOR_WALLET=~/.config/solana/id.json
```

### 3 — (First time) Initialise on-chain state

```bash
# local network
node scripts/init-devnet.js

# public testnet
# set NEXT_PUBLIC_RPC_URL to the chosen Avalanche RPC before running
NEXT_PUBLIC_RPC_URL=https://api.avax-test.network node scripts/init-devnet.js
```

### 4 — (Optional) Pre-fund the escrow

```bash
node scripts/prefund-escrow.js
```

### 5 — Start the dev server

```bash
npm run dev          # Next.js on :3000 + WebSocket on :3001
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Production (Docker)

```bash
docker build -t sprmfun .

# Mount your wallet keypair at runtime — never bake secrets into the image
docker run -p 3000:3000 -p 3001:3001 \
  -v /path/to/id.json:/app/wallet.json \
  -e ANCHOR_WALLET=/app/wallet.json \
  -e ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
  sprmfun
```

---

## Project Structure

```
sprmfunv2/
├── app/                     # Next.js App Router
│   ├── layout.tsx           # Root layout — wraps WalletContextProvider
│   ├── page.tsx             # Home page — renders StockGrid + GameHUD + GlobalChat
│   ├── globals.css          # Global styles
│   └── api/
│       ├── airdrop/route.ts # POST /api/airdrop — localnet AVAX faucet
│       └── idl/route.ts     # GET  /api/idl    — (legacy) serves compiled IDL
├── components/
│   ├── StockGrid.tsx        # Canvas-rendered live grid + WebSocket client
│   ├── GameHUD.tsx          # Wallet UI, bet modal, faucet, side panel
│   ├── GlobalChat.tsx       # PubNub chat panel
│   └── WalletProvider.tsx   # Ethers/Web3 wallet context (MetaMask)
├── scripts/
│   ├── init-devnet.js       # One-shot on-chain initialisation
│   └── prefund-escrow.js    # Pre-fund escrow with SPRM tokens
├── server.js                # Node.js: Next.js server + WebSocket game server
├── avalanche-contracts/     # Solidity contracts and tests for Avalanche
│   ├── src/
│   │   ├── SprmGame.sol
│   │   └── ...
│   ├── tests/
│   │   └── ...
│   └── foundry.toml
├── Dockerfile
├── next.config.js
└── tsconfig.json
```

---

## Smart Contract

The on-chain logic lives in the `avalanche-contracts/` directory and is written in Solidity. Contracts are deployed to the Avalanche C‑Chain; the server interacts with them via `ethers.js`.

| Function | Description |
|---|---|
| `initialize()` | Sets up global state (house edge, VRF seed, etc.) |
| `faucet()` | Mints SPRM tokens to caller (test networks only) |
| `placeBet()` | User locks tokens on a grid cell |
| `resolveBet()` | Authority resolves and pays out a bet |
| `sweepEscrow()` | Admin drains escrow to treasury |

(Note: previous Solana/Anchor code remains in `sprmfun-anchor/` for reference but is no longer used.)

---

## Docs

| Document | Description |
|---|---|
| [Architecture](docs/architecture.md) | High-level component overview and component interactions |
| [Technical Architecture](docs/technical-architecture.md) | Stack, data flows, inter-process communication |
| [System Architecture](docs/system-architecture.md) | (deprecated) alias for Architecture overview — kept for backward compatibility |
| [System Design](docs/system-design.md) | VRF design, betting model, token economics |
| [User Flow](docs/user-flow.md) | Step-by-step user journeys with diagrams |
| [File Structure](docs/file-structure.md) | Annotated file tree |
| [Core Functions](docs/core-functions.md) | All major functions — inputs, outputs, side effects |

---

## Environment Variables Reference

| Variable | Where used | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_RPC_URL` | Browser (WalletProvider) | `http://127.0.0.1:8545` | Avalanche RPC endpoint |
| `NEXT_PUBLIC_WS_URL` | Browser (StockGrid, GameHUD) | `ws://localhost:3001` | Game WebSocket URL |
| `NEXT_PUBLIC_PUBNUB_PUBLISH_KEY` | Browser (GlobalChat) | `''` | PubNub publish key |
| `NEXT_PUBLIC_PUBNUB_SUBSCRIBE_KEY` | Browser (GlobalChat) | `''` | PubNub subscribe key |
| `ANCHOR_PROVIDER_URL` | Server / scripts | `http://127.0.0.1:8545` | Avalanche RPC for server-side calls (unused?) |
| `ANCHOR_WALLET` | Server / scripts | `~/.config/avalanche/keystore.json` | Path to authority wallet key |
| `NODE_ENV` | Server | `development` | Enables/disables Next.js dev mode |

> ⚠️ Never commit `.env` files or keypair JSON files to version control.

---

## Licence

Private — all rights reserved.
