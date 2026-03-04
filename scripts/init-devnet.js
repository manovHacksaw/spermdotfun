#!/usr/bin/env node
// One-time initialization on devnet: creates State PDA, Mint PDA, Escrow ATA, Treasury ATA.
// Run once after deploying the program:
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com node scripts/init-devnet.js

const anchor = require('@coral-xyz/anchor')
const { PublicKey, Keypair, Connection } = require('@solana/web3.js')
const { getAssociatedTokenAddressSync } = require('@solana/spl-token')
const fs = require('fs')
const path = require('path')

const RPC_URL     = process.env.ANCHOR_PROVIDER_URL || 'https://api.devnet.solana.com'
const WALLET_PATH = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`
const PROGRAM_ID  = new PublicKey('AouUDBc5RzydyxEUtrH3nf65ZMeZxxVgMzG4cUat8Cd6')
const IDL_PATH    = path.join(__dirname, '../sprmfun-anchor/target/idl/sprmfun_anchor.json')

const HOUSE_EDGE_BPS = 200  // 2%

const STATE_SEED = Buffer.from('state')
const MINT_SEED  = Buffer.from('mint')

async function main() {
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, 'utf-8')))
  )

  const connection = new Connection(RPC_URL, 'confirmed')
  const wallet     = new anchor.Wallet(authority)
  const provider   = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' })
  anchor.setProvider(provider)

  const idl     = JSON.parse(fs.readFileSync(IDL_PATH, 'utf-8'))
  const program  = new anchor.Program(idl, provider)

  const [statePda] = PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID)
  const [mintPda]  = PublicKey.findProgramAddressSync([MINT_SEED, statePda.toBuffer()], PROGRAM_ID)
  const escrowAta  = getAssociatedTokenAddressSync(mintPda, statePda, true)
  const treasuryAta = getAssociatedTokenAddressSync(mintPda, authority.publicKey)

  console.log('Authority:   ', authority.publicKey.toBase58())
  console.log('State PDA:   ', statePda.toBase58())
  console.log('Mint PDA:    ', mintPda.toBase58())
  console.log('Escrow ATA:  ', escrowAta.toBase58())
  console.log('Treasury ATA:', treasuryAta.toBase58())
  console.log()

  // Step 1: initialize (creates State + Mint)
  const stateInfo = await connection.getAccountInfo(statePda)
  if (stateInfo) {
    console.log('✓ State PDA already exists — skipping initialize')
  } else {
    console.log('Step 1: calling initialize...')
    const sig = await program.methods
      .initialize(HOUSE_EDGE_BPS)
      .accounts({ authority: authority.publicKey })
      .rpc()
    console.log(`  ✓ initialize tx: ${sig}`)
  }

  // Step 2: init_atas (creates Escrow + Treasury ATAs)
  const escrowInfo = await connection.getAccountInfo(escrowAta)
  if (escrowInfo) {
    console.log('✓ Escrow ATA already exists — skipping init_atas')
  } else {
    console.log('Step 2: calling init_atas...')
    const sig = await program.methods
      .initAtas()
      .accounts({
        authority: authority.publicKey,
        state: statePda,
        mint: mintPda,
        escrow: escrowAta,
        treasury: treasuryAta,
      })
      .rpc()
    console.log(`  ✓ init_atas tx: ${sig}`)
  }

  console.log()
  console.log('=== Devnet init complete ===')
  console.log(`Program:     https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`)
  console.log(`State PDA:   https://explorer.solana.com/address/${statePda.toBase58()}?cluster=devnet`)
  console.log(`Escrow ATA:  https://explorer.solana.com/address/${escrowAta.toBase58()}?cluster=devnet`)
}

main().catch(err => { console.error(err); process.exit(1) })
