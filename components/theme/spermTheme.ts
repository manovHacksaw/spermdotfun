export const spermTheme = {
  bgBase: '#070610',
  bgElevated: 'rgba(15,12,26,0.82)',
  bgGlass: 'rgba(15,12,26,0.52)',
  bgGlassStrong: 'rgba(15,12,26,0.68)',
  /** Black chrome glass for header, chat, bet panels (game zone stays purple) */
  bgChrome: 'rgba(0,0,0,0.55)',
  bgChromeStrong: 'rgba(8,8,12,0.72)',
  bgChromeSoft: 'rgba(14,14,18,0.65)',
  borderChrome: 'rgba(245,245,242,0.12)',
  textPrimary: 'rgba(245,245,242,0.94)',
  textSecondary: 'rgba(245,245,242,0.70)',
  textTertiary: 'rgba(245,245,242,0.46)',
  accent: '#C58CFF',
  accentSoft: 'rgba(197,140,255,0.16)',
  accentBorder: 'rgba(197,140,255,0.45)',
  accentGlow: 'rgba(197,140,255,0.28)',
  borderSoft: 'rgba(245,245,242,0.12)',
  borderFaint: 'rgba(245,245,242,0.07)',
  success: 'rgba(152,214,194,0.92)',
  error: 'rgba(227,150,170,0.92)',
} as const

export type SpermTheme = typeof spermTheme
