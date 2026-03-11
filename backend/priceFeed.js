// ── Price feed + market pause + house bank ────────────────────────────────────
//
//   Primary:   Binance.US WebSocket  wss://stream.binance.us:9443  (US-legal)
//   Fallback:  Chainlink on-chain    Fuji AVAX/USD feed             (geo-proof)

const { WebSocket } = require('ws');
const { ethers } = require('ethers');
const { PRICE_STALE_MS, GAME_ADDRESS } = require('./config');
const { state, broadcast } = require('./state');

// ── Chainlink fallback (Fuji AVAX/USD) ───────────────────────────────────────
const CHAINLINK_AVAX_USD = '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD';
const DATA_FEED_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
];

async function fetchPriceChainlink() {
  if (!state.evmProvider) return;
  try {
    const feed = new ethers.Contract(CHAINLINK_AVAX_USD, DATA_FEED_ABI, state.evmProvider);
    const { answer } = await feed.latestRoundData();
    const price = parseFloat(ethers.formatUnits(answer, 8));
    if (price > 0) {
      state.currentAvaxPrice = price;
      state.lastPriceTick = Date.now();
      state.lastFeedError = null;
      if (state.priceBaseline === 0) {
        state.priceBaseline = price;
        console.log(`[PRICE] Chainlink initial: $${price}`);
      }
    }
  } catch (err) {
    state.lastFeedError = `Chainlink error: ${err.message}`;
    console.error('[PRICE] Chainlink error:', err.message);
  }
}

// ── Binance.US WebSocket ──────────────────────────────────────────────────────
function initBinanceUs() {
  // Try port 443 first, fall back to 9443
  const urls = [
    'wss://stream.binance.us/ws/avaxusdt@ticker',
    'wss://stream.binance.us:9443/ws/avaxusdt@ticker',
  ];
  let idx = 0;

  function connect() {
    const url = urls[idx % urls.length];
    console.log(`[PRICE] Connecting to Binance.US: ${url}`);
    const ws = new WebSocket(url);

    let staleTimer = setTimeout(() => {
      if (state.currentAvaxPrice === 0) {
        console.warn('[PRICE] Binance.US no data after 8s — Chainlink fallback active');
        fetchPriceChainlink();
      }
    }, 8000);

    ws.onopen = () => console.log(`[PRICE] Binance.US connected (${url})`);

    ws.onmessage = (evt) => {
      clearTimeout(staleTimer);
      staleTimer = null;
      try {
        const data = JSON.parse(evt.data);
        const price = parseFloat(data.c);
        if (price > 0) {
          state.currentAvaxPrice = price;
          state.lastPriceTick = Date.now();
          state.lastFeedError = null;
          if (state.priceBaseline === 0) {
            state.priceBaseline = price;
            console.log(`[PRICE] Binance.US initial: $${price}`);
          }
        }
      } catch (e) {
        console.error('[PRICE] Binance.US parse error:', e.message);
      }
    };

    ws.onerror = (err) => {
      state.lastFeedError = `Binance.US WS error: ${err.message ?? err}`;
      console.error(`[PRICE] Binance.US error (${url}):`, err.message ?? err);
      if (staleTimer) { clearTimeout(staleTimer); staleTimer = null; }
    };

    ws.onclose = () => {
      if (staleTimer) { clearTimeout(staleTimer); staleTimer = null; }
      idx++;
      const delay = idx <= urls.length ? 3000 : 10_000;
      console.log(`[PRICE] Binance.US closed — retry in ${delay / 1000}s`);
      setTimeout(connect, delay);
    };
  }

  connect();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function initPriceFeed() {
  // Chainlink gives an immediate price on startup (before WS connects)
  fetchPriceChainlink();
  // Keep Chainlink polling every 10s as a safety floor
  setInterval(fetchPriceChainlink, 10_000);
  // Binance.US WS provides real-time ticks on top
  initBinanceUs();
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

module.exports = { initPriceFeed, checkAndUpdateMarketPause, updateHouseBank };
