'use client'

import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { spermTheme } from '@/components/theme/spermTheme'

export default function ConnectGate() {
  return (
    <div
      style={{
        position: 'relative',
        margin: '0 auto',
        maxWidth: 960,
        border: `1px solid ${spermTheme.accentBorder}`,
        borderRadius: 26,
        background: `linear-gradient(165deg, ${spermTheme.bgGlassStrong}, rgba(8,8,15,0.86))`,
        backdropFilter: 'blur(16px)',
        padding: '54px 34px',
        textAlign: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 320,
          height: 320,
          left: -90,
          top: -140,
          borderRadius: '50%',
          filter: 'blur(90px)',
          background: 'rgba(197,140,255,0.22)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 260,
          height: 260,
          right: -70,
          bottom: -120,
          borderRadius: '50%',
          filter: 'blur(80px)',
          background: 'rgba(197,140,255,0.16)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 16 }}>⚡</div>
        <h1
          style={{
            marginBottom: 12,
            color: spermTheme.textPrimary,
            fontSize: 36,
            letterSpacing: 1,
            fontWeight: 900,
            lineHeight: 1.1,
          }}
        >
          Connect Wallet To View Profile
        </h1>
        <p
          style={{
            marginBottom: 28,
            color: spermTheme.textSecondary,
            fontSize: 16,
            lineHeight: 1.6,
            maxWidth: 680,
            marginInline: 'auto',
          }}
        >
          Your stats, transfer history, profile settings, and linked session-wallet data are scoped to the active wallet address.
        </p>

        <WalletMultiButton
          style={{
            background: spermTheme.accentSoft,
            border: `1px solid ${spermTheme.accentBorder}`,
            borderRadius: 14,
            fontSize: 15,
            height: 52,
            padding: '0 24px',
            fontFamily: 'inherit',
            fontWeight: 800,
          }}
        />
      </div>
    </div>
  )
}
