'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useSessionWallet, type SessionWalletState } from '@/hooks/useSessionWallet'

const SessionWalletContext = createContext<SessionWalletState | null>(null)

/** Provide the session wallet state to the entire component tree. */
export function SessionWalletProvider({ children }: { children: ReactNode }) {
  const state = useSessionWallet()
  return (
    <SessionWalletContext.Provider value={state}>
      {children}
    </SessionWalletContext.Provider>
  )
}

/** Consume the session wallet context. Must be inside <SessionWalletProvider>. */
export function useSessionWalletContext(): SessionWalletState {
  const ctx = useContext(SessionWalletContext)
  if (!ctx) throw new Error('useSessionWalletContext must be used inside <SessionWalletProvider>')
  return ctx
}
