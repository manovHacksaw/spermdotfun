require("dotenv").config();

const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { WebSocketServer, WebSocket } = require("ws");
const { ethers } = require("ethers");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { createProfileService } = require("./lib/server/profile-service");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const NEXT_PORT = 3000;
const WS_PORT = 3001;

const app = next({ dev, hostname, port: NEXT_PORT });
const handle = app.getRequestHandler();

// ── Layout constants ────────────────────────────────────────────────────────────
const COLUMN_WIDTH = 50;
const PX_PER_EVENT = 0.95; // Reduced by 5% (was 1)

// ── Dynamic multiplier generator (1.01x–2.00x per box) ─────────────────────────
// Weighted multiplier: exponential falloff so high values are rare.
// Uses inverse-CDF of an exponential distribution clamped to [1.01, 20.00].
// λ=0.45 gives ~85% of boxes below 10×, ~98% below 15×, ~2% reach 15–20×.
function randomMult() {
  const lambda = 0.22; // ~87% below 10×, ~97% below 15×, ~3% golden (15–20×)
  const minX = 1.01,
    maxX = 20.0;
  // Inverse CDF of truncated exponential: x = min - ln(1 - u*(1-e^{-λ(max-min)}))/λ
  const u = Math.random();
  const raw =
    minX - Math.log(1 - u * (1 - Math.exp(-lambda * (maxX - minX)))) / lambda;
  const display = Math.min(maxX, Math.max(minX, raw));
  const num = Math.round(display * 100); // integer cents, e.g. 173 = 1.73×
  return { num, den: 100, display: num / 100 };
}

// ── Avalanche / EVM setup ──────────────────────────────────────────────────────
const RPC_URL = process.env.AVALANCHE_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
const WS_RPC_URL = process.env.AVALANCHE_WS_RPC_URL || "wss://api.avax-test.network/ext/bc/C/ws";
const GAME_ADDRESS = process.env.GAME_CONTRACT_ADDRESS || "";
// Set VRF_ENABLED=true only when deploying a contract with requestVrf() support (SprmfunGame, not SprmGameSimple)
const VRF_ENABLED = process.env.VRF_ENABLED === "true";

// Minimal ABI — only the functions/events the server uses
const GAME_ABI = [
  "function resolveBet(uint256 betId, bool won, bytes calldata serverSig) external",
  "function requestVrf() external returns (uint256 requestId)",
  "function isVrfPending() external view returns (bool)",
  "event BetPlaced(uint256 indexed betId, address indexed player, uint32 boxX, uint16 boxRow, uint16 multNum, uint256 amount)",
  "event BetResolved(uint256 indexed betId, address indexed player, bool won, uint256 payout)",
  "event VrfFulfilled(uint256 indexed epochId, uint256 indexed requestId, bytes32 vrfResult)",
  "event VrfRequested(uint256 indexed epochId, uint256 indexed requestId)",
];

let evmProvider = null;
let serverWallet = null;
let gameContract = null;
let tokenContract = null;
let onchainReady = false;

const TOKEN_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)"
];

function initEvm() {
  const privateKey = process.env.SERVER_PRIVATE_KEY;
  if (!privateKey) {
    console.warn(
      "[EVM] SERVER_PRIVATE_KEY not set — on-chain resolution disabled.",
    );
    return;
  }
  if (!GAME_ADDRESS) {
    console.warn(
      "[EVM] GAME_CONTRACT_ADDRESS not set — on-chain resolution disabled.",
    );
    return;
  }
  evmProvider = new ethers.JsonRpcProvider(RPC_URL);
  serverWallet = new ethers.Wallet(privateKey, evmProvider);
  gameContract = new ethers.Contract(GAME_ADDRESS, GAME_ABI, serverWallet);

  const tokenAddr = process.env.NEXT_PUBLIC_TOKEN_ADDRESS || "";
  if (tokenAddr) {
    tokenContract = new ethers.Contract(tokenAddr, TOKEN_ABI, evmProvider);
  }

  // Separate WebSocket provider for event subscriptions — avoids eth_filter expiry on Fuji HTTP RPC
  const wsProvider = new ethers.WebSocketProvider(WS_RPC_URL);
  gameContract._wsContract = new ethers.Contract(GAME_ADDRESS, GAME_ABI, wsProvider);


  onchainReady = true;
  console.log(`[EVM] Connected — wallet=${serverWallet.address} contract=${GAME_ADDRESS} token=${tokenAddr}`);
}

const profileService = createProfileService({
  logger: console,
  getTxResolvedAt: async (txHash) => {
    try {
      if (!evmProvider) return null;
      const receipt = await evmProvider.getTransactionReceipt(txHash);
      if (!receipt?.blockNumber) return null;
      const block = await evmProvider.getBlock(receipt.blockNumber);
      if (block?.timestamp) return new Date(block.timestamp * 1000);
      return null;
    } catch {
      return null;
    }
  },
});

let profileBackfillInFlight = false;

// ── Rate limiting ────────────────────────────────────────────────────────────────
// Sliding-window per-IP counter; no external dependency needed.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60; // registrations per minute per IP
const rateLimitMap = new Map(); // ip → [timestamp, ...]

function checkRateLimit(ip) {
  const now = Date.now();
  const window = RATE_LIMIT_WINDOW_MS;
  const arr = (rateLimitMap.get(ip) || []).filter(t => now - t < window);
  if (arr.length >= RATE_LIMIT_MAX) return false;
  arr.push(now);
  rateLimitMap.set(ip, arr);
  return true;
}

// Prune stale rate-limit entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [ip, arr] of rateLimitMap) {
    const pruned = arr.filter(t => t > cutoff);
    if (pruned.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, pruned);
  }
}, 300_000);

// ── Bet validation ───────────────────────────────────────────────────────────────
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_BET_AMOUNT = parseFloat(process.env.MAX_BET_AMOUNT || '10000');

function validateBetPayload(msg) {
  if (!msg || typeof msg !== 'object') return 'Invalid payload';
  if (!EVM_ADDR_RE.test(String(msg.user || ''))) return 'Invalid user address';
  const row = Number(msg.box_row);
  if (!Number.isFinite(row) || row < 0 || row > 499) return 'box_row out of range [0,499]';
  const bx = Number(msg.box_x);
  if (!Number.isFinite(bx) || bx < 0) return 'box_x must be a non-negative number';
  const mn = Number(msg.mult_num);
  if (!Number.isFinite(mn) || mn < 101 || mn > 2000) return 'mult_num out of range [101,2000]';
  const ba = Number(msg.bet_amount);
  if (!Number.isFinite(ba) || ba <= 0) return 'bet_amount must be positive';
  if (ba > MAX_BET_AMOUNT) return `bet_amount exceeds maximum (${MAX_BET_AMOUNT} SPRM)`;
  return null; // ok
}

// ── Market pause state ───────────────────────────────────────────────────────────
const PRICE_STALE_MS = 5000;       // ms since last price tick before pausing bets
let lastPriceTick = 0;             // timestamp of last Binance price message
let bettingPaused = false;

function checkAndUpdateMarketPause() {
  if (lastPriceTick === 0) return; // haven't received first tick yet
  const stale = Date.now() - lastPriceTick > PRICE_STALE_MS;
  if (stale !== bettingPaused) {
    bettingPaused = stale;
    broadcast(JSON.stringify({ type: 'market_paused', paused: bettingPaused }));
    console.log(`[MARKET] ${bettingPaused ? 'PAUSED (feed stale)' : 'RESUMED'}`);
  }
}

// ── House Bank Balance ──────────────────────────────────────────────────────────
let houseBankBalance = 0;

async function updateHouseBank() {
  if (!onchainReady || !tokenContract || !GAME_ADDRESS) return;
  try {
    const bal = await tokenContract.balanceOf(GAME_ADDRESS);
    const formatted = parseFloat(ethers.formatUnits(bal, 18));
    if (formatted !== houseBankBalance) {
      houseBankBalance = formatted;
      broadcast(JSON.stringify({ type: 'house_bank', balance: houseBankBalance }));
      console.log(`[BANK] House bank updated: ${houseBankBalance.toFixed(2)} SPRM`);
    }
  } catch (err) {
    console.error(`[BANK] Failed to fetch house bank: ${err.message}`);
  }
}

// Update house bank every 30 seconds
setInterval(updateHouseBank, 30000);

// ── Leaderboard throttle ─────────────────────────────────────────────────────────
let leaderboardDirty = false;
setInterval(() => {
  if (leaderboardDirty && clients.size > 0) {
    broadcast(JSON.stringify(leaderboardPayload()));
    leaderboardDirty = false;
  }
}, 2000);

// ── VRF state ───────────────────────────────────────────────────────────────────
// Request new randomness every VRF_REFRESH_COLS columns. Oracle has latency so
// we request further ahead (15 cols) and trigger early (when 12 cols consumed).
const VRF_REFRESH_COLS = 15;

let currentVrfResult = crypto.randomBytes(32); // initial placeholder (used until oracle responds)
let currentSeedIndex = 0; // mirrors on-chain state.seed_index
let lastVrfColX = -Infinity; // colX when we last requested VRF
let vrfRequestPending = false; // guard against duplicate requests
let pendingVrfStartColX = 0; // colX for which the pending request was made
let vrfFailCount = 0; // consecutive oracle failures → trigger local fallback

// Winning row: weighted selection biased toward lastWinRow so jumps stay small.
// Weight table for delta = -4..+4 (9 entries). delta=0 is removed (weight=0) so
// the pointer ALWAYS moves diagonally — never stays at the same row across columns.
// Large jumps (±4) are rare. This forces a diagonal path for every column crossing.
const ROW_DELTA_WEIGHTS = [2, 4, 10, 20, 0, 20, 10, 4, 2]; // deltas -4..+4, no delta=0
const ROW_DELTA_CDF = (() => {
  const total = ROW_DELTA_WEIGHTS.reduce((a, b) => a + b, 0);
  const cdf = [];
  let cum = 0;
  for (const w of ROW_DELTA_WEIGHTS) {
    cum += w;
    cdf.push(Math.round((cum / total) * 256));
  }
  return cdf; // 9 entries, last ~256
})();
function weightedDelta(byte) {
  for (let i = 0; i < ROW_DELTA_CDF.length; i++) {
    if (byte < ROW_DELTA_CDF[i]) return i - 4; // index 0 → -4, index 4 → 0, index 8 → +4
  }
  return 4;
}

let lastWinRow = 250; // tracks previous winning row for smooth transitions

// (server_salt removed — oracle randomness is self-verifying)
function deriveWinningRow(vrfResult, boxX) {
  const boxXBuf = Buffer.alloc(8);
  boxXBuf.writeBigInt64LE(BigInt(boxX));
  const hash = crypto
    .createHash("sha256")
    .update(vrfResult)
    .update(boxXBuf)
    .digest();
  let delta = weightedDelta(hash[0]);
  // Boundary repulsion: closer to edge → stronger push back toward center.
  // Row 9 = top of screen (low y), row 0 = bottom (high y). Center = rows 4–5.
  // In 500 row grid, center is 250.
  const distFromCenter = lastWinRow - 250;
  const biasMag = Math.round(Math.abs(distFromCenter) * 0.7);
  const bias = -Math.sign(distFromCenter) * biasMag; // push toward center
  delta = Math.max(-4, Math.min(4, delta + bias));
  let row = Math.max(0, Math.min(499, lastWinRow + delta));
  // Diagonal enforcement: if boundary clamping caused row to equal lastWinRow, nudge by 1
  if (row === lastWinRow) {
    row = (hash[1] & 1) ? Math.min(499, row + 1) : Math.max(0, row - 1);
  }
  lastWinRow = row;
  return row;
}

// vrfPath: colX → { row, vrfResult } — keyed by column x pixel
const vrfPath = new Map();

// ── Binance WebSocket integration ──────────────────────────────────────────────
let currentAvaxPrice = 0;
let lastPrice = 0;
let priceBaseline = 0;
const PRICE_CHAOS_FACTOR = 142.5; // Reduced by 5% (was 150.0)
const FRICTION = 0.94;           // Drag to prevent infinite sliding
const MOMENTUM_INERTIA = 0.114;  // Reduced by 5% (was 0.12)

function initBinance() {
  const ws = new WebSocket("wss://stream.binance.com:9443/ws/avaxusdt@ticker");

  ws.onopen = () => {
    console.log("[BINANCE] Connected to AVAX/USDT stream");
  };

  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      const price = parseFloat(data.c); // current price
      if (price) {
        currentAvaxPrice = price;
        lastPriceTick = Date.now();
        // console.log(`[BINANCE] AVAX Price: ${price}`);
        if (priceBaseline === 0) priceBaseline = price;
      }
    } catch (e) {
      console.error("[BINANCE] Parse error", e);
    }
  };

  ws.onerror = (err) => {
    console.error("[BINANCE] Error", err);
  };

  ws.onclose = () => {
    console.log("[BINANCE] Connection closed, retrying in 5s...");
    setTimeout(initBinance, 5000);
  };
}

// ── Simulation state ────────────────────────────────────────────────────────────
let simY = 0.0;
let simVelocity = 0;
let simTime = 0;

// Target row the pointer is heading toward this column (set each time vrfPath changes col)
let steerTargetY = 0.5;
let steerActive = false;

// ── Price flatness detection ────────────────────────────────────────────────────
// When price is unchanged for PRICE_FLAT_MS, inject escalating chaos so the
// pointer remains unpredictable and players can't trivially read the path.
const PRICE_FLAT_MS = 1500;       // ms of no price change before chaos kicks in
const CHAOS_SHOCK_INTERVAL = 18;  // inject a velocity shock every N ticks (~600ms at 30fps)
let lastPriceChangedAt = 0;       // timestamp of last real price tick
let lastTrackedPrice = 0;         // price value at lastPriceChangedAt

function stepSim() {
  simTime++;

  // ── Price-Driven Momentum Physics ──
  if (currentAvaxPrice > 0) {
    if (lastPrice === 0) lastPrice = currentAvaxPrice;

    // Calculate the "Thrust" from the latest price change (6-decimal sensitivity)
    const priceDelta = currentAvaxPrice - lastPrice;
    lastPrice = currentAvaxPrice;

    // Track when price actually changed (not just ticked with the same value)
    const now = Date.now();
    if (currentAvaxPrice !== lastTrackedPrice) {
      lastTrackedPrice = currentAvaxPrice;
      lastPriceChangedAt = now;
    }
    const flatMs = lastPriceChangedAt > 0 ? now - lastPriceChangedAt : 0;
    const isFlat = flatMs >= PRICE_FLAT_MS;

    // Apply "Force" to velocity: Price Delta * Chaos * Inertia
    simVelocity = (simVelocity * FRICTION) + (priceDelta * PRICE_CHAOS_FACTOR * MOMENTUM_INERTIA);

    if (isFlat) {
      // Price has been constant — inject escalating unpredictable turbulence.
      // Strength grows with how long the price has been flat, capped at 3x.
      const flatSecs = flatMs / 1000;
      const chaosStrength = Math.min(3.0, 1.0 + flatSecs * 0.4);

      // Continuous random micro-noise (replaces the deterministic sin-jitter)
      simVelocity += (Math.random() - 0.5) * 0.003 * chaosStrength;

      // Periodic velocity shocks — sudden direction reversals every ~18 ticks
      if (simTime % CHAOS_SHOCK_INTERVAL === 0) {
        const shockDir = Math.random() < 0.5 ? 1 : -1;
        simVelocity += shockDir * (0.015 + Math.random() * 0.025) * chaosStrength;
        console.log(`[SIM] flat=${flatMs}ms shock dir=${shockDir > 0 ? '↑' : '↓'} strength=${chaosStrength.toFixed(2)}`);
      }
    } else {
      // Normal operation: small deterministic jitter replaced with true random noise
      simVelocity += (Math.random() - 0.5) * 0.001;
    }

    // Update position
    simY += simVelocity;

    // Gentle "Elastic" pull toward the VRF target row if steerActive
    // This blends the real market movement with our hidden winning path
    if (steerActive) {
      const steeringForce = (steerTargetY - simY) * 0.04;
      simVelocity += steeringForce;
    }

    // Centering force to prevent it from hugging the edges forever
    const bias = (0.0 - simY) * 0.005;
    simY += bias;

    // Hard clamps significantly relaxed for "infinite" feel
    simY = Math.max(-50, Math.min(50, simY));

    return { y: simY };
  }

  // Fallback to organic noise/steering if no price data yet
  const noiseScale = steerActive ? 0.004 : 0.01;
  const trend = Math.sin(simTime * 0.008) * 0.0003;
  const noise = (Math.random() - 0.5) * noiseScale;
  const shock =
    !steerActive && Math.random() < 0.015 ? (Math.random() - 0.5) * 0.05 : 0;
  const spring = steerActive ? (steerTargetY - simY) * 0.06 : 0;
  simVelocity = simVelocity * 0.93 + noise + trend + shock + spring;
  simVelocity = Math.max(-0.025, Math.min(0.025, simVelocity));
  simY += simVelocity;
  if (!steerActive) simY += (0.0 - simY) * 0.001;
  simY = Math.max(-50, Math.min(50, simY));
  return { y: simY };
}

function steerTowardRow(targetRow, curColX, currentX) {
  // box.row convention: y=0 is at center-ish (row 250), but we'll use raw row index
  const newTargetY = (targetRow - 250) / 30;
  // Only update target when entering a new column
  if (Math.abs(newTargetY - steerTargetY) > 0.001 || !steerActive) {
    steerTargetY = newTargetY;
  }
  steerActive = true;
  const pxLeft = curColX + COLUMN_WIDTH - currentX;
  // Disable steering near column exit (let pointer coast naturally through the target band)
  if (pxLeft < COLUMN_WIDTH * 0.15) steerActive = false;
}

// ── Global state ────────────────────────────────────────────────────────────────
let serverCurrentX = 0;
let gridIdCounter = 0;
let nextColX = 0;

// Track all rows the pointer passed through in each column
// colX → { minRow, maxRow } — all rows in [minRow..maxRow] are winners
const columnRowRange = new Map(); // colX → { minRow, maxRow }

const HISTORY_SIZE = 2800;
const historyBuffer = [];
const allColumns = [];
const clients = new Set();

// ── Multiplier history: recent column results (max 50 entries) ─────────────────
const MULT_HISTORY_SIZE = 50;
const multHistory = []; // { colX, multiplier, winRow, timestamp }

// ── Pending bets to resolve:
// Map<betIdStr, { betId, user, box_x, box_row, mult_num, bet_amount, lastBetAt }> ──
const pendingBets = new Map();
// Bets currently in a retry backoff window — pointer loop must skip these.
const retryingBets = new Set();

// ── Nickname cache: wallet address → { nickname, cachedAt } ────────────────────
const nicknameCache = new Map();
const NICKNAME_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function lookupNickname(address) {
  const cached = nicknameCache.get(address);
  if (cached && Date.now() - cached.cachedAt < NICKNAME_CACHE_TTL) return;
  // Mark as in-flight to prevent duplicate concurrent lookups
  nicknameCache.set(address, { nickname: null, cachedAt: Date.now() });
  profileService
    .getWalletNickname(address)
    .then((nickname) =>
      nicknameCache.set(address, {
        nickname: nickname || null,
        cachedAt: Date.now(),
      }),
    )
    .catch(() => { });
}

// ── Ghost selections: Map<"colX_row", Set<shortAddr>> ──────────────────────────
// Tracks all connected clients' highlighted boxes so others can see them.
const ghostSelections = new Map(); // key → Set<shortAddr>
// Per-ws: Set of keys this client has selected (for cleanup on disconnect)
const wsGhostKeys = new WeakMap(); // ws → Set<key>

function ghostAdd(ws, key, shortAddr) {
  if (!ghostSelections.has(key)) ghostSelections.set(key, new Set());
  ghostSelections.get(key).add(shortAddr);
  // Track key→shortAddr per ws so we can clean up on disconnect
  if (!wsGhostKeys.has(ws)) wsGhostKeys.set(ws, new Map());
  wsGhostKeys.get(ws).set(key, shortAddr);
}

function ghostRemove(ws, key, shortAddr) {
  const set = ghostSelections.get(key);
  if (set) {
    set.delete(shortAddr);
    if (set.size === 0) ghostSelections.delete(key);
  }
  const wsKeys = wsGhostKeys.get(ws);
  if (wsKeys) wsKeys.delete(key);
}

function ghostCleanupWs(ws) {
  const wsKeys = wsGhostKeys.get(ws);
  if (!wsKeys) return [];
  const removed = [];
  for (const [key, shortAddr] of wsKeys) {
    const set = ghostSelections.get(key);
    if (set) {
      set.delete(shortAddr);
      if (set.size === 0) ghostSelections.delete(key);
    }
    removed.push({ key, shortAddr });
  }
  wsGhostKeys.delete(ws);
  return removed;
}

function ghostSnapshot() {
  const entries = [];
  for (const [key, set] of ghostSelections) {
    const [colX, row] = key.split("_").map(Number);
    for (const shortAddr of set) entries.push({ colX, row, shortAddr });
  }
  return entries;
}

// ── Leaderboard: Map<userAddress, { shortAddr, wins, losses, totalBet, totalPayout }> ──
const leaderboard = new Map();

function updateLeaderboard(user, betAmount, payout, won) {
  const short = `${user.slice(0, 4)}…${user.slice(-4)}`;
  const entry = leaderboard.get(user) || {
    shortAddr: short,
    wins: 0,
    losses: 0,
    totalBet: 0,
    totalPayout: 0,
  };
  entry.wins += won ? 1 : 0;
  entry.losses += won ? 0 : 1;
  entry.totalBet += betAmount;
  entry.totalPayout += payout;
  leaderboard.set(user, entry);
  console.log(
    `[LB] updated ${short}  wins=${entry.wins} losses=${entry.losses} bet=${entry.totalBet.toFixed(2)} payout=${entry.totalPayout.toFixed(2)}`,
  );
}

function leaderboardPayload() {
  const entries = [];
  for (const [address, e] of leaderboard) {
    entries.push({ address, ...e });
  }
  entries.sort(
    (a, b) => b.totalPayout - b.totalBet - (a.totalPayout - a.totalBet),
  );
  return { type: "leaderboard", entries: entries.slice(0, 50) };
}

function activePlayersPayload() {
  const byUser = new Map();

  for (const info of pendingBets.values()) {
    if (!info?.user) continue;
    const address = String(info.user);
    const cached = nicknameCache.get(address);
    const existing = byUser.get(address) || {
      address,
      shortAddr: `${address.slice(0, 4)}…${address.slice(-4)}`,
      nickname: cached?.nickname || null,
      pendingBets: 0,
      totalBet: 0,
      lastBetAt: 0,
    };
    existing.pendingBets += 1;
    existing.totalBet += Number(info.bet_amount ?? 0);
    existing.lastBetAt = Math.max(
      existing.lastBetAt,
      Number(info.lastBetAt ?? 0),
    );
    byUser.set(address, existing);
  }

  const players = Array.from(byUser.values())
    .sort((a, b) => b.lastBetAt - a.lastBetAt || b.totalBet - a.totalBet)
    .slice(0, 20);
  return { type: "active_players", count: players.length, players };
}

function broadcastActivePlayers() {
  broadcast(JSON.stringify(activePlayersPayload()));
}

// ── Grid epoch: request Chainlink VRF, fall back to local if unavailable ───────
// When gameContract is live: calls requestVrf() on-chain; Chainlink callback emits
// VrfFulfilled which we listen for below (subscribeVrfEvents).
// Fallback: if contract unavailable, generate local randomness so the visual game
// keeps running (used during dev / contract not yet deployed).
function refreshVrfLocally(startColX) {
  pendingVrfStartColX = startColX;
  lastVrfColX = startColX;

  if (gameContract && VRF_ENABLED) {
    // Don't block — fire and forget. VRF result arrives via VrfFulfilled event.
    vrfRequestPending = true;
    gameContract.isVrfPending()
      .then((alreadyPending) => {
        if (alreadyPending) {
          // Chainlink is already processing a request — seed locally so the game
          // keeps running; VrfFulfilled event will override when it arrives.
          console.log("[VRF] contract already has a pending request, using local seed until fulfilled");
          currentVrfResult = crypto.randomBytes(32);
          currentSeedIndex++;
          vrfRequestPending = true; // still waiting for the on-chain fulfillment
          populateVrfPathLocally(startColX);
          return;
        }
        return gameContract.requestVrf()
          .then((tx) => {
            console.log(`[VRF] requestVrf tx=${tx.hash} startColX=${startColX}`);
          });
      })
      .catch((e) => {
        console.error("[VRF] requestVrf failed — using local fallback:", e.message);
        vrfRequestPending = false;
        // Local fallback so the game doesn't freeze
        currentVrfResult = crypto.randomBytes(32);
        currentSeedIndex++;
        populateVrfPathLocally(startColX);
      });
  } else {
    // Dev mode: no contract, use local randomness
    currentVrfResult = crypto.randomBytes(32);
    currentSeedIndex++;
    vrfRequestPending = false;
    populateVrfPathLocally(startColX);
  }
}

// ── Subscribe to VrfFulfilled events from the contract ─────────────────────────
function subscribeVrfEvents() {
  if (!gameContract || !VRF_ENABLED) return;
  // Use WebSocket contract if available (avoids eth_filter expiry on HTTP RPC)
  const sub = gameContract._wsContract || gameContract;
  sub.on("VrfFulfilled", (epochId, requestId, vrfResult) => {
    console.log(`[VRF] Fulfilled: epochId=${epochId} requestId=${requestId}`);
    // vrfResult is bytes32 from contract — use directly as entropy
    currentVrfResult = Buffer.from(vrfResult.slice(2), "hex"); // strip 0x
    currentSeedIndex = Number(epochId);
    vrfRequestPending = false;

    populateVrfPathLocally(pendingVrfStartColX);

    broadcast(JSON.stringify({ type: "vrf_state", seedIndex: currentSeedIndex }));
  });
  console.log("[VRF] Subscribed to VrfFulfilled events (WebSocket)");
}

// ── Populate vrfPath with current seed (always local on EVM) ────────────────────
function populateVrfPathLocally(startColX) {
  const newPaths = [];
  for (let i = 0; i < VRF_REFRESH_COLS; i++) {
    const colX = startColX + i * COLUMN_WIDTH;
    const row = deriveWinningRow(currentVrfResult, colX);
    vrfPath.set(colX, { row, vrfResult: currentVrfResult });
    newPaths.push({ colX, row });
  }
  broadcast(
    JSON.stringify({
      type: "path_revealed",
      paths: newPaths,
      seedIndex: currentSeedIndex,
    }),
  );
  console.log(
    `[VRF] (offline) paths populated for colX ${startColX}–${startColX + (VRF_REFRESH_COLS - 1) * COLUMN_WIDTH}`,
  );
}

// ── Resolve a bet on-chain (EVM) ──────────────────────────────────────────────
async function resolveBet(betKey) {
  const info = pendingBets.get(betKey);
  if (!info) return;
  // Remove immediately so concurrent pointer-loop ticks don't re-enter.
  pendingBets.delete(betKey);

  const colX = Math.floor(info.box_x / COLUMN_WIDTH) * COLUMN_WIDTH;
  const range = columnRowRange.get(colX);
  console.log(
    `[BET] Resolve: betId=${betKey} box_x=${info.box_x} colX=${colX} betRow=${info.box_row} range=${range ? range.minRow + "–" + range.maxRow : "NOT RECORDED"}`,
  );
  if (!range) {
    console.warn(`[BET] No row range for colX=${colX} — skipping`);
    return;
  }

  const hitPadding = 2; // Increase hit box size by 2 rows up and down for visual forgiveness
  const hitMin = range.minRow - hitPadding;
  const hitMax = range.maxRow + hitPadding;

  const won = info.box_row >= hitMin && info.box_row <= hitMax;
  const winRow = won ? info.box_row : info.box_row === 0 ? 1 : 0;
  const payout = won ? ((info.bet_amount * info.mult_num) / 100) * 0.98 : 0;

  // Optimistic instant response (txHash = "pending")
  broadcast(JSON.stringify({
    type: "bet_resolved",
    betPda: betKey,
    user: info.user,
    won,
    payout,
    txHash: "pending",
    box_x: info.box_x,
    box_row: info.box_row,
    min_row: range.minRow,
    max_row: range.maxRow,
  }));

  if (gameContract && info.betId) {
    // Process on-chain transaction completely async
    (async () => {
      let finalTxHash = null;
      try {
        if (onchainReady) {
          const betId = BigInt(info.betId);
          const msgHash = ethers.solidityPackedKeccak256(
            ["uint256", "bool", "address"],
            [betId, won, GAME_ADDRESS],
          );
          const serverSig = await serverWallet.signMessage(ethers.getBytes(msgHash));

          console.log(`[BET] Resolving on-chain: betId=${betId} won=${won}`);
          const tx = await gameContract.resolveBet(betId, won, serverSig);
          const receipt = await tx.wait();
          finalTxHash = receipt.hash;
          console.log(`[BET] ✓ Resolved on-chain: tx=${finalTxHash}`);
        }

        // Broadcast final receipt
        broadcast(JSON.stringify({
          type: "bet_receipt",
          betPda: betKey,
          user: info.user,
          txHash: finalTxHash,
        }));

        profileService.enqueueResolvedBet({
          txSignature: finalTxHash || "off-chain",
          eventIndex: 0,
          betPda: betKey,
          sourceWallet: info.user,
          game: "crash",
          boxX: info.box_x,
          boxRow: info.box_row,
          winningRow: winRow,
          won,
          betAmount: info.bet_amount,
          payout,
          seedIndex: currentSeedIndex,
        });
      } catch (err) {
        console.error("[BET] on-chain resolveBet error:", err.message);
        broadcast(JSON.stringify({
          type: "bet_resolve_failed",
          betPda: betKey,
          user: info.user,
          box_x: info.box_x,
          box_row: info.box_row,
          bet_amount: info.bet_amount,
          error: err.message?.slice(0, 200) ?? "Unknown error",
          min_row: range.minRow,
          max_row: range.maxRow,
        }));
      }
    })();
  } else {
    console.log(`[BET] Off-chain resolution (no contract/betId): betKey=${betKey} won=${won}`);
  }

  console.log(`[BET] ${won ? "🏆 WIN" : "✗ LOSE"} betKey=${betKey} payout=${payout.toFixed(4)}`);

  if (info.user) {
    updateLeaderboard(info.user, info.bet_amount, payout, won);
    leaderboardDirty = true; // throttled broadcast via 2s interval

    // Referral reward logic (0.5% of bet amount)
    if (profileService.isEnabled()) {
      (async () => {
        try {
          const settings = await profileService.getSettingsForWallet(info.user);
          if (settings.referredBy) {
            const reward = info.bet_amount * 0.005;
            await profileService.creditReferralReward({
              referrerWallet: settings.referredBy,
              rewardAmount: reward,
            });
            console.log(`[REFERRAL] ${reward.toFixed(4)} SPRM awarded to ${settings.referredBy} (inviter of ${info.user})`);
          }
        } catch (err) {
          console.error("[REFERRAL] reward error:", err.message);
        }
      })();
    }
  }
  broadcastActivePlayers();
}

// ── Column factory ──────────────────────────────────────────────────────────────
function makeColumns(count) {
  const cols = [];
  for (let i = 0; i < count; i++) {
    gridIdCounter++;
    const colBoxes = [];
    for (let r = 0; r < 500; r++) {
      const m = randomMult();
      colBoxes.push({
        id: `b${gridIdCounter}-${r}`,
        multiplier: m.display,
        mult_num: m.num,
        mult_den: m.den,
      });
    }
    cols.push({ id: `g${gridIdCounter}`, x: nextColX, boxes: colBoxes });
    nextColX += COLUMN_WIDTH;
  }
  return cols;
}

// ── Startup: seed history + columns ────────────────────────────────────────────
const INIT_COL_COUNT = 30;
allColumns.push(...makeColumns(INIT_COL_COUNT));

for (let i = 0; i < HISTORY_SIZE; i++) {
  serverCurrentX += PX_PER_EVENT;
  const { y, multiplier } = stepSim();
  historyBuffer.push({ x: serverCurrentX, y, multiplier });
}
console.log(
  `[BOOT] history seeded: ${historyBuffer.length} pts, serverCurrentX=${serverCurrentX}`,
);
// Ensure columns start 50 columns ahead of the pointer
nextColX = serverCurrentX + COLUMN_WIDTH; // reset to just ahead of pointer
allColumns.length = 0;
allColumns.push(...makeColumns(50));
console.log(
  `[BOOT] columns seeded: x=${allColumns[0]?.x}–${allColumns[allColumns.length - 1]?.x}`,
);

function broadcast(msg) {
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendProfileError(res, error) {
  const code = error?.code;
  if (code === "UNAUTHORIZED")
    return sendJson(res, 401, { error: error.message || "Unauthorized" });
  if (code === "INVALID_WALLET")
    return sendJson(res, 400, {
      error: error.message || "Invalid wallet address",
    });
  if (code === "INVALID_CURSOR")
    return sendJson(res, 400, { error: error.message || "Invalid cursor" });
  if (code === "INVALID_NONCE")
    return sendJson(res, 400, { error: error.message || "Invalid nonce" });
  if (code === "INVALID_JSON_BODY")
    return sendJson(res, 400, { error: error.message || "Invalid JSON body" });
  if (code === "NONCE_EXPIRED" || code === "NONCE_USED")
    return sendJson(res, 401, { error: error.message || "Nonce is not valid" });
  if (code === "INVALID_SIGNATURE")
    return sendJson(res, 401, { error: error.message || "Invalid signature" });
  if (code === "INVALID_LINK")
    return sendJson(res, 400, {
      error: error.message || "Invalid wallet link request",
    });

  console.error("[PROFILE] API error:", error);
  return sendJson(res, 500, { error: "Internal profile API error" });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("error", reject);
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(
          Object.assign(new Error("Invalid JSON body"), {
            code: "INVALID_JSON_BODY",
          }),
        );
      }
    });
  });
}

function parseBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

async function requireProfileSession(req, res) {
  const token = parseBearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "Missing bearer token" });
    return null;
  }

  try {
    return await profileService.authenticateAccessToken(token);
  } catch (error) {
    sendProfileError(res, error);
    return null;
  }
}

async function handleProfileApiRequest(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname || "";
  if (!pathname.startsWith("/api/profile/")) return false;

  if (!profileService.isReady()) {
    sendJson(res, 503, {
      error:
        "Profile backend is unavailable. Configure SUPABASE_DB_URL (or DATABASE_URL) and install server dependencies.",
    });
    return true;
  }

  try {
    if (req.method === "POST" && pathname === "/api/profile/auth/challenge") {
      const body = await readJsonBody(req);
      const result = await profileService.createAuthChallenge(body.wallet);
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === "POST" && pathname === "/api/profile/auth/verify") {
      const body = await readJsonBody(req);
      const result = await profileService.verifyAuthChallenge({
        wallet: body.wallet,
        nonce: body.nonce,
        signature: body.signature,
      });
      sendJson(res, 200, {
        accessToken: result.accessToken,
        expiresAt: result.expiresAt,
      });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/profile/overview") {
      const wallet = parsedUrl.query.wallet;
      if (!wallet || typeof wallet !== "string") {
        sendJson(res, 400, { error: "Missing wallet query parameter" });
        return true;
      }

      const range =
        typeof parsedUrl.query.range === "string"
          ? parsedUrl.query.range
          : "7D";
      const txLimit = Number.parseInt(
        String(parsedUrl.query.txLimit ?? "25"),
        10,
      );
      const result = await profileService.getOverview({
        wallet,
        range,
        txLimit: Number.isFinite(txLimit) ? txLimit : 25,
      });
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === "GET" && pathname === "/api/profile/transactions") {
      const wallet = parsedUrl.query.wallet;
      if (!wallet || typeof wallet !== "string") {
        sendJson(res, 400, { error: "Missing wallet query parameter" });
        return true;
      }

      const range =
        typeof parsedUrl.query.range === "string"
          ? parsedUrl.query.range
          : "ALL";
      const limit = Number.parseInt(String(parsedUrl.query.limit ?? "25"), 10);
      const cursor =
        typeof parsedUrl.query.cursor === "string"
          ? parsedUrl.query.cursor
          : null;
      const result = await profileService.getTransactions({
        wallet,
        range,
        limit: Number.isFinite(limit) ? limit : 25,
        cursor,
      });
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === "PATCH" && pathname === "/api/profile/settings") {
      const session = await requireProfileSession(req, res);
      if (!session) return true;

      const body = await readJsonBody(req);
      const result = await profileService.updateSettingsWithToken({
        tokenWallet: session.wallet,
        patch: body,
      });
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === "POST" && pathname === "/api/profile/session-links") {
      const session = await requireProfileSession(req, res);
      if (!session) return true;

      const body = await readJsonBody(req);
      const result = await profileService.linkSessionWallet({
        mainWallet: session.wallet,
        sessionWallet: body.sessionWallet,
      });
      sendJson(res, 200, result);
      return true;
    }

    if (
      req.method === "DELETE" &&
      pathname.startsWith("/api/profile/session-links/")
    ) {
      const session = await requireProfileSession(req, res);
      if (!session) return true;

      const sessionWallet = decodeURIComponent(
        pathname.slice("/api/profile/session-links/".length),
      );
      const result = await profileService.unlinkSessionWallet({
        mainWallet: session.wallet,
        sessionWallet,
      });
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === "POST" && pathname === "/api/profile/backfill") {
      const adminKey =
        req.headers["x-profile-admin-key"] || req.headers["x-admin-key"];
      const expectedAdminKey = process.env.PROFILE_ADMIN_KEY || "";
      if (!expectedAdminKey) {
        sendJson(res, 501, { error: "PROFILE_ADMIN_KEY is not configured" });
        return true;
      }
      if (!adminKey || String(adminKey) !== expectedAdminKey) {
        sendJson(res, 403, { error: "Forbidden" });
        return true;
      }

      if (profileBackfillInFlight) {
        sendJson(res, 409, { error: "Backfill is already running" });
        return true;
      }

      const body = await readJsonBody(req);
      const maxSignatures = Number.parseInt(
        String(body.maxSignatures ?? ""),
        10,
      );
      const pageSize = Number.parseInt(String(body.pageSize ?? ""), 10);
      const resetCursor = body.resetCursor === true;

      profileBackfillInFlight = true;
      try {
        const result = await profileService.runBackfill({
          provider: evmProvider,
          contractAddress: GAME_ADDRESS,
          pageSize: Number.isFinite(pageSize) ? pageSize : 500,
          maxSignatures: Number.isFinite(maxSignatures) ? maxSignatures : Infinity,
          resetCursor,
          jobName: "bet_resolved_full",
        });
        sendJson(res, 200, result);
      } finally {
        profileBackfillInFlight = false;
      }
      return true;
    }

    sendJson(res, 404, { error: "Unknown profile API route" });
    return true;
  } catch (error) {
    sendProfileError(res, error);
    return true;
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────────
app.prepare().then(async () => {
  initBinance();
  try {
    const profileReady = await profileService.init();
    if (profileReady) {
      const dbLeaderboard = await profileService.getGlobalLeaderboard(50);
      for (const entry of dbLeaderboard) {
        leaderboard.set(entry.address, entry);
      }
      console.log(`[PROFILE] Leaderboard seeded with ${dbLeaderboard.length} entries from database`);

      // Refresh leaderboard from DB every 5 minutes
      setInterval(async () => {
        try {
          const refreshed = await profileService.getGlobalLeaderboard(50);
          for (const entry of refreshed) {
            leaderboard.set(entry.address, entry);
          }
          leaderboardDirty = true;
          console.log(`[PROFILE] Leaderboard refreshed from database (${refreshed.length} entries)`);
        } catch (err) {
          console.error("[PROFILE] Leaderboard refresh failed:", err.message);
        }
      }, 5 * 60 * 1000);
    } else {
      console.warn(
        "[PROFILE] backend disabled (check SUPABASE_DB_URL/DATABASE_URL and npm dependencies)",
      );
    }
  } catch (error) {
    console.error("[PROFILE] startup failure:", error?.message || error);
  }

  const shutdownProfile = async () => {
    try {
      await profileService.close();
    } catch {
      // ignore close errors during shutdown
    }
  };
  process.once("SIGINT", shutdownProfile);
  process.once("SIGTERM", shutdownProfile);

  // Initialise EVM connection, subscribe to VRF events, seed first epoch
  initEvm();
  subscribeVrfEvents();
  const startColX = Math.ceil(serverCurrentX / COLUMN_WIDTH) * COLUMN_WIDTH;
  refreshVrfLocally(startColX);

  const httpServer = createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    const pathname = parsedUrl.pathname || "";

    if (await handleProfileApiRequest(req, res, parsedUrl)) {
      return;
    }

    // ── /register-bet: client POSTs bet info so server can auto-resolve ──
    // Accepts: { betId, user, box_x, box_row, mult_num, bet_amount }
    if (req.method === "POST" && pathname === "/register-bet") {
      // Rate limit by IP
      const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      if (!checkRateLimit(clientIp)) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Rate limit exceeded. Max 60 registrations/minute." }));
        return;
      }

      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const msg = JSON.parse(body);

          // Market pause check
          if (bettingPaused) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "market_paused" }));
            return;
          }

          // Input validation
          const validationError = validateBetPayload(msg);
          if (validationError) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: validationError }));
            return;
          }

          // betId is the uint256 contract bet ID (string or number)
          const betKey = String(msg.betId ?? msg.betPda ?? "");

          if (msg.user && profileService.isEnabled()) {
            profileService.ensureReferralCode(msg.user).catch(() => { });
            if (msg.referralCode) {
              profileService.handleReferral({ userWallet: msg.user, referralCode: msg.referralCode })
                .catch(err => console.error("[REFERRAL] POST handler error:", err.message));
            }
          }
          if (betKey && !pendingBets.has(betKey)) {
            const betColX = Math.floor(msg.box_x / COLUMN_WIDTH) * COLUMN_WIDTH;
            const curColX = Math.floor(serverCurrentX / COLUMN_WIDTH) * COLUMN_WIDTH;
            const colsAhead = (betColX - curColX) / COLUMN_WIDTH;
            // Relaxed the colsAhead check from 10 to -200.
            // Blockchain mining can take seconds, during which the pointer advances.
            // If the user paid for the bet (verified by betId), we must register it even if it arrives late.
            if (colsAhead < -200) {
              console.warn(
                `[BET] REJECTED (too historically detached): box_x=${msg.box_x} colsAhead=${colsAhead}`,
              );
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: false, error: "Bet registration too historically detached" }));
              return;
            }
            pendingBets.set(betKey, {
              betId: String(msg.betId ?? ""),
              user: msg.user,
              box_x: Number(msg.box_x),
              box_row: Number(msg.box_row),
              mult_num: Number(msg.mult_num),
              bet_amount: Number(msg.bet_amount),
              lastBetAt: Date.now(),
            });
            if (msg.user) lookupNickname(msg.user);
            console.log(
              `[BET] Registered via HTTP: betId=${betKey} box_x=${msg.box_x} row=${msg.box_row} mult=${msg.mult_num}/100 colsAhead=${colsAhead}`,
            );
            broadcastActivePlayers();
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    try {
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("HTTP error", req.url, err);
      res.statusCode = 500;
      res.end("error");
    }
  });
  httpServer.listen(NEXT_PORT, () =>
    console.log(`  ▶  Next.js  http://${hostname}:${NEXT_PORT}`),
  );

  const wsHttpServer = createServer();
  const wss = new WebSocketServer({ server: wsHttpServer });

  // ── Pointer broadcast (~30 fps) ─────────────────────────────────────────
  let broadcastCount = 0;
  setInterval(async () => {
    if (clients.size === 0) return;

    checkAndUpdateMarketPause();

    serverCurrentX += PX_PER_EVENT;
    broadcastCount++;

    const prevColX =
      Math.floor((serverCurrentX - PX_PER_EVENT) / COLUMN_WIDTH) * COLUMN_WIDTH;
    const curColX = Math.floor(serverCurrentX / COLUMN_WIDTH) * COLUMN_WIDTH;
    const vrfEntry = vrfPath.get(curColX);
    const vrfWinRow = vrfEntry?.row;
    if (vrfWinRow !== undefined)
      steerTowardRow(vrfWinRow, curColX, serverCurrentX);

    const { y } = stepSim();
    historyBuffer.push({ x: serverCurrentX, y });
    if (historyBuffer.length > HISTORY_SIZE) historyBuffer.shift();

    // tickRow must match box.row convention (row 0=bottom, row 499=top).
    // Mapping: y=0 maps to row 250. Each 1.0 y units is 30 rows.
    const tickRow = Math.max(0, Math.min(499, Math.floor(y * 30) + 250));
    const existing = columnRowRange.get(curColX);
    if (!existing) {
      columnRowRange.set(curColX, { minRow: tickRow, maxRow: tickRow });
    } else {
      existing.minRow = Math.min(existing.minRow, tickRow);
      existing.maxRow = Math.max(existing.maxRow, tickRow);
    }

    // When pointer moves into a new column, log the finalised range of the previous column
    if (curColX !== prevColX) {
      const range = columnRowRange.get(prevColX);
      console.log(
        `[COL] crossed colX=${prevColX}  rows=${range ? range.minRow + "–" + range.maxRow : "?"}  y=${y.toFixed(4)}`,
      );

      // Track the winning multiplier from this column
      if (range) {
        const col = allColumns.find((c) => c.x === prevColX);
        if (col) {
          // Use the row the pointer ended on (maxRow if going up, minRow if going down)
          // For simplicity, use the center of the range
          const winRow = Math.round((range.minRow + range.maxRow) / 2);
          const box = col.boxes[winRow];
          if (box) {
            const entry = {
              colX: prevColX,
              multiplier: box.multiplier,
              winRow,
              timestamp: Date.now(),
            };
            multHistory.push(entry);
            if (multHistory.length > MULT_HISTORY_SIZE) multHistory.shift();
            broadcast(
              JSON.stringify({
                type: "mult_history",
                entry,
                history: multHistory,
              }),
            );
          }
        }
      }

      // Prune old entries to avoid unbounded growth
      if (columnRowRange.size > 200) {
        const oldest = columnRowRange.keys().next().value;
        columnRowRange.delete(oldest);
      }
    }

    if (broadcastCount % 30 === 1)
      console.log(
        `[PTR #${broadcastCount}]  x=${serverCurrentX}  y=${y.toFixed(4)}  vrfRow=${vrfWinRow ?? "?"}`,
      );

    broadcast(
      JSON.stringify({
        type: "pointer",
        y,
        currentX: serverCurrentX,
        price: currentAvaxPrice,
        timestamp: Date.now(),
      }),
    );

    // Check for bets whose column the pointer has just passed → resolve them
    // Skip bets that are already in a retry backoff window (retryingBets) to prevent
    // the runaway storm where every 33ms tick fires a new resolveBet call.
    for (const [key, info] of pendingBets) {
      if (
        serverCurrentX >= info.box_x + COLUMN_WIDTH &&
        !retryingBets.has(key)
      ) {
        console.log(
          `[BET] Pointer passed box_x=${info.box_x} (serverCurrentX=${serverCurrentX}) → triggering resolve`,
        );
        resolveBet(key).catch((e) =>
          console.error("[BET] resolveBet unhandled error:", e.message),
        );
      }
    }

    // Rotate epoch when pointer is 12+ columns past the last seed point
    const colsAhead = (curColX - lastVrfColX) / COLUMN_WIDTH;
    if (colsAhead >= VRF_REFRESH_COLS - 3 && !vrfRequestPending) {
      const nextVrfStart = lastVrfColX + VRF_REFRESH_COLS * COLUMN_WIDTH;
      refreshVrfLocally(nextVrfStart);
    }
  }, 33);

  // ── Grid broadcast (every 1 s) ──────────────────────────────────────────
  setInterval(() => {
    if (clients.size === 0) return;
    // Keep nextColX at least 50 columns ahead; only skip if already ≥ 35 ahead
    const colsAhead = Math.round((nextColX - serverCurrentX) / COLUMN_WIDTH);
    if (colsAhead >= 35) {
      return;
    }
    const needed = Math.max(10, 50 - colsAhead);
    const cols = makeColumns(needed);
    allColumns.push(...cols);
    if (allColumns.length > 400) allColumns.splice(0, allColumns.length - 400);
    console.log(
      `[GRID] broadcast ${cols.length} cols x=${cols[0]?.x}–${cols[cols.length - 1]?.x}  ahead=${Math.round((nextColX - serverCurrentX) / COLUMN_WIDTH)} cols`,
    );
    broadcast(JSON.stringify({ type: "grid", columns: cols }));
  }, 1000);

  // ── New client connection ───────────────────────────────────────────────
  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`\n[WS] Client connected  (total=${clients.size})`);

    ws.send(
      JSON.stringify({
        type: "init",
        columns: allColumns,
        history: historyBuffer.slice(),
        currentX: serverCurrentX,
        multHistory: multHistory.slice(),
        houseBank: houseBankBalance,
        marketPaused: bettingPaused,
      }),
    );

    // Send known VRF paths to the new client
    if (vrfPath.size > 0) {
      const paths = [];
      for (const [colX, entry] of vrfPath) paths.push({ colX, row: entry.row });
      ws.send(
        JSON.stringify({
          type: "vrf_state",
          paths,
          seedIndex: currentSeedIndex,
        }),
      );
    }

    // Send current leaderboard
    if (leaderboard.size > 0) {
      ws.send(JSON.stringify(leaderboardPayload()));
    }
    ws.send(JSON.stringify(activePlayersPayload()));

    // Send current ghost snapshot to new client
    const snap = ghostSnapshot();
    if (snap.length > 0) {
      ws.send(JSON.stringify({ type: "ghost_snapshot", entries: snap }));
    }

    // ── Messages from client (bet registration / ghost selections) ───────
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "ghost_select") {
          // msg: { colX, row, shortAddr }
          const key = `${msg.colX}_${msg.row}`;
          ghostAdd(ws, key, msg.shortAddr);
          // Relay to all OTHER clients
          const relay = JSON.stringify({
            type: "ghost_select",
            colX: msg.colX,
            row: msg.row,
            shortAddr: msg.shortAddr,
          });
          for (const client of clients) {
            if (client !== ws && client.readyState === client.OPEN)
              client.send(relay);
          }
        } else if (msg.type === "ghost_deselect") {
          // msg: { colX, row, shortAddr }
          const key = `${msg.colX}_${msg.row}`;
          ghostRemove(ws, key, msg.shortAddr);
          const relay = JSON.stringify({
            type: "ghost_deselect",
            colX: msg.colX,
            row: msg.row,
            shortAddr: msg.shortAddr,
          });
          for (const client of clients) {
            if (client !== ws && client.readyState === client.OPEN)
              client.send(relay);
          }
        } else if (msg.type === "register_bet") {
          // msg: { betId, user, box_x, box_row, mult_num, bet_amount }
          if (bettingPaused) return; // silently drop when market paused
          const wsValidErr = validateBetPayload(msg);
          if (wsValidErr) { console.warn(`[BET] WS validation failed: ${wsValidErr}`); return; }

          if (msg.user && profileService.isEnabled()) {
            // Ensure user has a referral code
            profileService.ensureReferralCode(msg.user).catch(() => { });
            // Handle incoming referral if present
            if (msg.referralCode) {
              profileService.handleReferral({ userWallet: msg.user, referralCode: msg.referralCode })
                .catch((err) => console.error("[REFERRAL] handler error:", err.message));
            }
          }

          const betKey = String(msg.betId ?? msg.betPda ?? "");
          const betColX = Math.floor(Number(msg.box_x) / COLUMN_WIDTH) * COLUMN_WIDTH;
          const curColX = Math.floor(serverCurrentX / COLUMN_WIDTH) * COLUMN_WIDTH;
          const colsAhead = (betColX - curColX) / COLUMN_WIDTH;
          if (!pendingBets.has(betKey)) {
            if (colsAhead <= 0) {
              console.warn(`[BET] REJECTED via WS (too late): box_x=${msg.box_x} colsAhead=${colsAhead}`);
            } else {
              pendingBets.set(betKey, {
                betId: String(msg.betId ?? ""),
                user: msg.user,
                box_x: Number(msg.box_x),
                box_row: Number(msg.box_row),
                mult_num: Number(msg.mult_num),
                bet_amount: Number(msg.bet_amount),
                lastBetAt: Date.now(),
              });
              if (msg.user) lookupNickname(msg.user);
              broadcastActivePlayers();
            }
          }
        }
      } catch (e) {
        console.error("[WS] message parse error", e.message);
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
      // Clean up ghost selections from this client and notify others
      const removed = ghostCleanupWs(ws);
      if (removed && removed.length > 0) {
        for (const { key, shortAddr } of removed) {
          const [colX, row] = key.split("_").map(Number);
          const relay = JSON.stringify({
            type: "ghost_deselect",
            colX,
            row,
            shortAddr,
          });
          for (const client of clients) {
            if (client.readyState === client.OPEN) client.send(relay);
          }
        }
      }
      console.log(`[WS] Client disconnected`);
    });
    ws.on("error", (err) => console.error("[WS] error", err));
  });

  wsHttpServer.listen(WS_PORT, () =>
    console.log(`  ▶  WebSocket  ws://${hostname}:${WS_PORT}\n`),
  );
});
