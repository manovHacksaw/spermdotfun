import { useState, useEffect } from 'react'
import { getOrCreateUsername, usernameInitials } from '@/lib/username'

/**
 * Returns the persistent random username for a connected wallet.
 * - Generates + saves a new name on first connection.
 * - Returns '' while walletAddress is null (not connected).
 */
export function useUsername(walletAddress: string | null | undefined): {
  username: string
  initials: string
} {
  const [username, setUsername] = useState('')

  useEffect(() => {
    if (!walletAddress) {
      setUsername('')
      return
    }
    // getOrCreateUsername reads/writes localStorage — always runs client-side
    const name = getOrCreateUsername(walletAddress)
    setUsername(name)
  }, [walletAddress])

  return {
    username,
    initials: username ? usernameInitials(username) : '??',
  }
}
