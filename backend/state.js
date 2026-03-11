// ── Shared mutable game state ─────────────────────────────────────────────────
// All modules import this object and mutate its properties directly.

const { WebSocket } = require('ws');

const state = {
  // EVM
  evmProvider: null,
  serverWallet: null,
  gameContract: null,
  tokenContract: null,
  onchainReady: false,

  // Price feed
  currentAvaxPrice: 0,
  lastPrice: 0,
  priceBaseline: 0,
  lastPriceTick: 0,

  // Market pause
  bettingPaused: false,
  houseBankBalance: 0,
  lastFeedError: null,
  restAttempts: 0,

  // Physics simulation
  simY: 0.0,
  simYEma: 0.0,
  simVelocity: 0,
  simTime: 0,
  steerTargetY: 0.5,
  steerActive: false,
  lastPriceChangedAt: 0,
  lastTrackedPrice: 0,

  // VRF
  currentVrfResult: null,   // initialised in vrfManager.js
  currentSeedIndex: 0,
  lastVrfColX: -Infinity,
  vrfRequestPending: false,
  pendingVrfStartColX: 0,
  lastWinRow: 250,
  vrfPath: new Map(),

  // Grid / pointer
  serverCurrentX: 0,
  gridIdCounter: 0,
  nextColX: 0,
  columnRowRange: new Map(),
  historyBuffer: [],
  allColumns: [],
  multHistory: [],

  // Bets
  pendingBets: new Map(),
  retryingBets: new Set(),

  // WebSocket clients
  clients: new Set(),

  // Leaderboard
  leaderboard: new Map(),
  leaderboardDirty: false,

  // Ghost cursors
  ghostSelections: new Map(),
  wsGhostKeys: new WeakMap(),

  // Nicknames
  nicknameCache: new Map(),

  // Profile
  profileBackfillInFlight: false,
};

function broadcast(msg) {
  for (const ws of state.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

module.exports = { state, broadcast };
