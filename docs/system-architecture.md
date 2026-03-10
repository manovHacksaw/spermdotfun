# System Architecture

This document describes the high-level system architecture of SPRMFUN — how the major runtime processes and external services relate to each other.

---

## Component Overview

```mermaid
graph TD
    subgraph Browser["Browser (Player)"]
        UI["Next.js UI\n(React 19)"]
        WA["Wallet Adapter\n(EVM wallet)"]
    end

    subgraph Server["Node.js Server (server.js)"]
        NX["Next.js Handler\n:3000"]
        WSS["WebSocket Server\n:3001"]
        SIM["Price Simulator\n(30 fps loop)"]
        VRF["VRF Engine\n(SHA-256)"]
        BET["Bet Resolver"]
    end

    subgraph Avalanche["Avalanche C-Chain"]
        PROG["sprmfun_anchor\nProgram"]
        STATE["State PDA"]
        MINT["SPRM Mint PDA"]
        ESCROW["Escrow ATA"]
        TREASURY["Treasury ATA"]
        BETPDA["Bet PDA\n(per user × cell)"]
    end

    subgraph External["External Services"]
        PUBNUB["PubNub\n(Global Chat)"]
        RPC["Avalanche RPC Node"]
    end

    UI -- "HTTP :3000" --> NX
    UI -- "WS :3001" --> WSS
    WA -- "signs txns" --> UI
    UI -- "POST /register-bet" --> NX

    SIM -- "pointer ticks" --> WSS
    VRF -- "path_revealed" --> WSS
    BET -- "resolve_bet CPI" --> RPC

    RPC --> PROG
    PROG --> STATE
    PROG --> MINT
    PROG --> ESCROW
    PROG --> TREASURY
    PROG --> BETPDA

    UI -- "publish/subscribe" --> PUBNUB
    Server -- "RPC calls" --> RPC
    WA -- "submit txns" --> RPC
```

---

## Runtime Processes

### Next.js HTTP Server (port 3000)

Serves the compiled Next.js application and exposes two API routes:

| Route | Method | Description |
|---|---|---|
| `/api/idl` | GET | Returns the compiled contract ABI/metadata as JSON |
| `/api/airdrop` | POST | Requests AVAX tokens from the local faucet for the given wallet |
| `/register-bet` | POST | Registers a confirmed on-chain bet for server-side resolution |

### WebSocket Game Server (port 3001)

Maintains a live simulation loop that runs at ~30 fps (every 33 ms). On each tick it:

1. Advances the simulated price (`stepSim`)
2. Steers the pointer toward the VRF-determined winning row
3. Broadcasts a `pointer` message to all connected clients
4. Checks whether any pending bets can now be resolved (pointer has passed the bet's column)
5. Triggers `refreshVrf` when due

Every 3 seconds it broadcasts new `grid` columns to keep the look-ahead buffer full.

### Avalanche Contract (on-chain)

A Solidity contract deployed on the Avalanche C‑Chain. All token custody, bet lifecycle, and payout arithmetic happen on-chain. The server acts as the trusted **authority** that posts VRF results and resolves bets.

---

## Data Flow — Bet Lifecycle

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant Server
    participant Avalanche

    User->>Browser: Click grid cell (future column)
    Browser->>Browser: Show bet modal
    User->>Browser: Enter amount → Confirm Bet
    Browser->>Avalanche: place_bet tx (signed by user's Web3 wallet)
    Avalanche-->>Browser: tx confirmed
    Browser->>Server: POST /register-bet {betPda, box_x, box_row, userAta}
    Server->>Server: Store in pendingBets Map

    loop Every 33ms
        Server->>Server: stepSim() → advance pointer
        Server->>Browser: WS pointer event
        alt pointer has passed bet column
            Server->>Avalanche: resolve_bet tx (signed by authority)
            Avalanche-->>Server: tx confirmed
            Server->>Browser: WS bet_resolved event
            Browser->>User: WIN / LOSE toast
        end
    end
```

---

## Infrastructure Topology

```mermaid
graph LR
    subgraph Host
        D["Docker Container\n(node:24-slim)"]
        D -- ":3000" --> LB["Reverse Proxy / Load Balancer"]
        D -- ":3001 (WS)" --> LB
    end
    LB --> Internet
    D -- "RPC" --> RPC["Avalanche RPC\n(testnet or local node)"]
    D -- "PubNub API" --> PN["PubNub Cloud"]
```

> **Assumption**: A reverse proxy (e.g. nginx or Caddy) fronts both ports in production. The Dockerfile exposes `3000` and `3001`. Actual proxy configuration is not present in this repository.

---

## Key Design Constraints

| Constraint | Value |
|---|---|
| Grid column width | 140 px |
| Rows per column | 10 |
| Pointer broadcast rate | ~30 fps (33 ms interval) |
| Grid look-ahead | 25 columns |
| History buffer size | 4 000 points (client) / 2 800 points (server) |
| VRF refresh period | Every 8 columns (~37 s at default speed) |
| Max column memory (client) | 300 columns |
| Token decimals | 9 |
| House edge | 200 bps (2 %) — set at initialisation |
