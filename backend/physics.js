// ── Price simulation physics ──────────────────────────────────────────────────

const {
  FRICTION, MOMENTUM_INERTIA, MAX_SIM_VELOCITY,
  PRICE_CHAOS_FACTOR, PRICE_FLAT_MS, CHAOS_SHOCK_INTERVAL, COLUMN_WIDTH,
} = require('./config');
const { state } = require('./state');

function stepSim() {
  state.simTime++;

  if (state.currentAvaxPrice > 0) {
    if (state.lastPrice === 0) state.lastPrice = state.currentAvaxPrice;
    const priceDelta = state.currentAvaxPrice - state.lastPrice;
    state.lastPrice = state.currentAvaxPrice;

    const now = Date.now();
    if (state.currentAvaxPrice !== state.lastTrackedPrice) {
      state.lastTrackedPrice = state.currentAvaxPrice;
      state.lastPriceChangedAt = now;
    }

    const flatMs = state.lastPriceChangedAt > 0 ? now - state.lastPriceChangedAt : 0;
    const isFlat = flatMs >= PRICE_FLAT_MS;

    state.simVelocity = (state.simVelocity * FRICTION) + (priceDelta * PRICE_CHAOS_FACTOR * MOMENTUM_INERTIA);
    state.simVelocity = Math.max(-MAX_SIM_VELOCITY, Math.min(MAX_SIM_VELOCITY, state.simVelocity));

    if (isFlat) {
      const chaosStrength = Math.min(3.0, 1.0 + (flatMs / 1000) * 0.4);
      state.simVelocity += (Math.random() - 0.5) * 0.0015 * chaosStrength;
      if (state.simTime % CHAOS_SHOCK_INTERVAL === 0) {
        const shockDir = Math.random() < 0.5 ? 1 : -1;
        state.simVelocity += shockDir * (0.008 + Math.random() * 0.012) * chaosStrength;
      }
    } else {
      state.simVelocity += (Math.random() - 0.5) * 0.001;
    }

    state.simY += state.simVelocity;
    if (state.steerActive) {
      state.simVelocity += (state.steerTargetY - state.simY) * 0.04;
    }
    state.simY += (0.0 - state.simY) * 0.005;
    state.simY = Math.max(-50, Math.min(50, state.simY));
    return { y: state.simY };
  }

  // No price — noise-driven motion
  const noiseScale = state.steerActive ? 0.004 : 0.01;
  const trend = Math.sin(state.simTime * 0.008) * 0.0003;
  const noise = (Math.random() - 0.5) * noiseScale;
  const shock = !state.steerActive && Math.random() < 0.015 ? (Math.random() - 0.5) * 0.05 : 0;
  const spring = state.steerActive ? (state.steerTargetY - state.simY) * 0.06 : 0;
  state.simVelocity = state.simVelocity * 0.93 + noise + trend + shock + spring;
  state.simVelocity = Math.max(-0.025, Math.min(0.025, state.simVelocity));
  state.simY += state.simVelocity;
  if (!state.steerActive) state.simY += (0.0 - state.simY) * 0.001;
  state.simY = Math.max(-50, Math.min(50, state.simY));
  return { y: state.simY };
}

function steerTowardRow(targetRow, curColX, currentX) {
  const newTargetY = (targetRow - 250) / 30;
  if (Math.abs(newTargetY - state.steerTargetY) > 0.001 || !state.steerActive) {
    state.steerTargetY = newTargetY;
  }
  state.steerActive = true;
  const pxLeft = curColX + COLUMN_WIDTH - currentX;
  if (pxLeft < COLUMN_WIDTH * 0.15) state.steerActive = false;
}

module.exports = { stepSim, steerTowardRow };
