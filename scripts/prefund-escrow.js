#!/usr/bin/env node
// Mints 1,000,000 SPRM into the escrow ATA to pre-fund the house reserve.
// Run once: node scripts/prefund-escrow.js

const anchor = require('@coral-xyz/anchor')
const { PublicKey, Keypair, Connection, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js')
const { getAssociatedTokenAddressSync, getAccount, createTransferInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token')
const fs = require('fs')
const path = require('path')

const RPC_URL     = process.env.ANCHOR_PROVIDER_URL || 'http://127.0.0.1:8899'
const WALLET_PATH = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`
const PROGRAM_ID  = new PublicKey('AouUDBc5RzydyxEUtrH3nf65ZMeZxxVgMzG4cUat8Cd6')
const IDL_PATH    = path.join(__dirname, '../sprmfun-anchor/target/idl/sprmfun_anchor.json')

const MINT_AMOUNT = 1_000_000n * 1_000_000_000n  // 1M SPRM (9 decimals)

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

  const idl    = JSON.parse(fs.readFileSync(IDL_PATH, 'utf-8'))
  const program = new anchor.Program(idl, provider)

  const [statePda] = PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID)
  const [mintPda]  = PublicKey.findProgramAddressSync([MINT_SEED, statePda.toBuffer()], PROGRAM_ID)
  const escrowPda  = getAssociatedTokenAddressSync(mintPda, statePda, true)
  const treasuryAta = getAssociatedTokenAddressSync(mintPda, authority.publicKey)

  const before = await getAccount(connection, escrowPda)
  console.log(`Escrow balance before: ${Number(before.amount) / 1e9} SPRM`)

  // Step 1: mint 1M SPRM to authority's ATA via faucet
  // (faucet uses state PDA as mint authority via CPI)
  console.log('Step 1: minting 1M SPRM to authority ATA via faucet...')
  await program.methods
    .faucet(new anchor.BN(MINT_AMOUNT.toString()))
    .accounts({ user: authority.publicKey, mint: mintPda })
    .rpc()

  const treasuryBal = await getAccount(connection, treasuryAta)
  console.log(`Authority ATA balance: ${Number(treasuryBal.amount) / 1e9} SPRM`)

  // Step 2: transfer from authority ATA → escrow (authority signs directly)
  console.log('Step 2: transferring to escrow...')
  const tx = new Transaction().add(
    createTransferInstruction(
      treasuryAta,
      escrowPda,
      authority.publicKey,
      MINT_AMOUNT,
      [],
      TOKEN_PROGRAM_ID,
    )
  )
  await sendAndConfirmTransaction(connection, tx, [authority])

  const after = await getAccount(connection, escrowPda)
  console.log(`Escrow balance after:  ${Number(after.amount) / 1e9} SPRM  ✓`)
}

main().catch(err => { console.error(err); process.exit(1) })
