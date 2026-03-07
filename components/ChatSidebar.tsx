import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PubNub from 'pubnub'
import { Send, MessageSquare, Trophy, Image as ImageIcon } from 'lucide-react'
import type { LeaderEntry } from '@/hooks/useLiveGameStats'
import { RAIL_COLORS } from '@/components/leftRailShared'
import { spermTheme } from '@/components/theme/spermTheme'
import { useEvmWallet } from '@/components/WalletProvider'
import { ethers } from 'ethers'

// ── Environment config ────────────────────────────────────────────────────────
const PUBLISH_KEY = process.env.NEXT_PUBLIC_PUBNUB_PUBLISH_KEY || ''
const SUBSCRIBE_KEY = process.env.NEXT_PUBLIC_PUBNUB_SUBSCRIBE_KEY || ''
const CHANNEL = 'sprm_crash_chat'
const GIPHY_API_KEY = process.env.NEXT_PUBLIC_GIPHY_API_KEY || ''
const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS
const RPC_URL = process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc'

type Tab = 'chat' | 'leaderboard'

interface ChatMessage {
  text: string
  sender: string
  fullSender: string
  timestamp: number
  isGif?: boolean
}

interface ChatSidebarProps {
  leaderboard: LeaderEntry[]
}

const AVATAR_PALETTES = [
  ['#f5f5f2', '#c58cff'],
  ['#ddd5ee', '#a88dd0'],
  ['#ebe4f7', '#9075bc'],
  ['#d4c9e6', '#7f66aa'],
  ['#f3eefc', '#b494dd'],
  ['#c4b8d8', '#705995'],
  ['#e8e1f2', '#9f85c7'],
  ['#cbbfdd', '#6c578f'],
]

function getAvatarStyle(sender: string): React.CSSProperties {
  let hash = 0
  for (let i = 0; i < sender.length; i++) hash = sender.charCodeAt(i) + ((hash << 5) - hash)
  const [c1, c2] = AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length]
  const angle = Math.abs(hash >> 4) % 360
  return {
    background: `linear-gradient(${angle}deg, ${c1}, ${c2})`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 800,
    color: 'rgba(10,7,18,0.68)',
    userSelect: 'none',
  }
}

function getLevel(sender: string) {
  let hash = 0
  for (let i = 0; i < sender.length; i++) hash = sender.charCodeAt(i) + ((hash << 5) - hash)
  return Math.abs(hash % 50) + 1
}

async function fetchSprmBalance(address: string): Promise<number | null> {
  try {
    if (!TOKEN_ADDRESS) return null
    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const token = new ethers.Contract(TOKEN_ADDRESS, ['function balanceOf(address) view returns (uint256)'], provider)
    const bal = await token.balanceOf(address)
    return parseFloat(ethers.formatEther(bal))
  } catch {
    return null
  }
}

export default function ChatSidebar({ leaderboard }: ChatSidebarProps) {
  const { address } = useEvmWallet()

  const [tab, setTab] = useState<Tab>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [pubnub, setPubnub] = useState<PubNub | null>(null)

  const [showGifPicker, setShowGifPicker] = useState(false)
  const [gifSearch, setGifSearch] = useState('')
  const [gifResults, setGifResults] = useState<string[]>([])
  const [gifLoading, setGifLoading] = useState(false)

  const gifSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const [tooltip, setTooltip] = useState<{ address: string; balance: number | null; loading: boolean } | null>(null)

  const sortedLeaderboard = useMemo(() => {
    return [...leaderboard]
      .sort((a, b) => b.totalPayout - a.totalPayout)
      .slice(0, 20)
  }, [leaderboard])

  useEffect(() => {
    if (!PUBLISH_KEY || !SUBSCRIBE_KEY) return

    const pn = new PubNub({
      publishKey: PUBLISH_KEY,
      subscribeKey: SUBSCRIBE_KEY,
      uuid: address || `anon-${Date.now()}`,
    })

    setPubnub(pn)
    pn.subscribe({ channels: [CHANNEL] })
    pn.addListener({
      message: (event: any) => {
        setMessages((prev) => [
          ...prev,
          {
            text: event.message.text,
            sender: event.message.sender,
            fullSender: event.message.fullSender || event.message.sender,
            timestamp: event.timetoken / 10000,
            isGif: event.message.isGif,
          },
        ])
      },
    })

    pn.fetchMessages({ channels: [CHANNEL], count: 25 }, (_status: any, response: any) => {
      if (!response?.channels?.[CHANNEL]) return
      setMessages(
        response.channels[CHANNEL].map((msg: any) => ({
          text: msg.message.text,
          sender: msg.message.sender,
          fullSender: msg.message.fullSender || msg.message.sender,
          timestamp: msg.timetoken / 10000,
          isGif: msg.message.isGif,
        }))
      )
    })

    return () => {
      pn.unsubscribe({ channels: [CHANNEL] })
    }
  }, [address])

  useEffect(() => {
    if (tab === 'chat') bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, tab])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!input.trim() || !pubnub) return

      const shortAddr = address
        ? `${address.slice(0, 4)}…${address.slice(-4)}`
        : 'Anon'

      pubnub.publish({
        channel: CHANNEL,
        message: {
          text: input.trim(),
          sender: shortAddr,
          fullSender: address || shortAddr,
        },
      })
      setInput('')
    },
    [input, pubnub, address]
  )

  const handleGifSelect = useCallback(
    (gifUrl: string) => {
      if (!pubnub) return
      const shortAddr = address
        ? `${address.slice(0, 4)}…${address.slice(-4)}`
        : 'Anon'
      pubnub.publish({
        channel: CHANNEL,
        message: {
          text: gifUrl,
          sender: shortAddr,
          fullSender: address || shortAddr,
          isGif: true,
        },
      })
      setShowGifPicker(false)
    },
    [pubnub, address]
  )

  const fetchGifs = useCallback(async (query: string) => {
    if (!GIPHY_API_KEY) return
    setGifLoading(true)
    try {
      const endpoint = query.trim()
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=12&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=12&rating=g`
      const res = await fetch(endpoint)
      const json = await res.json()
      setGifResults((json.data ?? []).map((g: any) => g.images.fixed_height_small.url as string))
    } catch {
      // Ignore API failures.
    }
    setGifLoading(false)
  }, [])

  useEffect(() => {
    if (showGifPicker) fetchGifs(gifSearch)
    // Only fetch immediately when opening; text search remains debounced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGifPicker])

  const handleGifSearchChange = (query: string) => {
    setGifSearch(query)
    if (gifSearchTimer.current) clearTimeout(gifSearchTimer.current)
    gifSearchTimer.current = setTimeout(() => fetchGifs(query), 400)
  }

  const handleSenderMouseEnter = (fullSender: string) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    const isShort = fullSender.includes('…') || fullSender.length < 32
    if (isShort) {
      setTooltip({ address: fullSender, balance: null, loading: false })
      return
    }
    setTooltip({ address: fullSender, balance: null, loading: true })
    fetchSprmBalance(fullSender).then((balance) => {
      setTooltip((curr) => (curr?.address === fullSender ? { address: fullSender, balance, loading: false } : curr))
    })
  }

  const handleSenderMouseLeave = () => {
    tooltipTimer.current = setTimeout(() => setTooltip(null), 200)
  }

  useEffect(
    () => () => {
      if (gifSearchTimer.current) clearTimeout(gifSearchTimer.current)
      if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    },
    []
  )

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', borderBottom: `1px solid ${RAIL_COLORS.border}`, background: 'rgba(255,255,255,0.02)', flexShrink: 0 }}>
        {([
          { id: 'chat', icon: <MessageSquare size={12} />, label: 'CHAT' },
          { id: 'leaderboard', icon: <Trophy size={12} />, label: 'LEADERBOARD' },
        ] as { id: Tab; icon: React.ReactNode; label: string }[]).map((tabBtn) => (
          <button
            key={tabBtn.id}
            onClick={() => setTab(tabBtn.id)}
            style={{
              flex: 1,
              padding: '12px 4px',
              background: tab === tabBtn.id ? 'rgba(212,170,255,0.05)' : 'transparent',
              border: 'none',
              borderBottom: tab === tabBtn.id ? `2px solid ${spermTheme.accent}` : '2px solid transparent',
              color: tab === tabBtn.id ? spermTheme.accent : spermTheme.textTertiary,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontSize: 10,
              letterSpacing: 1.5,
              fontWeight: 800,
              fontFamily: "'JetBrains Mono', monospace",
              transition: 'all 0.2s',
            }}
          >
            {tabBtn.icon}
            {tabBtn.label}
          </button>
        ))}
      </div>

      {tab === 'chat' && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '12px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {messages.length === 0 && (
              <div style={{ color: RAIL_COLORS.textDim, fontSize: 11, textAlign: 'center', marginTop: 28, lineHeight: 1.8 }}>
                No messages yet
                <br />
                <span style={{ fontSize: 9, opacity: 0.6 }}>Be the first to say something</span>
              </div>
            )}

            {messages.map((msg, i) => {
              const isMe =
                !!address &&
                (msg.fullSender === address ||
                  msg.sender === `${address.slice(0, 4)}…${address.slice(-4)}`)

              return (
                <div
                  key={`${msg.timestamp}-${i}`}
                  style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', gap: 6, alignItems: 'flex-end' }}
                >
                  {!isMe && (
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        border: '1px solid rgba(255,255,255,0.18)',
                        flexShrink: 0,
                        ...getAvatarStyle(msg.fullSender),
                        fontSize: 10,
                      }}
                    >
                      {msg.sender.slice(0, 2).toUpperCase()}
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      alignItems: isMe ? 'flex-end' : 'flex-start',
                      maxWidth: '80%',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span
                        onMouseEnter={() => handleSenderMouseEnter(msg.fullSender)}
                        onMouseLeave={handleSenderMouseLeave}
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: isMe ? RAIL_COLORS.accent : RAIL_COLORS.text,
                          cursor: 'default',
                          position: 'relative',
                        }}
                      >
                        {isMe ? 'you' : msg.sender}
                        {tooltip?.address === msg.fullSender && (
                          <span
                            style={{
                              position: 'absolute',
                              bottom: '100%',
                              left: isMe ? 'auto' : 0,
                              right: isMe ? 0 : 'auto',
                              marginBottom: 4,
                              background: spermTheme.bgElevated,
                              border: `1px solid ${spermTheme.borderSoft}`,
                              borderRadius: 6,
                              padding: '4px 8px',
                              fontSize: 11,
                              color: RAIL_COLORS.text,
                              whiteSpace: 'nowrap',
                              zIndex: 200,
                              pointerEvents: 'none',
                            }}
                          >
                            {tooltip.loading
                              ? 'Loading…'
                              : tooltip.balance !== null
                                ? `${tooltip.balance.toFixed(2)} SPRM`
                                : tooltip.address.includes('…')
                                  ? '—'
                                  : 'No SPRM account'}
                          </span>
                        )}
                      </span>

                      {!isMe && (
                        <span
                          style={{
                            fontSize: 11,
                            color: spermTheme.accent,
                            background: spermTheme.accentSoft,
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontWeight: 700,
                          }}
                        >
                          {getLevel(msg.fullSender)}
                        </span>
                      )}
                    </div>

                    {msg.isGif ? (
                      <img src={msg.text} alt="gif" style={{ maxWidth: '100%', borderRadius: 6, border: `1px solid ${spermTheme.borderChrome}` }} />
                    ) : (
                      <span
                        style={{
                          fontSize: 13,
                          color: spermTheme.textPrimary,
                          background: isMe ? 'rgba(212,170,255,0.06)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${isMe ? 'rgba(212,170,255,0.2)' : spermTheme.borderChrome}`,
                          borderRadius: isMe ? '8px 2px 8px 8px' : '2px 8px 8px 8px',
                          padding: '8px 12px',
                          wordBreak: 'break-word',
                          lineHeight: 1.5,
                          fontFamily: "'Outfit', sans-serif"
                        }}
                      >
                        {msg.text}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {showGifPicker && (
            <div
              style={{
                position: 'absolute',
                bottom: 52,
                left: 8,
                right: 8,
                background: spermTheme.bgElevated,
                border: `1px solid ${RAIL_COLORS.border}`,
                borderRadius: 8,
                padding: 8,
                zIndex: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06), 0 12px 26px rgba(0,0,0,0.34)',
              }}
            >
              <input
                autoFocus
                value={gifSearch}
                onChange={(e) => handleGifSearchChange(e.target.value)}
                placeholder="Search GIFs…"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  borderRadius: 6,
                  padding: '6px 10px',
                  color: RAIL_COLORS.text,
                  fontSize: 12,
                  outline: 'none',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 5,
                  maxHeight: 160,
                  overflowY: 'auto',
                }}
              >
                {gifLoading ? (
                  <div
                    style={{ gridColumn: '1/-1', textAlign: 'center', color: RAIL_COLORS.textDim, fontSize: 11, padding: '16px 0' }}
                  >
                    Loading…
                  </div>
                ) : gifResults.length === 0 ? (
                  <div
                    style={{ gridColumn: '1/-1', textAlign: 'center', color: RAIL_COLORS.textDim, fontSize: 11, padding: '16px 0' }}
                  >
                    {GIPHY_API_KEY ? 'No results' : 'Add NEXT_PUBLIC_GIPHY_API_KEY to .env'}
                  </div>
                ) : (
                  gifResults.map((gif, idx) => (
                    <img
                      key={`${gif}-${idx}`}
                      src={gif}
                      alt="gif"
                      onClick={() => handleGifSelect(gif)}
                      style={{
                        width: '100%',
                        height: 55,
                        objectFit: 'cover',
                        borderRadius: 5,
                        cursor: 'pointer',
                        border: '1px solid rgba(255,255,255,0.16)',
                      }}
                      loading="lazy"
                    />
                  ))
                )}
              </div>

              <div style={{ fontSize: 9, color: RAIL_COLORS.textDim, textAlign: 'right', opacity: 0.5 }}>Powered by GIPHY</div>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            style={{
              display: 'flex',
              gap: 4,
              padding: '8px 10px',
              borderTop: `1px solid ${RAIL_COLORS.border}`,
              background: spermTheme.bgGlassStrong,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
              flexShrink: 0,
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={address ? 'Say something…' : 'Connect wallet'}
              maxLength={200}
              disabled={!address}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.16)',
                borderRadius: 8,
                padding: '8px 10px',
                color: RAIL_COLORS.text,
                fontSize: 12,
                outline: 'none',
                opacity: address ? 1 : 0.5,
              }}
            />

            <button
              type="button"
              onClick={() => setShowGifPicker((open) => !open)}
              disabled={!address}
              style={{
                background: showGifPicker ? spermTheme.accentSoft : 'rgba(255,255,255,0.06)',
                border: `1px solid ${showGifPicker ? spermTheme.accentBorder : 'rgba(255,255,255,0.16)'}`,
                borderRadius: 8,
                padding: '8px',
                width: 36,
                height: 36,
                flexShrink: 0,
                color: showGifPicker ? RAIL_COLORS.accent : RAIL_COLORS.textDim,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: address ? 1 : 0.4,
              }}
            >
              <ImageIcon size={16} />
            </button>

            <button
              type="submit"
              disabled={!address}
              style={{
                background: spermTheme.accentSoft,
                border: `1px solid ${spermTheme.accentBorder}`,
                borderRadius: 8,
                padding: '8px',
                width: 36,
                height: 36,
                flexShrink: 0,
                color: RAIL_COLORS.accent,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: address ? 1 : 0.4,
              }}
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}

      {tab === 'leaderboard' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, color: RAIL_COLORS.textDim, letterSpacing: 1, marginBottom: 4, paddingLeft: 2, flexShrink: 0 }}>
            TOP PLAYERS - THIS SESSION
          </div>
          {sortedLeaderboard.length === 0 ? (
            <div style={{ textAlign: 'center', marginTop: 36, color: RAIL_COLORS.textDim, fontSize: 11, lineHeight: 2 }}>
              <Trophy size={28} style={{ opacity: 0.2, margin: '0 auto 8px', display: 'block' }} />
              No results yet
              <br />
              <span style={{ fontSize: 9, opacity: 0.6 }}>Place bets to appear here</span>
            </div>
          ) : (
            sortedLeaderboard.map((entry, i) => {
              const profit = entry.totalPayout - entry.totalBet
              const isMe =
                !!address &&
                (entry.address === address ||
                  entry.shortAddr === `${address.slice(0, 4)}…${address.slice(-4)}`)
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null

              return (
                <div
                  key={entry.address}
                  style={{
                    background: isMe ? spermTheme.accentSoft : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isMe ? spermTheme.accentBorder : 'rgba(255,255,255,0.12)'}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12, width: 20, textAlign: 'center', flexShrink: 0 }}>
                    {medal ?? <span style={{ color: RAIL_COLORS.textDim, fontSize: 10 }}>#{i + 1}</span>}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 11,
                        color: isMe ? RAIL_COLORS.accent : RAIL_COLORS.text,
                        fontWeight: 700,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isMe ? 'YOU' : entry.shortAddr}
                    </div>
                    <div style={{ fontSize: 9, color: RAIL_COLORS.textDim, marginTop: 1 }}>
                      {entry.wins}W · {entry.totalBet.toFixed(1)} bet
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0, fontFamily: "'JetBrains Mono', monospace" }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: profit >= 0 ? spermTheme.success : spermTheme.error }}>
                      {profit >= 0 ? '+' : ''}
                      {profit.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 9, color: spermTheme.textTertiary, letterSpacing: 1 }}>SPRM</div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
