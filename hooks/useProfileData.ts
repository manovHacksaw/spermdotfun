'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ensureProfileAccessToken, type SignMessageFn } from '@/lib/profile/clientAuth'
import {
  type ProfileOverviewResponse,
  type ProfilePnlPoint,
  type ProfileSettings,
  type ProfileStats,
  type ProfileTimeFilter,
  type ProfileTransactionsResponse,
  type ProfileTransaction,
} from '@/lib/profile/types'

const EMPTY_SETTINGS: ProfileSettings = {
  nickname: '',
  email: '',
  avatarDataUrl: null,
  clientSeed: '',
  referralCode: '',
  volume: 35,
  referredBy: null,
  referralEarned: 0,
}

const EMPTY_STATS: ProfileStats = {
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  totalWagered: 0,
  totalPayout: 0,
  netProfit: 0,
  grossProfit: 0,
  totalLoss: 0,
  avgBet: 0,
  avgPayout: 0,
}

async function readJsonOrThrow<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `Request failed with status ${response.status}`
    throw new Error(message)
  }
  return payload as T
}

export function useProfileData(
  walletAddress: string | null,
  signMessage?: SignMessageFn,
) {
  const [settings, setSettings] = useState<ProfileSettings>(EMPTY_SETTINGS)
  const [stats, setStats] = useState<ProfileStats>(EMPTY_STATS)
  const [pnlSeries, setPnlSeries] = useState<ProfilePnlPoint[]>([])

  const [statsRange, setStatsRange] = useState<ProfileTimeFilter>('7D')
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState('')

  const [transactions, setTransactions] = useState<ProfileTransaction[]>([])
  const [transactionsLoading, setTransactionsLoading] = useState(false)
  const [transactionsError, setTransactionsError] = useState('')
  const [transactionsHasMore, setTransactionsHasMore] = useState(false)
  const [transactionsCursor, setTransactionsCursor] = useState<string | null>(null)
  const [loadingMoreTransactions, setLoadingMoreTransactions] = useState(false)

  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetState = useCallback(() => {
    setSettings(EMPTY_SETTINGS)
    setStats(EMPTY_STATS)
    setPnlSeries([])
    setStatsError('')
    setTransactions([])
    setTransactionsError('')
    setTransactionsHasMore(false)
    setTransactionsCursor(null)
    setSettingsSaving(false)
    setSettingsError('')
  }, [])

  const fetchOverview = useCallback(async (range: ProfileTimeFilter) => {
    if (!walletAddress) {
      resetState()
      return
    }

    setStatsLoading(true)
    setStatsError('')

    try {
      const response = await fetch(
        `/api/profile/overview?wallet=${encodeURIComponent(walletAddress)}&range=${encodeURIComponent(range)}&txLimit=1`,
      )
      const payload = await readJsonOrThrow<ProfileOverviewResponse>(response)
      setSettings(payload.settings ?? EMPTY_SETTINGS)
      setStats(payload.stats ?? EMPTY_STATS)
      setPnlSeries(Array.isArray(payload.pnlSeries) ? payload.pnlSeries : [])
    } catch (error: any) {
      setStatsError(error?.message ?? 'Failed to load profile overview')
    } finally {
      setStatsLoading(false)
    }
  }, [walletAddress, resetState])

  const fetchTransactions = useCallback(async ({
    cursor,
    append,
  }: {
    cursor: string | null
    append: boolean
  }) => {
    if (!walletAddress) {
      resetState()
      return
    }

    if (append) {
      setLoadingMoreTransactions(true)
    } else {
      setTransactionsLoading(true)
      setTransactionsError('')
    }

    try {
      const params = new URLSearchParams()
      params.set('wallet', walletAddress)
      params.set('range', 'ALL')
      params.set('limit', '25')
      if (cursor) params.set('cursor', cursor)

      const response = await fetch(`/api/profile/transactions?${params.toString()}`)
      const payload = await readJsonOrThrow<ProfileTransactionsResponse>(response)

      const incoming = Array.isArray(payload.items) ? payload.items : []
      setTransactions((prev) => {
        if (!append) return incoming
        const byId = new Map(prev.map((item) => [item.id, item]))
        for (const tx of incoming) {
          byId.set(tx.id, tx)
        }
        return Array.from(byId.values()).sort((a, b) => b.timestamp - a.timestamp)
      })

      setTransactionsHasMore(Boolean(payload.hasMore))
      setTransactionsCursor(payload.nextCursor ?? null)
    } catch (error: any) {
      setTransactionsError(error?.message ?? 'Failed to load profile transactions')
    } finally {
      setTransactionsLoading(false)
      setLoadingMoreTransactions(false)
    }
  }, [walletAddress, resetState])

  useEffect(() => {
    if (!walletAddress) {
      resetState()
      return
    }
    void fetchOverview(statsRange)
  }, [fetchOverview, resetState, statsRange, walletAddress])

  useEffect(() => {
    if (!walletAddress) {
      resetState()
      return
    }
    void fetchTransactions({ cursor: null, append: false })
  }, [fetchTransactions, resetState, walletAddress])

  useEffect(() => {
    if (!walletAddress) return

    const refetchDebounced = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        void fetchOverview(statsRange)
        void fetchTransactions({ cursor: null, append: false })
      }, 550)
    }

    window.addEventListener('sprmfun:betresult', refetchDebounced)
    window.addEventListener('sprmfun:profile_links_updated', refetchDebounced)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      window.removeEventListener('sprmfun:betresult', refetchDebounced)
      window.removeEventListener('sprmfun:profile_links_updated', refetchDebounced)
    }
  }, [fetchOverview, fetchTransactions, statsRange, walletAddress])

  const loadMoreTransactions = useCallback(async () => {
    if (!walletAddress) return
    if (!transactionsHasMore || !transactionsCursor) return
    await fetchTransactions({ cursor: transactionsCursor, append: true })
  }, [fetchTransactions, transactionsCursor, transactionsHasMore, walletAddress])

  const saveSettings = useCallback(async (patch: Partial<ProfileSettings>) => {
    if (!walletAddress) throw new Error('Connect a wallet to save profile settings')

    setSettingsSaving(true)
    setSettingsError('')

    try {
      const token = await ensureProfileAccessToken(walletAddress, signMessage)
      const response = await fetch('/api/profile/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      })

      const payload = await readJsonOrThrow<{ wallet: string; settings: ProfileSettings }>(response)
      setSettings(payload.settings)

      window.dispatchEvent(new CustomEvent('sprmfun:profile_settings_updated', {
        detail: {
          wallet: payload.wallet,
          volume: payload.settings.volume,
        },
      }))

      return payload.settings
    } catch (error: any) {
      const message = error?.message ?? 'Failed to save settings'
      setSettingsError(message)
      throw new Error(message)
    } finally {
      setSettingsSaving(false)
    }
  }, [signMessage, walletAddress])

  const summary = useMemo(() => ({
    walletAddress,
    linkedTransactions: transactions.length,
  }), [transactions.length, walletAddress])

  return {
    summary,
    settings,
    stats,
    pnlSeries,
    statsRange,
    setStatsRange,
    statsLoading,
    statsError,
    transactions,
    transactionsLoading,
    transactionsError,
    transactionsHasMore,
    loadMoreTransactions,
    loadingMoreTransactions,
    saveSettings,
    settingsSaving,
    settingsError,
    refreshOverview: () => fetchOverview(statsRange),
    refreshTransactions: () => fetchTransactions({ cursor: null, append: false }),
  }
}
