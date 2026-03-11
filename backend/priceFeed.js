// ── Binance price feed + market pause + house bank ───────────────────────────

const { WebSocket } = require('ws');
const https = require('https');
const { ethers } = require('ethers');
const { PRICE_STALE_MS, GAME_ADDRESS } = require('./config');
const { state, broadcast } = require('./state');

// ── REST fallback — poll Binance HTTP API ─────────────────────────────────────
function fetchPriceRest() {
  state.restAttempts++;
  const url = 'https://api.binance.com/api/v3/ticker/price?symbol=AVAXUSDT';
  const options = {
    headers: { 'User-Agent': 'Mozilla/5.0 (SPRMFUN-Server)' },
    timeout: 5000
  };

  const req = https.get(url, options, (res) => {
    let body = '';
    if (res.statusCode !== 200) {
      state.lastFeedError = `REST HTTP ${res.statusCode}`;
      return;
    }
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      try {
        const price = parseFloat(JSON.parse(body).price);
        if (price > 0) {
          state.currentAvaxPrice = price;
          state.lastPriceTick = Date.now();
          state.lastFeedError = null; // Clear on success
          if (state.priceBaseline === 0) {
            state.priceBaseline = price;
          }
        }
      } catch (e) {
        state.lastFeedError = `REST Parse Error: ${e.message}`;
      }
    });
  });

  req.on('error', (e) => {
    state.lastFeedError = `REST Request Error: ${e.message}`;
  });

  req.on('timeout', () => {
    req.destroy();
    state.lastFeedError = 'REST Request Timeout';
  });
}

// ── WebSocket stream ──────────────────────────────────────────────────────────
function initBinance() {
  // Try port 443 first (always open on hosting providers), fall back to 9443
  const WS_URLS = [
    'wss://stream.binance.com/ws/avaxusdt@ticker',
    'wss://stream.binance.com:9443/ws/avaxusdt@ticker',
  ];
  let urlIndex = 0;

  function connect() {
    const url = WS_URLS[urlIndex % WS_URLS.length];
    console.log(`[BINANCE] Connecting to ${url}`);
    const ws = new WebSocket(url);

    // If no message within 10s of open, assume port is blocked → try REST fallback
    let openTimer = null;

    ws.onopen = () => {
      console.log(`[BINANCE] Connected (${url})`);
      openTimer = setTimeout(() => {
        if (state.currentAvaxPrice === 0) {
          console.warn('[BINANCE] No data after 10s — starting REST fallback poll');
          startRestFallback();
        }
      }, 10_000);
    };

    ws.onmessage = (evt) => {
      if (openTimer) { clearTimeout(openTimer); openTimer = null; }
      try {
        const data = JSON.parse(evt.data);
        const price = parseFloat(data.c);
        console.log(`[BINANCE] Received tick for ${data.s}: ${data.c}`);
        if (price > 0) {
          state.currentAvaxPrice = price;
          state.lastPriceTick = Date.now();
          if (state.priceBaseline === 0) {
            state.priceBaseline = price;
            console.log(`[BINANCE] Initial price baseline set: $${price}`);
          }
        } else {
          console.warn('[BINANCE] Price parsed as 0 or empty:', data.c);
        }
      } catch (e) {
        console.error('[BINANCE] Message parse error', e, 'Data:', evt.data);
      }
    };

    ws.onerror = (err) => {
      console.error(`[BINANCE] Error on ${url}:`, err.message ?? err);
      if (openTimer) { clearTimeout(openTimer); openTimer = null; }
    };

    ws.onclose = () => {
      if (openTimer) { clearTimeout(openTimer); openTimer = null; }
      urlIndex++;
      const delay = urlIndex <= WS_URLS.length ? 2000 : 10_000;
      console.log(`[BINANCE] Closed — retrying in ${delay / 1000}s`);
      setTimeout(connect, delay);
    };
  }

  connect();

  // Fetch immediately via REST so price is nonzero from the first tick
  fetchPriceRest();
  // Also keep REST polling every 3s as a permanent safety net
  startRestFallback();
}

// ── REST fallback poll (every 3s) ─────────────────────────────────────────────
let restFallbackRunning = false;

function startRestFallback() {
  if (restFallbackRunning) return;
  restFallbackRunning = true;
  console.log('[BINANCE] REST fallback active (polling every 3s)');
  setInterval(fetchPriceRest, 3000);
}

// ── Market pause ──────────────────────────────────────────────────────────────
function checkAndUpdateMarketPause() {
  if (state.lastPriceTick === 0) return;
  const stale = Date.now() - state.lastPriceTick > PRICE_STALE_MS;
  if (stale !== state.bettingPaused) {
    state.bettingPaused = stale;
    broadcast(JSON.stringify({ type: 'market_paused', paused: state.bettingPaused }));
    console.log(`[MARKET] ${state.bettingPaused ? 'PAUSED (feed stale)' : 'RESUMED'}`);
  }
}

// ── House bank ────────────────────────────────────────────────────────────────
async function updateHouseBank() {
  if (!state.onchainReady || !state.tokenContract || !GAME_ADDRESS) return;
  try {
    const bal = await state.tokenContract.balanceOf(GAME_ADDRESS);
    const formatted = parseFloat(ethers.formatUnits(bal, 18));
    if (formatted !== state.houseBankBalance) {
      state.houseBankBalance = formatted;
      broadcast(JSON.stringify({ type: 'house_bank', balance: state.houseBankBalance }));
    }
  } catch (err) {
    console.error(`[BANK] Failed to fetch house bank: ${err.message}`);
  }
}

module.exports = { initBinance, checkAndUpdateMarketPause, updateHouseBank };
