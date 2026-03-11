# Core Functions

This document catalogues every major function in SPRMFUN with its inputs, outputs, and side effects.

---

## server.js

### `initEvm()`
**Purpose:** Connect to Avalanche Fuji and initialise on-chain interfaces.

**Side effects:**
- Creates `ethers.JsonRpcProvider` from `AVALANCHE_RPC_URL`
- Creates `ethers.Wallet` from `SERVER_PRIVATE_KEY` (the resolver signer)
- Initialises `gameContract` (SprmGame ABI) and `tokenContract` (ERC-20 ABI)
- Calls `subscribeVrfEvents()` to listen for Chainlink fulfillments
- Calls `refreshVrfLocally(startColX)` to seed the first VRF epoch

---

### `initBinance()`
**Purpose:** Open a persistent WebSocket to the Binance AVAX/USDT ticker.

**Side effects:**
- Connects to `wss://stream.binance.com:9443/ws/avaxusdt@trade`
- Updates `currentAvaxPrice` and `lastPriceTick` on every message
- Reconnects automatically on close/error

---

### `stepSim()`
**Purpose:** Advance the game simulation by one tick (called at 30 Hz).

**Inputs:** Global state — `currentAvaxPrice`, `simY`, `simVelocity`, `serverCurrentX`, `lastWinRow`

**Side effects:**
- Updates `simVelocity` using price delta + friction + inertia
- Injects chaos impulses when price is flat for >1500 ms
- Applies VRF steering bias toward current column's winning row
- Updates `simY` (clamped to −50 … +50)
- Advances `serverCurrentX` by `PX_PER_EVENT`
- When pointer enters a new column: tracks `columnRowRange`, triggers `resolveBetsForColumn()`
- Calls `broadcast({ type: "pointer", y, currentX, price, microVelocity })`

---

### `resolveBet(betInfo)`
**Purpose:** Settle one pending bet on-chain.

**Input:** `{ betId, user, box_x, box_row, mult_num, bet_amount }`

**Algorithm:**
1. Retrieve `columnRowRange[box_x]` — `{minRow, maxRow}`
2. Win condition: `box_row >= minRow - 2 && box_row <= maxRow + 2`
3. Compute `won` (boolean)
4. Sign: `wallet.signMessage(ethers.getBytes(keccak256(abiEncode(betId, won, CONTRACT_ADDRESS))))`
5. Call `gameContract.resolveBet(betId, won, serverSig)`
6. Broadcast `{ type: "bet_resolved", betId, user, won, payout, colX, row }`
7. Broadcast `{ type: "bet_receipt", betId, txHash, won }` after on-chain confirmation
8. Update in-memory leaderboard
9. Call `profileService.enqueueResolvedBet(...)` if DB is active
10. Trigger referral reward if applicable

**Side effects:** On-chain SPRM transfer, leaderboard mutation, WebSocket broadcast

---

### `resolveBetsForColumn(colX)`
**Purpose:** Resolve all pending bets registered against a column when the pointer exits it.

**Input:** `colX` (number) — the column X coordinate

**Side effects:** Calls `resolveBet(betInfo)` for every pending bet with `box_x === colX`

---

### `deriveWinningRow(vrfResult, colX)`
**Purpose:** Deterministically derive a winning row from VRF entropy and column ID.

**Inputs:**
- `vrfResult` (Buffer | hex string) — 32-byte entropy from Chainlink VRF
- `colX` (number) — Column X coordinate

**Returns:** `winRow` (number, 0–499)

**Algorithm:**
1. `hash = SHA256(vrfResult || colX)`
2. `delta = weightedRowDelta(hash[0])` — weighted from `[2,4,10,20,0,20,10,4,2]`
3. Apply boundary repulsion (push away from row 0 and row 499)
4. `winRow = clamp(lastWinRow + delta, 0, 499)`

---

### `refreshVrfLocally(startColX)`
**Purpose:** Populate the `vrfPath` map for the next VRF epoch (15 columns).

**Inputs:** `startColX` — starting column X

**Side effects:**
- If `VRF_ENABLED=true`: calls `gameContract.requestVrf()` and waits for `VrfFulfilled` event
- If disabled/unavailable: generates `crypto.randomBytes(32)` as fallback entropy
- For each column in the epoch: calls `deriveWinningRow()` and stores in `vrfPath`
- Broadcasts `{ type: "vrf_state", paths: [...] }`

---

### `subscribeVrfEvents()`
**Purpose:** Listen for on-chain `VrfFulfilled` events and update `currentVrfResult`.

**Side effects:**
- Attaches event listener on `gameContract` for `VrfFulfilled(epochId, requestId, vrfResult)`
- On each event: updates `currentVrfResult`, calls `refreshVrfLocally()` to repopulate `vrfPath`

---

### `checkFeedStaleness()`
**Purpose:** Detect if the Binance price feed has gone silent.

**Side effects:**
- If `Date.now() - lastPriceTick > PRICE_STALE_MS (5000)`:
  - Sets `bettingPaused = true`
  - Broadcasts `{ type: "market_paused", reason: "price_feed_stale" }`
- If feed recovers:
  - Sets `bettingPaused = false`
  - Broadcasts `{ type: "market_resumed" }`

---

### `broadcast(message)`
**Purpose:** Send a JSON message to all connected WebSocket clients.

**Input:** `message` (object) — serialised to JSON

**Side effects:** Sends to all entries in `clients` Set where `ws.readyState === OPEN`

---

### `POST /register-bet` handler
**Purpose:** Register a bet that has already been placed on-chain.

**Input body:**
```json
{
  "betId": "42",
  "user": "0xAbCd...1234",
  "box_x": 12500,
  "box_row": 247,
  "mult_num": 350,
  "bet_amount": 10.0
}
```

**Validation:**
- Rate limit: 60 req/min per IP
- `bettingPaused` → returns 503 `{ ok: false, error: "market_paused" }`
- EVM address format check
- `box_row` in [0, 499]
- `box_x` not more than 200 columns in the past
- `mult_num` in [101, 2000]
- `bet_amount` > 0

**Side effects:**
- Stores bet in `pendingBets` Map
- Broadcasts updated `active_players` payload

---

## components/StockGrid.tsx

### `connectWebSocket()`
**Purpose:** Open WebSocket connection to the game server and register message handlers.

**Side effects:**
- Sets up handlers for: `init`, `pointer`, `grid`, `vrf_state`, `bet_resolved`, `bet_receipt`, `leaderboard`, `active_players`, `house_bank`, `market_paused`, `market_resumed`, `mult_history`, `ghost_select`, `ghost_deselect`
- Schedules reconnect on close/error

---

### `animate(timestamp)`
**Purpose:** The 60 FPS requestAnimationFrame loop that renders the canvas.

**Algorithm per frame:**
1. Interpolate pointer Y: `alpha = elapsed / 100ms; drawY = lerp(prevY, currY, alpha)`
2. Apply `microVelocity` offset to sperm head Y (sub-grid animation)
3. Clear canvas
4. Draw grid background + column dividers
5. For each visible column: draw boxes with multiplier labels and bet highlights
6. Draw pointer trail (opacity fades by age, blur/width scales with volatility)
7. Draw sperm head with direction-aware aura glow (emerald up / orange-red down / magenta flat)
8. If feed paused: draw grey overlay + "FEED PAUSED" text
9. Draw ghost selections from other players
10. Draw win/lose resolution overlays

---

### `handleCellClick(colX, row)`
**Purpose:** Dispatch a bet selection event when a user clicks a grid cell.

**Side effects:**
- `window.dispatchEvent(new CustomEvent('sprmfun:select', { detail: { colX, row, multiplier, multNum } }))`
- Sends `ghost_select` to server via WebSocket

---

## components/GameHUD.tsx

### `handleBetConfirm()`
**Purpose:** Execute a bet placement on-chain and register it with the server.

**Algorithm:**
1. Get `betAmount` from input
2. If `activeWallet === 'instant'`: use session wallet signer; else use wagmi wallet client
3. Check SPRM allowance; if insufficient, call `token.approve(CONTRACT_ADDRESS, MAX_UINT256)`
4. Call `contract.placeBet(box_x, box_row, mult_num, amountWei)`
5. Wait for tx confirmation, extract `betId` from `BetPlaced` event log
6. `POST /register-bet` with betId
7. `optimisticDeduct(betAmount)` if using session wallet
8. Set cell state to "pending" (green highlight)

---

### `handleBetResolution(event)`
**Purpose:** Handle `bet_resolved` WebSocket message — show win/lose popup.

**Side effects:**
- Triggers win (green) or lose (red) popup with payout amount
- Spawns floating P/L text animation
- Calls `refreshBalances()` after 800 ms

---

## hooks/useSessionWallet.ts

### `createSession()`
**Purpose:** Create a new ephemeral session wallet and fund it.

**Algorithm:**
1. `ethers.Wallet.createRandom()` → save private key to localStorage
2. Request MetaMask to send 0.05 AVAX to session address (via wagmi `sendTransaction`)
3. Set `isActive = true`, update `sessionAddress`

**Side effects:** localStorage write, MetaMask AVAX transfer

---

### `deposit(sprmAmt)`
**Purpose:** Transfer SPRM from main wallet to session wallet.

**Algorithm:**
1. Call `token.transfer(sessionAddress, amountWei)` from main wallet (wagmi)
2. Wait for confirmation
3. On first deposit: session wallet calls `token.approve(CONTRACT_ADDRESS, MAX_UINT256)`
4. `refreshBalances()`

**Side effects:** MetaMask SPRM transfer, on-chain allowance approval

---

### `withdrawAll()`
**Purpose:** Transfer all SPRM from session wallet back to main wallet.

**Algorithm:**
1. Session wallet reads its SPRM balance
2. Calls `token.transfer(mainAddress, fullBalance)` (signed by session key, no MetaMask)
3. `refreshBalances()`

---

### `optimisticDeduct(amount)`
**Purpose:** Immediately reduce the displayed session SPRM balance before on-chain confirmation.

**Input:** `amount` (number) — SPRM to deduct

**Side effects:** Updates `sessionSprmBalance` in React state

---

### `refreshBalances()`
**Purpose:** Re-read SPRM and AVAX balances from chain for both wallets.

**Side effects:** Updates `sessionSprmBalance`, `sessionAvaxBalance`, and main wallet balances

---

## lib/sessionWallet.ts

### `saveSessionWallet(privateKey)`
Writes `privateKey` to `localStorage['sprmfun:session_evm_key']`.

### `loadSessionWallet()`
Reads private key from localStorage and returns a reconstructed `ethers.Wallet`.
Returns `null` if no key is stored.

### `destroySessionWallet()`
Removes `sprmfun:session_evm_key` from localStorage.

---

## lib/username.ts

### `generateRandomName()`
**Returns:** Random name string, e.g. `"NeonWolf4823"` — adjective + noun + 4-digit suffix.
Pool: 60 adjectives × 65 nouns × 10,000 suffixes ≈ 39 million combinations.

### `getOrCreateUsername(walletAddress)`
**Returns:** Persisted username for the wallet, generating one if it doesn't exist yet.
Reads/writes `localStorage['sprmfun:username:<address>']`.

### `deriveUsername(walletAddress)`
**Returns:** Deterministic username derived from the wallet address via djb2 hash.
Used as a fallback for addresses seen in chat that aren't the current user.

---

## lib/profile/clientAuth.ts

### `ensureProfileAccessToken(walletAddress, signMessage)`
**Purpose:** Obtain a valid profile access token, using cache if available.

**Algorithm:**
1. Check `sessionStorage` for non-expired cached token
2. If none: `POST /api/profile/auth/challenge` → get `{ nonce, message, expiresAt }`
3. Call `signMessage(textEncode(message))` → returns EVM hex signature
4. `POST /api/profile/auth/verify` with `{ wallet, nonce, signature }` → get `{ accessToken, expiresAt }`
5. Cache in `sessionStorage`
6. Return `accessToken`

**Input:** `signMessage` — wagmi's `signMessage` function (returns hex sig string)

---

## lib/server/profile-service.js

### `init()`
**Returns:** `boolean` — `true` if DB connected, `false` if disabled/unavailable.
**Side effects:** Connects to Supabase, starts the 2.5 s flush timer for the bet write queue.

### `enqueueResolvedBet(payload)`
**Purpose:** Add a resolved bet to the write queue for async DB insertion.
**Side effects:** Pushes to `writeQueue`, triggers `flushResolvedBetQueue()`.

### `getOverview({ wallet, range, txLimit })`
**Returns:** `{ wallet, stats, pnlSeries, transactions, settings, linkedSessionWallets }`
**Notes:** Resolves the wallet scope (main + all linked session wallets) before querying.

### `createAuthChallenge(wallet)`
**Returns:** `{ nonce, message, expiresAt }`
**Side effects:** Inserts nonce into `profile_auth_nonces` table (TTL: 5 min default).

### `verifyAuthChallenge({ wallet, nonce, signature })`
**Returns:** `{ wallet, accessToken, expiresAt }`
**Algorithm:**
1. Look up nonce in DB; check not expired, not used
2. `ethers.verifyMessage(message, signature)` → recover signer address
3. Compare recovered address to `wallet` (case-insensitive)
4. Mark nonce used, create session in `profile_auth_sessions`

### `linkSessionWallet({ mainWallet, sessionWallet })`
**Purpose:** Associate a session wallet address with a main wallet for unified stats.
**Side effects:** Updates `wallet_links` table.

### `handleReferral(db, logger, { userWallet, referralCode })`
**Purpose:** Record a referral relationship if not already set.
**Side effects:** Writes `referred_by` to `profile_settings` for `userWallet`.

### `normalizeWallet(input)`
**Returns:** EVM checksummed address string, or `null` if invalid.
**Uses:** `ethers.getAddress(input)`

---

## lib/friendlyError.ts

### `friendlyError(rawError)`
**Input:** Raw error (Error object, string, or unknown)

**Returns:** Player-readable error string

**Mapped patterns include:**
- `insufficient funds` → "Your wallet doesn't have enough AVAX for gas"
- `user rejected` → "Transaction cancelled"
- `market_paused` → "Betting is paused — price feed unavailable"
- `allowance` → "Token approval failed — please try again"
- `nonce` → "Transaction nonce issue — please refresh"
- `timeout` → "Transaction timed out — check your wallet"
- `SPRM balance` → "Not enough SPRM tokens"
- `bet already resolved` → "This bet was already settled"
