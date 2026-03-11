'use client'

import { useEffect, useState } from 'react'

export interface LeaderEntry {
  address: string
  shortAddr: string
  wins: number
  losses: number
  totalBet: number
  totalPayout: number
}

export interface ActivePlayerEntry {
  address: string
  shortAddr: string
  nickname: string | null
  pendingBets: number
  totalBet: number
  lastBetAt: number
}

export type UseLiveGameStatsResult = {
  leaderboard: LeaderEntry[]
  activePlayers: ActivePlayerEntry[]
  activePlayersCount: number
}

type LeaderboardMessage = {
  type: 'leaderboard'
  entries?: LeaderEntry[]
}

type ActivePlayersMessage = {
  type: 'active_players'
  count?: number
  players?: ActivePlayerEntry[]
}

export function useLiveGameStats(): UseLiveGameStatsResult {
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([])
  const [activePlayers, setActivePlayers] = useState<ActivePlayerEntry[]>([])

  useEffect(() => {
    let ws: WebSocket | null = null
    let unmounted = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (unmounted) return
      const getWsUrl = () => {
        if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname === 'localhost' ? 'localhost:3000' : 'spermdotfun-socket.onrender.com';
        return `${protocol}//${host}`;
      };
      ws = new WebSocket(getWsUrl())

      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as LeaderboardMessage | ActivePlayersMessage
          if (data.type === 'leaderboard') {
            setLeaderboard(data.entries ?? [])
            return
          }
          if (data.type === 'active_players') {
            setActivePlayers(data.players ?? [])
          }
        } catch {
          // Ignore invalid payloads.
        }
      }

      ws.onclose = () => {
        ws = null
        if (!unmounted) retryTimer = setTimeout(connect, 3000)
      }

      ws.onerror = () => ws?.close()
    }

    connect()

    return () => {
      unmounted = true
      if (retryTimer) clearTimeout(retryTimer)
      ws?.close()
    }
  }, [])

  return {
    leaderboard,
    activePlayers,
    activePlayersCount: activePlayers.length,
  }
}
