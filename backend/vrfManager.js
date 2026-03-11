// ── Chainlink VRF management ──────────────────────────────────────────────────

const crypto = require('crypto');
const { COLUMN_WIDTH, VRF_REFRESH_COLS, VRF_ENABLED } = require('./config');
const { state, broadcast } = require('./state');

// Initialise with local random bytes (replaced by on-chain VRF when available)
state.currentVrfResult = crypto.randomBytes(32);

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

function deriveWinningRow(vrfResult, boxX) {
  const boxXBuf = Buffer.alloc(8);
  boxXBuf.writeBigInt64LE(BigInt(boxX));
  const hash = crypto.createHash('sha256').update(vrfResult).update(boxXBuf).digest();
  let delta = weightedDelta(hash[0]);
  const distFromCenter = state.lastWinRow - 250;
  const bias = -Math.sign(distFromCenter) * Math.round(Math.abs(distFromCenter) * 0.7);
  delta = Math.max(-4, Math.min(4, delta + bias));
  let row = Math.max(0, Math.min(499, state.lastWinRow + delta));
  if (row === state.lastWinRow) {
    row = (hash[1] & 1) ? Math.min(499, row + 1) : Math.max(0, row - 1);
  }
  state.lastWinRow = row;
  return row;
}

function populateVrfPathLocally(startColX) {
  const newPaths = [];
  for (let i = 0; i < VRF_REFRESH_COLS; i++) {
    const colX = startColX + i * COLUMN_WIDTH;
    const row = deriveWinningRow(state.currentVrfResult, colX);
    state.vrfPath.set(colX, { row, vrfResult: state.currentVrfResult });
    newPaths.push({ colX, row });
  }
  broadcast(JSON.stringify({ type: 'path_revealed', paths: newPaths, seedIndex: state.currentSeedIndex }));
}

function refreshVrfLocally(startColX) {
  state.pendingVrfStartColX = startColX;
  state.lastVrfColX = startColX;

  if (state.gameContract && VRF_ENABLED) {
    state.vrfRequestPending = true;
    state.gameContract.isVrfPending()
      .then((alreadyPending) => {
        if (alreadyPending) {
          state.currentVrfResult = crypto.randomBytes(32);
          state.currentSeedIndex++;
          state.vrfRequestPending = true;
          populateVrfPathLocally(startColX);
          return;
        }
        return state.gameContract.requestVrf().then(tx => console.log(`[VRF] requestVrf tx=${tx.hash}`));
      })
      .catch((e) => {
        console.error('[VRF] requestVrf failed — using local fallback:', e.message);
        state.vrfRequestPending = false;
        state.currentVrfResult = crypto.randomBytes(32);
        state.currentSeedIndex++;
        populateVrfPathLocally(startColX);
      });
  } else {
    state.currentVrfResult = crypto.randomBytes(32);
    state.currentSeedIndex++;
    state.vrfRequestPending = false;
    populateVrfPathLocally(startColX);
  }
}

function subscribeVrfEvents() {
  if (!state.gameContract || !VRF_ENABLED) return;
  const sub = state.gameContract._wsContract || state.gameContract;
  sub.on('VrfFulfilled', (epochId, requestId, vrfResult) => {
    console.log(`[VRF] Fulfilled: epochId=${epochId} requestId=${requestId}`);
    state.currentVrfResult = Buffer.from(vrfResult.slice(2), 'hex');
    state.currentSeedIndex = Number(epochId);
    state.vrfRequestPending = false;
    populateVrfPathLocally(state.pendingVrfStartColX);
    broadcast(JSON.stringify({ type: 'vrf_state', seedIndex: state.currentSeedIndex }));
  });
  console.log('[VRF] Subscribed to VrfFulfilled events');
}

module.exports = { refreshVrfLocally, subscribeVrfEvents };
