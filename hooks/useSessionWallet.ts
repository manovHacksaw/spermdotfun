'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import {
  generateSessionWallet,
  saveSessionWallet,
  loadSessionWallet,
  destroySessionWallet,
} from '@/lib/sessionWallet'
import { useSprmBalance } from '@/hooks/useSprmBalance'
import { useEvmWallet } from '@/components/WalletProvider'

// ── Contract constants ─────────────────────────────────────────────────────────
const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? ''
const GAME_ADDRESS = process.env.NEXT_PUBLIC_GAME_ADDRESS ?? ''
const RPC_URL = process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

// ── Public types ─────────────────────────────────────────────────────────────
export type TxStatus = 'idle' | 'pending' | 'done' | 'error'
export type ActiveWallet = 'primary' | 'instant'

const ACTIVE_WALLET_KEY = 'sprmfun:active_wallet'

export interface SessionWalletState {
  sessionWallet: ethers.Wallet | null
  sessionAddress: string | null
  isActive: boolean
  sessionSprmBalance: number | null
  sessionAvaxBalance: number | null
  activeWallet: ActiveWallet
  setActiveWallet: (w: ActiveWallet) => void
  depositStatus: TxStatus
  depositError: string
  withdrawStatus: TxStatus
  withdrawError: string
  fundStatus: TxStatus
  fundError: string
  createSession: () => Promise<void>
  deposit: (sprmAmt: number) => Promise<void>
  withdrawAll: () => Promise<void>
  destroySession: () => void
  refreshBalances: () => Promise<void>
  optimisticDeduct: (amount: number) => void
  topUpGas: () => Promise<void>
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useSessionWallet(): SessionWalletState {
  const { address: mainAddress, signer } = useEvmWallet()

  const [sessionWallet, setSessionWallet] = useState<ethers.Wallet | null>(null)
  const [depositStatus, setDepositStatus] = useState<TxStatus>('idle')
  const [depositError, setDepositError] = useState('')
  const [withdrawStatus, setWithdrawStatus] = useState<TxStatus>('idle')
  const [withdrawError, setWithdrawError] = useState('')
  const [fundStatus, setFundStatus] = useState<TxStatus>('idle')
  const [fundError, setFundError] = useState('')
  const [activeWallet, setActiveWalletState] = useState<ActiveWallet>('primary')
  // Optimistic override for balance display (set after a bet, cleared on next real refresh)
  const [optimisticBalance, setOptimisticBalance] = useState<number | null>(null)
  // Off-chain balance from VaultService
  const [vaultBalance, setVaultBalance] = useState<number | null>(null)

  const sessionAddress = sessionWallet?.address ?? null

  const [sessionAvaxBalance, setSessionAvaxBalance] = useState<number | null>(null)

  // ── useSprmBalance for automatic polling ─────────────────────────────────
  const { balance: rawSessionBalance, refresh: refreshSessionBalance } = useSprmBalance(
    sessionAddress,
    { pollMs: 8_000 },
  )

  // Merge source of truth: 
  // - If instant wallet: optimistic > vault (off-chain) > raw (on-chain)
  // - If primary wallet: raw (on-chain)
  const sessionSprmBalance = (activeWallet === 'instant')
    ? (optimisticBalance !== null ? optimisticBalance : (vaultBalance !== null ? vaultBalance : rawSessionBalance))
    : rawSessionBalance

  // Clear optimistic override whenever a real balance poll arrives
  const prevRawRef = useRef<number | null>(null)
  useEffect(() => {
    if (rawSessionBalance !== prevRawRef.current) {
      prevRawRef.current = rawSessionBalance
      setOptimisticBalance(null)
    }
  }, [rawSessionBalance])

  const refreshAvaxBalance = useCallback(async () => {
    if (!sessionAddress) { setSessionAvaxBalance(null); return }
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL)
      const bal = await provider.getBalance(sessionAddress)
      setSessionAvaxBalance(Number(ethers.formatEther(bal)))
    } catch { /* ignore */ }
  }, [sessionAddress])

  useEffect(() => {
    if (!sessionAddress) { setSessionAvaxBalance(null); return }
    refreshAvaxBalance()
    const id = setInterval(refreshAvaxBalance, 30_000)
    return () => clearInterval(id)
  }, [sessionAddress, refreshAvaxBalance])

  const setActiveWallet = useCallback((w: ActiveWallet) => {
    setActiveWalletState(w)
    if (typeof window !== 'undefined') localStorage.setItem(ACTIVE_WALLET_KEY, w)
  }, [])

  // Load persisted session + wallet preference on mount (client-only)
  useEffect(() => {
    const w = loadSessionWallet()
    if (w) setSessionWallet(w)
    const saved = localStorage.getItem(ACTIVE_WALLET_KEY)
    if (saved === 'instant' || saved === 'primary') setActiveWalletState(saved)
  }, [])

  // ── refreshBalances (wraps the hook's refresh for external callers) ─────
  const refreshBalances = useCallback(async () => {
    setOptimisticBalance(null)
    await refreshSessionBalance()
  }, [refreshSessionBalance])

  // ── Optimistic balance deduction (call after a confirmed bet tx) ─────────
  const optimisticDeduct = useCallback((amount: number) => {
    setOptimisticBalance(prev => {
      const base = prev !== null ? prev : (rawSessionBalance ?? 0)
      return Math.max(0, base - amount)
    })
  }, [rawSessionBalance])

  // ── Listen for bet results via window event (fired by StockGrid WS) ─────
  useEffect(() => {
    if (!sessionAddress) return

    const onBetResult = async (evt: Event) => {
      try {
        const data = (evt as CustomEvent).detail
        if (data?.user === sessionAddress) {
          if (data.vaultBalance !== undefined) {
            setVaultBalance(parseFloat(data.vaultBalance))
          }
          await new Promise(r => setTimeout(r, 800))
          setOptimisticBalance(null)
          await refreshSessionBalance()
        }
      } catch { /* ignore */ }
    }

    const onResolveFailed = async (evt: Event) => {
      try {
        const data = (evt as CustomEvent).detail
        if (data?.user === sessionAddress) {
          console.warn('[SESSION] bet resolve failed:', data.error)
          setOptimisticBalance(null)
          await refreshSessionBalance()
        }
      } catch { /* ignore */ }
    }

    const onVaultBalance = (evt: Event) => {
      const data = (evt as CustomEvent).detail
      if (data?.user === sessionAddress) {
        setVaultBalance(parseFloat(data.balance))
      }
    }

    window.addEventListener('sprmfun:betresult', onBetResult as EventListener)
    window.addEventListener('sprmfun:vault_balance', onVaultBalance as EventListener)
    return () => {
      window.removeEventListener('sprmfun:betresult', onBetResult as EventListener)
      window.removeEventListener('sprmfun:vault_balance', onVaultBalance as EventListener)
      window.removeEventListener('sprmfun:betresolvefailed', onResolveFailed as EventListener)
    }
  }, [sessionAddress, refreshSessionBalance])

  // ── createSession ─────────────────────────────────────────────────────────
  // Generates a session keypair, then prompts MetaMask to send 0.05 AVAX
  // from the user's main wallet to the session wallet for gas.
  const createSession = useCallback(async () => {
    if (!signer) {
      setFundError('Connect your MetaMask wallet first')
      setFundStatus('error')
      return
    }
    const w = generateSessionWallet()
    saveSessionWallet(w)
    setSessionWallet(w)
    setOptimisticBalance(null)
    setFundStatus('pending')
    setFundError('')
    try {
      const tx = await signer.sendTransaction({
        to: w.address,
        value: ethers.parseEther('0.05'),
      })
      console.log('[SESSION] AVAX fund tx:', tx.hash)
      await tx.wait()
      await refreshAvaxBalance()
      setFundStatus('done')
      setTimeout(() => setFundStatus('idle'), 4000)
    } catch (err: any) {
      console.error('[SESSION] fund error:', err)
      setFundError(err?.message?.slice(0, 120) ?? 'Fund failed')
      setFundStatus('error')
    }
  }, [signer, refreshAvaxBalance])

  // ── topUpGas: MetaMask signer sends 0.05 AVAX to session wallet ──────────
  const topUpGas = useCallback(async () => {
    if (!signer) {
      setFundError('Connect MetaMask first')
      setFundStatus('error')
      return
    }
    if (!sessionAddress) {
      setFundError('No session wallet active')
      setFundStatus('error')
      return
    }
    setFundStatus('pending')
    setFundError('')
    try {
      const tx = await signer.sendTransaction({
        to: sessionAddress,
        value: ethers.parseEther('0.05'),
      })
      console.log('[SESSION] top-up AVAX tx:', tx.hash)
      await tx.wait()
      await refreshAvaxBalance()
      setFundStatus('done')
      setTimeout(() => setFundStatus('idle'), 4000)
    } catch (err: any) {
      console.error('[SESSION] topUpGas error:', err)
      setFundError(err?.message?.slice(0, 120) ?? 'Top up failed')
      setFundStatus('error')
    }
  }, [signer, sessionAddress, refreshAvaxBalance])

  // ── deposit: MetaMask signer calls token.transfer(sessionAddress, amount) ─
  // Note: the session wallet needs a small amount of AVAX to pay gas for bets
  // and withdrawals. Users can obtain testnet AVAX from faucet.avax.network.
  const deposit = useCallback(async (sprmAmt: number) => {
    if (!sessionAddress || !signer) {
      setDepositError('Connect your MetaMask wallet first')
      setDepositStatus('error')
      return
    }
    if (!TOKEN_ADDRESS) {
      setDepositError('Token address not configured')
      setDepositStatus('error')
      return
    }
    setDepositStatus('pending')
    setDepositError('')
    try {
      const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, signer)
      const amountRaw = ethers.parseUnits(sprmAmt.toString(), 18)
      const tx = await token.transfer(sessionAddress, amountRaw)
      console.log('[SESSION] deposit tx:', tx.hash)
      await tx.wait()
      // Auto-approve game contract so session wallet can bet without per-bet approve
      if (GAME_ADDRESS) {
        try {
          const provider = new ethers.JsonRpcProvider(RPC_URL)
          const sessionConnected = sessionWallet!.connect(provider)
          const tokenForApprove = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, sessionConnected)
          const approveTx = await tokenForApprove.approve(GAME_ADDRESS, ethers.MaxUint256)
          console.log('[SESSION] approve tx:', approveTx.hash)
          await approveTx.wait()
          console.log('[SESSION] game contract approved for MAX_UINT256')
        } catch (approveErr: any) {
          console.warn('[SESSION] auto-approve failed (non-fatal):', approveErr.message)
        }
      }
      setOptimisticBalance(null)
      await refreshSessionBalance()
      setDepositStatus('done')
      setTimeout(() => setDepositStatus('idle'), 3000)
    } catch (err: any) {
      console.error('[SESSION] deposit error:', err)
      setDepositError(err?.message?.slice(0, 120) ?? 'Deposit failed')
      setDepositStatus('error')
    }
  }, [sessionAddress, signer, refreshSessionBalance])

  // ── withdrawAll: session wallet calls token.transfer(mainAddress, balance) ─
  // Session wallet pays its own AVAX gas — must have AVAX from faucet.avax.network
  const withdrawAll = useCallback(async () => {
    if (!sessionWallet || !mainAddress) {
      setWithdrawError('Connect your main wallet first')
      setWithdrawStatus('error')
      return
    }
    if (!TOKEN_ADDRESS) {
      setWithdrawError('Token address not configured')
      setWithdrawStatus('error')
      return
    }
    setWithdrawStatus('pending')
    setWithdrawError('')
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL)
      const connectedWallet = sessionWallet.connect(provider)
      const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, connectedWallet)

      // Fetch live on-chain SPRM balance
      const rawBalance: bigint = await token.balanceOf(sessionWallet.address)
      if (rawBalance === BigInt(0)) {
        throw new Error('Nothing to withdraw — session wallet SPRM balance is zero.')
      }

      const tx = await token.transfer(mainAddress, rawBalance)
      console.log('[SESSION] withdrawAll tx:', tx.hash)
      await tx.wait()
      setOptimisticBalance(null)
      await refreshSessionBalance()
      setWithdrawStatus('done')
      setTimeout(() => setWithdrawStatus('idle'), 3000)
    } catch (err: any) {
      console.error('[SESSION] withdrawAll error:', err)
      setWithdrawError(err?.message?.slice(0, 120) ?? 'Withdraw failed')
      setWithdrawStatus('error')
    }
  }, [sessionWallet, mainAddress, refreshSessionBalance])

  // ── destroySession ────────────────────────────────────────────────────────
  const destroySession = useCallback(() => {
    destroySessionWallet()
    setSessionWallet(null)
    setOptimisticBalance(null)
    setActiveWallet('primary')
  }, [setActiveWallet])

  return {
    sessionWallet,
    sessionAddress,
    isActive: !!sessionWallet,
    sessionSprmBalance,
    sessionAvaxBalance,
    activeWallet,
    setActiveWallet,
    depositStatus,
    depositError,
    withdrawStatus,
    withdrawError,
    fundStatus,
    fundError,
    createSession,
    deposit,
    withdrawAll,
    destroySession,
    refreshBalances,
    optimisticDeduct,
    topUpGas,
  }
}
