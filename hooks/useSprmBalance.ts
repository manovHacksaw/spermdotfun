'use client'

import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'

const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? ''
const ERC20_ABI     = ['function balanceOf(address) view returns (uint256)']
const RPC_URL       = process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc'
const DECIMALS      = 18

export function useSprmBalance(
  address: string | null | undefined,
  options?: { pollMs?: number; enabled?: boolean },
) {
  const { pollMs = 6000, enabled = true } = options ?? {}
  const [balance, setBalance] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    if (!address || !enabled || !TOKEN_ADDRESS) { setBalance(null); return }
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL)
      const token    = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, provider)
      const raw: bigint = await token.balanceOf(address)
      setBalance(Number(ethers.formatUnits(raw, DECIMALS)))
    } catch {
      setBalance(0)
    }
  }, [address, enabled])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!address || !enabled) return
    const id = setInterval(refresh, pollMs)
    return () => clearInterval(id)
  }, [address, enabled, pollMs, refresh])

  return { balance, refresh }
}
