require("dotenv").config();

const { createServer } = require("http");
const { parse } = require("url");
const { WebSocketServer, WebSocket } = require("ws");
const { ethers } = require("ethers");
const crypto = require("crypto");
const { createProfileService } = require("../lib/server/profile-service");

const hostname = "0.0.0.0";
const PORT = process.env.PORT || 3001;

// Allowed CORS origin — set to your Vercel frontend URL in production
// e.g. ALLOWED_ORIGIN=https://sprmfun.vercel.app
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

// ── Layout constants ────────────────────────────────────────────────────────────
const COLUMN_WIDTH = 50;
const PX_PER_EVENT = 0.95;

// ── Dynamic multiplier generator (1.01x–20.00x per box) ────────────────────────
function randomMult() {
  const lambda = 0.22;
  const minX = 1.01, maxX = 20.0;
  const u = Math.random();
  const raw = minX - Math.log(1 - u * (1 - Math.exp(-lambda * (maxX - minX)))) / lambda;
  const display = Math.min(maxX, Math.max(minX, raw));
  const num = Math.round(display * 100);
  return { num, den: 100, display: num / 100 };
}

// ── Avalanche / EVM setup ──────────────────────────────────────────────────────
const RPC_URL = process.env.AVALANCHE_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
const WS_RPC_URL = process.env.AVALANCHE_WS_RPC_URL || "wss://api.avax-test.network/ext/bc/C/ws";
const GAME_ADDRESS = process.env.GAME_CONTRACT_ADDRESS || "";
const VRF_ENABLED = process.env.VRF_ENABLED === "true";

const GAME_ABI = [
  "function resolveBet(uint256 betId, bool won, bytes calldata serverSig) external",
  "function requestVrf() external returns (uint256 requestId)",
  "function isVrfPending() external view returns (bool)",
  "event BetPlaced(uint256 indexed betId, address indexed player, uint32 boxX, uint16 boxRow, uint16 multNum, uint256 amount)",
  "event BetResolved(uint256 indexed betId, address indexed player, bool won, uint256 payout)",
  "event VrfFulfilled(uint256 indexed epochId, uint256 indexed requestId, bytes32 vrfResult)",
  "event VrfRequested(uint256 indexed epochId, uint256 indexed requestId)",
];

const TOKEN_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

let evmProvider = null;
let serverWallet = null;
let gameContract = null;
let tokenContract = null;
let onchainReady = false;

function initEvm() {
  const privateKey = process.env.SERVER_PRIVATE_KEY;
  if (!privateKey) {
    console.warn("[EVM] SERVER_PRIVATE_KEY not set — on-chain resolution disabled.");
    return;
  }
  if (!GAME_ADDRESS) {
    console.warn("[EVM] GAME_CONTRACT_ADDRESS not set — on-chain resolution disabled.");
    return;
  }
  evmProvider = new ethers.JsonRpcProvider(RPC_URL);
  serverWallet = new ethers.Wallet(privateKey, evmProvider);
  gameContract = new ethers.Contract(GAME_ADDRESS, GAME_ABI, serverWallet);

  const tokenAddr = process.env.NEXT_PUBLIC_TOKEN_ADDRESS || "";
  if (tokenAddr) {
    tokenContract = new ethers.Contract(tokenAddr, TOKEN_ABI, evmProvider);
  }

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
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const arr = (rateLimitMap.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (arr.length >= RATE_LIMIT_MAX) return false;
  arr.push(now);
  rateLimitMap.set(ip, arr);
  return true;
}

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
const MAX_BET_AMOUNT = parseFloat(process.env.MAX_BET_AMOUNT || "10000");

function validateBetPayload(msg) {
  if (!msg || typeof msg !== "object") return "Invalid payload";
  if (!EVM_ADDR_RE.test(String(msg.user || ""))) return "Invalid user address";
  const row = Number(msg.box_row);
  if (!Number.isFinite(row) || row < 0 || row > 499) return "box_row out of range [0,499]";
  const bx = Number(msg.box_x);
  if (!Number.isFinite(bx) || bx < 0) return "box_x must be a non-negative number";
  const mn = Number(msg.mult_num);
  if (!Number.isFinite(mn) || mn < 101 || mn > 2000) return "mult_num out of range [101,2000]";
  const ba = Number(msg.bet_amount);
  if (!Number.isFinite(ba) || ba <= 0) return "bet_amount must be positive";
  if (ba > MAX_BET_AMOUNT) return `bet_amount exceeds maximum (${MAX_BET_AMOUNT} SPRM)`;
  return null;
}

// ── Market pause state ───────────────────────────────────────────────────────────
const PRICE_STALE_MS = 5000;
let lastPriceTick = 0;
let bettingPaused = false;

function checkAndUpdateMarketPause() {
  if (lastPriceTick === 0) return;
  const stale = Date.now() - lastPriceTick > PRICE_STALE_MS;
  if (stale !== bettingPaused) {
    bettingPaused = stale;
    broadcast(JSON.stringify({ type: "market_paused", paused: bettingPaused }));
    console.log(`[MARKET] ${bettingPaused ? "PAUSED (feed stale)" : "RESUMED"}`);
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
      broadcast(JSON.stringify({ type: "house_bank", balance: houseBankBalance }));
    }
  } catch (err) {
    console.error(`[BANK] Failed to fetch house bank: ${err.message}`);
  }
}

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
const VRF_REFRESH_COLS = 15;

let currentVrfResult = crypto.randomBytes(32);
let currentSeedIndex = 0;
let lastVrfColX = -Infinity;
let vrfRequestPending = false;
let pendingVrfStartColX = 0;

const ROW_DELTA_WEIGHTS = [2, 4, 10, 20, 0, 20, 10, 4, 2];
const ROW_DELTA_CDF = (() => {
  const total = ROW_DELTA_WEIGHTS.reduce((a, b) => a + b, 0);
  const cdf = [];
  let cum = 0;
  for (const w of ROW_DELTA_WEIGHTS) {
    cum += w;
    cdf.push(Math.round((cum / total) * 256));
  }
  return cdf;
})();

function weightedDelta(byte) {
  for (let i = 0; i < ROW_DELTA_CDF.length; i++) {
    if (byte < ROW_DELTA_CDF[i]) return i - 4;
  }
  return 4;
}

let lastWinRow = 250;

function deriveWinningRow(vrfResult, boxX) {
  const boxXBuf = Buffer.alloc(8);
  boxXBuf.writeBigInt64LE(BigInt(boxX));
  const hash = crypto.createHash("sha256").update(vrfResult).update(boxXBuf).digest();
  let delta = weightedDelta(hash[0]);
  const distFromCenter = lastWinRow - 250;
  const biasMag = Math.round(Math.abs(distFromCenter) * 0.7);
  const bias = -Math.sign(distFromCenter) * biasMag;
  delta = Math.max(-4, Math.min(4, delta + bias));
  let row = Math.max(0, Math.min(499, lastWinRow + delta));
  if (row === lastWinRow) {
    row = (hash[1] & 1) ? Math.min(499, row + 1) : Math.max(0, row - 1);
  }
  lastWinRow = row;
  return row;
}

const vrfPath = new Map();

// ── Binance WebSocket integration ──────────────────────────────────────────────
let currentAvaxPrice = 0;
let lastPrice = 0;
let priceBaseline = 0;
const PRICE_CHAOS_FACTOR = 45.0;
const FRICTION = 0.85;
const MOMENTUM_INERTIA = 0.08;
const MAX_SIM_VELOCITY = 0.15;
const EMA_ALPHA = 0.12;

function initBinance() {
  const ws = new WebSocket("wss://stream.binance.com:9443/ws/avaxusdt@ticker");
  ws.onopen = () => console.log("[BINANCE] Connected to AVAX/USDT stream");
  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      const price = parseFloat(data.c);
      if (price) {
        currentAvaxPrice = price;
        lastPriceTick = Date.now();
        if (priceBaseline === 0) priceBaseline = price;
      }
    } catch (e) {
      console.error("[BINANCE] Parse error", e);
    }
  };
  ws.onerror = (err) => console.error("[BINANCE] Error", err);
  ws.onclose = () => {
    console.log("[BINANCE] Connection closed, retrying in 5s...");
    setTimeout(initBinance, 5000);
  };
}

// ── Simulation state ────────────────────────────────────────────────────────────
let simY = 0.0;
let simYEma = 0.0;
let simVelocity = 0;
let simTime = 0;
let steerTargetY = 0.5;
let steerActive = false;

const PRICE_FLAT_MS = 1500;
const CHAOS_SHOCK_INTERVAL = 18;
let lastPriceChangedAt = 0;
let lastTrackedPrice = 0;

function stepSim() {
  simTime++;
  if (currentAvaxPrice > 0) {
    if (lastPrice === 0) lastPrice = currentAvaxPrice;
    const priceDelta = currentAvaxPrice - lastPrice;
    lastPrice = currentAvaxPrice;
    const now = Date.now();
    if (currentAvaxPrice !== lastTrackedPrice) {
      lastTrackedPrice = currentAvaxPrice;
      lastPriceChangedAt = now;
    }
    const flatMs = lastPriceChangedAt > 0 ? now - lastPriceChangedAt : 0;
    const isFlat = flatMs >= PRICE_FLAT_MS;
    simVelocity = (simVelocity * FRICTION) + (priceDelta * PRICE_CHAOS_FACTOR * MOMENTUM_INERTIA);
    simVelocity = Math.max(-MAX_SIM_VELOCITY, Math.min(MAX_SIM_VELOCITY, simVelocity));
    if (isFlat) {
      const flatSecs = flatMs / 1000;
      const chaosStrength = Math.min(3.0, 1.0 + flatSecs * 0.4);
      simVelocity += (Math.random() - 0.5) * 0.0015 * chaosStrength;
      if (simTime % CHAOS_SHOCK_INTERVAL === 0) {
        const shockDir = Math.random() < 0.5 ? 1 : -1;
        simVelocity += shockDir * (0.008 + Math.random() * 0.012) * chaosStrength;
      }
    } else {
      simVelocity += (Math.random() - 0.5) * 0.001;
    }
    simY += simVelocity;
    if (steerActive) {
      const steeringForce = (steerTargetY - simY) * 0.04;
      simVelocity += steeringForce;
    }
    const bias = (0.0 - simY) * 0.005;
    simY += bias;
    simY = Math.max(-50, Math.min(50, simY));
    return { y: simY };
  }
  const noiseScale = steerActive ? 0.004 : 0.01;
  const trend = Math.sin(simTime * 0.008) * 0.0003;
  const noise = (Math.random() - 0.5) * noiseScale;
  const shock = !steerActive && Math.random() < 0.015 ? (Math.random() - 0.5) * 0.05 : 0;
  const spring = steerActive ? (steerTargetY - simY) * 0.06 : 0;
  simVelocity = simVelocity * 0.93 + noise + trend + shock + spring;
  simVelocity = Math.max(-0.025, Math.min(0.025, simVelocity));
  simY += simVelocity;
  if (!steerActive) simY += (0.0 - simY) * 0.001;
  simY = Math.max(-50, Math.min(50, simY));
  return { y: simY };
}

function steerTowardRow(targetRow, curColX, currentX) {
  const newTargetY = (targetRow - 250) / 30;
  if (Math.abs(newTargetY - steerTargetY) > 0.001 || !steerActive) {
    steerTargetY = newTargetY;
  }
  steerActive = true;
  const pxLeft = curColX + COLUMN_WIDTH - currentX;
  if (pxLeft < COLUMN_WIDTH * 0.15) steerActive = false;
}

// ── Global state ────────────────────────────────────────────────────────────────
let serverCurrentX = 0;
let gridIdCounter = 0;
let nextColX = 0;

const columnRowRange = new Map();
const HISTORY_SIZE = 2800;
const historyBuffer = [];
const allColumns = [];
const clients = new Set();

const MULT_HISTORY_SIZE = 50;
const multHistory = [];

const pendingBets = new Map();
const retryingBets = new Set();

const nicknameCache = new Map();
const NICKNAME_CACHE_TTL = 5 * 60 * 1000;

function lookupNickname(address) {
  const cached = nicknameCache.get(address);
  if (cached && Date.now() - cached.cachedAt < NICKNAME_CACHE_TTL) return;
  nicknameCache.set(address, { nickname: null, cachedAt: Date.now() });
  profileService.getWalletNickname(address)
    .then(nickname => nicknameCache.set(address, { nickname: nickname || null, cachedAt: Date.now() }))
    .catch(() => { });
}

const ghostSelections = new Map();
const wsGhostKeys = new WeakMap();

function ghostAdd(ws, key, shortAddr) {
  if (!ghostSelections.has(key)) ghostSelections.set(key, new Set());
  ghostSelections.get(key).add(shortAddr);
  if (!wsGhostKeys.has(ws)) wsGhostKeys.set(ws, new Map());
  wsGhostKeys.get(ws).set(key, shortAddr);
}

function ghostRemove(ws, key, shortAddr) {
  const set = ghostSelections.get(key);
  if (set) { set.delete(shortAddr); if (set.size === 0) ghostSelections.delete(key); }
  const wsKeys = wsGhostKeys.get(ws);
  if (wsKeys) wsKeys.delete(key);
}

function ghostCleanupWs(ws) {
  const wsKeys = wsGhostKeys.get(ws);
  if (!wsKeys) return [];
  const removed = [];
  for (const [key, shortAddr] of wsKeys) {
    const set = ghostSelections.get(key);
    if (set) { set.delete(shortAddr); if (set.size === 0) ghostSelections.delete(key); }
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

const leaderboard = new Map();

function updateLeaderboard(user, betAmount, payout, won) {
  const short = `${user.slice(0, 4)}…${user.slice(-4)}`;
  const entry = leaderboard.get(user) || { shortAddr: short, wins: 0, losses: 0, totalBet: 0, totalPayout: 0 };
  entry.wins += won ? 1 : 0;
  entry.losses += won ? 0 : 1;
  entry.totalBet += betAmount;
  entry.totalPayout += payout;
  leaderboard.set(user, entry);
}

function leaderboardPayload() {
  const entries = [];
  for (const [address, e] of leaderboard) entries.push({ address, ...e });
  entries.sort((a, b) => b.totalPayout - b.totalBet - (a.totalPayout - a.totalBet));
  return { type: "leaderboard", entries: entries.slice(0, 50) };
}

function activePlayersPayload() {
  const byUser = new Map();
  for (const info of pendingBets.values()) {
    if (!info?.user) continue;
    const address = String(info.user);
    const cached = nicknameCache.get(address);
    const existing = byUser.get(address) || {
      address, shortAddr: `${address.slice(0, 4)}…${address.slice(-4)}`,
      nickname: cached?.nickname || null, pendingBets: 0, totalBet: 0, lastBetAt: 0,
    };
    existing.pendingBets += 1;
    existing.totalBet += Number(info.bet_amount ?? 0);
    existing.lastBetAt = Math.max(existing.lastBetAt, Number(info.lastBetAt ?? 0));
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

function refreshVrfLocally(startColX) {
  pendingVrfStartColX = startColX;
  lastVrfColX = startColX;
  if (gameContract && VRF_ENABLED) {
    vrfRequestPending = true;
    gameContract.isVrfPending()
      .then((alreadyPending) => {
        if (alreadyPending) {
          currentVrfResult = crypto.randomBytes(32);
          currentSeedIndex++;
          vrfRequestPending = true;
          populateVrfPathLocally(startColX);
          return;
        }
        return gameContract.requestVrf().then(tx => console.log(`[VRF] requestVrf tx=${tx.hash}`));
      })
      .catch((e) => {
        console.error("[VRF] requestVrf failed — using local fallback:", e.message);
        vrfRequestPending = false;
        currentVrfResult = crypto.randomBytes(32);
        currentSeedIndex++;
        populateVrfPathLocally(startColX);
      });
  } else {
    currentVrfResult = crypto.randomBytes(32);
    currentSeedIndex++;
    vrfRequestPending = false;
    populateVrfPathLocally(startColX);
  }
}

function subscribeVrfEvents() {
  if (!gameContract || !VRF_ENABLED) return;
  const sub = gameContract._wsContract || gameContract;
  sub.on("VrfFulfilled", (epochId, requestId, vrfResult) => {
    console.log(`[VRF] Fulfilled: epochId=${epochId} requestId=${requestId}`);
    currentVrfResult = Buffer.from(vrfResult.slice(2), "hex");
    currentSeedIndex = Number(epochId);
    vrfRequestPending = false;
    populateVrfPathLocally(pendingVrfStartColX);
    broadcast(JSON.stringify({ type: "vrf_state", seedIndex: currentSeedIndex }));
  });
  console.log("[VRF] Subscribed to VrfFulfilled events");
}

function populateVrfPathLocally(startColX) {
  const newPaths = [];
  for (let i = 0; i < VRF_REFRESH_COLS; i++) {
    const colX = startColX + i * COLUMN_WIDTH;
    const row = deriveWinningRow(currentVrfResult, colX);
    vrfPath.set(colX, { row, vrfResult: currentVrfResult });
    newPaths.push({ colX, row });
  }
  broadcast(JSON.stringify({ type: "path_revealed", paths: newPaths, seedIndex: currentSeedIndex }));
}

async function resolveBet(betKey) {
  const info = pendingBets.get(betKey);
  if (!info) return;
  pendingBets.delete(betKey);

  const colX = Math.floor(info.box_x / COLUMN_WIDTH) * COLUMN_WIDTH;
  const range = columnRowRange.get(colX);
  if (!range) { console.warn(`[BET] No row range for colX=${colX} — skipping`); return; }

  const hitPadding = 2;
  const hitMin = range.minRow - hitPadding;
  const hitMax = range.maxRow + hitPadding;
  const won = info.box_row >= hitMin && info.box_row <= hitMax;
  const winRow = won ? info.box_row : info.box_row === 0 ? 1 : 0;
  const payout = won ? ((info.bet_amount * info.mult_num) / 100) * 0.98 : 0;

  broadcast(JSON.stringify({
    type: "bet_resolved", betPda: betKey, user: info.user, won, payout,
    txHash: "pending", box_x: info.box_x, box_row: info.box_row,
    min_row: range.minRow, max_row: range.maxRow,
  }));

  if (gameContract && info.betId) {
    (async () => {
      let finalTxHash = null;
      try {
        if (onchainReady) {
          const betId = BigInt(info.betId);
          const msgHash = ethers.solidityPackedKeccak256(
            ["uint256", "bool", "address"], [betId, won, GAME_ADDRESS]
          );
          const serverSig = await serverWallet.signMessage(ethers.getBytes(msgHash));
          const tx = await gameContract.resolveBet(betId, won, serverSig);
          const receipt = await tx.wait();
          finalTxHash = receipt.hash;
          console.log(`[BET] ✓ Resolved on-chain: tx=${finalTxHash}`);
        }
        broadcast(JSON.stringify({ type: "bet_receipt", betPda: betKey, user: info.user, txHash: finalTxHash }));
        profileService.enqueueResolvedBet({
          txSignature: finalTxHash || "off-chain", eventIndex: 0, betPda: betKey,
          sourceWallet: info.user, game: "crash", boxX: info.box_x, boxRow: info.box_row,
          winningRow: winRow, won, betAmount: info.bet_amount, payout, seedIndex: currentSeedIndex,
        });
      } catch (err) {
        console.error("[BET] on-chain resolveBet error:", err.message);
        broadcast(JSON.stringify({
          type: "bet_resolve_failed", betPda: betKey, user: info.user,
          box_x: info.box_x, box_row: info.box_row, bet_amount: info.bet_amount,
          error: err.message?.slice(0, 200) ?? "Unknown error",
          min_row: range.minRow, max_row: range.maxRow,
        }));
      }
    })();
  } else {
    console.log(`[BET] Off-chain resolution: betKey=${betKey} won=${won}`);
  }

  console.log(`[BET] ${won ? "🏆 WIN" : "✗ LOSE"} betKey=${betKey} payout=${payout.toFixed(4)}`);

  if (info.user) {
    updateLeaderboard(info.user, info.bet_amount, payout, won);
    leaderboardDirty = true;
    if (profileService.isEnabled()) {
      (async () => {
        try {
          const settings = await profileService.getSettingsForWallet(info.user);
          if (settings?.referredBy) {
            const reward = info.bet_amount * 0.005;
            await profileService.creditReferralReward({ referrerWallet: settings.referredBy, rewardAmount: reward });
          }
        } catch (err) {
          console.error("[REFERRAL] reward error:", err.message);
        }
      })();
    }
  }
  broadcastActivePlayers();
}

function makeColumns(count) {
  const cols = [];
  for (let i = 0; i < count; i++) {
    gridIdCounter++;
    const colBoxes = [];
    for (let r = 0; r < 500; r++) {
      const m = randomMult();
      colBoxes.push({ id: `b${gridIdCounter}-${r}`, multiplier: m.display, mult_num: m.num, mult_den: m.den });
    }
    cols.push({ id: `g${gridIdCounter}`, x: nextColX, boxes: colBoxes });
    nextColX += COLUMN_WIDTH;
  }
  return cols;
}

// Seed initial history and columns
const INIT_COL_COUNT = 30;
allColumns.push(...makeColumns(INIT_COL_COUNT));
for (let i = 0; i < HISTORY_SIZE; i++) {
  serverCurrentX += PX_PER_EVENT;
  const { y } = stepSim();
  historyBuffer.push({ x: serverCurrentX, y });
}
nextColX = (Math.floor(serverCurrentX / COLUMN_WIDTH) + 2) * COLUMN_WIDTH;
allColumns.length = 0;
allColumns.push(...makeColumns(50));
console.log(`[BOOT] history=${historyBuffer.length}pts x=${serverCurrentX.toFixed(1)}`);
console.log(`[BOOT] columns=${allColumns.length} x=${allColumns[0]?.x}–${allColumns[allColumns.length - 1]?.x}`);

function broadcast(msg) {
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

// ── CORS ─────────────────────────────────────────────────────────────────────────
function setCorsHeaders(res, origin) {
  const allowedOrigin = ALLOWED_ORIGIN === "*" ? "*" : (origin || ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Profile-Admin-Key, X-Admin-Key");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (ALLOWED_ORIGIN !== "*") res.setHeader("Vary", "Origin");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendProfileError(res, error) {
  const code = error?.code;
  if (code === "UNAUTHORIZED") return sendJson(res, 401, { error: error.message || "Unauthorized" });
  if (code === "INVALID_WALLET") return sendJson(res, 400, { error: error.message || "Invalid wallet address" });
  if (code === "INVALID_CURSOR") return sendJson(res, 400, { error: error.message || "Invalid cursor" });
  if (code === "INVALID_NONCE") return sendJson(res, 400, { error: error.message || "Invalid nonce" });
  if (code === "INVALID_JSON_BODY") return sendJson(res, 400, { error: error.message || "Invalid JSON body" });
  if (code === "NONCE_EXPIRED" || code === "NONCE_USED") return sendJson(res, 401, { error: error.message || "Nonce is not valid" });
  if (code === "INVALID_SIGNATURE") return sendJson(res, 401, { error: error.message || "Invalid signature" });
  if (code === "INVALID_LINK") return sendJson(res, 400, { error: error.message || "Invalid wallet link request" });
  console.error("[PROFILE] API error:", error);
  return sendJson(res, 500, { error: "Internal profile API error" });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("error", reject);
    req.on("end", () => {
      if (!body.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(Object.assign(new Error("Invalid JSON body"), { code: "INVALID_JSON_BODY" })); }
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
  if (!token) { sendJson(res, 401, { error: "Missing bearer token" }); return null; }
  try { return await profileService.authenticateAccessToken(token); }
  catch (error) { sendProfileError(res, error); return null; }
}

async function handleProfileApiRequest(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname || "";
  if (!pathname.startsWith("/api/profile/")) return false;

  if (!profileService.isReady()) {
    sendJson(res, 503, { error: "Profile backend is unavailable. Configure SUPABASE_DB_URL (or DATABASE_URL)." });
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
      const result = await profileService.verifyAuthChallenge({ wallet: body.wallet, nonce: body.nonce, signature: body.signature });
      sendJson(res, 200, { accessToken: result.accessToken, expiresAt: result.expiresAt });
      return true;
    }

    if (req.method === "GET" && pathname === "/api/profile/overview") {
      const wallet = parsedUrl.query.wallet;
      if (!wallet || typeof wallet !== "string") { sendJson(res, 400, { error: "Missing wallet query parameter" }); return true; }
      const range = typeof parsedUrl.query.range === "string" ? parsedUrl.query.range : "7D";
      const txLimit = Number.parseInt(String(parsedUrl.query.txLimit ?? "25"), 10);
      const result = await profileService.getOverview({ wallet, range, txLimit: Number.isFinite(txLimit) ? txLimit : 25 });
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === "GET" && pathname === "/api/profile/transactions") {
      const wallet = parsedUrl.query.wallet;
      if (!wallet || typeof wallet !== "string") { sendJson(res, 400, { error: "Missing wallet query parameter" }); return true; }
      const range = typeof parsedUrl.query.range === "string" ? parsedUrl.query.range : "ALL";
      const limit = Number.parseInt(String(parsedUrl.query.limit ?? "25"), 10);
      const cursor = typeof parsedUrl.query.cursor === "string" ? parsedUrl.query.cursor : null;
      const result = await profileService.getTransactions({ wallet, range, limit: Number.isFinite(limit) ? limit : 25, cursor });
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === "PATCH" && pathname === "/api/profile/settings") {
      const session = await requireProfileSession(req, res);
      if (!session) return true;
      const body = await readJsonBody(req);
      const result = await profileService.updateSettingsWithToken({ tokenWallet: session.wallet, patch: body });
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === "POST" && pathname === "/api/profile/session-links") {
      const session = await requireProfileSession(req, res);
      if (!session) return true;
      const body = await readJsonBody(req);
      const result = await profileService.linkSessionWallet({ mainWallet: session.wallet, sessionWallet: body.sessionWallet });
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === "DELETE" && pathname.startsWith("/api/profile/session-links/")) {
      const session = await requireProfileSession(req, res);
      if (!session) return true;
      const sessionWallet = decodeURIComponent(pathname.slice("/api/profile/session-links/".length));
      const result = await profileService.unlinkSessionWallet({ mainWallet: session.wallet, sessionWallet });
      sendJson(res, 200, result);
      return true;
    }

    if (req.method === "POST" && pathname === "/api/profile/backfill") {
      const adminKey = req.headers["x-profile-admin-key"] || req.headers["x-admin-key"];
      const expectedAdminKey = process.env.PROFILE_ADMIN_KEY || "";
      if (!expectedAdminKey) { sendJson(res, 501, { error: "PROFILE_ADMIN_KEY is not configured" }); return true; }
      if (!adminKey || String(adminKey) !== expectedAdminKey) { sendJson(res, 403, { error: "Forbidden" }); return true; }
      if (profileBackfillInFlight) { sendJson(res, 409, { error: "Backfill is already running" }); return true; }
      const body = await readJsonBody(req);
      const maxSignatures = Number.parseInt(String(body.maxSignatures ?? ""), 10);
      const pageSize = Number.parseInt(String(body.pageSize ?? ""), 10);
      const resetCursor = body.resetCursor === true;
      profileBackfillInFlight = true;
      try {
        const result = await profileService.runBackfill({
          provider: evmProvider, contractAddress: GAME_ADDRESS,
          pageSize: Number.isFinite(pageSize) ? pageSize : 500,
          maxSignatures: Number.isFinite(maxSignatures) ? maxSignatures : Infinity,
          resetCursor, jobName: "bet_resolved_full",
        });
        sendJson(res, 200, result);
      } finally { profileBackfillInFlight = false; }
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
async function main() {
  initBinance();

  try {
    const profileReady = await profileService.init();
    if (profileReady) {
      const dbLeaderboard = await profileService.getGlobalLeaderboard(50);
      for (const entry of dbLeaderboard) leaderboard.set(entry.address, entry);
      console.log(`[PROFILE] Leaderboard seeded with ${dbLeaderboard.length} entries from database`);
      setInterval(async () => {
        try {
          const refreshed = await profileService.getGlobalLeaderboard(50);
          for (const entry of refreshed) leaderboard.set(entry.address, entry);
          leaderboardDirty = true;
        } catch (err) { console.error("[PROFILE] Leaderboard refresh failed:", err.message); }
      }, 5 * 60 * 1000);
    } else {
      console.warn("[PROFILE] backend disabled (check SUPABASE_DB_URL/DATABASE_URL)");
    }
  } catch (error) {
    console.error("[PROFILE] startup failure:", error?.message || error);
  }

  const shutdownProfile = async () => {
    try { await profileService.close(); } catch { }
  };
  process.once("SIGINT", shutdownProfile);
  process.once("SIGTERM", shutdownProfile);

  initEvm();
  subscribeVrfEvents();
  const startColX = Math.ceil(serverCurrentX / COLUMN_WIDTH) * COLUMN_WIDTH;
  refreshVrfLocally(startColX);

  const httpServer = createServer(async (req, res) => {
    const origin = req.headers.origin;
    setCorsHeaders(res, origin);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = parse(req.url, true);
    const pathname = parsedUrl.pathname || "";

    // Health check
    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, { ok: true, uptime: process.uptime(), clients: clients.size, price: currentAvaxPrice });
      return;
    }

    if (await handleProfileApiRequest(req, res, parsedUrl)) return;

    if (req.method === "POST" && pathname === "/register-bet") {
      const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
      if (!checkRateLimit(clientIp)) {
        sendJson(res, 429, { ok: false, error: "Rate limit exceeded. Max 60 registrations/minute." });
        return;
      }

      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        try {
          const msg = JSON.parse(body);

          if (bettingPaused) {
            sendJson(res, 503, { ok: false, error: "market_paused" });
            return;
          }

          const validationError = validateBetPayload(msg);
          if (validationError) {
            sendJson(res, 400, { ok: false, error: validationError });
            return;
          }

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
            if (colsAhead < -200) {
              sendJson(res, 400, { ok: false, error: "Bet registration too historically detached" });
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
            console.log(`[BET] Registered: betId=${betKey} box_x=${msg.box_x} row=${msg.box_row} colsAhead=${colsAhead}`);
            broadcastActivePlayers();
          }

          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 400, { ok: false, error: e.message });
        }
      });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });

  httpServer.listen(PORT, hostname, () =>
    console.log(`  ▶  Backend running on http://${hostname}:${PORT}  (WS + REST)`)
  );

  const wss = new WebSocketServer({ server: httpServer });

  // ── Pointer broadcast (~30 fps) ─────────────────────────────────────────────
  let broadcastCount = 0;
  setInterval(async () => {
    if (clients.size === 0) return;
    checkAndUpdateMarketPause();
    serverCurrentX += PX_PER_EVENT;
    broadcastCount++;

    const prevColX = Math.floor((serverCurrentX - PX_PER_EVENT) / COLUMN_WIDTH) * COLUMN_WIDTH;
    const curColX = Math.floor(serverCurrentX / COLUMN_WIDTH) * COLUMN_WIDTH;
    const vrfEntry = vrfPath.get(curColX);
    const vrfWinRow = vrfEntry?.row;
    if (vrfWinRow !== undefined) steerTowardRow(vrfWinRow, curColX, serverCurrentX);

    const { y } = stepSim();
    simYEma = simYEma + EMA_ALPHA * (y - simYEma);
    historyBuffer.push({ x: serverCurrentX, y: simYEma });
    if (historyBuffer.length > HISTORY_SIZE) historyBuffer.shift();

    const tickRow = Math.max(0, Math.min(499, Math.floor(simYEma * 30) + 250));
    const existing = columnRowRange.get(curColX);
    if (!existing) {
      columnRowRange.set(curColX, { minRow: tickRow, maxRow: tickRow });
    } else {
      existing.minRow = Math.min(existing.minRow, tickRow);
      existing.maxRow = Math.max(existing.maxRow, tickRow);
    }

    if (curColX !== prevColX) {
      const range = columnRowRange.get(prevColX);
      if (range) {
        const col = allColumns.find(c => c.x === prevColX);
        if (col) {
          const winRow = Math.round((range.minRow + range.maxRow) / 2);
          const box = col.boxes[winRow];
          if (box) {
            const entry = { colX: prevColX, multiplier: box.multiplier, winRow, timestamp: Date.now() };
            multHistory.push(entry);
            if (multHistory.length > MULT_HISTORY_SIZE) multHistory.shift();
            broadcast(JSON.stringify({ type: "mult_history", entry, history: multHistory }));
          }
        }
      }
      if (columnRowRange.size > 200) {
        const oldest = columnRowRange.keys().next().value;
        columnRowRange.delete(oldest);
      }
    }

    if (broadcastCount % 30 === 1)
      console.log(`[PTR #${broadcastCount}] x=${serverCurrentX.toFixed(1)} y=${y.toFixed(4)} vrfRow=${vrfWinRow ?? "?"}`);

    broadcast(JSON.stringify({ type: "pointer", y: simYEma, currentX: serverCurrentX, price: currentAvaxPrice, timestamp: Date.now() }));

    for (const [key, info] of pendingBets) {
      if (serverCurrentX >= info.box_x + COLUMN_WIDTH && !retryingBets.has(key)) {
        resolveBet(key).catch(e => console.error("[BET] resolveBet error:", e.message));
      }
    }

    const colsAhead = (curColX - lastVrfColX) / COLUMN_WIDTH;
    if (colsAhead >= VRF_REFRESH_COLS - 3 && !vrfRequestPending) {
      const nextVrfStart = lastVrfColX + VRF_REFRESH_COLS * COLUMN_WIDTH;
      refreshVrfLocally(nextVrfStart);
    }
  }, 33);

  // ── Grid broadcast (every 1 s) ───────────────────────────────────────────────
  setInterval(() => {
    if (clients.size === 0) return;
    const colsAhead = Math.round((nextColX - serverCurrentX) / COLUMN_WIDTH);
    if (colsAhead >= 35) return;
    const needed = Math.max(10, 50 - colsAhead);
    const cols = makeColumns(needed);
    allColumns.push(...cols);
    if (allColumns.length > 400) allColumns.splice(0, allColumns.length - 400);
    broadcast(JSON.stringify({ type: "grid", columns: cols }));
  }, 1000);

  // ── New client connection ────────────────────────────────────────────────────
  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`[WS] Client connected (total=${clients.size})`);

    ws.send(JSON.stringify({
      type: "init", columns: allColumns, history: historyBuffer.slice(),
      currentX: serverCurrentX, multHistory: multHistory.slice(),
      houseBank: houseBankBalance, marketPaused: bettingPaused,
    }));

    if (vrfPath.size > 0) {
      const paths = [];
      for (const [colX, entry] of vrfPath) paths.push({ colX, row: entry.row });
      ws.send(JSON.stringify({ type: "vrf_state", paths, seedIndex: currentSeedIndex }));
    }

    if (leaderboard.size > 0) ws.send(JSON.stringify(leaderboardPayload()));
    ws.send(JSON.stringify(activePlayersPayload()));

    const snap = ghostSnapshot();
    if (snap.length > 0) ws.send(JSON.stringify({ type: "ghost_snapshot", entries: snap }));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "ghost_select") {
          const key = `${msg.colX}_${msg.row}`;
          ghostAdd(ws, key, msg.shortAddr);
          const relay = JSON.stringify({ type: "ghost_select", colX: msg.colX, row: msg.row, shortAddr: msg.shortAddr });
          for (const client of clients) { if (client !== ws && client.readyState === client.OPEN) client.send(relay); }
        } else if (msg.type === "ghost_deselect") {
          const key = `${msg.colX}_${msg.row}`;
          ghostRemove(ws, key, msg.shortAddr);
          const relay = JSON.stringify({ type: "ghost_deselect", colX: msg.colX, row: msg.row, shortAddr: msg.shortAddr });
          for (const client of clients) { if (client !== ws && client.readyState === client.OPEN) client.send(relay); }
        } else if (msg.type === "register_bet") {
          if (bettingPaused) return;
          const wsValidErr = validateBetPayload(msg);
          if (wsValidErr) { console.warn(`[BET] WS validation failed: ${wsValidErr}`); return; }

          if (msg.user && profileService.isEnabled()) {
            profileService.ensureReferralCode(msg.user).catch(() => { });
            if (msg.referralCode) {
              profileService.handleReferral({ userWallet: msg.user, referralCode: msg.referralCode }).catch(() => { });
            }
          }

          const betKey = String(msg.betId ?? msg.betPda ?? "");
          const betColX = Math.floor(Number(msg.box_x) / COLUMN_WIDTH) * COLUMN_WIDTH;
          const curColX = Math.floor(serverCurrentX / COLUMN_WIDTH) * COLUMN_WIDTH;
          const colsAhead = (betColX - curColX) / COLUMN_WIDTH;
          if (!pendingBets.has(betKey)) {
            if (colsAhead <= 0) {
              console.warn(`[BET] REJECTED via WS (too late): box_x=${msg.box_x}`);
            } else {
              pendingBets.set(betKey, {
                betId: String(msg.betId ?? ""), user: msg.user,
                box_x: Number(msg.box_x), box_row: Number(msg.box_row),
                mult_num: Number(msg.mult_num), bet_amount: Number(msg.bet_amount),
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
      const removed = ghostCleanupWs(ws);
      if (removed && removed.length > 0) {
        for (const { key, shortAddr } of removed) {
          const [colX, row] = key.split("_").map(Number);
          const relay = JSON.stringify({ type: "ghost_deselect", colX, row, shortAddr });
          for (const client of clients) { if (client.readyState === client.OPEN) client.send(relay); }
        }
      }
      console.log(`[WS] Client disconnected (total=${clients.size})`);
    });

    ws.on("error", err => console.error("[WS] error", err));
  });
}

main().catch(err => { console.error("[FATAL]", err); process.exit(1); });
