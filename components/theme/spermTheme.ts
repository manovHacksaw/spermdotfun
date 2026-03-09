export const spermTheme = {
  /** Deep AVAX-inspired dark base */
  bgBase: '#0B0B0F',
  bgPanel: '#0F1319',
  bgCard: '#11141A',
  bgHover: '#161D26',

  /** Legacy aliases — kept for compatibility */
  bgElevated: 'rgba(15,19,25,0.96)',
  bgGlass: 'rgba(11,11,15,0.72)',
  bgGlassStrong: 'rgba(9,9,13,0.88)',
  bgChrome: 'rgba(15,19,25,0.92)',
  bgChromeStrong: 'rgba(11,11,15,0.96)',
  bgChromeSoft: 'rgba(17,20,26,0.72)',

  /** Borders */
  borderChrome: 'rgba(255,255,255,0.06)',
  borderSoft: 'rgba(255,255,255,0.04)',
  borderFaint: 'rgba(255,255,255,0.025)',
  borderAccent: 'rgba(232,65,66,0.32)',

  /** Typography */
  textPrimary: '#E6E8EB',
  textSecondary: '#9BA3AF',
  textTertiary: '#4B5563',

  /** Primary accent: Avalanche Red */
  accent: '#E84142',
  accentBright: '#FF5A5F',
  accentSoft: 'rgba(232,65,66,0.10)',
  accentBorder: 'rgba(232,65,66,0.32)',
  accentGlow: 'rgba(232,65,66,0.20)',

  /** Gold for big wins / multipliers */
  gold: '#F59E0B',
  goldSoft: 'rgba(245,158,11,0.15)',
  goldBorder: 'rgba(245,158,11,0.4)',

  /** Semantic */
  success: '#10B981',
  successSoft: 'rgba(16,185,129,0.12)',
  error: '#EF4444',
  errorSoft: 'rgba(239,68,68,0.12)',
} as const

export type SpermTheme = typeof spermTheme
