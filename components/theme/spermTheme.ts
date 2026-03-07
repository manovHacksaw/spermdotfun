export const spermTheme = {
  /** Deep navy casino base */
  bgBase: '#080B14',
  bgPanel: '#0D1120',
  bgCard: '#111827',
  bgHover: '#1a2235',

  /** Legacy aliases — kept for compatibility */
  bgElevated: 'rgba(13,17,32,0.95)',
  bgGlass: 'rgba(8,11,20,0.7)',
  bgGlassStrong: 'rgba(6,8,16,0.85)',
  bgChrome: 'rgba(13,17,32,0.9)',
  bgChromeStrong: 'rgba(8,11,20,0.95)',
  bgChromeSoft: 'rgba(17,24,39,0.7)',

  /** Casino borders */
  borderChrome: 'rgba(255,255,255,0.06)',
  borderSoft: 'rgba(255,255,255,0.04)',
  borderFaint: 'rgba(255,255,255,0.02)',
  borderAccent: 'rgba(139,92,246,0.3)',

  /** Typography */
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textTertiary: '#475569',

  /** Primary purple accent */
  accent: '#8B5CF6',
  accentBright: '#A78BFA',
  accentSoft: 'rgba(139,92,246,0.12)',
  accentBorder: 'rgba(139,92,246,0.35)',
  accentGlow: 'rgba(139,92,246,0.25)',

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
