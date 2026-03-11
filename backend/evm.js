// ── Avalanche / EVM initialisation ───────────────────────────────────────────

const { ethers } = require('ethers');
const { RPC_URL, WS_RPC_URL, GAME_ADDRESS, GAME_ABI, TOKEN_ABI } = require('./config');
const { state } = require('./state');

function initEvm() {
  const privateKey = process.env.SERVER_PRIVATE_KEY;
  if (!privateKey) {
    console.warn('[EVM] SERVER_PRIVATE_KEY not set — on-chain resolution disabled.');
    return;
  }
  if (!GAME_ADDRESS) {
    console.warn('[EVM] GAME_CONTRACT_ADDRESS not set — on-chain resolution disabled.');
    return;
  }

  state.evmProvider = new ethers.JsonRpcProvider(RPC_URL);
  state.serverWallet = new ethers.Wallet(privateKey, state.evmProvider);
  state.gameContract = new ethers.Contract(GAME_ADDRESS, GAME_ABI, state.serverWallet);

  const tokenAddr = process.env.NEXT_PUBLIC_TOKEN_ADDRESS || '';
  if (tokenAddr) {
    state.tokenContract = new ethers.Contract(tokenAddr, TOKEN_ABI, state.evmProvider);
  }

  const wsProvider = new ethers.WebSocketProvider(WS_RPC_URL);
  state.gameContract._wsContract = new ethers.Contract(GAME_ADDRESS, GAME_ABI, wsProvider);

  state.onchainReady = true;
  console.log(`[EVM] Connected — wallet=${state.serverWallet.address} contract=${GAME_ADDRESS} token=${tokenAddr}`);
}

module.exports = { initEvm };
