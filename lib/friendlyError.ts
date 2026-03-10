// Maps raw ethers.js / Solidity revert messages to player-readable strings.

const PATTERNS: Array<[RegExp, string]> = [
  [/insufficient funds/i, "Your wallet doesn't have enough AVAX for gas. Top up via the sidebar."],
  [/user rejected|user denied|rejected the request/i, "Transaction cancelled."],
  [/low bank/i, "House bank is running low — your bet size may exceed available liquidity. Try a smaller amount."],
  [/bad sig/i, "Server signature error. This is rare — please retry in a moment."],
  [/market_paused/i, "Betting is paused — the price feed is temporarily unavailable."],
  [/resolved/i, "This bet has already been settled."],
  [/exceeds max bet/i, "Your bet exceeds the maximum allowed size. Please reduce the amount."],
  [/allowance/i, "Token approval failed. Please try again — approval is needed before betting."],
  [/execution reverted/i, "Transaction reverted by the contract. Please retry or contact support."],
  [/network error|NETWORK_ERROR/i, "Network connection error. Check your internet connection and retry."],
  [/timeout/i, "Request timed out. The network may be slow — please retry."],
  [/nonce/i, "Transaction nonce conflict. Please wait a moment and retry."],
  [/gas required exceeds allowance/i, "Not enough AVAX for gas. Top up your wallet."],
  [/Rate limit/i, "Too many requests. Please slow down."],
  [/historically detached/i, "Bet arrived too late — the pointer already passed that column."],
  [/box_row out of range/i, "Invalid grid position. Please select a valid row."],
  [/ACTION_REJECTED|user rejected/i, "Transaction cancelled."],
  [/nothing to withdraw/i, "Nothing to withdraw — your session wallet balance is zero."],
  [/insufficient balance/i, "Insufficient balance for this operation."],
  [/CALL_EXCEPTION/i, "Contract call failed. Please check your network or contract address."],
]

export function friendlyError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? 'Unknown error')
  for (const [pattern, friendly] of PATTERNS) {
    if (pattern.test(msg)) return friendly
  }
  // Trim raw message to 100 chars as last resort
  return msg.length > 100 ? msg.slice(0, 97) + '…' : msg
}
