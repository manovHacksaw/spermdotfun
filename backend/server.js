require('dotenv').config();

const { createServer } = require('http');
const { parse } = require('url');
const { WebSocketServer } = require('ws');
const { createProfileService } = require('./lib/server/profile-service');

const { state, broadcast } = require('./state');
const { initEvm } = require('./evm');
const { initBinance, checkAndUpdateMarketPause, updateHouseBank } = require('./priceFeed');
const { stepSim, steerTowardRow } = require('./physics');
const { refreshVrfLocally, subscribeVrfEvents } = require('./vrfManager');
const { resolveBet, leaderboardPayload, activePlayersPayload, broadcastActivePlayers } = require('./betResolution');
const { setCorsHeaders, sendJson, handleProfileApiRequest } = require('./profileRoutes');
const {
  COLUMN_WIDTH, PX_PER_EVENT, HISTORY_SIZE, MULT_HISTORY_SIZE, NICKNAME_CACHE_TTL,
  EVM_ADDR_RE, MAX_BET_AMOUNT, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX,
  EMA_ALPHA, VRF_REFRESH_COLS,
} = require('./config');

const hostname = '0.0.0.0';
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// ── Rate limiting ─────────────────────────────────────────────────────────────
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

// ── Bet payload validation ────────────────────────────────────────────────────
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
  return null;
}

// ── Grid generation ───────────────────────────────────────────────────────────
function randomMult() {
  const lambda = 0.22;
  const minX = 1.01, maxX = 20.0;
  const u = Math.random();
  const raw = minX - Math.log(1 - u * (1 - Math.exp(-lambda * (maxX - minX)))) / lambda;
  const display = Math.min(maxX, Math.max(minX, raw));
  const num = Math.round(display * 100);
  return { num, den: 100, display: num / 100 };
}

function makeColumns(count) {
  const cols = [];
  for (let i = 0; i < count; i++) {
    state.gridIdCounter++;
    const colBoxes = [];
    for (let r = 0; r < 500; r++) {
      const m = randomMult();
      colBoxes.push({ id: `b${state.gridIdCounter}-${r}`, multiplier: m.display, mult_num: m.num, mult_den: m.den });
    }
    cols.push({ id: `g${state.gridIdCounter}`, x: state.nextColX, boxes: colBoxes });
    state.nextColX += COLUMN_WIDTH;
  }
  return cols;
}

// ── Nickname lookup ───────────────────────────────────────────────────────────
function lookupNickname(address, profileService) {
  const cached = state.nicknameCache.get(address);
  if (cached && Date.now() - cached.cachedAt < NICKNAME_CACHE_TTL) return;
  state.nicknameCache.set(address, { nickname: null, cachedAt: Date.now() });
  profileService.getWalletNickname(address)
    .then(nickname => state.nicknameCache.set(address, { nickname: nickname || null, cachedAt: Date.now() }))
    .catch(() => { });
}

// ── Ghost cursors ─────────────────────────────────────────────────────────────
function ghostAdd(ws, key, shortAddr) {
  if (!state.ghostSelections.has(key)) state.ghostSelections.set(key, new Set());
  state.ghostSelections.get(key).add(shortAddr);
  if (!state.wsGhostKeys.has(ws)) state.wsGhostKeys.set(ws, new Map());
  state.wsGhostKeys.get(ws).set(key, shortAddr);
}

function ghostRemove(ws, key, shortAddr) {
  const set = state.ghostSelections.get(key);
  if (set) { set.delete(shortAddr); if (set.size === 0) state.ghostSelections.delete(key); }
  const wsKeys = state.wsGhostKeys.get(ws);
  if (wsKeys) wsKeys.delete(key);
}

function ghostCleanupWs(ws) {
  const wsKeys = state.wsGhostKeys.get(ws);
  if (!wsKeys) return [];
  const removed = [];
  for (const [key, shortAddr] of wsKeys) {
    const set = state.ghostSelections.get(key);
    if (set) { set.delete(shortAddr); if (set.size === 0) state.ghostSelections.delete(key); }
    removed.push({ key, shortAddr });
  }
  state.wsGhostKeys.delete(ws);
  return removed;
}

function ghostSnapshot() {
  const entries = [];
  for (const [key, set] of state.ghostSelections) {
    const [colX, row] = key.split('_').map(Number);
    for (const shortAddr of set) entries.push({ colX, row, shortAddr });
  }
  return entries;
}

// ── Register a bet into pending state ────────────────────────────────────────
function registerBet(msg, profileService) {
  const betKey = String(msg.betId ?? msg.betPda ?? '');
  if (!betKey || state.pendingBets.has(betKey)) return;

  if (msg.user && profileService.isEnabled()) {
    profileService.ensureReferralCode(msg.user).catch(() => { });
    if (msg.referralCode) {
      profileService.handleReferral({ userWallet: msg.user, referralCode: msg.referralCode })
        .catch(err => console.error('[REFERRAL]', err.message));
    }
  }

  state.pendingBets.set(betKey, {
    betId: String(msg.betId ?? ''),
    user: msg.user,
    box_x: Number(msg.box_x),
    box_row: Number(msg.box_row),
    mult_num: Number(msg.mult_num),
    bet_amount: Number(msg.bet_amount),
    lastBetAt: Date.now(),
  });

  if (msg.user) lookupNickname(msg.user, profileService);
  broadcastActivePlayers();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function main() {
  initBinance();

  const profileService = createProfileService({
    logger: console,
    getTxResolvedAt: async (txHash) => {
      try {
        if (!state.evmProvider) return null;
        const receipt = await state.evmProvider.getTransactionReceipt(txHash);
        if (!receipt?.blockNumber) return null;
        const block = await state.evmProvider.getBlock(receipt.blockNumber);
        if (block?.timestamp) return new Date(block.timestamp * 1000);
        return null;
      } catch { return null; }
    },
  });

  try {
    const profileReady = await profileService.init();
    if (profileReady) {
      const dbLeaderboard = await profileService.getGlobalLeaderboard(50);
      for (const entry of dbLeaderboard) state.leaderboard.set(entry.address, entry);
      console.log(`[PROFILE] Leaderboard seeded with ${dbLeaderboard.length} entries from database`);
      setInterval(async () => {
        try {
          const refreshed = await profileService.getGlobalLeaderboard(50);
          for (const entry of refreshed) state.leaderboard.set(entry.address, entry);
          state.leaderboardDirty = true;
        } catch (err) { console.error('[PROFILE] Leaderboard refresh failed:', err.message); }
      }, 5 * 60 * 1000);
    } else {
      console.warn('[PROFILE] backend disabled (check SUPABASE_DB_URL/DATABASE_URL)');
    }
  } catch (error) {
    console.error('[PROFILE] startup failure:', error?.message || error);
  }

  const shutdownProfile = async () => { try { await profileService.close(); } catch { } };
  process.once('SIGINT', shutdownProfile);
  process.once('SIGTERM', shutdownProfile);

  initEvm();
  subscribeVrfEvents();

  // Seed initial history and columns
  state.allColumns.push(...makeColumns(30));
  for (let i = 0; i < HISTORY_SIZE; i++) {
    state.serverCurrentX += PX_PER_EVENT;
    const { y } = stepSim();
    state.historyBuffer.push({ x: state.serverCurrentX, y });
  }
  state.nextColX = (Math.floor(state.serverCurrentX / COLUMN_WIDTH) + 2) * COLUMN_WIDTH;
  state.allColumns.length = 0;
  state.allColumns.push(...makeColumns(50));
  console.log(`[BOOT] history=${state.historyBuffer.length}pts x=${state.serverCurrentX.toFixed(1)}`);
  console.log(`[BOOT] columns=${state.allColumns.length} x=${state.allColumns[0]?.x}–${state.allColumns[state.allColumns.length - 1]?.x}`);

  refreshVrfLocally(Math.ceil(state.serverCurrentX / COLUMN_WIDTH) * COLUMN_WIDTH);

  setInterval(updateHouseBank, 30_000);
  setInterval(() => {
    if (state.leaderboardDirty && state.clients.size > 0) {
      broadcast(JSON.stringify(leaderboardPayload()));
      state.leaderboardDirty = false;
    }
  }, 2000);

  // ── HTTP server ───────────────────────────────────────────────────────────
  const httpServer = createServer(async (req, res) => {
    const origin = req.headers.origin;
    setCorsHeaders(res, origin, ALLOWED_ORIGIN);

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const parsedUrl = parse(req.url, true);
    const pathname = parsedUrl.pathname || '';

    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true, uptime: process.uptime(), clients: state.clients.size, price: state.currentAvaxPrice });
      return;
    }

    if (await handleProfileApiRequest(req, res, parsedUrl, profileService)) return;

    if (req.method === 'POST' && pathname === '/register-bet') {
      const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
      if (!checkRateLimit(clientIp)) {
        sendJson(res, 429, { ok: false, error: 'Rate limit exceeded. Max 60 registrations/minute.' });
        return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const msg = JSON.parse(body);
          if (state.bettingPaused) { sendJson(res, 503, { ok: false, error: 'market_paused' }); return; }
          const err = validateBetPayload(msg);
          if (err) { sendJson(res, 400, { ok: false, error: err }); return; }
          const betColX = Math.floor(Number(msg.box_x) / COLUMN_WIDTH) * COLUMN_WIDTH;
          const curColX = Math.floor(state.serverCurrentX / COLUMN_WIDTH) * COLUMN_WIDTH;
          if ((betColX - curColX) / COLUMN_WIDTH < -200) {
            sendJson(res, 400, { ok: false, error: 'Bet registration too historically detached' });
            return;
          }
          registerBet(msg, profileService);
          console.log(`[BET] Registered: betId=${msg.betId ?? msg.betPda} box_x=${msg.box_x} row=${msg.box_row}`);
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 400, { ok: false, error: e.message });
        }
      });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  });

  httpServer.listen(PORT, hostname, () =>
    console.log(`  ▶  Backend running on http://${hostname}:${PORT}  (WS + REST)`)
  );

  const wss = new WebSocketServer({ server: httpServer });

  // ── Pointer broadcast (~30 fps) ───────────────────────────────────────────
  let broadcastCount = 0;
  setInterval(() => {
    if (state.clients.size === 0) return;
    checkAndUpdateMarketPause();
    state.serverCurrentX += PX_PER_EVENT;
    broadcastCount++;

    const prevColX = Math.floor((state.serverCurrentX - PX_PER_EVENT) / COLUMN_WIDTH) * COLUMN_WIDTH;
    const curColX = Math.floor(state.serverCurrentX / COLUMN_WIDTH) * COLUMN_WIDTH;
    const vrfEntry = state.vrfPath.get(curColX);
    if (vrfEntry?.row !== undefined) steerTowardRow(vrfEntry.row, curColX, state.serverCurrentX);

    const { y } = stepSim();
    state.simYEma = state.simYEma + EMA_ALPHA * (y - state.simYEma);
    state.historyBuffer.push({ x: state.serverCurrentX, y: state.simYEma });
    if (state.historyBuffer.length > HISTORY_SIZE) state.historyBuffer.shift();

    const tickRow = Math.max(0, Math.min(499, Math.floor(state.simYEma * 30) + 250));
    const existing = state.columnRowRange.get(curColX);
    if (!existing) {
      state.columnRowRange.set(curColX, { minRow: tickRow, maxRow: tickRow });
    } else {
      existing.minRow = Math.min(existing.minRow, tickRow);
      existing.maxRow = Math.max(existing.maxRow, tickRow);
    }

    if (curColX !== prevColX) {
      const range = state.columnRowRange.get(prevColX);
      if (range) {
        const col = state.allColumns.find(c => c.x === prevColX);
        if (col) {
          const winRow = Math.round((range.minRow + range.maxRow) / 2);
          const box = col.boxes[winRow];
          if (box) {
            const entry = { colX: prevColX, multiplier: box.multiplier, winRow, timestamp: Date.now() };
            state.multHistory.push(entry);
            if (state.multHistory.length > MULT_HISTORY_SIZE) state.multHistory.shift();
            broadcast(JSON.stringify({ type: 'mult_history', entry, history: state.multHistory }));
          }
        }
      }
      if (state.columnRowRange.size > 200) {
        state.columnRowRange.delete(state.columnRowRange.keys().next().value);
      }
    }

    if (broadcastCount % 30 === 1)
      console.log(`[PTR #${broadcastCount}] x=${state.serverCurrentX.toFixed(1)} y=${y.toFixed(4)} vrfRow=${vrfEntry?.row ?? '?'}`);

    broadcast(JSON.stringify({ type: 'pointer', y: state.simYEma, currentX: state.serverCurrentX, price: state.currentAvaxPrice, timestamp: Date.now() }));

    for (const [key, info] of state.pendingBets) {
      if (state.serverCurrentX >= info.box_x + COLUMN_WIDTH && !state.retryingBets.has(key)) {
        resolveBet(key, profileService).catch(e => console.error('[BET] resolveBet error:', e.message));
      }
    }

    const colsAhead = (curColX - state.lastVrfColX) / COLUMN_WIDTH;
    if (colsAhead >= VRF_REFRESH_COLS - 3 && !state.vrfRequestPending) {
      refreshVrfLocally(state.lastVrfColX + VRF_REFRESH_COLS * COLUMN_WIDTH);
    }
  }, 33);

  // ── Grid broadcast (1 s) ──────────────────────────────────────────────────
  setInterval(() => {
    if (state.clients.size === 0) return;
    const colsAhead = Math.round((state.nextColX - state.serverCurrentX) / COLUMN_WIDTH);
    if (colsAhead >= 35) return;
    const cols = makeColumns(Math.max(10, 50 - colsAhead));
    state.allColumns.push(...cols);
    if (state.allColumns.length > 400) state.allColumns.splice(0, state.allColumns.length - 400);
    broadcast(JSON.stringify({ type: 'grid', columns: cols }));
  }, 1000);

  // ── WebSocket connections ─────────────────────────────────────────────────
  wss.on('connection', (ws) => {
    state.clients.add(ws);
    console.log(`[WS] Client connected (total=${state.clients.size})`);

    ws.send(JSON.stringify({
      type: 'init', columns: state.allColumns, history: state.historyBuffer.slice(),
      currentX: state.serverCurrentX, multHistory: state.multHistory.slice(),
      houseBank: state.houseBankBalance, marketPaused: state.bettingPaused,
      price: state.currentAvaxPrice,
    }));

    if (state.vrfPath.size > 0) {
      const paths = [];
      for (const [colX, entry] of state.vrfPath) paths.push({ colX, row: entry.row });
      ws.send(JSON.stringify({ type: 'vrf_state', paths, seedIndex: state.currentSeedIndex }));
    }

    if (state.leaderboard.size > 0) ws.send(JSON.stringify(leaderboardPayload()));
    ws.send(JSON.stringify(activePlayersPayload()));

    const snap = ghostSnapshot();
    if (snap.length > 0) ws.send(JSON.stringify({ type: 'ghost_snapshot', entries: snap }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'ghost_select') {
          const key = `${msg.colX}_${msg.row}`;
          ghostAdd(ws, key, msg.shortAddr);
          const relay = JSON.stringify({ type: 'ghost_select', colX: msg.colX, row: msg.row, shortAddr: msg.shortAddr });
          for (const c of state.clients) { if (c !== ws && c.readyState === c.OPEN) c.send(relay); }
        } else if (msg.type === 'ghost_deselect') {
          const key = `${msg.colX}_${msg.row}`;
          ghostRemove(ws, key, msg.shortAddr);
          const relay = JSON.stringify({ type: 'ghost_deselect', colX: msg.colX, row: msg.row, shortAddr: msg.shortAddr });
          for (const c of state.clients) { if (c !== ws && c.readyState === c.OPEN) c.send(relay); }
        } else if (msg.type === 'register_bet') {
          if (state.bettingPaused) return;
          const wsErr = validateBetPayload(msg);
          if (wsErr) { console.warn(`[BET] WS validation failed: ${wsErr}`); return; }
          const betColX = Math.floor(Number(msg.box_x) / COLUMN_WIDTH) * COLUMN_WIDTH;
          const curColX = Math.floor(state.serverCurrentX / COLUMN_WIDTH) * COLUMN_WIDTH;
          if ((betColX - curColX) / COLUMN_WIDTH <= 0) {
            console.warn(`[BET] REJECTED via WS (too late): box_x=${msg.box_x}`);
            return;
          }
          registerBet(msg, profileService);
        }
      } catch (e) {
        console.error('[WS] message parse error', e.message);
      }
    });

    ws.on('close', () => {
      state.clients.delete(ws);
      const removed = ghostCleanupWs(ws);
      if (removed?.length > 0) {
        for (const { key, shortAddr } of removed) {
          const [colX, row] = key.split('_').map(Number);
          const relay = JSON.stringify({ type: 'ghost_deselect', colX, row, shortAddr });
          for (const c of state.clients) { if (c.readyState === c.OPEN) c.send(relay); }
        }
      }
      console.log(`[WS] Client disconnected (total=${state.clients.size})`);
    });

    ws.on('error', err => console.error('[WS] error', err));
  });
}

main().catch(err => { console.error('[BOOT] Fatal error:', err); process.exit(1); });
