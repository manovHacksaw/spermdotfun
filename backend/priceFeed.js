// ── Price feed + market pause + house bank ────────────────────────────────────
//
// Binance geo-blocks US-hosted servers (Render runs on AWS us-east).
// We use two US-friendly sources instead:
//   Primary:   Kraken WebSocket  wss://ws.kraken.com  (port 443, no geo-block)
//   Fallback:  Coinbase REST     api.coinbase.com      (US company, always open)

const { WebSocket } = require('ws');
const https = require('https');
const { ethers } = require('ethers');
const { PRICE_STALE_MS, GAME_ADDRESS } = require('./config');
const { state, broadcast } = require('./state');

// ── Chainlink On-Chain Feed (Fuji) ───────────────────────────────────────────
// This is geoblock-proof and works on all cloud providers.
const CHAINLINK_AVAX_USD = '0x5498BB86BC934c8D34FDA08E81D444153d0D06aD';
const DATA_FEED_ABI = [
  'function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
];

async function fetchPriceChainlink() {
  if (!state.evmProvider) return;
  try {
    const contract = new ethers.Contract(CHAINLINK_AVAX_USD, DATA_FEED_ABI, state.evmProvider);
    const roundData = await contract.latestRoundData();
    const price = parseFloat(ethers.formatUnits(roundData.answer, 8));

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
    console.error('[PRICE] Chainlink fetch error:', err.message);
  }
}

function initBinance() {
  // Poll every 2 seconds for fresh on-chain data
  setInterval(fetchPriceChainlink, 2000);
  fetchPriceChainlink();
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

module.exports = { initPriceFeed: initBinance, checkAndUpdateMarketPause, updateHouseBank };
