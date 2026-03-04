export const spermTheme = {
  /** Deepest obsidian base for maximum contrast */
  bgBase: '#020205',
  /** Professional glass with neutral tint */
  bgElevated: 'rgba(10,10,14,0.85)',
  bgGlass: 'rgba(8,8,12,0.55)',
  bgGlassStrong: 'rgba(6,6,10,0.75)',

  /** Industrial gunmetal chrome for sidebars/readouts */
  bgChrome: 'rgba(0,0,0,0.62)',
  bgChromeStrong: 'rgba(4,4,6,0.82)',
  bgChromeSoft: 'rgba(12,12,16,0.58)',

  /** Ultra-thin borders for premium look */
  borderChrome: 'rgba(255,255,245,0.08)',
  borderSoft: 'rgba(255,255,245,0.06)',
  borderFaint: 'rgba(255,255,245,0.03)',

  /** High-fidelity typography colors */
  textPrimary: '#F5F5F2',
  textSecondary: 'rgba(245,245,242,0.65)',
  textTertiary: 'rgba(245,245,242,0.40)',

  /** Refined neon accent */
  accent: '#D4AAFF',
  accentSoft: 'rgba(212,170,255,0.12)',
  accentBorder: 'rgba(212,170,255,0.35)',
  accentGlow: 'rgba(212,170,255,0.22)',

  /** Semantic indicators */
  success: '#98D6C2',
  error: '#E396AA',
} as const

export type SpermTheme = typeof spermTheme
