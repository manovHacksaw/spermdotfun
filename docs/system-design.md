# System Design

This document covers the key design decisions in SPRMFUN: the grid model, price simulation physics, VRF-based randomness, betting mechanics, payout model, and token economics.

---

## Grid Model

### Layout

The game world is a horizontally scrolling grid of **columns** and **rows**.

| Constant | Value | Meaning |
|---|---|---|
| `COLUMN_WIDTH` | 50 px | Width of each grid column |
| `ROW_COUNT` | 500 | Number of rows per column |
| `POINTER_LEFT_FRAC` | ~0.30 | Pointer rendered ~30% from the right edge of the viewport |
| `MAX_HISTORY` | 4000 (client) / 2800 (server) | Max pointer trail points kept in memory |
| `MAX_COLUMNS` | 400 | Max columns held server-side |

The pointer moves **left-to-right** at a constant horizontal speed of ~0.95 px per 33 ms tick, scrolling the viewport with it. Each column that the pointer enters represents an "event" where all pending bets for that column are resolved.

### Column Generation

New columns are generated ahead of the pointer at a fixed lookahead distance. Each column is assigned:

- A unique ID and X coordinate
- 500 boxes (one per row), each with a pre-computed multiplier
- A VRF-determined winning row (received asynchronously from Chainlink)

### Multiplier Assignment

Each box's multiplier is assigned based on its distance from the centre row (row 250). The distribution is symmetric with higher multipliers toward the edges.

Typical multiplier range: **0.10× (near-bust) → 20× (edge row)**.

Multipliers are expressed as `mult_num / 100` for integer arithmetic in the smart contract (e.g., `mult_num = 350` → 3.50×).

---

## Price Simulation

### Physics Model

The server runs a momentum-based simulation at **30 Hz** (every 33 ms) in `stepSim()`.

```
priceDelta = currentAvaxPrice - prevAvaxPrice

// Momentum update
velocity += priceDelta × PRICE_CHAOS_FACTOR × MOMENTUM_INERTIA
velocity *= FRICTION

// Flat market chaos injection
if price unchanged for >1500ms:
    velocity += escalating random impulse

// Clamp
simY = clamp(simY + velocity, -50, +50)
```

| Parameter | Value | Effect |
|---|---|---|
| `PRICE_CHAOS_FACTOR` | 45.0 | Scales price deltas into visible vertical movement |
| `FRICTION` | 0.85 | Velocity decay per tick (damping) |
| `MOMENTUM_INERTIA` | 0.08 | Weight of new price delta vs existing velocity |
| `EMA_ALPHA` | 0.12 | Smoothing coefficient for broadcast Y |

The normalised `simY` value (−50 to +50) is mapped linearly to a row index (0–499) for the winning-row comparison.

### Flat Market Behaviour

If the AVAX price does not change for more than 1500 ms, the server injects small random impulses that grow over time. This ensures the pointer always keeps moving even during low-volatility periods, and prevents all bets from clustering on the same row.

---

## VRF Randomness

### Purpose

VRF (Verifiable Random Function) determines the **winning row** for each column. The winning row is the exact row (±2 forgiveness) that the pointer must visit for a bet on that row to win.

This prevents the server from steering the pointer to avoid paying out winners. The winning rows are committed to the blockchain before the pointer reaches those columns.

### Epoch System

VRF entropy is refreshed every **15 columns** (one epoch ≈ 150 seconds at current pointer speed).

1. Server calls `contract.requestVrf()` when approaching the end of the current epoch.
2. Chainlink VRF Coordinator returns a 256-bit random value via `fulfillRandomWords()`.
3. Server emits `VrfFulfilled(epochId, requestId, vrfResult)`.
4. Server uses `vrfResult` to derive a winning row for each column in the next epoch.

### Row Derivation

```
winRow = deriveWinningRow(vrfResult, colX):
    hash = SHA256(vrfResult || colX)
    delta = weightedRowDelta(hash[0])  // weighted: ±1 most common, ±4 rarest
    winRow = clamp(prevWinRow + delta, boundary_repulsion)
```

Weighted row deltas favour small movements (±1 or ±2) and rarely jump (±4), creating a smooth diagonal path through the grid. Boundary repulsion pushes the winning row away from row 0 and row 499 to prevent the path from getting stuck at the edges.

### Local Fallback

If `VRF_ENABLED=false` or the contract is unavailable, the server generates local `crypto.randomBytes(32)` entropy and uses the same `deriveWinningRow` algorithm. This maintains the same row-distribution behaviour but without on-chain verifiability.

### Pointer Steering

To ensure the pointer actually reaches the VRF-determined winning row, the server applies an **elastic steering bias**:

```
if pointer is in column c and steerActive:
    steeringForce = (targetY - simY) × 0.04
    velocity += steeringForce
```

Steering is active from the moment the pointer enters a column until it has crossed ~60% of that column's width. This keeps the movement looking natural (price-driven) while guaranteeing the winning row is visited.

---

## Betting Mechanics

### Bet Placement

1. Player selects a cell (column + row) in a **future** column (at least 1 column ahead of the pointer).
2. Player calls `contract.placeBet(boxX, boxRow, multNum, amount)`.
3. SPRM tokens are transferred from the player to the contract (held in escrow).
4. Player calls `POST /register-bet` to inform the server.
5. The server stores the bet in `pendingBets` with the betId from the contract event.

### Bet Resolution

When the pointer crosses column `colX`, the server resolves all pending bets registered against that column:

1. Retrieve `columnRowRange[colX]` — the min and max rows the pointer visited while in that column.
2. A bet wins if: `betRow >= minRow - 2 && betRow <= maxRow + 2` (±2-row forgiveness).
3. Server signs the resolution: `ECDSA.sign(keccak256(betId, won, contractAddress), serverPrivKey)`.
4. Server calls `contract.resolveBet(betId, won, serverSig)`.
5. Contract verifies the signature matches `resolverSigner` and transfers payout.

### Forgiveness Window

The ±2 row forgiveness window accounts for network latency between the player clicking and the bet being registered on the server. A player who clicked a cell that the pointer just barely missed should still win.

### Payout Formula

```
grossPayout = betAmount × (multNum / 100)
netPayout   = grossPayout × (1 − houseEdgeBps / 10000)
            = grossPayout × 0.98   (with houseEdgeBps = 200)
```

Example: 10 SPRM bet on a 3.50× cell → `10 × 3.50 × 0.98 = 34.3 SPRM` net payout.

### Column Validity Window

Bets can only be registered for columns that are **at most 200 columns in the past** relative to the current pointer position. This prevents server-side replays of very old bets while allowing for mining latency on slower networks.

---

## Feed Staleness & Market Pausing

If the Binance price feed goes silent for more than **5 seconds**:

1. `bettingPaused = true`
2. Server broadcasts `{ type: "market_paused", reason: "price_feed_stale" }`
3. `/register-bet` returns HTTP 503 `{ ok: false, error: "market_paused" }`
4. Canvas shows grey overlay + "FEED PAUSED" text

When the feed recovers:
1. `bettingPaused = false`
2. Server broadcasts `{ type: "market_resumed" }`
3. Active pending bets resume resolving against new pointer positions

---

## Token Economics

### SPRM Token

- Standard ERC-20, 18 decimals
- Deployed at `0x9a30294499b8784b80096b6C6Dd87456972eCA70` (Fuji)
- Players acquire SPRM via the faucet (testnet) or by purchasing (mainnet)

### Faucet

- `SprmFaucet` contract at `0x50fEF1bCA8686302ca7Dac9D596aF121A288855B`
- Dispenses **50 SPRM per 24 hours** per wallet address
- UI available at `/faucet`

### House Edge

- **2%** (`houseEdgeBps = 200`)
- Applied only on winning bets: 2% of gross payout is retained by the contract and sent to the treasury address
- Losing bets: the full bet amount stays in the contract's house bank

### House Bank

- The contract holds a house bank of SPRM tokens to fund payouts
- The house bank balance is broadcast to clients via the `house_bank` WebSocket message
- If the house bank runs low, the treasury must top it up to continue operations

### Referral System (when profile DB is enabled)

- Players earn a **0.5% reward** on each bet made by a referred user
- Referral codes are auto-generated per wallet (4-byte hex, uppercase)
- Rewards are credited to `profile_settings.referral_earned`

---

## Security Model

### Server Signing

The server holds `SERVER_PRIVATE_KEY` and is the sole entity authorised to call `resolveBet`. The contract verifies the signature on every resolution call. This means:

- The server cannot create a fake bet (the betId must exist on-chain from a real `placeBet` call).
- The server cannot change the outcome after signing (the signature commits to `betId + won + contractAddress`).
- Any compromise of `SERVER_PRIVATE_KEY` would allow fraudulent resolutions — rotate it and call `contract.setResolverSigner(newAddress)` immediately if compromised.

### Session Wallet Trust Model

- The session wallet private key is generated client-side and stored only in `localStorage`.
- The server never sees the session wallet key.
- The session wallet can only spend tokens it was explicitly funded with.
- A session wallet compromise exposes only that wallet's balance, not the main wallet.

### VRF Verifiability

- The VRF request/fulfillment is on-chain and publicly auditable.
- Clients receive `vrfPaths` (winning rows per column) via WebSocket — this is informational only; the server's in-memory vrfPath is the authoritative source for resolution.
- Players can verify any resolution by checking the on-chain `BetResolved` event and comparing the `resolverSigner` signature.
