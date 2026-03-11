'use client'

import { useState, useEffect, useRef } from 'react'
import PubNub from 'pubnub'
import { useAccount } from 'wagmi'
import { MessageSquare, X, Send } from 'lucide-react'
import { getOrCreateUsername, getUsernameMap, deriveUsername } from '@/lib/username'
import { spermTheme } from '@/components/theme/spermTheme'

interface ChatMessage {
  text: string
  sender: string       // short display (e.g. "Ab12…XYZw") — kept for legacy
  fullSender: string   // full address string
  username?: string    // generated random name, e.g. "NeonWolf4823"
  timestamp: number
}

const PUBLISH_KEY = process.env.NEXT_PUBLIC_PUBNUB_PUBLISH_KEY || ''
const SUBSCRIBE_KEY = process.env.NEXT_PUBLIC_PUBNUB_SUBSCRIBE_KEY || ''
const CHANNEL = 'sprmfun-global-chat'

export default function GlobalChat() {
  const { address } = useAccount()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [pubnub, setPubnub] = useState<PubNub | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
        setMessages(prev => [...prev, {
          text: event.message.text,
          sender: event.message.sender,
          fullSender: event.message.fullSender || event.message.sender,
          username: event.message.username,
          timestamp: event.timetoken / 10000,
        }])
      },
    })
    return () => { pn.unsubscribe({ channels: [CHANNEL] }) }
  }, [address])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !pubnub) return
    const addrStr = address ?? ''
    const shortAddr = addrStr ? `${addrStr.slice(0, 4)}…${addrStr.slice(-4)}` : 'Anon'
    const username = addrStr ? getOrCreateUsername(addrStr) : 'Anon'
    pubnub.publish({
      channel: CHANNEL,
      message: {
        text: input.trim(),
        sender: shortAddr,
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
          width: 300, height: 400,
          background: 'transparent',
          border: `1px solid ${spermTheme.borderChrome}`,
          borderRadius: 8,
          display: 'flex', flexDirection: 'column',
          fontFamily: "'Outfit', sans-serif",
          overflow: 'hidden',
          boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
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
              padding: '12px 16px',
              borderBottom: `1px solid ${spermTheme.borderChrome}`,
              fontSize: 10, fontWeight: 800, letterSpacing: 2,
              color: spermTheme.accent,
              fontFamily: "'JetBrains Mono', monospace",
              background: 'rgba(255,255,255,0.02)',
            }}>
              SYSTEM: GLOBAL_CHAT
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
                  const isMe = address && (msg.fullSender === address || msg.sender === `${address.slice(0, 4)}…${address.slice(-4)}`)
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                      <span
                        style={{ fontSize: 10, color: isMe ? spermTheme.accent : spermTheme.textTertiary, fontWeight: 700, cursor: 'default' }}
                      >
                        {isMe ? 'YOU' : displayName}
                      </span>
                      <span style={{
                        fontSize: 12, color: spermTheme.textPrimary,
                        background: isMe ? 'rgba(212,170,255,0.08)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${isMe ? 'rgba(212,170,255,0.2)' : spermTheme.borderChrome}`,
                        borderRadius: 6, padding: '6px 10px',
                        wordBreak: 'break-word',
                        lineHeight: 1.5,
                        textAlign: isMe ? 'right' : 'left'
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
