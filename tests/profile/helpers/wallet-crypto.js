const crypto = require('crypto')
const bs58Module = require('bs58')
const { Keypair } = require('@solana/web3.js')
const { ed25519 } = require('@noble/curves/ed25519.js')
const bs58 = bs58Module?.default || bs58Module

function createDeterministicWallet(label) {
  const seed = crypto.createHash('sha256').update(String(label)).digest().subarray(0, 32)
  const keypair = Keypair.fromSeed(seed)

  return {
    keypair,
    wallet: keypair.publicKey.toBase58(),
    signingKey: keypair.secretKey.slice(0, 32),
  }
}

function signMessageBase58(walletBundle, message) {
  const bytes = Buffer.isBuffer(message) ? message : Buffer.from(String(message), 'utf8')
  const signature = ed25519.sign(bytes, walletBundle.signingKey)
  return bs58.encode(signature)
}

module.exports = {
  createDeterministicWallet,
  signMessageBase58,
}
