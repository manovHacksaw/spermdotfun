'use client'

import bs58 from 'bs58'

const AUTH_CACHE_PREFIX = 'sprmfun:profile:auth:v1'

export type SignMessageFn = (message: Uint8Array) => Promise<Uint8Array>

interface CachedAuthSession {
  accessToken: string
  expiresAt: string
}

function cacheKey(walletAddress: string): string {
  return `${AUTH_CACHE_PREFIX}:${walletAddress}`
}

function readCachedSession(walletAddress: string): CachedAuthSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(cacheKey(walletAddress))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedAuthSession
    if (!parsed?.accessToken || !parsed?.expiresAt) return null

    const expiresAtMs = new Date(parsed.expiresAt).getTime()
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now() + 30_000) {
      window.sessionStorage.removeItem(cacheKey(walletAddress))
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function writeCachedSession(walletAddress: string, session: CachedAuthSession) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(cacheKey(walletAddress), JSON.stringify(session))
  } catch {
    // Ignore storage failures (private mode/quota) and continue with in-memory auth flow.
  }
}

async function readJsonOrThrow(response: Response): Promise<any> {
  let payload: any = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `Request failed with status ${response.status}`
    throw new Error(message)
  }

  return payload
}

export async function ensureProfileAccessToken(
  walletAddress: string,
  signMessage?: SignMessageFn,
): Promise<string> {
  if (!walletAddress) {
    throw new Error('Wallet address is required for profile auth')
  }
  if (!signMessage) {
    throw new Error('Connected wallet does not support message signing')
  }

  const cached = readCachedSession(walletAddress)
  if (cached) return cached.accessToken

  const challengeResponse = await fetch('/api/profile/auth/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: walletAddress }),
  })
  const challenge = await readJsonOrThrow(challengeResponse)

  const message = typeof challenge?.message === 'string' ? challenge.message : ''
  const nonce = typeof challenge?.nonce === 'string' ? challenge.nonce : ''
  if (!message || !nonce) {
    throw new Error('Profile auth challenge returned invalid payload')
  }

  const signatureBytes = await signMessage(new TextEncoder().encode(message))
  const signature = bs58.encode(signatureBytes)

  const verifyResponse = await fetch('/api/profile/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: walletAddress, nonce, signature }),
  })
  const verified = await readJsonOrThrow(verifyResponse)

  const accessToken = typeof verified?.accessToken === 'string' ? verified.accessToken : ''
  const expiresAt = typeof verified?.expiresAt === 'string' ? verified.expiresAt : ''
  if (!accessToken || !expiresAt) {
    throw new Error('Profile auth verify returned invalid payload')
  }

  writeCachedSession(walletAddress, { accessToken, expiresAt })
  return accessToken
}
