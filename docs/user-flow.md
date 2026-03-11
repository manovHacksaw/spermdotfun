# User Flow

This document describes the step-by-step journeys a player takes through SPRMFUN, from first visit to placing bets and managing their session wallet.

---

## Screen Layout

```
┌──────────────────────────────────────────────────────────┐
│                     TopHeader                            │
│  [logo]   [AVAX price]  [volume]  [wallet btn] [profile] │
├──────────────────────────────────────────────────────────┤
│  │                                                  │    │
│  │  L     ┌────────────────────────────────────┐   │ B  │
│  │  e     │                                    │   │ e  │
│  │  f     │         StockGrid (canvas)         │   │ t  │
│  │  t     │                                    │    │    │
│  │  R     │  columns · pointer · multipliers   │   │ S  │
│  │  a     │                                    │   │ i  │
│  │  i     └────────────────────────────────────┘   │ d  │
│  │  l     MultiplierBar (scrolling ticker)          │ e  │
│  │                                                  │ b  │
│  │                                                  │ a  │
│  │                                                  │ r  │
└──────────────────────────────────────────────────────────┘
   [GlobalChat toggle — bottom left]
```

---

## 1. First Visit

```
User opens http://localhost:3000
        │
        ▼
  layout.tsx mounts providers:
    WalletProvider (RainbowKit + wagmi)
    SessionWalletProvider
    Sonner toaster
        │
        ▼
  page.tsx renders:
    TopHeader
    StockGrid ────► WebSocket connects to ws://localhost:3001
    MultiplierBar      receives "init" message (columns, history, currentX)
    GameHUD            canvas begins rendering at 60 FPS
    BetSidebar
    ChatSidebar
        │
        ▼
  User sees live canvas:
    - Pointer scrolling right, driven by AVAX price
    - Grid columns with multiplier labels
    - Multiplier history ticker at bottom
```

---

## 2. Connect Wallet

```
User clicks "Connect Wallet" in TopHeader
        │
        ▼
  RainbowKit modal opens
  (MetaMask / WalletConnect / Coinbase / etc.)
        │
        ▼
  User selects wallet and approves connection
        │
        ▼
  If wrong network (not Fuji):
    wagmi detects chain mismatch
    Auto-prompts wallet to switch to Avalanche Fuji (chainId 43113)
        │
        ▼
  TopHeader updates:
    - Wallet address pill shown
    - SPRM balance displayed
    - Profile menu unlocked
```

---

## 3. Get Testnet Tokens (Faucet)

```
User navigates to /faucet
        │
        ▼
  SprmFaucet.claim() called
  (contract: 0x50fEF1bCA8686302ca7Dac9D596aF121A288855B)
        │
        ▼
  MetaMask prompts for gas approval
        │
        ▼
  50 SPRM transferred to user's wallet
  (limited to once per 24 hours per address)
        │
        ▼
  TopHeader SPRM balance updates
  (useSprmBalance polls every 6 s)
```

---

## 4. Place a Bet (Primary Wallet)

```
User hovers over a cell in an upcoming column
        │
        ▼
  StockGrid highlights cell (cyan glow)
  StockGrid sends ghost_select to server (broadcast to other players)
        │
        ▼
  User clicks the cell
        │
        ▼
  StockGrid fires: window.dispatchEvent('sprmfun:select',
    { colX, row, multiplier, multNum })
        │
        ▼
  GameHUD receives event, shows bet modal:
    ┌────────────────────────────────┐
    │  Row 247  ×3.50                │
    │  Amount: [___] SPRM            │
    │  Est. payout: 34.3 SPRM        │
    │  [CANCEL]        [CONFIRM BET] │
    └────────────────────────────────┘
        │
        ▼
  User enters amount, clicks CONFIRM
        │
        ▼
  GameHUD calls: contract.placeBet(boxX, boxRow, multNum, amount)
  MetaMask prompts for SPRM allowance (first bet only), then tx approval
        │
        ▼
  On tx confirmed:
    POST /register-bet {betId, user, box_x, box_row, mult_num, bet_amount}
    Server stores in pendingBets
    Cell turns green on canvas
        │
        ▼
  Pointer crosses column:
    server resolves bet, broadcasts bet_resolved
        │
        ├── WIN: green popup with payout amount
        │         P/L float animation (+34.3 SPRM)
        │
        └── LOSE: red popup
                  P/L float animation (−10 SPRM)
```

---

## 5. Session Wallet Setup (Instant Mode)

The session wallet enables gasless bets — no MetaMask popup per bet.

```
User opens BetSidebar
        │
        ▼
  Clicks "Create Session Wallet"
        │
        ▼
  useSessionWallet.createSession():
    1. Generates random ethers.Wallet keypair
    2. Saves private key to localStorage ('sprmfun:session_evm_key')
    3. Requests MetaMask to send 0.05 AVAX to session wallet (for gas)
        │
        ▼
  MetaMask approval for 0.05 AVAX transfer
        │
        ▼
  Clicks "Deposit SPRM"
  Enters amount (e.g. 100 SPRM)
        │
        ▼
  MetaMask approves SPRM transfer to session wallet
  Session wallet auto-approves MAX_UINT256 on game contract
        │
        ▼
  Session wallet is active:
    - SPRM balance shown in BetSidebar
    - "Instant" mode toggle enabled in GameHUD
```

---

## 6. Place a Bet (Instant Mode)

```
User has session wallet active with SPRM balance
        │
        ▼
  User clicks cell in upcoming column
        │
        ▼
  GameHUD shows bet modal (or quick-bet fires immediately if enabled)
        │
        ▼
  Session wallet signs placeBet tx locally
  (no MetaMask popup — instant signing)
        │
        ▼
  contract.placeBet() called from session wallet address
        │
        ▼
  POST /register-bet (same as primary wallet flow)
        │
        ▼
  useSessionWallet.optimisticDeduct(amount):
    Balance decremented immediately in UI
        │
        ▼
  Resolution same as primary wallet flow
  After win/lose: refreshBalances() called after 800 ms delay
```

---

## 7. Quick Bet Mode

```
User enables "Quick Bet" in GameHUD settings
User sets preset amount (e.g. 5 SPRM)
        │
        ▼
  Clicking any cell:
    ├── No modal shown
    └── Bet fires immediately with preset amount
        (session wallet must be active for best UX)
```

---

## 8. Withdraw Session Wallet

```
User clicks "Withdraw All" in BetSidebar
        │
        ▼
  useSessionWallet.withdrawAll():
    Session wallet signs ERC-20 transfer back to main wallet
    (no MetaMask popup — session key signs locally)
        │
        ▼
  SPRM balance returned to main wallet
  Remaining AVAX gas stays in session wallet
  (use "Withdraw Gas" or just leave it for next session)
```

---

## 9. Profile Page

```
User navigates to /profile
        │
        ▼
  If wallet not connected:
    ConnectGate component shown (RainbowKit connect button)
        │
        ▼
  If connected, useProfileData fetches:
    1. POST /api/profile/auth/challenge  (server returns nonce + message)
    2. MetaMask signs message (personal_sign / EVM sig)
    3. POST /api/profile/auth/verify     (server verifies sig, returns accessToken)
    4. GET  /api/profile/overview        (stats: 24H / 7D / 1M / ALL)
        │
        ▼
  Profile page shows:
    - Win / loss count and win rate
    - Total wagered / total payout / net P/L
    - PnL chart over time
    - Bet transaction history (paginated, cursor-based)
    - Settings (nickname, avatar, referral code, volume)
```

---

## 10. Feed Paused State

```
Binance price feed goes silent >5 seconds
        │
        ▼
  server.js: bettingPaused = true
  Broadcast: { type: "market_paused", reason: "price_feed_stale" }
        │
        ▼
  StockGrid: grey overlay drawn on canvas
             "FEED PAUSED" text rendered
  TopHeader: red warning indicator shown
        │
        ▼
  New bet clicks:
    Modal shows "Betting paused — price feed unavailable"
    /register-bet returns HTTP 503
        │
        ▼
  Feed recovers
  Broadcast: { type: "market_resumed" }
  Normal play resumes, overlay removed
```

---

## Cell Appearance States

| State | Appearance | Meaning |
|---|---|---|
| Default | Dark grey | Available, not selected |
| Hovered | Cyan glow | Current user is hovering (ghost_select sent) |
| Pending bet | Green | User's bet registered, awaiting resolution |
| Another player's ghost | Red variant | Another player is hovering here |
| Pointer visited (winning row) | Gold highlight | Pointer passed through — winning row |
| Pointer visited (other rows) | Dim highlight | Pointer passed through — not winning row |
| Win resolved | Bright gold | This cell was the winning cell |
| Lost resolved | Muted red | Pointer did not cross this row |
