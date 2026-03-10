import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

const RPC_URL = process.env.AVALANCHE_RPC_URL || 'http://127.0.0.1:8545'
const FAUCET_PK = process.env.FAUCET_PRIVATE_KEY || ''
const provider = new ethers.JsonRpcProvider(RPC_URL)
const faucet = FAUCET_PK ? new ethers.Wallet(FAUCET_PK, provider) : null

export async function POST(req: NextRequest) {
  try {
    const { wallet } = await req.json()
    if (!wallet) return NextResponse.json({ error: 'missing wallet' }, { status: 400 })
    if (!faucet) return NextResponse.json({ error: 'faucet disabled' }, { status: 500 })

    const tx = await faucet.sendTransaction({
      to: wallet,
      value: ethers.parseEther('1'),
    })
    await tx.wait()
    const balance = await provider.getBalance(wallet)
    return NextResponse.json({ ok: true, airdropped: true, txHash: tx.hash, balance: balance.toString() })
  } catch (err: any) {
    console.error('[AIRDROP] error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
