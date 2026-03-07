'use client'

import { useState, useEffect } from 'react'
import { X, ChevronRight, ChevronLeft, Zap, Target, Trophy, Wallet, TrendingUp } from 'lucide-react'
import { spermTheme } from '@/components/theme/spermTheme'

const STORAGE_KEY = 'sprmfun_guide_v2_seen'

const steps = [
  {
    icon: TrendingUp,
    title: 'Live Price Feed',
    description: 'The sperm pointer moves based on real AVAX/USDT price data from Binance. Every tick reflects the actual market.',
    highlight: 'The grid scrolls left in real-time — watch the pointer trail.',
  },
  {
    icon: Target,
    title: 'Place a Bet',
    description: 'Click any cell on the grid to bet on that position. The multiplier shown is your potential payout — higher cells are riskier.',
    highlight: 'Cells near the current pointer are safer; edges pay more.',
  },
  {
    icon: Zap,
    title: 'Instant Wallet',
    description: 'Create a session wallet to bet instantly without MetaMask popups. Deposit a small amount of SPRM and AVAX once, then click to bet.',
    highlight: 'Session wallet = gasless, instant bets. No confirmations.',
  },
  {
    icon: Wallet,
    title: 'SPRM Token',
    description: 'All bets are placed in SPRM tokens. Use the Faucet to get free testnet SPRM, or deposit from your main wallet.',
    highlight: 'On testnet you can claim 50 SPRM every 24 hours from the Faucet.',
  },
  {
    icon: Trophy,
    title: 'Win & Collect',
    description: 'If the pointer crosses your bet cell, you win! Your payout is sent automatically to your wallet. Check the Bet Panel for live status.',
    highlight: 'Winnings are settled on-chain via Chainlink VRF-verified randomness.',
  },
]

export default function OnboardingGuide() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY)
    if (!seen) {
      // Small delay so the page loads first
      const t = setTimeout(() => setVisible(true), 800)
      return () => clearTimeout(t)
    }
  }, [])

  const close = () => {
    setClosing(true)
    setTimeout(() => {
      setVisible(false)
      setClosing(false)
      localStorage.setItem(STORAGE_KEY, '1')
    }, 200)
  }

  const next = () => {
    if (step < steps.length - 1) setStep(s => s + 1)
    else close()
  }

  const prev = () => {
    if (step > 0) setStep(s => s - 1)
  }

  if (!visible) return null

  const current = steps[step]
  const Icon = current.icon
  const isLast = step === steps.length - 1

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        opacity: closing ? 0 : 1,
        transition: 'opacity 0.2s ease',
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div
        style={{
          background: spermTheme.bgPanel,
          border: `1px solid ${spermTheme.borderAccent}`,
          borderRadius: 16,
          width: '100%',
          maxWidth: 440,
          margin: '0 16px',
          boxShadow: `0 0 60px rgba(139,92,246,0.15), 0 24px 48px rgba(0,0,0,0.5)`,
          transform: closing ? 'scale(0.95)' : 'scale(1)',
          transition: 'transform 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: `1px solid ${spermTheme.borderChrome}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: spermTheme.accentSoft,
                border: `1px solid ${spermTheme.accentBorder}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 14 }}>🎮</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: spermTheme.textPrimary }}>
              How to Play
            </span>
          </div>
          <button
            onClick={close}
            style={{
              background: 'transparent',
              border: 'none',
              color: spermTheme.textTertiary,
              padding: 4,
              borderRadius: 4,
              display: 'flex',
              cursor: 'pointer',
            }}
            aria-label="Close guide"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 4, padding: '12px 20px 0' }}>
          {steps.map((_, i) => (
            <div
              key={i}
              onClick={() => setStep(i)}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background: i <= step ? spermTheme.accent : spermTheme.borderChrome,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            />
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: '24px 20px 20px' }}>
          {/* Icon */}
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: spermTheme.accentSoft,
              border: `1px solid ${spermTheme.accentBorder}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <Icon size={24} color={spermTheme.accent} />
          </div>

          <div style={{ fontSize: 11, color: spermTheme.accent, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
            Step {step + 1} of {steps.length}
          </div>

          <h2 style={{ fontSize: 20, fontWeight: 700, color: spermTheme.textPrimary, marginBottom: 10, lineHeight: 1.3 }}>
            {current.title}
          </h2>

          <p style={{ fontSize: 14, color: spermTheme.textSecondary, lineHeight: 1.6, marginBottom: 14 }}>
            {current.description}
          </p>

          {/* Highlight box */}
          <div
            style={{
              background: 'rgba(139,92,246,0.08)',
              border: `1px solid ${spermTheme.accentBorder}`,
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
              color: spermTheme.accentBright,
              lineHeight: 1.5,
            }}
          >
            💡 {current.highlight}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px 16px',
            borderTop: `1px solid ${spermTheme.borderChrome}`,
          }}
        >
          <button
            onClick={prev}
            disabled={step === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '8px 14px',
              borderRadius: 6,
              border: `1px solid ${spermTheme.borderChrome}`,
              background: 'transparent',
              color: step === 0 ? spermTheme.textTertiary : spermTheme.textSecondary,
              fontSize: 13,
              fontWeight: 500,
              cursor: step === 0 ? 'not-allowed' : 'pointer',
              opacity: step === 0 ? 0.4 : 1,
            }}
          >
            <ChevronLeft size={14} />
            Back
          </button>

          <button
            onClick={next}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 20px',
              borderRadius: 6,
              border: 'none',
              background: isLast
                ? `linear-gradient(135deg, ${spermTheme.accent}, ${spermTheme.accentBright})`
                : spermTheme.accent,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              boxShadow: `0 4px 16px ${spermTheme.accentGlow}`,
            }}
          >
            {isLast ? "Let's Play!" : 'Next'}
            {!isLast && <ChevronRight size={14} />}
          </button>
        </div>

        {/* Skip */}
        <div style={{ textAlign: 'center', paddingBottom: 12 }}>
          <button
            onClick={close}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 12,
              color: spermTheme.textTertiary,
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Skip guide
          </button>
        </div>
      </div>
    </div>
  )
}
