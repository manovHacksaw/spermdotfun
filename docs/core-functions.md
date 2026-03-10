# Core Functions

This document catalogues every major function in SPRMFUN with its inputs, outputs, and side effects.

---

## server.js

### `deriveWinningRow(vrfResult, serverSalt, boxX)`

| | |
|---|---|
| **Location** | `server.js` |
| **Inputs** | `vrfResult: Buffer(32)`, `serverSalt: Buffer(32)`, `boxX: number` |
| **Returns** | `number` — winning row index (0–9) |
| **Side effects** | None |
| **Description** | Computes `sha256(vrfResult ‖ serverSalt ‖ boxX_as_LE_int64)[0] % 10`. Mirrors the deterministic formula that the on-chain `consume_vrf` path would use. |

---

### `stepSim()`

| | |
|---|---|
| **Location** | `server.js` |
| **Inputs** | None (reads/writes module-level `simY`, `simVelocity`, `simTime`) |
| **Returns** | `{ y: number, multiplier: number }` — current pointer position (0–1) and display multiplier |
| **Side effects** | Mutates `simY`, `simVelocity`, `simTime` |
| **Description** | Advances the bounded random-walk price simulator by one tick. Applies damping (×0.95), Gaussian noise, a sinusoidal trend, occasional shocks, and mean-reversion toward 0.5. |

---

### `steerTowardRow(targetRow, curColX, currentX)`

| | |
|---|---|
| **Location** | `server.js` |
| **Inputs** | `targetRow: number` (0–9), `curColX: number` (column start px), `currentX: number` (pointer px) |
| **Returns** | `void` |
| **Side effects** | Nudges `simVelocity` toward `targetRow`'s Y centre |
| **Description** | Computes pixels remaining in the current column and adds a proportional velocity push so the pointer naturally reaches the VRF winning row. Urgency is clamped to [0.01, 0.15]. |

---

### `refreshVrf(startColX)`

| | |
|---|---|
| **Location** | `server.js` |
| **Inputs** | `startColX: number` — first column X to pre-compute |
| **Returns** | `Promise<void>` |
| **Side effects** | Generates new `currentVrfResult` and `currentServerSalt`; calls `consume_vrf` on-chain; populates `vrfPath` for `VRF_REFRESH_COLS` columns; broadcasts `path_revealed` and `vrf_state` WS messages; increments `currentSeedIndex` |
| **Description** | Refreshes the server-side VRF every `VRF_REFRESH_COLS` (8) columns. Uses `vrfRefreshing` flag to prevent concurrent calls. Falls through gracefully if `program` is not initialised (offline mode). |

---

### `resolveBet(betKey)`

| | |
|---|---|
| **Location** | `server.js` |
| **Inputs** | `betKey: string` — `betPda.toBase58()` used as Map key |
| **Returns** | `Promise<void>` |
| **Side effects** | Removes `betKey` from `pendingBets`; calls `resolve_bet` on-chain; broadcasts `bet_resolved` WS message to all clients |
| **Description** | Determines win/lose by checking whether `bet.box_row` falls within `columnRowRange[colX]`. Passes `winRow = box_row` if win, any other row otherwise. Logs the outcome. Silently skips if no row range has been recorded yet. |

---

### `makeColumns(count)`

| | |
|---|---|
| **Location** | `server.js` |
| **Inputs** | `count: number` — number of columns to generate |
| **Returns** | `GridColumn[]` — array of column objects `{id, x, boxes[]}` |
| **Side effects** | Increments `gridIdCounter`; advances `nextColX` by `count × COLUMN_WIDTH` |
| **Description** | Factory that creates grid columns starting at `nextColX`. Each column has 10 boxes, one per multiplier row. |

---

### `broadcast(msg)`

| | |
|---|---|
| **Location** | `server.js` |
| **Inputs** | `msg: string` — serialised JSON message |
| **Returns** | `void` |
| **Side effects** | Calls `ws.send(msg)` on every open client in `clients` set |
| **Description** | Fan-out broadcast helper. Skips clients whose `readyState` is not `OPEN`. |

---

### Pointer loop (anonymous `setInterval`, 33 ms)

| | |
|---|---|
| **Location** | `server.js` |
| **Trigger** | Every 33 ms |
| **Side effects** | Advances `serverCurrentX`; calls `stepSim`; updates `historyBuffer` and `columnRowRange`; broadcasts `pointer` message; triggers `resolveBet` for eligible pending bets; triggers `refreshVrf` when due; logs every 30 ticks and column transitions |

---

### Grid loop (anonymous `setInterval`, 3 000 ms)

| | |
|---|---|
| **Location** | `server.js` |
| **Trigger** | Every 3 000 ms |
| **Side effects** | Calls `makeColumns(5)` if look-ahead < 25 columns; appends to `allColumns`; prunes `allColumns` to 300 entries; broadcasts `grid` message |

---

## components/StockGrid.tsx

### `resize()`

| | |
|---|---|
| **Location** | `StockGrid.tsx` |
| **Inputs** | None (reads `canvasRef`, `containerRef`) |
| **Returns** | `void` |
| **Side effects** | Sets `canvas.width`, `canvas.height`; updates `state.current.W` and `state.current.H` |
| **Description** | Syncs canvas pixel dimensions to the container's bounding rect. Called on mount and on `window.resize`. |

---

### `yToRow(ny)`

| | |
|---|---|
| **Location** | `StockGrid.tsx` |
| **Inputs** | `ny: number` — normalised Y (0 = top, 1 = bottom) |
| **Returns** | `number` — row index 0–9 (0 = bottom row) |
| **Side effects** | None |
| **Description** | Converts a normalised Y coordinate to a row index. `row = ROW_COUNT - 1 - floor(ny × ROW_COUNT)`. |

---

### `draw()`

| | |
|---|---|
| **Location** | `StockGrid.tsx` |
| **Inputs** | None (reads `canvasRef`, `state.current`) |
| **Returns** | `void` |
| **Side effects** | Paints the entire canvas each frame |
| **Description** | Full-frame canvas repaint. Renders in order: (1) background, (2) grid lines, (3) per-column box content (visited, pending, hover, resolved), (4) history polyline + glow, (5) pointer dot + crosshair + multiplier label, (6) WIN/LOSE toast, (7) header bar. |

---

### `loop()`

| | |
|---|---|
| **Location** | `StockGrid.tsx` |
| **Inputs** | None |
| **Returns** | `void` |
| **Side effects** | Calls `draw()`; logs a stall warning if no pointer event received in >5 s; schedules next frame via `requestAnimationFrame` |
| **Description** | `rAF`-driven render loop. Stores the frame ID in `rafRef.current` for cleanup. |

---

### `connect()` (inner function in mount `useEffect`)

| | |
|---|---|
| **Location** | `StockGrid.tsx` (mount `useEffect`) |
| **Inputs** | None (closes over `state`, `unmounted`, `retryTimer`, `activeWs`) |
| **Returns** | `void` |
| **Side effects** | Opens a `WebSocket` to `NEXT_PUBLIC_WS_URL`; sets `state.current.connected`; handles `init`, `pointer`, `grid`, `vrf_state`, `path_revealed`, `bet_resolved` messages; schedules reconnect on close |
| **Description** | Establishes the WebSocket connection. On `init`, replaces columns/history and rebuilds `visitedCols`. On `pointer`, pushes to `historyBuffer`, updates `visitedCols` and `columnRowRange`. On `path_revealed`, resolves any pending selections whose column is now revealed. |

---

### `getBoxAt(mouseX, mouseY)`

| | |
|---|---|
| **Location** | `StockGrid.tsx` (mouse `useEffect`) |
| **Inputs** | `mouseX: number`, `mouseY: number` — canvas-relative coordinates |
| **Returns** | `{ colX: number; row: number } \| null` |
| **Side effects** | None |
| **Description** | Maps mouse coordinates to a grid cell. Returns `null` if the column is the current or past column (only future columns are selectable). |

---

### `onMouseMove(e)` / `onClick(e)` / `onMouseLeave()`

| | |
|---|---|
| **Location** | `StockGrid.tsx` (mouse `useEffect`) |
| **Side effects** | `onMouseMove`: updates `state.current.hoverBox` and canvas cursor. `onClick`: toggles selection in `state.current.selections`; dispatches `sprmfun:select` CustomEvent. `onMouseLeave`: clears hover state. |

---

### `onDeselect(e)`

| | |
|---|---|
| **Location** | `StockGrid.tsx` |
| **Inputs** | `CustomEvent` with `detail: { colX, row }` |
| **Returns** | `void` |
| **Side effects** | Removes the cell from `state.current.selections` |
| **Description** | Handles the `sprmfun:deselect` event dispatched by `GameHUD` when the user cancels the bet modal. |

---

## components/GameHUD.tsx

### `fetchBalance()`

| | |
|---|---|
| **Location** | `GameHUD.tsx` |
| **Inputs** | None (closes over `publicKey`, `connection`) |
| **Returns** | `Promise<void>` |
| **Side effects** | Updates React state `balance`; calls `getAccount` on the user's SPRM ATA |
| **Description** | Fetches the user's SPRM token balance. Sets `balance = 0` if the ATA does not exist. Called on wallet connection and every 5 s. |

---

### `cancelBet(colX, row)`

| | |
|---|---|
| **Location** | `GameHUD.tsx` |
| **Inputs** | `colX: number`, `row: number` |
| **Returns** | `void` |
| **Side effects** | Dispatches `sprmfun:deselect` CustomEvent; sets `pendingBet = null` |
| **Description** | Cancels the active bet modal and removes the cell's green highlight from the grid. |

---

### `handleFaucet()`

| | |
|---|---|
| **Location** | `GameHUD.tsx` |
| **Inputs** | None (closes over `program`, `publicKey`, `connection`, `signTransaction`, `fetchBalance`) |
| **Returns** | `Promise<void>` |
| **Side effects** | May call `POST /api/airdrop`; builds and submits a `faucet(5 × ONE_TOKEN)` transaction; polls for confirmation (max 40 × 1 s); calls `fetchBalance` on success; shows `alert` on error |
| **Description** | Checks AVAX balance; requests an airdrop if below 0.01 AVAX; then submits the faucet contract call. Uses resend-every-2-s + polling strategy to handle local node latency. |

---

### `handlePlaceBet()`

| | |
|---|---|
| **Location** | `GameHUD.tsx` |
| **Inputs** | None (closes over `program`, `publicKey`, `pendingBet`, `betAmount`, `connection`, `signTransaction`, `fetchBalance`) |
| **Returns** | `Promise<void>` |
| **Side effects** | Validates amount; derives `betPda`; builds and submits `place_bet` tx; polls for confirmation; calls `POST /register-bet`; updates `betStatus`; calls `fetchBalance`; closes modal after 1.5 s on success |
| **Description** | Core bet placement flow. Amount is parsed, converted to `BN` raw units. The bet PDA seed is `[b"bet", user, boxXBytes(box_x), [box_row]]`. Uses same resend-and-poll pattern as the faucet. |

---

### `boxXBytes(boxX)`

| | |
|---|---|
| **Location** | `GameHUD.tsx` |
| **Inputs** | `boxX: number` |
| **Returns** | `Buffer` — 8-byte little-endian representation of `boxX` |
| **Side effects** | None |
| **Description** | Encodes the column X pixel value as a signed 64-bit little-endian integer. Must match the on-chain PDA seed encoding (`box_x.to_le_bytes()`). |

---

## components/GlobalChat.tsx

### `fetchSprmBalance(address)`

| | |
|---|---|
| **Location** | `GlobalChat.tsx` |
| **Inputs** | `address: string` — EVM address (hex) |
| **Returns** | `Promise<number \| null>` |
| **Side effects** | Calls `connection.getTokenAccountBalance` |
| **Description** | Derives the SPRM ATA for the address and fetches its balance. Returns `null` on any error (account not found, invalid address, etc.). |

---

### `handleSenderMouseEnter(fullSender)`

| | |
|---|---|
| **Location** | `GlobalChat.tsx` |
| **Inputs** | `fullSender: string` — full 44-char base58 public key, or short display string |
| **Returns** | `void` |
| **Side effects** | Sets `tooltip` state; calls `fetchSprmBalance` if a full address is available |
| **Description** | Shows a tooltip with the sender's SPRM balance on hover. Uses address length/format to detect whether a full lookup is possible. |

---

### `handleSubmit(e)`

| | |
|---|---|
| **Location** | `GlobalChat.tsx` |
| **Inputs** | `React.FormEvent` |
| **Returns** | `void` |
| **Side effects** | Calls `pubnub.publish`; clears `input` state |
| **Description** | Publishes the chat message with the wallet's short address as sender. Anonymous users send as `'Anon'`. Message is trimmed and truncated to 200 characters via the `<input maxLength>` attribute. |

---

## app/api/airdrop/route.ts

### `POST(req)`

| | |
|---|---|
| **Location** | `app/api/airdrop/route.ts` |
| **Inputs** | JSON body: `{ wallet: string }` |
| **Returns** | `NextResponse` — `{ok, airdropped, sig?, balance}` or `{error}` |
| **Side effects** | May call `connection.requestAirdrop` and `confirmTransaction` |
| **Description** | Airdrops 1 AVAX to the given wallet if its current balance is below 0.01 AVAX. Returns `airdropped: false` if the threshold is already met. |

---

## app/api/idl/route.ts

### `GET()`

| | |
|---|---|
| **Location** | `app/api/idl/route.ts` |
| **Inputs** | None |
| **Returns** | `NextResponse` — parsed IDL JSON |
| **Side effects** | Reads legacy `sprmfun-anchor/target/idl/sprmfun_anchor.json` from disk |
| **Description** | Serves the compiled contract ABI to the browser so `GameHUD` can construct a typed `ethers.Contract` instance (legacy). |

---

## sprmfun-anchor/programs/sprmfun-anchor/src/lib.rs

### `initialize(ctx, house_edge_bps)`

| | |
|---|---|
| **Inputs** | `house_edge_bps: u16` (must be ≤ 5 000) |
| **Side effects** | Creates `State` PDA and `Mint` PDA; sets authority, house edge, seed fields |
| **Errors** | `HouseEdgeTooHigh` |

---

### `init_atas(ctx)`

| | |
|---|---|
| **Side effects** | Creates escrow ATA (`associated_token(mint, state)`) and treasury ATA (`associated_token(mint, authority)`); stores escrow pubkey in `State` |

---

### `faucet(ctx, amount)`

| | |
|---|---|
| **Inputs** | `amount: u64` — token amount in raw units (9 decimals) |
| **Side effects** | Mints `amount` tokens to `user_ata` using `state` PDA as CPI signer; uses `init_if_needed` for the ATA |
| **Errors** | `FaucetDisabled` |

---

### `consume_vrf(ctx, randomness, server_salt)`

| | |
|---|---|
| **Inputs** | `randomness: [u8; 32]`, `server_salt: [u8; 32]` |
| **Side effects** | Updates `state.vrf_result`, `state.seed_salt`, `state.seed_index`, `state.seed_updated_at`; emits `VrfUpdated` event |
| **Errors** | `Overflow` (seed_index overflow — extremely unlikely) |
| **Access control** | Only the authority (state.authority) can sign |

---

### `place_bet(ctx, box_x, box_row, amount)`

| | |
|---|---|
| **Inputs** | `box_x: i64` (column X in pixels), `box_row: u8` (0–9), `amount: u64` (> 0) |
| **Side effects** | Transfers `amount` tokens from `user_ata` to escrow; initialises `Bet` PDA |
| **Errors** | `InvalidRow`, `ZeroBet` |

---

### `resolve_bet(ctx, winning_row)`

| | |
|---|---|
| **Inputs** | `winning_row: u8` (0–9) |
| **Side effects** | Marks bet as resolved; if `bet.box_row == winning_row`: transfers net payout from escrow to `user_ata` and fee to treasury; emits `BetResolved` event |
| **Errors** | `AlreadyResolved`, `InvalidRow` |
| **Access control** | Only the authority can sign |

---

### `sweep_escrow(ctx)`

| | |
|---|---|
| **Side effects** | Transfers entire escrow balance to treasury; no-op if escrow is empty |
| **Access control** | Only the authority can sign |

---

## scripts/init-devnet.js — `main()`

| | |
|---|---|
| **Side effects** | Reads local keypair; calls contract initialize helper if state is uninitialized; creates token accounts if missing; logs addresses to stdout |
| **Idempotent** | Yes — skips already-created accounts |

---

## scripts/prefund-escrow.js — `main()`

| | |
|---|---|
| **Side effects** | Mints 1 M SPRM to authority ATA via faucet; then transfers 1 M SPRM from authority ATA to escrow |
| **Precondition** | `initialize` and `init_atas` must have been called first |
