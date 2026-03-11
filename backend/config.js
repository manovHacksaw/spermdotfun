// ── Constants & environment config ───────────────────────────────────────────

const COLUMN_WIDTH = 50;
const PX_PER_EVENT = 0.95;
const HISTORY_SIZE = 2800;
const MULT_HISTORY_SIZE = 50;
const NICKNAME_CACHE_TTL = 5 * 60 * 1000;

const PRICE_STALE_MS = 5000;
const VRF_REFRESH_COLS = 15;

const MAX_BET_AMOUNT = parseFloat(process.env.MAX_BET_AMOUNT || '10000');
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;

// Physics
const PRICE_CHAOS_FACTOR = 45.0;
const FRICTION = 0.85;
const MOMENTUM_INERTIA = 0.08;
const MAX_SIM_VELOCITY = 0.15;
const EMA_ALPHA = 0.12;
const PRICE_FLAT_MS = 1500;
const CHAOS_SHOCK_INTERVAL = 18;

// Network
const RPC_URL = process.env.AVALANCHE_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc';
const WS_RPC_URL = process.env.AVALANCHE_WS_RPC_URL || 'wss://api.avax-test.network/ext/bc/C/ws';
const GAME_ADDRESS = process.env.GAME_CONTRACT_ADDRESS || '';
const VRF_ENABLED = process.env.VRF_ENABLED === 'true';

const GAME_ABI = [
  'function resolveBet(uint256 betId, bool won, bytes calldata serverSig) external',
  'function requestVrf() external returns (uint256 requestId)',
  'function isVrfPending() external view returns (bool)',
  'event BetPlaced(uint256 indexed betId, address indexed player, uint32 boxX, uint16 boxRow, uint16 multNum, uint256 amount)',
  'event BetResolved(uint256 indexed betId, address indexed player, bool won, uint256 payout)',
  'event VrfFulfilled(uint256 indexed epochId, uint256 indexed requestId, bytes32 vrfResult)',
  'event VrfRequested(uint256 indexed epochId, uint256 indexed requestId)',
];

const TOKEN_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

module.exports = {
  COLUMN_WIDTH, PX_PER_EVENT, HISTORY_SIZE, MULT_HISTORY_SIZE, NICKNAME_CACHE_TTL,
  PRICE_STALE_MS, VRF_REFRESH_COLS,
  MAX_BET_AMOUNT, EVM_ADDR_RE,
  RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX,
  PRICE_CHAOS_FACTOR, FRICTION, MOMENTUM_INERTIA, MAX_SIM_VELOCITY, EMA_ALPHA,
  PRICE_FLAT_MS, CHAOS_SHOCK_INTERVAL,
  RPC_URL, WS_RPC_URL, GAME_ADDRESS, VRF_ENABLED,
  GAME_ABI, TOKEN_ABI,
};










