// ── Bet resolution, leaderboard, active players ───────────────────────────────

const { ethers } = require('ethers');
const { COLUMN_WIDTH, GAME_ADDRESS } = require('./config');
const { state, broadcast } = require('./state');

function updateLeaderboard(user, betAmount, payout, won) {
  const short = `${user.slice(0, 4)}…${user.slice(-4)}`;
  const entry = state.leaderboard.get(user) || { shortAddr: short, wins: 0, losses: 0, totalBet: 0, totalPayout: 0 };
  entry.wins += won ? 1 : 0;
  entry.losses += won ? 0 : 1;
  entry.totalBet += betAmount;
  entry.totalPayout += payout;
  state.leaderboard.set(user, entry);
}

function leaderboardPayload() {
  const entries = [];
  for (const [address, e] of state.leaderboard) entries.push({ address, ...e });
  entries.sort((a, b) => b.totalPayout - b.totalBet - (a.totalPayout - a.totalBet));
  return { type: 'leaderboard', entries: entries.slice(0, 50) };
}

function activePlayersPayload() {
  const byUser = new Map();
  for (const info of state.pendingBets.values()) {
    if (!info?.user) continue;
    const address = String(info.user);
    const cached = state.nicknameCache.get(address);
    const existing = byUser.get(address) || {
      address,
      shortAddr: `${address.slice(0, 4)}…${address.slice(-4)}`,
      nickname: cached?.nickname || null,
      pendingBets: 0,
      totalBet: 0,
      lastBetAt: 0,
    };
    existing.pendingBets += 1;
    existing.totalBet += Number(info.bet_amount ?? 0);
    existing.lastBetAt = Math.max(existing.lastBetAt, Number(info.lastBetAt ?? 0));
    byUser.set(address, existing);
  }
  const players = Array.from(byUser.values())
    .sort((a, b) => b.lastBetAt - a.lastBetAt || b.totalBet - a.totalBet)
    .slice(0, 20);
  return { type: 'active_players', count: players.length, players };
}

function broadcastActivePlayers() {
  broadcast(JSON.stringify(activePlayersPayload()));
}

async function resolveBet(betKey, profileService) {
  const info = state.pendingBets.get(betKey);
  if (!info) return;
  state.pendingBets.delete(betKey);

  const colX = Math.floor(info.box_x / COLUMN_WIDTH) * COLUMN_WIDTH;
  const range = state.columnRowRange.get(colX);
  if (!range) {
    console.warn(`[BET] No row range for colX=${colX} — skipping`);
    return;
  }

  const hitPadding = 2;
  const won = info.box_row >= range.minRow - hitPadding && info.box_row <= range.maxRow + hitPadding;
  const winRow = won ? info.box_row : info.box_row === 0 ? 1 : 0;
  const payout = won ? ((info.bet_amount * info.mult_num) / 100) * 0.98 : 0;

  broadcast(JSON.stringify({
    type: 'bet_resolved', betPda: betKey, user: info.user, won, payout,
    txHash: 'pending', box_x: info.box_x, box_row: info.box_row,
    min_row: range.minRow, max_row: range.maxRow,
  }));

  if (state.gameContract && info.betId) {
    (async () => {
      let finalTxHash = null;
      try {
        if (state.onchainReady) {
          const betId = BigInt(info.betId);
          const msgHash = ethers.solidityPackedKeccak256(
            ['uint256', 'bool', 'address'], [betId, won, GAME_ADDRESS]
          );
          const serverSig = await state.serverWallet.signMessage(ethers.getBytes(msgHash));
          const tx = await state.gameContract.resolveBet(betId, won, serverSig);
          const receipt = await tx.wait();
          finalTxHash = receipt.hash;
          console.log(`[BET] ✓ Resolved on-chain: tx=${finalTxHash}`);
        }
        broadcast(JSON.stringify({ type: 'bet_receipt', betPda: betKey, user: info.user, txHash: finalTxHash }));
        profileService.enqueueResolvedBet({
          txSignature: finalTxHash || 'off-chain', eventIndex: 0, betPda: betKey,
          sourceWallet: info.user, game: 'crash', boxX: info.box_x, boxRow: info.box_row,
          winningRow: winRow, won, betAmount: info.bet_amount, payout, seedIndex: state.currentSeedIndex,
        });
      } catch (err) {
        console.error('[BET] on-chain resolveBet error:', err.message);
        broadcast(JSON.stringify({
          type: 'bet_resolve_failed', betPda: betKey, user: info.user,
          box_x: info.box_x, box_row: info.box_row, bet_amount: info.bet_amount,
          error: err.message?.slice(0, 200) ?? 'Unknown error',
          min_row: range.minRow, max_row: range.maxRow,
        }));
      }
    })();
  } else {
    console.log(`[BET] Off-chain resolution: betKey=${betKey} won=${won}`);
  }

  console.log(`[BET] ${won ? '🏆 WIN' : '✗ LOSE'} betKey=${betKey} payout=${payout.toFixed(4)}`);

  if (info.user) {
    updateLeaderboard(info.user, info.bet_amount, payout, won);
    state.leaderboardDirty = true;
    if (profileService.isEnabled()) {
      (async () => {
        try {
          const settings = await profileService.getSettingsForWallet(info.user);
          if (settings?.referredBy) {
            const reward = info.bet_amount * 0.005;
            await profileService.creditReferralReward({ referrerWallet: settings.referredBy, rewardAmount: reward });
          }
        } catch (err) {
          console.error('[REFERRAL] reward error:', err.message);
        }
      })();
    }
  }

  broadcastActivePlayers();
}

module.exports = { resolveBet, leaderboardPayload, activePlayersPayload, broadcastActivePlayers };
