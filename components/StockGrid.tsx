'use client'

import { useEffect, useRef } from 'react'
import { useEvmWallet } from '@/components/WalletProvider'
import { useSessionWalletContext } from '@/context/SessionWalletContext'
import { spermTheme } from '@/components/theme/spermTheme'

// ── Layout constants ────────────────────────────────────────────────────────────
const COLUMN_WIDTH = 50
const ROW_COUNT = 30
const POINTER_LEFT_FRAC = 0.30
const MAX_HISTORY = 4000


// ── Colour palette ──────────────────────────────────────────────────────────────
const C = {
  bg: spermTheme.bgBase,
  gridLine: 'rgba(245,245,242,0.05)',
  dot: 'rgba(245,245,242,0.18)',
  multDim: 'rgba(245,245,242,0.40)',
  multMid: 'rgba(245,245,242,0.70)',
  multActive: 'rgba(245,245,242,1)',
  line: 'rgba(245,245,242,0.82)',
  lineGlow: 'rgba(197,140,255,0.18)',
  pastBox: 'rgba(197,140,255,',
  pointer: 'rgba(245,245,242,0.85)',
  header: 'rgba(15,12,26,0.92)',
  headerLine: 'rgba(245,245,242,0.18)',
  title: spermTheme.textPrimary,
  liveGreen: spermTheme.success,
  liveRed: spermTheme.error,
  hoverFill: 'rgba(197,140,255,0.09)',
  hoverBorder: 'rgba(245,245,242,0.55)',
  selFill: 'rgba(197,140,255,0.16)',
  selBorder: 'rgba(197,140,255,0.72)',
  vrfWinRow: 'rgba(197,140,255,0.14)',
  vrfWinBorder: 'rgba(197,140,255,0.48)',
}

// ── Ghost colors (single-hue neutral/orchid variants for other users' selections) ─
const GHOST_COLORS = [
  { fill: 'rgba(245,245,242,0.05)', border: 'rgba(245,245,242,0.20)', text: 'rgba(245,245,242,0.56)' },
  { fill: 'rgba(197,140,255,0.06)', border: 'rgba(197,140,255,0.24)', text: 'rgba(214,182,244,0.64)' },
  { fill: 'rgba(197,140,255,0.08)', border: 'rgba(197,140,255,0.30)', text: 'rgba(221,193,247,0.70)' },
  { fill: 'rgba(197,140,255,0.10)', border: 'rgba(197,140,255,0.34)', text: 'rgba(229,208,250,0.74)' },
  { fill: 'rgba(197,140,255,0.12)', border: 'rgba(197,140,255,0.38)', text: 'rgba(236,220,252,0.78)' },
]
const MAX_GHOST_BOXES = 5

// ── Types ───────────────────────────────────────────────────────────────────────
interface Box { id: string; multiplier: number; mult_num?: number; mult_den?: number }
interface GridColumn { id: string; x: number; boxes: Box[] }
interface PtPoint { x: number; y: number }
interface VisitedCol { minRow: number; maxRow: number; leaveTime: number | null }

// ── Component ───────────────────────────────────────────────────────────────────
export default function StockGrid() {
  const { address } = useEvmWallet()
  const { sessionAddress } = useSessionWalletContext()
  const walletRef = useRef<string | null>(null)
  const sessionWalletRef = useRef<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const wsRef = useRef<WebSocket | null>(null)
  const selectSfx = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    selectSfx.current = new Audio('/creatorshome-video-game-select-337214.mp3')
    selectSfx.current.volume = 0.5
  }, [])

  const state = useRef({
    history: [] as PtPoint[],
    columns: [] as GridColumn[],
    currentX: 0,
    lastPtr: null as { y: number } | null,
    connected: false,
    W: 0, H: 0,
    visitedCols: new Map<number, VisitedCol>(),
    prevColX: -1,
    renderedCols: new Set<string>(),
    pointerCount: 0,
    lastPointerTime: 0,
    hoverBox: null as { colX: number; row: number } | null,
    // key = `${colX}_${row}`
    selections: new Map<string, { colX: number; row: number; result: 'pending' | 'win' | 'lose'; resultTime: number }>(),
    lastResult: null as 'win' | 'lose' | null,
    lastResultTime: 0,
    // vrfPath: colX → winning row (0–9)
    vrfPath: new Map<number, number>(),
    // Ghost selections from other users: key → Set<shortAddr>
    // We only display up to 5 sampled unique (colX,row) boxes
    ghostAll: new Map<string, Set<string>>(),   // key → Set<shortAddr>
    ghostVisible: new Map<string, number>(),         // key → ghost color index (0–4)
    currentPrice: 0,
    lerpY: 0.5, // Client-side interpolated Y for smoothness
  })

  // ── Resize ──────────────────────────────────────────────────────────────────
  function resize() {
    const c = canvasRef.current, d = containerRef.current
    if (!c || !d) return
    const { width, height } = d.getBoundingClientRect()
    c.width = Math.floor(width)
    c.height = Math.floor(height)
    state.current.W = c.width
    state.current.H = c.height
  }

  function yToRow(ny: number): number {
    return Math.max(0, Math.min(ROW_COUNT - 1, ROW_COUNT - 1 - Math.floor(ny * ROW_COUNT)))
  }

  // ── Draw ─────────────────────────────────────────────────────────────────────
  function draw() {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    const s = state.current
    const W = s.W, H = s.H
    if (!W || !H) return

    const rowH = H / ROW_COUNT
    const rightMargin = Math.round(W * (1 - POINTER_LEFT_FRAC))
    const viewX = s.currentX - (W - rightMargin)
    const now = Date.now()
    const roundRadius = Math.min(10, rowH * 0.34)

    const drawRoundedRect = (x: number, y: number, w: number, h: number, radius: number) => {
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, radius)
    }

    const curColX = Math.floor(s.currentX / COLUMN_WIDTH) * COLUMN_WIDTH
    const curRow = s.lastPtr ? yToRow(s.lastPtr.y) : -1

    // 1. Background
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, W, H)

    // 2. Grid lines — (structural lines hidden)


    // 3. Per-column content
    // Box is selectable if its colX is strictly ahead of the pointer's current column
    const sels = s.selections
    const hovBox = s.hoverBox

    for (const col of s.columns) {
      const sx = col.x - viewX
      if (sx < -COLUMN_WIDTH || sx > W + COLUMN_WIDTH) continue
      if (!s.renderedCols.has(col.id)) s.renderedCols.add(col.id)

      const visited = s.visitedCols.get(col.x)
      const isCurrent = col.x === curColX
      const isSelectable = col.x > curColX + (COLUMN_WIDTH * 10)   // block 10 columns ahead for safety
      for (let r = 0; r < ROW_COUNT; r++) {
        const boxTop = (ROW_COUNT - 1 - r) * rowH
        const mult = col.boxes[r]?.multiplier ?? 1.5
        const selKey = `${col.x}_${r}`
        const sel = sels.get(selKey)
        const isPending = sel?.result === 'pending'
        const isResolved = sel && sel.result !== 'pending'
        const isHovered = hovBox?.colX === col.x && hovBox.row === r && !isPending

        // Intersection dot
        ctx.fillStyle = C.dot
        ctx.beginPath()
        ctx.arc(sx, boxTop, 2.2, 0, Math.PI * 2)
        ctx.fill()

        // Visited / active highlight
        let drewYellow = false
        if (visited && r >= visited.minRow && r <= visited.maxRow) {
          let alpha = 1
          if (!isCurrent && visited.leaveTime !== null) {
            const age = (now - visited.leaveTime) / 1000
            alpha = Math.max(0, 1 - age / 6)
          }
          if (alpha > 0.01) {
            const isExactRow = isCurrent && r === curRow
            const fillAlpha = isExactRow ? 0.20 : isCurrent ? 0.14 : Math.min(0.12, alpha * 0.10)
            const borderAlpha = isExactRow ? 0.75 : isCurrent ? 0.42 : Math.min(0.34, alpha * 0.30)

            ctx.fillStyle = C.pastBox + fillAlpha.toFixed(2) + ')'
            drawRoundedRect(sx + 1.5, boxTop + 1.5, COLUMN_WIDTH - 3, rowH - 3, roundRadius)
            ctx.fill()

            ctx.strokeStyle = isExactRow
              ? 'rgba(245,245,242,0.82)'
              : isCurrent
                ? `rgba(197,140,255,${borderAlpha.toFixed(2)})`
                : `rgba(245,245,242,${borderAlpha.toFixed(2)})`
            ctx.lineWidth = isExactRow ? 1.8 : 1.2
            drawRoundedRect(sx + 1.5, boxTop + 1.5, COLUMN_WIDTH - 3, rowH - 3, roundRadius)
            ctx.stroke()

            ctx.fillStyle = isExactRow ? C.multActive : C.multMid
            ctx.font = isExactRow ? `600 13px Inter, sans-serif` : `500 12px Inter, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(`${mult}×`, sx + COLUMN_WIDTH / 2, boxTop + rowH / 2)
            ctx.textBaseline = 'alphabetic'
            drewYellow = true
            if (!sel) continue
          }
        }

        // Selection result flash (win / lose)
        if (isResolved && sel) {
          const age = (now - sel.resultTime) / 1000
          const alpha = Math.max(0, 1 - age / 2.5)
          if (alpha > 0.01) {
            ctx.fillStyle = sel.result === 'win'
              ? `rgba(152,214,194,${(alpha * 0.22).toFixed(2)})`
              : `rgba(227,150,170,${(alpha * 0.22).toFixed(2)})`
            drawRoundedRect(sx + 1.5, boxTop + 1.5, COLUMN_WIDTH - 3, rowH - 3, roundRadius)
            ctx.fill()
            ctx.strokeStyle = sel.result === 'win'
              ? `rgba(152,214,194,${(alpha * 0.84).toFixed(2)})`
              : `rgba(227,150,170,${alpha.toFixed(2)})`
            ctx.lineWidth = 1.8
            drawRoundedRect(sx + 1.5, boxTop + 1.5, COLUMN_WIDTH - 3, rowH - 3, roundRadius)
            ctx.stroke()
          }
          continue
        }

        // Pending selection — with pulse animation
        if (isPending) {
          const pulse = (Math.sin(now / 200) + 1) / 2
          ctx.fillStyle = C.selFill
          drawRoundedRect(sx + 1.5, boxTop + 1.5, COLUMN_WIDTH - 3, rowH - 3, roundRadius)
          ctx.fill()

          ctx.strokeStyle = `rgba(197, 140, 255, ${0.45 + pulse * 0.45})`
          ctx.lineWidth = 1.8 + pulse * 0.8
          drawRoundedRect(sx + 1.5, boxTop + 1.5, COLUMN_WIDTH - 3, rowH - 3, roundRadius)
          ctx.stroke()

          // Selection glow
          ctx.shadowColor = 'rgba(197, 140, 255, 0.5)'
          ctx.shadowBlur = 10 + pulse * 10
          ctx.stroke()
          ctx.shadowBlur = 0
          ctx.save()
          ctx.shadowColor = spermTheme.accentGlow
          ctx.shadowBlur = 8
          ctx.fillStyle = C.multActive
          ctx.font = `600 12px Inter, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${mult}×`, sx + COLUMN_WIDTH / 2, boxTop + rowH / 2)
          ctx.restore()
          ctx.textBaseline = 'alphabetic'
          continue
        }

        // Hover in selectable zone
        if (isHovered && isSelectable) {
          ctx.fillStyle = C.hoverFill
          drawRoundedRect(sx + 1.5, boxTop + 1.5, COLUMN_WIDTH - 3, rowH - 3, roundRadius)
          ctx.fill()
          ctx.strokeStyle = C.hoverBorder
          ctx.lineWidth = 1.3
          drawRoundedRect(sx + 1.5, boxTop + 1.5, COLUMN_WIDTH - 3, rowH - 3, roundRadius)
          ctx.stroke()
          ctx.save()
          ctx.shadowColor = 'rgba(245,245,242,0.36)'
          ctx.shadowBlur = 6
          ctx.fillStyle = C.multMid
          ctx.font = `600 11px Inter, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${mult}×`, sx + COLUMN_WIDTH / 2, boxTop + rowH / 2)
          ctx.restore()
          ctx.textBaseline = 'alphabetic'
          continue
        }

        if (drewYellow) continue

        // Ghost selections from other users (dim, distinct colors, no own selection on this box)
        if (!isPending && !isResolved) {
          const ghostColorIdx = s.ghostVisible.get(selKey)
          if (ghostColorIdx !== undefined) {
            const gc = GHOST_COLORS[ghostColorIdx % GHOST_COLORS.length]
            ctx.fillStyle = gc.fill
            drawRoundedRect(sx + 1.5, boxTop + 1.5, COLUMN_WIDTH - 3, rowH - 3, roundRadius)
            ctx.fill()
            ctx.strokeStyle = gc.border
            ctx.lineWidth = 1.2
            ctx.setLineDash([4, 3])
            drawRoundedRect(sx + 1.5, boxTop + 1.5, COLUMN_WIDTH - 3, rowH - 3, roundRadius)
            ctx.stroke()
            ctx.setLineDash([])
            ctx.save()
            ctx.shadowColor = gc.border
            ctx.shadowBlur = 4
            ctx.fillStyle = gc.text
            ctx.font = `500 11px Inter, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(`${mult}×`, sx + COLUMN_WIDTH / 2, boxTop + rowH / 2)
            ctx.restore()
            ctx.textBaseline = 'alphabetic'
            continue
          }
        }

        // Normal multiplier text — restrained hierarchy
        ctx.save()
        const multColor = isSelectable ? C.multMid : isCurrent ? C.multMid : C.multDim
        ctx.shadowColor = isSelectable ? 'rgba(245,245,242,0.16)' : 'rgba(245,245,242,0.08)'
        ctx.shadowBlur = isSelectable ? 4 : 2
        ctx.fillStyle = multColor
        ctx.font = isSelectable ? '600 11px Inter, sans-serif' : '500 11px Inter, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${mult}×`, sx + COLUMN_WIDTH / 2, boxTop + rowH / 2)
        ctx.restore()
        ctx.textBaseline = 'alphabetic'
      }

      // (Bottom edge dot hidden)
    }

    // 4. (History line hidden)


    // 5. Pointer — sperm shape (anatomical head + fluid tail)
    const last2 = s.history[s.history.length - 1]
    const dotX = last2.x - viewX

    // Smoothly interpolate the Y position on every frame
    const targetY = last2.y
    s.lerpY += (targetY - s.lerpY) * 0.15 // Adjust the speed of the "chase"
    const dotY = s.lerpY * H

    // Direction angle from previous LERP position
    const prev2 = s.history.length > 1 ? s.history[s.history.length - 2] : last2
    const angle = Math.atan2((targetY - s.lerpY) * H * 10, (last2.x - prev2.x) || 1)

    ctx.save()

    // Soft glow behind head
    const grd = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, 25)
    grd.addColorStop(0, 'rgba(197,140,255,0.28)')
    grd.addColorStop(0.4, 'rgba(255,255,255,0.1)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grd
    ctx.beginPath()
    ctx.arc(dotX, dotY, 25, 0, Math.PI * 2)
    ctx.fill()

    // Draw tail — complex wave propagation backward from head
    const TAIL_SEGS = 24
    const TAIL_LEN = 45
    const MAX_WIDTH = 2.4
    const BORDER_PAD = 1.4
    const tailAngle = angle + Math.PI
    const t = Date.now() / 150

    // Turbulence: tail wiggles more when moving fast vertically
    const turbulence = Math.min(1.5, Math.abs(targetY - s.lerpY) * 50)

    const segs: { x0: number; y0: number; x1: number; y1: number; frac: number }[] = []
    for (let i = 0; i < TAIL_SEGS; i++) {
      const t0 = i / TAIL_SEGS
      const t1 = (i + 1) / TAIL_SEGS
      const d0 = t0 * TAIL_LEN, d1 = t1 * TAIL_LEN

      // Multi-frequency wave amplified by turbulence
      const amp0 = (t0 * 6.5) * (1 + turbulence)
      const amp1 = (t1 * 6.5) * (1 + turbulence)
      const wave0 = Math.sin(t - t0 * 6) * amp0 + Math.sin(t * 0.5 - t0 * 2) * (t0 * 2)
      const wave1 = Math.sin(t - t1 * 6) * amp1 + Math.sin(t * 0.5 - t1 * 2) * (t1 * 2)

      const perp = tailAngle + Math.PI / 2
      segs.push({
        x0: dotX + Math.cos(tailAngle) * d0 + Math.cos(perp) * wave0,
        y0: dotY + Math.sin(tailAngle) * d0 + Math.sin(perp) * wave0,
        x1: dotX + Math.cos(tailAngle) * d1 + Math.cos(perp) * wave1,
        y1: dotY + Math.sin(tailAngle) * d1 + Math.sin(perp) * wave1,
        frac: t0,
      })
    }

    // Outer glow/border on tail
    for (const seg of segs) {
      const alpha = 0.28 * Math.pow(1 - seg.frac, 1.2)
      ctx.strokeStyle = `rgba(197,140,255,${alpha.toFixed(2)})`
      ctx.lineWidth = (MAX_WIDTH + BORDER_PAD) * (1 - seg.frac)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(seg.x0, seg.y0)
      ctx.lineTo(seg.x1, seg.y1)
      ctx.stroke()
    }

    // Pearl core on tail
    for (const seg of segs) {
      const alpha = 0.7 * (1 - seg.frac)
      ctx.strokeStyle = `rgba(245,245,242,${alpha.toFixed(2)})`
      ctx.lineWidth = MAX_WIDTH * Math.pow(1 - seg.frac, 0.8)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(seg.x0, seg.y0)
      ctx.lineTo(seg.x1, seg.y1)
      ctx.stroke()
    }

    // anatomical head (egg-shaped)
    ctx.translate(dotX, dotY)
    ctx.rotate(angle)

    // Draw head using a Bezier curve for an "egg" shape (thicker at front)
    const headW = 10, headH = 7.5
    ctx.beginPath()
    // Front (top of egg)
    ctx.moveTo(headW, 0)
    // Top curve
    ctx.bezierCurveTo(headW, -headH, -headW * 0.5, -headH, -headW, 0)
    // Bottom curve
    ctx.bezierCurveTo(-headW * 0.5, headH, headW, headH, headW, 0)
    ctx.closePath()

    // Dark envelope
    ctx.fillStyle = 'rgba(16,12,26,0.95)'
    ctx.fill()

    // Pearl body
    ctx.save()
    ctx.scale(0.85, 0.82)
    ctx.beginPath()
    ctx.moveTo(headW, 0)
    ctx.bezierCurveTo(headW, -headH, -headW * 0.5, -headH, -headW, 0)
    ctx.bezierCurveTo(-headW * 0.5, headH, headW, headH, headW, 0)
    ctx.closePath()
    ctx.fillStyle = C.pointer
    ctx.shadowColor = 'rgba(197,140,255,0.4)'
    ctx.shadowBlur = 8
    ctx.fill()
    ctx.restore()

    // Nucleus / internal detail
    ctx.beginPath()
    ctx.ellipse(2, 0, 3, 2.2, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(197,140,255,0.3)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 0.5
    ctx.stroke()

    ctx.restore()

    if (s.lastPtr) {
      const lblW = 85, lblH = Math.min(rowH * 0.76, 26)
      const lblX = dotX + 8
      const lblY = Math.max(2, Math.min(H - lblH - 2, dotY - lblH / 2))
      ctx.fillStyle = spermTheme.bgGlassStrong
      ctx.fillRect(lblX, lblY, lblW, lblH)
      ctx.strokeStyle = 'rgba(245,245,242,0.45)'
      ctx.lineWidth = 1.2
      ctx.strokeRect(lblX + 0.75, lblY + 0.75, lblW - 1.5, lblH - 1.5)

      ctx.fillStyle = 'rgba(245,245,242,0.88)'
      ctx.font = `700 11px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const priceStr = s.currentPrice > 0 ? `$${s.currentPrice.toFixed(6)}` : `ROW ${yToRow(s.lastPtr.y)}`
      ctx.fillText(priceStr, lblX + lblW / 2, lblY + lblH / 2)
      ctx.textBaseline = 'alphabetic'
    }

    // 6. Prediction Ghost Path (if hovering)
    if (s.hoverBox) {
      const hX = s.hoverBox.colX + COLUMN_WIDTH / 2
      const hY = H - (s.hoverBox.row + 0.5) * rowH

      // Calculate a "predicted" curve from head to hover target
      const dx = hX - dotX
      const dy = hY - dotY

      ctx.save()
      ctx.setLineDash([5, 5])
      ctx.strokeStyle = 'rgba(197, 140, 255, 0.25)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(dotX, dotY)
      // Quadratic curve for a more organic path
      ctx.quadraticCurveTo(dotX + dx * 0.5, dotY, hX, hY)
      ctx.stroke()
      ctx.restore()

      // Ghost target highlight
      ctx.fillStyle = 'rgba(197, 140, 255, 0.08)'
      const hSX = hX - COLUMN_WIDTH / 2 - viewX
      const hSY = H - (s.hoverBox.row + 1) * rowH
      drawRoundedRect(hSX + 1.5, hSY + 1.5, COLUMN_WIDTH - 3, rowH - 3, roundRadius)
      ctx.fill()
    }

    // 7. Live Price Badge (Top Left)
    if (s.currentPrice > 0) {
      const badgeW = 140, badgeH = 36, badgeX = 20, badgeY = 20
      ctx.save()

      // Glass effect background
      ctx.fillStyle = 'rgba(16, 12, 26, 0.75)'
      drawRoundedRect(badgeX, badgeY, badgeW, badgeH, 6)
      ctx.fill()
      ctx.strokeStyle = 'rgba(197, 140, 255, 0.4)'
      ctx.lineWidth = 1.2
      ctx.stroke()

      // Live indicator (pulsing red/green dot)
      const pulse = (Math.sin(Date.now() / 300) + 1) / 2
      ctx.fillStyle = `rgba(255, 60, 100, ${0.4 + pulse * 0.6})`
      ctx.beginPath()
      ctx.arc(badgeX + 15, badgeY + badgeH / 2, 4, 0, Math.PI * 2)
      ctx.fill()

      // Text
      ctx.fillStyle = '#fff'
      ctx.font = '700 14px "JetBrains Mono", monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(`$${s.currentPrice.toFixed(6)}`, badgeX + 28, badgeY + badgeH / 2)

      ctx.restore()
    }

    // 7. Win / Lose toast
    if (s.lastResult !== null) {
      const age = (now - s.lastResultTime) / 1000
      const alpha = Math.max(0, 1 - age / 2.5)
      if (alpha > 0.01) {
        const isWin = s.lastResult === 'win'
        const toastW = 180, toastH = 52
        const toastX = (W - toastW) / 2
        const toastY = H / 2 - toastH / 2
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.fillStyle = isWin ? spermTheme.bgElevated : 'rgba(40,22,30,0.92)'
        ctx.fillRect(toastX, toastY, toastW, toastH)
        ctx.strokeStyle = isWin ? spermTheme.success : spermTheme.error
        ctx.lineWidth = 1.6
        ctx.strokeRect(toastX + 1, toastY + 1, toastW - 2, toastH - 2)
        ctx.fillStyle = isWin ? spermTheme.success : spermTheme.error
        ctx.font = `700 24px Inter, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(isWin ? '✓  WIN' : '✗  MISS', W / 2, toastY + toastH / 2)
        ctx.restore()
      }
    }

    ctx.textBaseline = 'alphabetic'
  }

  // ── Render loop ──────────────────────────────────────────────────────────────
  function loop() {
    try { draw() } catch (e) { console.error('[DRAW ERROR]', e) }
    const s = state.current
    if (s.lastPointerTime > 0 && Date.now() - s.lastPointerTime > 5000) {
      console.warn(`[POINTER STALL] No pointer event in ${((Date.now() - s.lastPointerTime) / 1000).toFixed(1)}s`)
      s.lastPointerTime = Date.now()
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  // Keep walletRef current so WS closure can access it without re-connecting
  useEffect(() => { walletRef.current = address ?? null }, [address])
  useEffect(() => { sessionWalletRef.current = sessionAddress ?? null }, [sessionAddress])

  // ── Mount ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    // Re-measure after the left rail collapses/expands (transition is 220ms)
    const onRailWidth = () => setTimeout(resize, 240)
    window.addEventListener('sprmfun:railwidth', onRailWidth)

    // ResizeObserver for robust container-size tracking (sidebar toggle, etc.)
    let resizeObserver: ResizeObserver | null = null
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => resize())
      resizeObserver.observe(containerRef.current)
    }

    const s = state.current
    let unmounted = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let activeWs: WebSocket | null = null

    // Pick up to MAX_GHOST_BOXES unique box keys from ghostAll, assign stable color indices
    function resampleGhosts(st: typeof s) {
      const allKeys = Array.from(st.ghostAll.keys())
      const picked = allKeys.length <= MAX_GHOST_BOXES
        ? allKeys
        : allKeys.sort(() => Math.random() - 0.5).slice(0, MAX_GHOST_BOXES)
      const next = new Map<string, number>()
      const usedColors = new Set<number>()
      // First pass: preserve colors for keys that are staying
      for (const key of picked) {
        const existing = st.ghostVisible.get(key)
        if (existing !== undefined) { next.set(key, existing); usedColors.add(existing) }
      }
      // Second pass: assign unused colors to new keys
      let colorIdx = 0
      for (const key of picked) {
        if (next.has(key)) continue
        while (usedColors.has(colorIdx % GHOST_COLORS.length)) colorIdx++
        const c = colorIdx % GHOST_COLORS.length
        next.set(key, c)
        usedColors.add(c)
        colorIdx++
      }
      st.ghostVisible = next
    }

    function connect() {
      if (unmounted) return
      const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001')
      activeWs = ws

      ws.onopen = () => { s.connected = true; wsRef.current = ws; console.log('[WS] connected') }
      ws.onerror = () => { s.connected = false }
      ws.onclose = () => {
        s.connected = false
        activeWs = null
        wsRef.current = null
        if (!unmounted) {
          console.log('[WS] disconnected — retrying in 2s…')
          retryTimer = setTimeout(connect, 2000)
        }
      }

      ws.onmessage = (evt) => {
        let data: any
        try { data = JSON.parse(evt.data) } catch { return }

        if (data.type === 'init') {
          // Request initial vault balance sync for session wallet
          if (sessionWalletRef.current) {
            ws.send(JSON.stringify({ type: 'request_vault_balance', user: sessionWalletRef.current }))
          }
          s.renderedCols.clear()
          s.pointerCount = 0
          s.lastPointerTime = 0
          s.visitedCols.clear()

          s.columns = (data.columns as any[]).map((col: any) => ({
            id: col.id, x: col.x as number, boxes: col.boxes as Box[],
          }))
          s.history = (data.history as any[]).map((pt: any) => ({
            x: pt.x as number, y: 1 - (pt.y as number),
          }))
          s.currentX = data.currentX as number
          s.prevColX = Math.floor(s.currentX / COLUMN_WIDTH) * COLUMN_WIDTH

          for (const pt of s.history) {
            const colX = Math.floor(pt.x / COLUMN_WIDTH) * COLUMN_WIDTH
            const row = yToRow(pt.y)
            const existing = s.visitedCols.get(colX)
            if (!existing) {
              s.visitedCols.set(colX, { minRow: row, maxRow: row, leaveTime: Date.now() - 5000 })
            } else {
              existing.minRow = Math.min(existing.minRow, row)
              existing.maxRow = Math.max(existing.maxRow, row)
            }
          }

        } else if (data.type === 'pointer') {
          s.currentPrice = data.price as number
          window.dispatchEvent(new CustomEvent('sprmfun:price', { detail: { price: s.currentPrice } }))
          s.currentX = data.currentX as number
          s.lastPointerTime = Date.now()
          s.pointerCount++
          if (s.pointerCount % 100 === 0) {
            const maxColX = s.columns.reduce((m, c) => Math.max(m, c.x), 0)
            const aheadCols = Math.round((maxColX - s.currentX) / COLUMN_WIDTH)
            console.log(`[PTR] tick=${s.pointerCount}  currentX=${Math.round(s.currentX)}  cols=${s.columns.length}  ahead=${aheadCols} cols`)
          }

          const pt: PtPoint = { x: s.currentX, y: 1 - (data.y as number) }
          s.history.push(pt)
          if (s.history.length > MAX_HISTORY) s.history.shift()
          s.lastPtr = { y: pt.y }

          const colX = Math.floor(s.currentX / COLUMN_WIDTH) * COLUMN_WIDTH
          const row = yToRow(pt.y)

          if (colX !== s.prevColX) {
            const prev = s.visitedCols.get(s.prevColX)
            if (prev) prev.leaveTime = Date.now()
            s.prevColX = colX
          }

          const existing = s.visitedCols.get(colX)
          if (!existing) {
            s.visitedCols.set(colX, { minRow: row, maxRow: row, leaveTime: null })
          } else {
            existing.minRow = Math.min(existing.minRow, row)
            existing.maxRow = Math.max(existing.maxRow, row)
            existing.leaveTime = null
          }

          const pruneBeforeX = colX - 30 * COLUMN_WIDTH
          for (const [k] of s.visitedCols) {
            if (k < pruneBeforeX) s.visitedCols.delete(k)
          }

          // Prune ghost selections for columns the pointer has already passed
          let ghostChanged = false
          for (const [gkey] of s.ghostAll) {
            const gColX = parseInt(gkey.split('_')[0])
            if (gColX < colX - COLUMN_WIDTH) { s.ghostAll.delete(gkey); ghostChanged = true }
          }
          if (ghostChanged) resampleGhosts(s)

        } else if (data.type === 'grid') {
          ; (data.columns as any[]).forEach((col: any) => {
            s.columns.push({ id: col.id, x: col.x as number, boxes: col.boxes as Box[] })
          })
          const pruneBeforeX = s.currentX - 2 * (s.W || 1920)
          const pruneAfterX = s.currentX + 55 * COLUMN_WIDTH
          s.columns = s.columns.filter(col => col.x >= pruneBeforeX && col.x <= pruneAfterX)
          const maxColX = s.columns.reduce((m, c) => Math.max(m, c.x), 0)
          const aheadCols = Math.round((maxColX - s.currentX) / COLUMN_WIDTH)
          console.log(`[GRID] rcvd ${(data.columns as any[]).length} cols  total=${s.columns.length}  currentX=${Math.round(s.currentX)}  maxColX=${maxColX}  ahead=${aheadCols} cols`)

        } else if (data.type === 'vrf_state') {
          // Sent on connect with already-known VRF paths
          for (const { colX, row } of (data.paths as { colX: number; row: number }[] ?? [])) {
            s.vrfPath.set(colX, row)
          }

        } else if (data.type === 'path_revealed') {
          // Server pushed new VRF paths: [{ colX, row }, ...]
          const paths = data.paths as { colX: number; row: number }[]
          for (const { colX, row } of paths) {
            s.vrfPath.set(colX, row)
          }

          // Resolve any pending selections whose column is now revealed
          const now2 = Date.now()
          for (const [key, sel] of s.selections) {
            if (sel.result !== 'pending') continue
            const winRow = s.vrfPath.get(sel.colX)
            if (winRow === undefined) continue
            // Only resolve if pointer has passed this column
            if (s.currentX < sel.colX + COLUMN_WIDTH) continue
            sel.result = (sel.row === winRow) ? 'win' : 'lose'
            sel.resultTime = now2
            s.lastResult = sel.result
            s.lastResultTime = now2
            const k = key
            setTimeout(() => { s.selections.delete(k) }, 3000)
          }

        } else if (data.type === 'bet_resolved') {
          // Server confirms on-chain resolution — update visual if not already resolved
          const key = `${data.box_x}_${data.box_row}`
          const sel = s.selections.get(key)
          const now2 = Date.now()
          const result = data.won ? 'win' as const : 'lose' as const
          if (sel && sel.result === 'pending') {
            sel.result = result
            sel.resultTime = now2
          }
          // Only show toast for bets belonging to this wallet (primary or session)
          const isMyBet = (walletRef.current && data.user === walletRef.current) ||
            (sessionWalletRef.current && data.user === sessionWalletRef.current)
          if (isMyBet) {
            s.lastResult = result
            s.lastResultTime = now2
          }
          setTimeout(() => { s.selections.delete(key) }, 3000)

          // Notify sidebar — leaderboard data comes from server via 'leaderboard' message
          console.log(`[LB] bet_resolved user=${(data.user as string)?.slice(0, 8)} won=${data.won} payout=${data.payout ?? 0}`)
          window.dispatchEvent(new CustomEvent('sprmfun:betresult', { detail: data }))

        } else if (data.type === 'vault_balance') {
          // Relay off-chain balance to hooks/HUD
          window.dispatchEvent(new CustomEvent('sprmfun:vault_balance', { detail: data }))

        } else if (data.type === 'bet_resolve_failed') {
          // Server failed to resolve bet on-chain — notify session wallet to refresh
          console.warn(`[BET] resolve failed for user=${(data.user as string)?.slice(0, 8)} error=${data.error}`)
          window.dispatchEvent(new CustomEvent('sprmfun:betresolvefailed', { detail: data }))

        } else if (data.type === 'ghost_snapshot') {
          s.ghostAll.clear()
          for (const { colX, row, shortAddr } of (data.entries as any[])) {
            const key = `${colX}_${row}`
            if (!s.ghostAll.has(key)) s.ghostAll.set(key, new Set())
            s.ghostAll.get(key)!.add(shortAddr)
          }
          resampleGhosts(s)

        } else if (data.type === 'ghost_select') {
          const key = `${data.colX}_${data.row}`
          if (!s.ghostAll.has(key)) s.ghostAll.set(key, new Set())
          s.ghostAll.get(key)!.add(data.shortAddr as string)
          resampleGhosts(s)

        } else if (data.type === 'ghost_deselect') {
          const key = `${data.colX}_${data.row}`
          const set = s.ghostAll.get(key)
          if (set) {
            set.delete(data.shortAddr as string)
            if (set.size === 0) s.ghostAll.delete(key)
          }
          resampleGhosts(s)
        }
      }
    }

    connect()
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      unmounted = true
      if (retryTimer) clearTimeout(retryTimer)
      if (activeWs) activeWs.close()
      cancelAnimationFrame(rafRef.current)
      if (resizeObserver) resizeObserver.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('sprmfun:railwidth', onRailWidth)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Mouse interaction ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return
    const canvas: HTMLCanvasElement = canvasRef.current
    const s = state.current

    function getBoxAt(mouseX: number, mouseY: number): { colX: number; row: number } | null {
      const W = s.W, H = s.H
      if (!W || !H) return null
      const rightMargin = Math.round(W * (1 - POINTER_LEFT_FRAC))
      const viewX = s.currentX - (W - rightMargin)
      const rowH = H / ROW_COUNT
      const absX = mouseX + viewX
      const colX = Math.floor(absX / COLUMN_WIDTH) * COLUMN_WIDTH
      const curColX = Math.floor(s.currentX / COLUMN_WIDTH) * COLUMN_WIDTH
      // Selectable: must be at least 10 columns ahead
      if (colX <= curColX + 10 * COLUMN_WIDTH) return null
      const row = Math.max(0, Math.min(ROW_COUNT - 1, ROW_COUNT - 1 - Math.floor(mouseY / rowH)))
      return { colX, row }
    }

    function onMouseMove(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      const box = getBoxAt(e.clientX - rect.left, e.clientY - rect.top)
      s.hoverBox = box
      canvas.style.cursor = box ? 'pointer' : 'default'
    }

    function sendGhost(type: 'ghost_select' | 'ghost_deselect', colX: number, row: number) {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const shortAddr = walletRef.current
        ? `${walletRef.current.slice(0, 4)}…${walletRef.current.slice(-4)}`
        : `anon-${Math.abs(colX ^ row)}`
      ws.send(JSON.stringify({ type, colX, row, shortAddr }))
    }

    function onClick(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect()
      const box = getBoxAt(e.clientX - rect.left, e.clientY - rect.top)
      if (!box) return
      const key = `${box.colX}_${box.row}`
      const existing = s.selections.get(key)
      if (existing?.result === 'pending') {
        s.selections.delete(key)
        sendGhost('ghost_deselect', box.colX, box.row)
      } else if (!existing) {
        const col = s.columns.find(c => c.x === box.colX)
        const bdata = col?.boxes[box.row]
        s.selections.set(key, { colX: box.colX, row: box.row, result: 'pending', resultTime: 0 })
        sendGhost('ghost_select', box.colX, box.row)
        if (selectSfx.current) { selectSfx.current.currentTime = 0; selectSfx.current.play().catch(() => { }) }
        window.dispatchEvent(new CustomEvent('sprmfun:select', {
          detail: {
            colX: box.colX, row: box.row,
            multNum: bdata?.mult_num ?? 150,
            multDen: bdata?.mult_den ?? 100,
            multDisp: bdata?.multiplier ?? 1.5,
          },
        }))
      }
    }

    function onMouseLeave() {
      s.hoverBox = null
      canvas.style.cursor = 'default'
    }

    function onDeselect(e: Event) {
      const { colX, row } = (e as CustomEvent).detail
      s.selections.delete(`${colX}_${row}`)
      sendGhost('ghost_deselect', colX, row)
    }

    canvas.addEventListener('mousemove', onMouseMove)
    canvas.addEventListener('click', onClick)
    canvas.addEventListener('mouseleave', onMouseLeave)
    window.addEventListener('sprmfun:deselect', onDeselect)
    return () => {
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('sprmfun:deselect', onDeselect)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  )
}
