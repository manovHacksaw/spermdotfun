import { NextRequest, NextResponse } from 'next/server'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'

const RPC_URL = process.env.ANCHOR_PROVIDER_URL || 'http://127.0.0.1:8899'
const connection = new Connection(RPC_URL, 'confirmed')

export async function POST(req: NextRequest) {
  try {
    const { wallet } = await req.json()
    if (!wallet) return NextResponse.json({ error: 'missing wallet' }, { status: 400 })

    const pubkey = new PublicKey(wallet)

    // Only airdrop if balance < 0.1 SOL
    const balance = await connection.getBalance(pubkey)
    if (balance >= 0.1 * LAMPORTS_PER_SOL) {
      return NextResponse.json({ ok: true, airdropped: false, balance })
    }

    const sig = await connection.requestAirdrop(pubkey, 1 * LAMPORTS_PER_SOL)
    await connection.confirmTransaction(sig, 'confirmed')
    const newBalance = await connection.getBalance(pubkey)
    console.log(`[AIRDROP] ${wallet} → 1 SOL (new balance: ${newBalance / LAMPORTS_PER_SOL} SOL)`)

    return NextResponse.json({ ok: true, airdropped: true, sig, balance: newBalance })
  } catch (err: any) {
    console.error('[AIRDROP] error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
