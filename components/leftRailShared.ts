import type { CSSProperties } from 'react'
import { spermTheme } from '@/components/theme/spermTheme'

export const TOP_HEADER_HEIGHT = 80
export const MOBILE_BREAKPOINT = 640
export const LEFT_RAIL_BREAKPOINT = 1200
export const CHAT_PANEL_WIDTH = 280
export const BET_PANEL_WIDTH = 300
export const SINGLE_PANEL_WIDTH = 300
export const DUAL_PANEL_WIDTH = CHAT_PANEL_WIDTH + BET_PANEL_WIDTH

export type LayoutMode = 'mobile' | 'compact' | 'full'

/** Determine layout mode from viewport width */
export function getLayoutMode(vw: number): LayoutMode {
  if (vw < MOBILE_BREAKPOINT) return 'mobile'
  if (vw < LEFT_RAIL_BREAKPOINT) return 'compact'
  return 'full'
}

/** Compute sidebar pixel width for a given viewport width + bet-panel state */
export function computeRailWidth(vw: number, betOpen = true): number {
  if (vw < MOBILE_BREAKPOINT) return 0                                            // mobile overlay
  if (vw < 900) return Math.round(Math.max(220, Math.min(300, vw * 0.32)))       // narrow compact
  if (vw < LEFT_RAIL_BREAKPOINT) return SINGLE_PANEL_WIDTH                        // wide compact
  return betOpen ? DUAL_PANEL_WIDTH : CHAT_PANEL_WIDTH                            // full desktop
}

export const RAIL_COLORS = {
  border: spermTheme.borderChrome,
  accent: spermTheme.accent,
  lime: spermTheme.accent,
  green: spermTheme.success,
  text: spermTheme.textPrimary,
  textDim: spermTheme.textTertiary,
  panelBg: spermTheme.bgChrome,
  tabBg: spermTheme.bgChromeSoft,
  tabActiveBg: 'rgba(255,255,255,0.08)',
}

export const panelFrameStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'hidden',
}

export const panelBlurLayerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
}

export const panelBlurGradientStyle: CSSProperties = {
  position: 'absolute',
  inset: '-20px',
  background:
    'radial-gradient(100% 100% at 0% 0%, rgba(255,255,255,0.03) 0%, transparent 50%), radial-gradient(100% 100% at 100% 100%, rgba(10,10,14,0.4) 0%, transparent 60%)',
  filter: 'blur(20px)',
}

export const panelBlurTintStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.45)',
  backdropFilter: 'blur(32px)',
  WebkitBackdropFilter: 'blur(32px)',
  boxShadow: `inset 0 0 0 1px ${spermTheme.borderChrome}, inset 0 1px 0 rgba(255,255,255,0.03)`,
}
