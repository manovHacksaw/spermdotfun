# Technical Architecture

This document describes the technical stack, inter-process communication, module boundaries, and key implementation choices in SPRMFUN.

---

## Technology Stack

| Concern | Technology | Version | Notes |
|---|---|---|---|
| Frontend framework | Next.js | ^16.1.6 | App Router; React 19 |
| Language (frontend) | TypeScript | ^5 | Strict mode |
| Rendering | HTML5 Canvas | — | No UI library; raw 2D context |
| Blockchain SDK | `@coral-xyz/anchor` | ^0.32.1 | Provides `Program`, `AnchorProvider`, `BN` |
| Solana web3 | `@solana/web3.js` | ^1.98.4 | `Connection`, `PublicKey`, `Keypair` |
| SPL Token | `@solana/spl-token` | ^0.4.14 | ATA helpers, `getAccount` |
| Wallet adapter | `@solana/wallet-adapter-*` | various | Phantom only (`PhantomWalletAdapter`) |
| Real-time transport | `ws` | ^8.18.0 | Node.js WebSocket server |
| Chat | PubNub | ^10.2.7 | Browser SDK |
| Smart contract | Anchor / Rust | 0.32 | `anchor-lang`, `anchor-spl` |
| Icons | `lucide-react` | ^0.575.0 | `Volume2`, `VolumeX`, `MessageSquare`, `Send`, `X` |
| Config | `dotenv` | ^17.3.1 | Loaded in `server.js` |
| Containerisation | Docker | — | Multi-stage (`deps` → `builder` → `runner`) |

---

## Module Map

```mermaid
graph TD
    subgraph Next["Next.js App (app/)"]
        LAY["layout.tsx\n(root layout)"]
        PAGE["page.tsx\n(home)"]
        IDL_RT["api/idl/route.ts"]
        AIR_RT["api/airdrop/route.ts"]
    end

    subgraph Components["components/"]
        SG["StockGrid.tsx\n(canvas + WS client)"]
        GH["GameHUD.tsx\n(wallet, betting, faucet)"]
        GC["GlobalChat.tsx\n(PubNub chat)"]
        WP["WalletProvider.tsx\n(Solana context)"]
    end

    subgraph Server["server.js"]
        SRV_HTTP["HTTP handler\n(Next.js passthrough)"]
        SRV_WS["WebSocket server"]
        SRV_SIM["Simulator loop"]
        SRV_VRF["VRF engine"]
        SRV_BET["Bet resolver"]
        SRV_CHAIN["Anchor program handle"]
    end

    LAY --> WP
    LAY --> PAGE
    PAGE --> SG
    PAGE --> GH
    PAGE --> GC

    SG -- "WS :3001" --> SRV_WS
    GH -- "WS :3001" --> SRV_WS
    GH -- "POST /register-bet" --> SRV_HTTP
    GH -- "GET /api/idl" --> IDL_RT
    GH -- "POST /api/airdrop" --> AIR_RT

    SRV_SIM --> SRV_VRF
    SRV_SIM --> SRV_BET
    SRV_BET --> SRV_CHAIN
    SRV_VRF --> SRV_CHAIN
```

---

## Server Architecture (`server.js`)

`server.js` is a monolithic Node.js entry point that:

1. Loads environment variables via `dotenv`
2. Prepares the Next.js application (`app.prepare()`)
3. Starts an HTTP server on **port 3000** that:
   - Handles `POST /register-bet` directly (no Next.js routing)
   - Passes all other requests to the Next.js request handler
4. Starts a separate HTTP server on **port 3001** exclusively for the WebSocket upgrade

### Timer Loops

| Loop | Interval | Purpose |
|---|---|---|
| Pointer broadcast | 33 ms | Advance simulation, broadcast pointer, resolve bets, trigger VRF refresh |
| Grid broadcast | 3 000 ms | Emit 5 new grid columns when look-ahead drops below 25 columns |

### In-Memory State

| Variable | Type | Description |
|---|---|---|
| `historyBuffer` | `Array` (max 2 800) | Recent pointer positions `{x, y, multiplier}` |
| `allColumns` | `Array` (max 300) | All generated grid columns |
| `clients` | `Set<WebSocket>` | Currently connected browser clients |
| `pendingBets` | `Map<betPdaStr, BetInfo>` | Bets awaiting resolution |
| `vrfPath` | `Map<colX, {row, vrfResult, serverSalt}>` | Pre-computed winning rows |
| `columnRowRange` | `Map<colX, {minRow, maxRow}>` | Row range pointer traversed per column |
| `serverCurrentX` | `number` | Current pointer X position in pixels |

---

## WebSocket Message Protocol

All messages are JSON strings.

### Server → Client

| `type` | Fields | Description |
|---|---|---|
| `init` | `columns`, `history`, `currentX` | Full state snapshot sent on connect |
| `pointer` | `y`, `multiplier`, `currentX`, `timestamp` | Per-tick pointer position |
| `grid` | `columns` | Batch of new grid columns |
| `vrf_state` | `paths[]` (`{colX, row}`), `seedIndex` | Known VRF paths for newly connected client |
| `path_revealed` | `paths[]` (`{colX, row}`), `seedIndex` | New VRF paths after a refresh |
| `bet_resolved` | `betPda`, `user`, `box_x`, `box_row`, `winning_row`, `won` | On-chain bet resolution result |

### Client → Server (WebSocket)

| `type` | Fields | Description |
|---|---|---|
| `register_bet` | `betPda`, `user`, `box_x`, `box_row`, `userAta` | Registers a confirmed bet for server-side watch |

### Client → Server (HTTP)

| Route | Method | Body | Description |
|---|---|---|---|
| `/register-bet` | POST | `{betPda, user, box_x, box_row, userAta}` | Same as WS `register_bet` but over HTTP |

---

## Frontend Component Architecture

### StockGrid

- Pure canvas component; no DOM elements except one `<div>` and one `<canvas>`
- All mutable state lives in a single `useRef` (`state.current`) to avoid React re-renders during the animation loop
- Two separate `useEffect` hooks: one for the WebSocket connection + animation loop, one for mouse event listeners
- Custom events (`sprmfun:select`, `sprmfun:deselect`) are used to communicate between `StockGrid` and `GameHUD` without shared state or prop drilling

### GameHUD

- Overlays the canvas with `pointer-events: none` except for interactive controls
- Manages the Anchor `Program` instance after wallet connection
- Maintains a second WebSocket connection (independent of `StockGrid`) for sending `register_bet`
- Implements transaction retry logic: resends serialised transactions every 2 s while polling for confirmation (up to 40 attempts / ~40 s)

### GlobalChat

- Connects to PubNub on mount; fetches the last 25 messages via `fetchMessages`
- Lazy-loads SPRM token balances on sender hover via `getTokenAccountBalance`
- Chat is silently hidden when PubNub keys are not set

### WalletProvider

- Wraps the tree in `ConnectionProvider → WalletProvider → WalletModalProvider`
- Hardcodes Phantom as the only wallet adapter
- RPC endpoint is configurable via `NEXT_PUBLIC_RPC_URL`

---

## Anchor Program Architecture

```mermaid
graph TD
    subgraph PDAs["Program Derived Addresses"]
        STATE["State PDA\nseeds: [b'state']"]
        MINTPDA["Mint PDA\nseeds: [b'mint', state]"]
        ESCROW["Escrow ATA\nassociated_token(mint, state)"]
        TREASURY["Treasury ATA\nassociated_token(mint, authority)"]
        BETPDA["Bet PDA\nseeds: [b'bet', user, box_x_le8, box_row]"]
    end

    STATE --> MINTPDA
    STATE --> ESCROW
    STATE --> BETPDA

    BETPDA -- "place_bet: transfer" --> ESCROW
    ESCROW -- "resolve_bet (win): transfer" --> USER_ATA["User ATA"]
    ESCROW -- "resolve_bet (fee): transfer" --> TREASURY
    MINTPDA -- "faucet: mint_to" --> USER_ATA
```

### Account Sizes

| Account | Size (bytes) | Calculation |
|---|---|---|
| `State` | 188 | `8 + 32×3 + 2 + 1 + 8 + 32 + 32 + 8 + 1` |
| `Bet` | 77 | `8 + 32 + 8 + 1 + 8 + 8 + 1 + 1 + 8 + 1` |

---

## Build Pipeline

```mermaid
graph LR
    A["npm install\n(deps stage)"] --> B["next build\n(builder stage)"]
    B --> C[".next/ output\n+ node_modules"]
    C --> D["runner stage\n(production image)"]
    D --> E["npm start\n→ node server.js"]
```

The `builder` stage sets `NEXT_PUBLIC_*` environment variables so they are baked into the static bundle. Server-side secrets (`ANCHOR_WALLET`, `ANCHOR_PROVIDER_URL`) are **not** baked — they must be supplied at runtime.

---

## Dependency Graph (key packages)

```mermaid
graph LR
    SG["StockGrid.tsx"] --> WJS["@solana/web3.js"]
    GH["GameHUD.tsx"] --> WJS
    GH["GameHUD.tsx"] --> ANC["@coral-xyz/anchor"]
    GH["GameHUD.tsx"] --> SPL["@solana/spl-token"]
    GH["GameHUD.tsx"] --> WA["@solana/wallet-adapter-react"]
    GH["GameHUD.tsx"] --> LR["lucide-react"]
    GC["GlobalChat.tsx"] --> PN["pubnub"]
    GC["GlobalChat.tsx"] --> SPL
    GC["GlobalChat.tsx"] --> WA
    WP["WalletProvider.tsx"] --> WA
    WP["WalletProvider.tsx"] --> WAW["@solana/wallet-adapter-wallets"]
    SRV["server.js"] --> WS["ws"]
    SRV --> ANC
    SRV --> WJS
    SRV --> SPL
```
