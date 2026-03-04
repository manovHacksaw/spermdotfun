'use client'

import { type ProfileTab } from '@/lib/profile/types'
import { spermTheme } from '@/components/theme/spermTheme'

interface ProfileTabsProps {
  activeTab: ProfileTab
  onChange: (tab: ProfileTab) => void
}

const tabs: { id: ProfileTab; label: string }[] = [
  { id: 'stats', label: 'Statistics' },
  { id: 'transfer', label: 'Transfer Funds' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'settings', label: 'Settings' },
]

const disabledItems = ['Affiliates', 'Cashback', 'Fairness', 'TOS', 'FAQ']

export default function ProfileTabs({ activeTab, onChange }: ProfileTabsProps) {
  return (
    <section style={{ marginBottom: 20 }}>
      <div
        style={{
          display: 'flex',
          gap: 10,
          overflowX: 'auto',
          paddingBottom: 6,
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTab
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              style={{
                border: active ? `1px solid ${spermTheme.accentBorder}` : `1px solid ${spermTheme.borderSoft}`,
                background: active
                  ? spermTheme.accentSoft
                  : 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
                color: active ? spermTheme.accent : spermTheme.textSecondary,
                borderRadius: 12,
                padding: '12px 18px',
                fontSize: 14,
                letterSpacing: 0.4,
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: active ? `0 0 0 1px ${spermTheme.accentBorder}, 0 10px 22px rgba(90,70,120,0.22)` : 'none',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div
        style={{
          marginTop: 10,
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 4,
        }}
      >
        {disabledItems.map((label) => (
          <button
            key={label}
            disabled
            title='Coming Soon'
            style={{
              border: `1px solid ${spermTheme.borderFaint}`,
              background: 'rgba(255,255,255,0.03)',
              color: spermTheme.textTertiary,
              borderRadius: 10,
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'not-allowed',
              whiteSpace: 'nowrap',
            }}
          >
            {label} (Coming Soon)
          </button>
        ))}
      </div>
    </section>
  )
}
