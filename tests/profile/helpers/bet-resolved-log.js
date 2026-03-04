const crypto = require('crypto')
const { PublicKey } = require('@solana/web3.js')

const ONE_TOKEN = 10 ** 9
const BET_RESOLVED_EVENT_DISC = crypto.createHash('sha256').update('event:BetResolved').digest().subarray(0, 8)
const BET_RESOLVED_EVENT_SIZE = 75

function toBaseUnits(amount) {
  return BigInt(Math.round(Number(amount) * ONE_TOKEN))
}

function encodeBetResolvedLog({
  sourceWallet,
  boxX = 0,
  boxRow = 0,
  betAmount = 0,
  winningRow = 0,
  won = false,
  payout = 0,
  seedIndex = 0,
}) {
  const raw = Buffer.alloc(BET_RESOLVED_EVENT_SIZE)
  let offset = 0

  BET_RESOLVED_EVENT_DISC.copy(raw, offset)
  offset += 8

  const userBytes = new PublicKey(sourceWallet).toBuffer()
  userBytes.copy(raw, offset)
  offset += 32

  raw.writeBigInt64LE(BigInt(boxX), offset)
  offset += 8

  raw.writeUInt8(Number(boxRow), offset)
  offset += 1

  raw.writeBigUInt64LE(toBaseUnits(betAmount), offset)
  offset += 8

  raw.writeUInt8(Number(winningRow), offset)
  offset += 1

  raw.writeUInt8(won ? 1 : 0, offset)
  offset += 1

  raw.writeBigUInt64LE(toBaseUnits(payout), offset)
  offset += 8

  raw.writeBigUInt64LE(BigInt(seedIndex), offset)

  return `Program data: ${raw.toString('base64')}`
}

module.exports = {
  encodeBetResolvedLog,
}
