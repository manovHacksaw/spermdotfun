# File Structure

Annotated file tree for the SPRMFUN repository.

---

```
sprmfunv2/
│
├── app/                                # Next.js App Router
│   ├── layout.tsx                      # Root layout — mounts WalletProvider, SessionWalletProvider, Toaster
│   ├── page.tsx                        # Home page — dynamic-imports all game components, handles mobile layout
│   ├── globals.css                     # Global styles (dark theme, custom scrollbars, canvas resets)
│   ├── faucet/
│   │   └── page.tsx                    # /faucet — UI to claim 50 SPRM from SprmFaucet contract
│   ├── profile/
│   │   └── page.tsx                    # /profile — stats, bet history, settings (requires wallet)
│   └── api/
│       └── profile/                    # Profile REST API (backed by profile-service.js)
│           ├── auth/
│           │   ├── challenge/route.ts  # POST — creates EVM sign challenge nonce
│           │   └── verify/route.ts     # POST — verifies signature, issues accessToken
│           ├── overview/route.ts       # GET  — stats for a wallet (range: 24H/7D/1M/ALL)
│           ├── transactions/route.ts   # GET  — bet history (cursor-based pagination)
│           ├── settings/route.ts       # PATCH — update nickname, avatar, client seed, etc.
│           └── session-links/
│               └── route.ts           # POST/DELETE — link/unlink session wallet to main wallet
│
├── components/
│   ├── StockGrid.tsx                   # Main game canvas; WebSocket client; 60 FPS render loop
│   │                                   #   receives: pointer, grid, vrf_state, bet_resolved, leaderboard
│   │                                   #   fires: sprmfun:select, sprmfun:deselect custom events
│   ├── GameHUD.tsx                     # Bet modal; session wallet UI; P/L floats; quick-bet toggle
│   │                                   #   listens: sprmfun:select, sprmfun:deselect, sprmfun:settings
│   ├── BetSidebar.tsx                  # Live bet feed; deposit/withdraw SPRM; active players list
│   ├── TopHeader.tsx                   # Wallet connect; SPRM balance; volume; profile dropdown
│   ├── MultiplierBar.tsx               # Scrolling ticker of recent column multipliers (color-coded)
│   ├── ChatSidebar.tsx                 # PubNub chat sidebar (full panel)
│   ├── GlobalChat.tsx                  # PubNub chat floating panel (bottom-left toggle)
│   ├── LeftRail.tsx                    # Mobile toggle for chat / bet sidebar
│   ├── OnboardingGuide.tsx             # First-time user tutorial overlay
│   ├── Providers.tsx                   # wagmi QueryClient provider
│   ├── WalletProvider.tsx              # RainbowKit + wagmi config; Avalanche Fuji chain; ethers adapters
│   └── theme/
│       └── spermTheme.ts               # Design tokens — colors, shadows, border styles
│   └── profile/
│       ├── ConnectGate.tsx             # Shown on /profile when wallet not connected (RainbowKit button)
│       └── ...                         # Other profile UI components
│
├── context/
│   └── SessionWalletContext.tsx        # React context wrapping useSessionWallet hook
│
├── hooks/
│   ├── useSessionWallet.ts             # Session wallet: create, deposit, withdraw, optimistic balance
│   ├── useLiveGameStats.ts             # WebSocket: leaderboard + active players data
│   ├── useSprmBalance.ts               # On-chain ERC-20 balance polling (default: 6 s interval)
│   ├── useUsername.ts                  # Persistent random username per wallet (localStorage)
│   └── useProfileData.ts              # Profile auth challenge + API data fetching
│
├── lib/
│   ├── sessionWallet.ts                # localStorage helpers for session keypair (save/load/destroy)
│   ├── username.ts                     # Username generation, storage, deriveUsername (djb2 fallback)
│   ├── friendlyError.ts                # Maps raw error messages to player-friendly strings
│   ├── profile/
│   │   ├── types.ts                    # TypeScript interfaces for profile API responses
│   │   ├── clientAuth.ts              # EVM challenge/signature auth flow (client-side)
│   │   └── store.ts                    # localStorage profile state persistence
│   └── server/
│       ├── profile-service.js          # Supabase queries: auth, stats, transactions, referrals
│       ├── profile-db.js               # Database adapter (pg Pool wrapper)
│       └── vault-service.js            # Encrypted local storage for server secrets
│
├── avalanche-contracts/                # Solidity contracts (Hardhat)
│   ├── contracts/
│   │   └── SprmfunGame.sol             # Main game contract: placeBet, resolveBet, VRF
│   ├── hardhat.config.ts
│   └── ...
│
├── scripts/
│   ├── profile-migrate.js              # Run Supabase DB migrations
│   └── profile-schema.sql             # Full DB schema (profiles, transactions, auth nonces)
│
├── tests/
│   └── profile/
│       ├── helpers/
│       │   └── test-db-adapter.js      # In-transaction DB adapter for isolated tests
│       └── ...                         # Profile service tests
│
├── server.js                           # Entry point — Node.js game server + Next.js HTTP server
│                                       #   Runs on: Next.js :3000, WebSocket :3001
│                                       #   Imports: ethers, ws, next, profile-service
│
├── next.config.js                      # Next.js config (standalone output, webpack overrides)
├── tsconfig.json                       # TypeScript config (paths: @/* → ./*)
├── next-env.d.ts                       # Next.js type declarations
├── Dockerfile                          # Multi-stage build (deps → builder → runner)
├── package.json                        # Dependencies + scripts
└── .env.local                          # (not committed) Environment variables
```

---

## Key Files by Concern

### Game Logic
| File | Concern |
|---|---|
| `server.js` | Price feed, game loop, bet registration, on-chain resolution, WebSocket broadcast |
| `components/StockGrid.tsx` | Canvas rendering, 60 FPS interpolation, WebSocket client |
| `components/GameHUD.tsx` | Bet confirmation modal, session wallet UI |
| `avalanche-contracts/contracts/SprmfunGame.sol` | On-chain bet escrow + payout |

### Wallet & Auth
| File | Concern |
|---|---|
| `components/WalletProvider.tsx` | RainbowKit + wagmi setup, Fuji network config |
| `hooks/useSessionWallet.ts` | Session keypair lifecycle |
| `lib/sessionWallet.ts` | localStorage persistence for session key |
| `lib/profile/clientAuth.ts` | EVM challenge-signature auth for profile API |

### Profile System
| File | Concern |
|---|---|
| `lib/server/profile-service.js` | All Supabase queries (stats, auth, settings, referrals) |
| `lib/server/profile-db.js` | pg Pool wrapper |
| `app/api/profile/` | Next.js API route handlers |
| `scripts/profile-schema.sql` | Database schema |

### Styling & Design
| File | Concern |
|---|---|
| `app/globals.css` | Base styles, scrollbar overrides |
| `components/theme/spermTheme.ts` | All colour tokens, shadows, border styles |

---

## What Is NOT in This Repository

- **Chainlink VRF subscription management** — managed via [vrf.chain.link](https://vrf.chain.link) dashboard
- **Supabase database** — hosted externally; schema applied via `scripts/profile-schema.sql`
- **Binance API keys** — price feed is a public unauthenticated WebSocket stream
- **Archive Solana version** — historical Solana/Anchor implementation removed; for reference see git history
