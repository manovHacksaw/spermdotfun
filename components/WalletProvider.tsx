'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { ethers } from 'ethers'

// ── Avalanche Fuji network ────────────────────────────────────────────────────
export const FUJI_CHAIN_ID = 43113
export const FUJI_PARAMS = {
  chainId:           '0xA869',
  chainName:         'Avalanche Fuji Testnet',
  nativeCurrency:    { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
  rpcUrls:           [process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc'],
  blockExplorerUrls: ['https://testnet.snowtrace.io'],
}

// ── Context type ──────────────────────────────────────────────────────────────
export interface EvmWalletState {
  address:      string | null
  connected:    boolean
  provider:     ethers.BrowserProvider | null
  signer:       ethers.JsonRpcSigner | null
  chainId:      number | null
  wrongNetwork: boolean
  connect:      () => Promise<void>
  disconnect:   () => void
  switchToFuji: () => Promise<void>
}

const EvmWalletContext = createContext<EvmWalletState | null>(null)

export function useEvmWallet(): EvmWalletState {
  const ctx = useContext(EvmWalletContext)
  if (!ctx) throw new Error('useEvmWallet must be used inside WalletContextProvider')
  return ctx
}

// ── Provider ──────────────────────────────────────────────────────────────────
export default function WalletContextProvider({ children }: { children: ReactNode }) {
  const [address,  setAddress]  = useState<string | null>(null)
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [signer,   setSigner]   = useState<ethers.JsonRpcSigner | null>(null)
  const [chainId,  setChainId]  = useState<number | null>(null)

  const connected    = !!address
  const wrongNetwork = connected && chainId !== FUJI_CHAIN_ID

  const switchToFuji = useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum) return
    try {
      await (window.ethereum as any).request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xA869' }],
      })
    } catch (e: any) {
      if (e.code === 4902) {
        await (window.ethereum as any).request({
          method: 'wallet_addEthereumChain',
          params: [FUJI_PARAMS],
        })
      }
    }
  }, [])

  const connect = useCallback(async () => {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      alert('MetaMask not found — install it at metamask.io')
      return
    }
    const prov = new ethers.BrowserProvider((window as any).ethereum)
    await prov.send('eth_requestAccounts', [])
    const net = await prov.getNetwork()
    if (Number(net.chainId) !== FUJI_CHAIN_ID) await switchToFuji()
    const s    = await prov.getSigner()
    const addr = await s.getAddress()
    const net2 = await prov.getNetwork()
    setProvider(prov)
    setSigner(s)
    setAddress(addr)
    setChainId(Number(net2.chainId))
  }, [switchToFuji])

  const disconnect = useCallback(() => {
    setProvider(null); setSigner(null); setAddress(null); setChainId(null)
  }, [])

  // Auto-reconnect on page load
  useEffect(() => {
    const eth = (window as any).ethereum
    if (!eth) return
    const prov = new ethers.BrowserProvider(eth)
    prov.send('eth_accounts', []).then(async (accounts: string[]) => {
      if (!accounts.length) return
      const s   = await prov.getSigner()
      const net = await prov.getNetwork()
      setProvider(prov)
      setSigner(s)
      setAddress(accounts[0])
      setChainId(Number(net.chainId))
    }).catch(() => {})

    const onAccounts = (accs: string[]) => accs.length ? setAddress(accs[0]) : disconnect()
    const onChain    = (cId: string)    => setChainId(parseInt(cId, 16))
    eth.on('accountsChanged', onAccounts)
    eth.on('chainChanged',    onChain)
    return () => { eth.removeListener('accountsChanged', onAccounts); eth.removeListener('chainChanged', onChain) }
  }, [disconnect])

  return (
    <EvmWalletContext.Provider value={{ address, connected, provider, signer, chainId, wrongNetwork, connect, disconnect, switchToFuji }}>
      {children}
    </EvmWalletContext.Provider>
  )
}
