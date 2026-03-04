'use client'

import { useState, useEffect, useRef } from 'react'
import PubNub from 'pubnub'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { MessageSquare, X, Send } from 'lucide-react'
import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { getOrCreateUsername, getUsernameMap, deriveUsername } from '@/lib/username'
import { spermTheme } from '@/components/theme/spermTheme'

interface ChatMessage {
  text: string
  sender: string       // short display (e.g. "Ab12…XYZw") — kept for legacy
  fullSender: string   // full pubkey string for balance lookup
  username?: string    // generated random name, e.g. "NeonWolf4823"
  timestamp: number
}

// SPRM mint PDA (mirrors GameHUD constants)
const STATE_SEED = Buffer.from('state')
const MINT_SEED  = Buffer.from('mint')
const PROGRAM_ID = new PublicKey('AouUDBc5RzydyxEUtrH3nf65ZMeZxxVgMzG4cUat8Cd6')
const [statePda] = PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID)
const [mintPda]  = PublicKey.findProgramAddressSync([MINT_SEED, statePda.toBuffer()], PROGRAM_ID)
const DECIMALS   = 9

const PUBLISH_KEY  = process.env.NEXT_PUBLIC_PUBNUB_PUBLISH_KEY  || ''
const SUBSCRIBE_KEY = process.env.NEXT_PUBLIC_PUBNUB_SUBSCRIBE_KEY || ''
const CHANNEL = 'sprmfun-global-chat'

export default function GlobalChat() {
  const { publicKey } = useWallet()
  const { connection } = useConnection()
  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput]       = useState('')
  const [pubnub, setPubnub]     = useState<PubNub | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // hover tooltip: { address, balance | null, loading }
  const [tooltip, setTooltip] = useState<{ address: string; balance: number | null; loading: boolean } | null>(null)
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetchSprmBalance(address: string): Promise<number | null> {
    try {
      const owner = new PublicKey(address)
      const ata   = getAssociatedTokenAddressSync(mintPda, owner)
      const info  = await connection.getTokenAccountBalance(ata)
      return parseFloat(info.value.uiAmountString ?? '0')
    } catch { return null }
  }

  function handleSenderMouseEnter(fullSender: string) {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    // Old messages only have the short display address — can't look up balance
    const isShort = fullSender.includes('…') || fullSender.length < 32
    if (isShort) {
      setTooltip({ address: fullSender, balance: null, loading: false })
      return
    }
    setTooltip({ address: fullSender, balance: null, loading: true })
    fetchSprmBalance(fullSender).then(balance => {
      setTooltip(t => t?.address === fullSender ? { address: fullSender, balance, loading: false } : t)
    })
  }

  function handleSenderMouseLeave() {
    tooltipTimer.current = setTimeout(() => setTooltip(null), 200)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!PUBLISH_KEY || !SUBSCRIBE_KEY) return
    const pn = new PubNub({
      publishKey:   PUBLISH_KEY,
      subscribeKey: SUBSCRIBE_KEY,
      uuid: publicKey?.toString() || `anon-${Date.now()}`,
    })
    setPubnub(pn)
    pn.subscribe({ channels: [CHANNEL] })
    pn.addListener({
      message: (event: any) => {
        setMessages(prev => [...prev, {
          text:       event.message.text,
          sender:     event.message.sender,
          fullSender: event.message.fullSender || event.message.sender,
          username:   event.message.username,
          timestamp:  event.timetoken / 10000,
        }])
      },
    })
    return () => { pn.unsubscribe({ channels: [CHANNEL] }) }
  }, [publicKey])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !pubnub) return
    const addrStr   = publicKey?.toString() ?? ''
    const shortAddr = addrStr ? `${addrStr.slice(0, 4)}…${addrStr.slice(-4)}` : 'Anon'
    const username  = addrStr ? getOrCreateUsername(addrStr) : 'Anon'
    pubnub.publish({
      channel: CHANNEL,
      message: {
        text:       input.trim(),
        sender:     shortAddr,
        fullSender: addrStr || shortAddr,
        username,
      },
    })
    setInput('')
  }

  return (
    <>
      {/* Toggle button — bottom left */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed', bottom: 20, left: 20, zIndex: 200,
          width: 42, height: 42, borderRadius: 10,
          background: spermTheme.accentSoft,
          border: `1px solid ${spermTheme.accentBorder}`,
          color: spermTheme.textPrimary, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title="Global Chat"
      >
        {open ? <X size={18} /> : <MessageSquare size={18} />}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 70, left: 20, zIndex: 200,
          width: 280, height: 380,
          background: 'transparent',
          border: `1px solid ${spermTheme.accentBorder}`,
          borderRadius: 12,
          display: 'flex', flexDirection: 'column',
          fontFamily: 'Inter, sans-serif',
          overflow: 'hidden',
        }}>
          {/* Gaussian blur background layer */}
          <div style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none', borderRadius: 12 }}>
            <div style={{
              position: 'absolute', inset: '-40px',
              background: 'linear-gradient(135deg, rgba(122,96,165,0.55) 0%, rgba(8,6,18,0.95) 40%, rgba(58,42,95,0.5) 70%, rgba(197,140,255,0.3) 100%)',
              filter: 'blur(32px)',
            }} />
            <div style={{ position: 'absolute', inset: 0, background: spermTheme.bgGlass }} />
          </div>
          {/* Content */}
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{
            padding: '10px 14px',
            borderBottom: `1px solid ${spermTheme.borderSoft}`,
            fontSize: 11, fontWeight: 700, letterSpacing: 1,
            color: spermTheme.accent,
          }}>
            GLOBAL CHAT
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '10px 12px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {messages.length === 0 && (
              <div style={{ color: spermTheme.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 20 }}>
                No messages yet
              </div>
            )}
            {(() => {
              const storedMap = getUsernameMap()
              return messages.map((msg, i) => {
                const isFullAddr = msg.fullSender && !msg.fullSender.includes('…') && msg.fullSender.length >= 32
                const displayName = msg.username
                  || storedMap[msg.fullSender]
                  || (isFullAddr ? deriveUsername(msg.fullSender) : msg.sender)
                return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  onMouseEnter={() => handleSenderMouseEnter(msg.fullSender)}
                  onMouseLeave={handleSenderMouseLeave}
                  style={{ fontSize: 10, color: spermTheme.accent, fontWeight: 600, cursor: 'default', position: 'relative', display: 'inline-block' }}
                >
                  {displayName}
                  {tooltip?.address === msg.fullSender && (
                    <span style={{
                      position: 'absolute', bottom: '100%', left: 0, marginBottom: 4,
                      background: 'rgba(10,8,20,0.97)',
                      border: `1px solid ${spermTheme.accentBorder}`,
                      borderRadius: 6, padding: '4px 8px',
                      fontSize: 11, color: spermTheme.textPrimary,
                      whiteSpace: 'nowrap', zIndex: 300, pointerEvents: 'none',
                    }}>
                      {tooltip?.loading ? 'Loading…' : tooltip?.balance !== null ? `${tooltip?.balance?.toFixed(2)} SPRM` : (tooltip?.address?.includes('…') ? 'Address unavailable' : 'No SPRM account')}
                    </span>
                  )}
                </span>
                <span style={{
                  fontSize: 12, color: spermTheme.textPrimary,
                  background: spermTheme.accentSoft,
                  border: `1px solid ${spermTheme.borderSoft}`,
                  borderRadius: 6, padding: '4px 8px',
                  wordBreak: 'break-word',
                }}>
                  {msg.text}
                </span>
              </div>
                )
              })
            })()}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} style={{
            display: 'flex', gap: 6, padding: '8px 10px',
            borderTop: `1px solid ${spermTheme.borderSoft}`,
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type a message…"
              maxLength={200}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${spermTheme.borderSoft}`,
                borderRadius: 6, padding: '6px 10px',
                color: spermTheme.textPrimary, fontSize: 12, outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <button type="submit" style={{
              background: spermTheme.accentSoft,
              border: `1px solid ${spermTheme.accentBorder}`,
              borderRadius: 6, padding: '0 10px',
              color: spermTheme.accent, cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}>
              <Send size={14} />
            </button>
          </form>
          </div>{/* end content wrapper */}
        </div>
      )}
    </>
  )
}
