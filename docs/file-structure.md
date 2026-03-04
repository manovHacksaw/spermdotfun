# File Structure

Annotated file tree for the SPRMFUN repository.

---

```
sprmfunv2/
│
├── README.md                          Project overview and quick-start guide
│
├── package.json                       NPM package manifest
│                                      Scripts: dev | build | start
│                                      Key deps: next, react, @coral-xyz/anchor,
│                                               @solana/web3.js, ws, pubnub
│
├── package-lock.json                  Lockfile (npm)
│
├── tsconfig.json                      TypeScript config (Next.js default)
│
├── tsconfig.tsbuildinfo               TS incremental build cache (generated)
│
├── next.config.js                     Next.js config (currently empty defaults)
│
├── next-env.d.ts                      Next.js TypeScript ambient declarations
│
├── server.js                          ⭐ Custom Node.js entry point
│                                      - Serves Next.js on :3000
│                                      - Runs WebSocket game server on :3001
│                                      - Price simulation loop (~30 fps)
│                                      - VRF engine (SHA-256 based)
│                                      - On-chain bet resolution via Anchor
│                                      - Handles POST /register-bet
│
├── Dockerfile                         Multi-stage Docker build
│                                      Stage 1 (deps):    npm install
│                                      Stage 2 (builder): next build
│                                      Stage 3 (runner):  production image
│                                      Exposes ports 3000 and 3001
│
├── .dockerignore                      Files excluded from Docker build context
│
├── .gitignore                         Files excluded from git
│
├── doc.tx                             (Untracked scratch note — not source code)
│
├── app/                               Next.js App Router directory
│   │
│   ├── layout.tsx                     Root layout
│   │                                  - Sets page <title> and <meta description>
│   │                                  - Wraps children in WalletContextProvider
│   │
│   ├── page.tsx                       Home page (only page)
│   │                                  - Renders StockGrid, GameHUD, GlobalChat
│   │                                  - Full-viewport dark background
│   │
│   ├── globals.css                    Global CSS reset / base styles
│   │
│   └── api/
│       │
│       ├── airdrop/
│       │   └── route.ts               POST /api/airdrop
│       │                              Airdrops 1 SOL to wallet if balance < 0.1 SOL
│       │                              (localnet / devnet only)
│       │
│       └── idl/
│           └── route.ts               GET /api/idl
│                                      Reads and returns sprmfun_anchor.json
│                                      (served to the browser for Anchor Program init)
│
├── components/
│   │
│   ├── StockGrid.tsx                  ⭐ Canvas-rendered live grid
│   │                                  - Connects to WS :3001
│   │                                  - Renders columns, pointer path, bet states
│   │                                  - Handles mouse hover + click for bet selection
│   │                                  - Emits / listens for custom DOM events
│   │
│   ├── GameHUD.tsx                    ⭐ Heads-up display overlay
│   │                                  - Wallet multi-button (top-right)
│   │                                  - SPRM balance pill + faucet button
│   │                                  - Bet modal (confirm amount, submit tx)
│   │                                  - Side panel (default amount, Quick Bet toggle)
│   │                                  - Background music (audio element + mute)
│   │                                  - Anchor Program instance management
│   │
│   ├── GlobalChat.tsx                 PubNub chat panel
│   │                                  - Floating toggle button (bottom-left)
│   │                                  - Scrollable message list
│   │                                  - Sender hover → SPRM balance tooltip
│   │
│   └── WalletProvider.tsx             Solana wallet context
│                                      - ConnectionProvider (RPC endpoint)
│                                      - WalletProvider (Phantom adapter)
│                                      - WalletModalProvider (Solana wallet UI)
│
├── public/
│   ├── delosound-energetic-sports-471133.mp3   Background music file
│   └── dummy.txt                               Placeholder (keep public/ non-empty)
│
├── scripts/
│   │
│   ├── init-devnet.js                 One-shot on-chain initialisation script
│   │                                  Calls initialize() then init_atas()
│   │                                  Idempotent: skips steps if PDAs already exist
│   │
│   └── prefund-escrow.js              Mints 1 M SPRM to authority ATA via faucet,
│                                      then transfers to escrow
│                                      Run once after init to seed the house reserve
│
├── docs/
│   ├── system-architecture.md         High-level component and sequence diagrams
│   ├── technical-architecture.md      Stack, module map, WS protocol, build pipeline
│   ├── system-design.md               Grid model, VRF scheme, bet lifecycle, tokenomics
│   ├── user-flow.md                   Step-by-step user journeys with flowcharts
│   ├── file-structure.md              (this file)
│   └── core-functions.md              All major functions — inputs, outputs, side effects
│
└── sprmfun-anchor/                    Anchor workspace (Rust smart contract)
    │
    ├── Anchor.toml                    Anchor configuration
    │                                  cluster = devnet
    │                                  wallet  = ~/.config/solana/id.json
    │
    ├── Cargo.toml                     Workspace Cargo manifest
    │
    ├── Cargo.lock                     Rust lockfile
    │
    ├── package.json                   Yarn/TS tooling for Anchor tests
    │
    ├── tsconfig.json                  TS config for Anchor test suite
    │
    ├── yarn.lock                      Yarn lockfile for test dependencies
    │
    ├── .prettierignore                Prettier exclusions
    │
    ├── migrations/
    │   └── deploy.ts                  Anchor deploy hook (empty placeholder)
    │
    ├── patches/
    │   └── constant_time_eq/          Patched crate to resolve build conflict
    │       ├── Cargo.toml
    │       └── src/lib.rs
    │
    ├── programs/
    │   └── sprmfun-anchor/
    │       ├── Cargo.toml             Program crate manifest
    │       ├── Xargo.toml             Xargo config for BPF target
    │       └── src/
    │           └── lib.rs             ⭐ Smart contract source
    │                                  Declares all instructions, accounts,
    │                                  events, and error codes
    │
    ├── target/
    │   └── idl/
    │       └── sprmfun_anchor.json    ⭐ Compiled Anchor IDL
    │                                  Served by /api/idl to the browser
    │                                  Required by server.js at startup
    │
    └── tests/
        └── sprmfun-anchor.ts          Integration tests (Mocha + Anchor)
                                       Tests: initialize, faucet, consume_vrf,
                                              place_bet, resolve_bet (win/lose),
                                              double-resolve rejection,
                                              invalid row, zero bet, sweep_escrow
```

---

## Key Files Quick Reference

| File | Role |
|---|---|
| `server.js` | Single entry point; starts Next.js + WebSocket servers |
| `app/page.tsx` | Only rendered page; composes the three main components |
| `components/StockGrid.tsx` | All canvas rendering and WS client for the grid |
| `components/GameHUD.tsx` | Wallet integration, bet modal, faucet, side panel |
| `components/GlobalChat.tsx` | PubNub-backed real-time chat |
| `components/WalletProvider.tsx` | Solana wallet context (Phantom) |
| `sprmfun-anchor/programs/sprmfun-anchor/src/lib.rs` | Rust smart contract |
| `sprmfun-anchor/target/idl/sprmfun_anchor.json` | Compiled IDL (must exist before `npm run dev`) |
| `scripts/init-devnet.js` | First-run on-chain setup |
| `scripts/prefund-escrow.js` | House reserve funding |

---

## Generated / Ignored Files

| Pattern | Reason |
|---|---|
| `node_modules/` | npm dependencies |
| `.next/` | Next.js build output |
| `sprmfun-anchor/target/` | Rust/Anchor build artifacts (except `target/idl/` which is committed) |
| `tsconfig.tsbuildinfo` | TypeScript incremental cache |
| `.env`, `.env.local` | Secret environment variables |
