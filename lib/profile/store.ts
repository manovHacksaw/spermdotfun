import {
  type ProfileSettings,
  type ProfileTransaction,
  type WalletProfileStoreV1,
} from '@/lib/profile/types'

const PROFILE_STORE_PREFIX = 'sprmfun:profile:v1'
const PROFILE_VERSION = 1
const MAX_TRANSACTIONS = 500
const MAX_AVATAR_DATA_URL_LEN = 400_000

const DEFAULT_SETTINGS: ProfileSettings = {
  nickname: '',
  email: '',
  avatarDataUrl: null,
  clientSeed: '',
  referralCode: '',
  volume: 35,
  referredBy: null,
  referralEarned: 0,
}

function makeDefaultStore(): WalletProfileStoreV1 {
  return {
    version: PROFILE_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    transactions: [],
  }
}

function isBrowser() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

export function profileStoreKey(walletAddress: string): string {
  return `${PROFILE_STORE_PREFIX}:${walletAddress}`
}

function toSafeString(value: unknown, maxLen = 256): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, maxLen)
}

function toSafeAvatar(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (!value.startsWith('data:image/')) return null
  if (value.length > MAX_AVATAR_DATA_URL_LEN) return null
  return value
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return num
}

function normalizeVolume(value: unknown): number {
  const num = Math.round(toSafeNumber(value, DEFAULT_SETTINGS.volume))
  return Math.max(0, Math.min(100, num))
}

function normalizeSettings(value: unknown): ProfileSettings {
  const input = (typeof value === 'object' && value !== null) ? (value as Record<string, unknown>) : {}
  return {
    nickname: toSafeString(input.nickname, 40),
    email: toSafeString(input.email, 120),
    avatarDataUrl: toSafeAvatar(input.avatarDataUrl),
    clientSeed: toSafeString(input.clientSeed, 120),
    referralCode: toSafeString(input.referralCode, 120),
    volume: normalizeVolume(input.volume),
    referredBy: typeof input.referredBy === 'string' ? input.referredBy : null,
    referralEarned: typeof input.referralEarned === 'number' ? input.referralEarned : 0,
  }
}

function normalizeTx(value: unknown): ProfileTransaction | null {
  const input = (typeof value === 'object' && value !== null) ? (value as Record<string, unknown>) : null
  if (!input) return null

  const rawTxSignature = toSafeString(input.txSignature ?? input.tx_signature, 140)
  const eventIndex = Math.max(0, Math.floor(toSafeNumber(input.eventIndex, 0)))
  const idFromSignature = rawTxSignature ? `${rawTxSignature}:${eventIndex}` : ''
  const id = toSafeString(input.id, 200) || idFromSignature
  const wallet = toSafeString(input.wallet, 80)
  const sourceWallet = toSafeString(input.sourceWallet, 80) || wallet
  const game = input.game === 'crash' ? 'crash' : null
  const betAmount = Math.max(0, toSafeNumber(input.betAmount, 0))
  const payout = Math.max(0, toSafeNumber(input.payout, 0))
  const net = toSafeNumber(input.net, payout - betAmount)
  const won = Boolean(input.won)
  const timestamp = Math.floor(toSafeNumber(input.timestamp, Date.now()))
  const resolvedAt = toSafeString(input.resolvedAt, 40) || new Date(timestamp).toISOString()
  const txSignature = rawTxSignature || toSafeString(input.betPda, 140) || id

  if (!id || !wallet || !game || !Number.isFinite(timestamp)) {
    return null
  }

  const tx: ProfileTransaction = {
    id,
    txSignature,
    eventIndex,
    wallet,
    sourceWallet,
    game,
    betAmount,
    payout,
    net,
    won,
    timestamp,
    resolvedAt,
  }

  const betPda = toSafeString(input.betPda, 120)
  if (betPda) tx.betPda = betPda

  const boxX = toSafeNumber(input.boxX, Number.NaN)
  if (Number.isFinite(boxX)) tx.boxX = boxX

  const boxRow = toSafeNumber(input.boxRow, Number.NaN)
  if (Number.isFinite(boxRow)) tx.boxRow = boxRow

  return tx
}

function normalizeTransactions(value: unknown): ProfileTransaction[] {
  if (!Array.isArray(value)) return []

  const out: ProfileTransaction[] = []
  const seen = new Set<string>()

  for (const raw of value) {
    const tx = normalizeTx(raw)
    if (!tx) continue
    if (seen.has(tx.id)) continue
    seen.add(tx.id)
    out.push(tx)
  }

  out.sort((a, b) => b.timestamp - a.timestamp)
  return out.slice(0, MAX_TRANSACTIONS)
}

function normalizeStore(value: unknown): WalletProfileStoreV1 {
  const input = (typeof value === 'object' && value !== null) ? (value as Record<string, unknown>) : {}

  return {
    version: PROFILE_VERSION,
    settings: normalizeSettings(input.settings),
    transactions: normalizeTransactions(input.transactions),
  }
}

export function readWalletProfile(walletAddress: string): WalletProfileStoreV1 {
  if (!walletAddress) return makeDefaultStore()
  if (!isBrowser()) return makeDefaultStore()

  try {
    const raw = localStorage.getItem(profileStoreKey(walletAddress))
    if (!raw) return makeDefaultStore()
    const parsed = JSON.parse(raw)
    return normalizeStore(parsed)
  } catch {
    return makeDefaultStore()
  }
}

export function writeWalletProfile(walletAddress: string, value: WalletProfileStoreV1): WalletProfileStoreV1 {
  const normalized = normalizeStore(value)
  if (!walletAddress || !isBrowser()) return normalized
  try {
    localStorage.setItem(profileStoreKey(walletAddress), JSON.stringify(normalized))
  } catch {
    // Ignore storage quota/privacy failures so UI does not crash.
  }
  return normalized
}

export function updateWalletSettings(
  walletAddress: string,
  patch: Partial<ProfileSettings>,
): WalletProfileStoreV1 {
  const current = readWalletProfile(walletAddress)
  const merged = {
    ...current,
    settings: normalizeSettings({ ...current.settings, ...patch }),
  }
  return writeWalletProfile(walletAddress, merged)
}

export function appendWalletTransaction(
  walletAddress: string,
  tx: ProfileTransaction,
): WalletProfileStoreV1 {
  const current = readWalletProfile(walletAddress)
  const normalizedTx = normalizeTx(tx)
  if (!normalizedTx) return current

  const next = [normalizedTx, ...current.transactions.filter((item) => item.id !== normalizedTx.id)]
  next.sort((a, b) => b.timestamp - a.timestamp)

  return writeWalletProfile(walletAddress, {
    version: PROFILE_VERSION,
    settings: current.settings,
    transactions: next.slice(0, MAX_TRANSACTIONS),
  })
}
