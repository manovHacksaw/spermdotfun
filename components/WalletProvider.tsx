'use client'

import React, { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from 'react'
import { ethers } from 'ethers'
import { useAccount, useWalletClient, usePublicClient, useDisconnect, useSwitchChain, useChainId } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'

// ── Avalanche Fuji network ────────────────────────────────────────────────────
export const FUJI_CHAIN_ID = 43113

// ── Context type ──────────────────────────────────────────────────────────────
export interface EvmWalletState {
  address: string | null
  connected: boolean
  provider: ethers.BrowserProvider | ethers.JsonRpcProvider | ethers.FallbackProvider | null
  signer: ethers.JsonRpcSigner | null
  chainId: number | null
  wrongNetwork: boolean
  connect: () => Promise<void>
  disconnect: () => void
  switchToFuji: () => Promise<void>
}

const EvmWalletContext = createContext<EvmWalletState | null>(null)

export function useEvmWallet(): EvmWalletState {
  const ctx = useContext(EvmWalletContext)
  if (!ctx) throw new Error('useEvmWallet must be used inside WalletContextProvider')
  return ctx
}

// ── Viem -> Ethers Adapters ───────────────────────────────────────────────────
export function publicClientToProvider(publicClient: any) {
  const { chain, transport } = publicClient
  const network = {
    chainId: chain?.id || FUJI_CHAIN_ID,
    name: chain?.name || 'Avalanche Fuji',
    ensAddress: chain?.contracts?.ensRegistry?.address,
  }
  if (transport.type === 'fallback') {
    const providers = (transport.transports as ReturnType<any>[]).map(
      ({ value }) => new ethers.JsonRpcProvider(value?.url, network)
    )
    if (providers.length === 1) return providers[0]
    return new ethers.FallbackProvider(providers)
  }
  return new ethers.JsonRpcProvider(transport.url, network)
}

export function walletClientToSigner(walletClient: any) {
  const { account, chain, transport } = walletClient
  const network = {
    chainId: chain?.id || FUJI_CHAIN_ID,
    name: chain?.name || 'Avalanche Fuji',
    ensAddress: chain?.contracts?.ensRegistry?.address,
  }
  const provider = new ethers.BrowserProvider(transport, network)
  return new ethers.JsonRpcSigner(provider, account.address)
}

// ── Provider ──────────────────────────────────────────────────────────────────
export default function WalletContextProvider({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { disconnect } = useDisconnect()
  const { switchChainAsync } = useSwitchChain()
  const { openConnectModal } = useConnectModal()

  const [provider, setProvider] = useState<ethers.BrowserProvider | ethers.JsonRpcProvider | ethers.FallbackProvider | null>(null)
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null)

  const wrongNetwork = isConnected && chainId !== FUJI_CHAIN_ID

  const switchToFuji = async () => {
    if (switchChainAsync) {
      try {
        await switchChainAsync({ chainId: FUJI_CHAIN_ID })
      } catch (e) {
        console.error('Failed to switch chain:', e)
      }
    }
  }

  const handleConnect = async () => {
    if (openConnectModal) {
      openConnectModal()
    }
  }

  const handleDisconnect = () => {
    disconnect()
  }

  useEffect(() => {
    if (publicClient) {
      setProvider(publicClientToProvider(publicClient))
    } else {
      setProvider(null)
    }
  }, [publicClient])

  useEffect(() => {
    if (walletClient) {
      setSigner(walletClientToSigner(walletClient))
    } else {
      setSigner(null)
    }
  }, [walletClient])

  const contextValue = useMemo(() => ({
    address: address ? (address as string) : null,
    connected: isConnected,
    provider,
    signer,
    chainId: chainId || null,
    wrongNetwork,
    connect: handleConnect,
    disconnect: handleDisconnect,
    switchToFuji,
  }), [address, isConnected, provider, signer, chainId, wrongNetwork, switchChainAsync, openConnectModal, disconnect])

  return (
    <EvmWalletContext.Provider value={contextValue}>
      {children}
    </EvmWalletContext.Provider>
  )
}

