# SPRMFUN — Live Multiplier Grid

SPRMFUN is a real-time, on-chain multiplier-grid betting game built on the [Solana](https://solana.com) blockchain. A live pointer scrolls across a 10-row grid; players click cells in future columns and stake SPRM tokens. When the pointer crosses a column, the server resolves every pending bet on-chain and pays out winners immediately.

---

## Features

- **Real-time canvas grid** rendered at ~30 fps via `requestAnimationFrame`
- **Solana smart contract** (Anchor / Rust) for trustless bet placement and payout
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
| Blockchain | Solana (Anchor 0.32 / Rust) |
| Token | SPL Token (SPRM, 9 decimals) |
| Real-time | Node.js `ws` WebSocket server |
| Chat | PubNub |
| Wallet | `@solana/wallet-adapter` (Phantom) |
| Containerisation | Docker (multi-stage) |

---

## Quick Start

### Prerequisites

- Node.js ≥ 20
- A Solana keypair at `~/.config/solana/id.json` (or set `ANCHOR_WALLET`)
- A running Solana validator (`solana-test-validator`) **or** a devnet RPC

### 1 — Install dependencies

```bash
npm install
```

### 2 — Configure environment

Create a `.env.local` file (never commit it):

```dotenv
# Solana RPC used by the browser wallet adapter
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
# localnet
node scripts/init-devnet.js

# devnet
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com node scripts/init-devnet.js
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
│       ├── airdrop/route.ts # POST /api/airdrop — localnet SOL faucet
│       └── idl/route.ts     # GET  /api/idl    — serves compiled Anchor IDL
├── components/
│   ├── StockGrid.tsx        # Canvas-rendered live grid + WebSocket client
│   ├── GameHUD.tsx          # Wallet UI, bet modal, faucet, side panel
│   ├── GlobalChat.tsx       # PubNub chat panel
│   └── WalletProvider.tsx   # @solana/wallet-adapter context
├── scripts/
│   ├── init-devnet.js       # One-shot on-chain initialisation
│   └── prefund-escrow.js    # Pre-fund escrow with SPRM tokens
├── server.js                # Node.js: Next.js server + WebSocket game server
├── sprmfun-anchor/          # Anchor workspace (Rust smart contract)
│   ├── programs/sprmfun-anchor/src/lib.rs
│   ├── tests/sprmfun-anchor.ts
│   └── target/idl/sprmfun_anchor.json
├── Dockerfile
├── next.config.js
└── tsconfig.json
```

---

## Smart Contract

Program ID: `BN8y2gfrrVe1Nira9R9PtN6BzfuyKjQZ1LyoXUT3yJfw`

| Instruction | Description |
|---|---|
| `initialize` | Creates the State PDA and SPRM mint |
| `init_atas` | Creates the escrow and treasury ATAs |
| `faucet` | Mints SPRM tokens to the caller's ATA |
| `consume_vrf` | Authority posts new VRF randomness |
| `place_bet` | User locks tokens on a grid cell |
| `resolve_bet` | Authority resolves and pays out a bet |
| `sweep_escrow` | Admin drains escrow to treasury |

---

## Docs

| Document | Description |
|---|---|
| [System Architecture](docs/system-architecture.md) | High-level component diagram |
| [Technical Architecture](docs/technical-architecture.md) | Stack, data flows, inter-process communication |
| [System Design](docs/system-design.md) | VRF design, betting model, token economics |
| [User Flow](docs/user-flow.md) | Step-by-step user journeys with diagrams |
| [File Structure](docs/file-structure.md) | Annotated file tree |
| [Core Functions](docs/core-functions.md) | All major functions — inputs, outputs, side effects |

---

## Environment Variables Reference

| Variable | Where used | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_RPC_URL` | Browser (WalletProvider) | `http://127.0.0.1:8899` | Solana RPC endpoint |
| `NEXT_PUBLIC_WS_URL` | Browser (StockGrid, GameHUD) | `ws://localhost:3001` | Game WebSocket URL |
| `NEXT_PUBLIC_PUBNUB_PUBLISH_KEY` | Browser (GlobalChat) | `''` | PubNub publish key |
| `NEXT_PUBLIC_PUBNUB_SUBSCRIBE_KEY` | Browser (GlobalChat) | `''` | PubNub subscribe key |
| `ANCHOR_PROVIDER_URL` | Server / scripts | `http://127.0.0.1:8899` | Solana RPC for server-side calls |
| `ANCHOR_WALLET` | Server / scripts | `~/.config/solana/id.json` | Path to authority keypair |
| `NODE_ENV` | Server | `development` | Enables/disables Next.js dev mode |

> ⚠️ Never commit `.env` files or keypair JSON files to version control.

---

## Licence

Private — all rights reserved.
