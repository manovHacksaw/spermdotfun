const crypto = require('crypto')
const { ethers } = require('ethers')

// derive a deterministic private key from arbitrary label
function createDeterministicWallet(label) {
  const hash = crypto.createHash('sha256').update(String(label)).digest('hex')
  // use first 32 bytes (64 hex chars) as private key
  const privateKey = '0x' + hash.substring(0, 64)
  const wallet = new ethers.Wallet(privateKey)
  return { wallet }
}

async function signMessage(walletBundle, message) {
  // ethers returns a hex signature
  return await walletBundle.wallet.signMessage(message)
}

module.exports = {
  createDeterministicWallet,
  signMessage,
}
