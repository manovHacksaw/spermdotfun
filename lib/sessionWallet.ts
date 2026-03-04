import { ethers } from 'ethers'

const SESSION_KEY = 'sprmfun:session_evm_key'

export function generateSessionWallet(): ethers.Wallet {
  return ethers.Wallet.createRandom()
}

export function saveSessionWallet(wallet: ethers.Wallet): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(SESSION_KEY, wallet.privateKey)
}

export function loadSessionWallet(): ethers.Wallet | null {
  if (typeof window === 'undefined') return null
  try {
    const pk = localStorage.getItem(SESSION_KEY)
    if (!pk) return null
    return new ethers.Wallet(pk)
  } catch {
    return null
  }
}

export function destroySessionWallet(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(SESSION_KEY)
}
