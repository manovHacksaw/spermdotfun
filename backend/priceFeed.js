// ── Binance price feed + market pause + house bank ───────────────────────────

const { WebSocket } = require('ws');
const { ethers } = require('ethers');
const { PRICE_STALE_MS, GAME_ADDRESS } = require('./config');
const { state, broadcast } = require('./state');

function initBinance() {
  const ws = new WebSocket('wss://stream.binance.com:9443/ws/avaxusdt@ticker');

  ws.onopen = () => console.log('[BINANCE] Connected to AVAX/USDT ticker stream');

  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      // 'c' is the last price in miniTicker
      const price = parseFloat(data.c);
      if (price > 0) {
        state.currentAvaxPrice = price;
        state.lastPriceTick = Date.now();
        if (state.priceBaseline === 0) {
          state.priceBaseline = price;
          console.log(`[BINANCE] Initial price: $${price}`);
        }
      }
    } catch (e) {
      console.error('[BINANCE] Message parse error', e);
    }
  };
  ws.onerror = (err) => console.error('[BINANCE] Error', err);
  ws.onclose = () => {
    console.log('[BINANCE] Connection closed, retrying in 5s...');
    setTimeout(initBinance, 5000);
  };
}

function checkAndUpdateMarketPause() {
  if (state.lastPriceTick === 0) return;
  const stale = Date.now() - state.lastPriceTick > PRICE_STALE_MS;
  if (stale !== state.bettingPaused) {
    state.bettingPaused = stale;
    broadcast(JSON.stringify({ type: 'market_paused', paused: state.bettingPaused }));
    console.log(`[MARKET] ${state.bettingPaused ? 'PAUSED (feed stale)' : 'RESUMED'}`);
  }
}

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
