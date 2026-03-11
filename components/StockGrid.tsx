'use client'

import { useEffect, useRef } from 'react'
import { useEvmWallet } from '@/components/WalletProvider'
import { useSessionWalletContext } from '@/context/SessionWalletContext'
import { spermTheme } from '@/components/theme/spermTheme'

// ── Layout constants ────────────────────────────────────────────────────────────
const COLUMN_WIDTH_BASE = 50
const ROW_HEIGHT_BASE = 45 // Base row height
const ROW_COUNT = 500
const MAX_HISTORY = 4000
const PRICE_AXIS_WIDTH = 60


// ── Colour palette — Avalanche red/black/white ──────────────────────────────────
const AVAX_RED = '#E84142'
const C = {
  bg: '#050709',                          // near-black base
  gridLine: 'rgba(255,255,255,0.04)',
  dot: 'rgba(255,255,255,0.14)',
  multDim: 'rgba(255,255,255,0.32)',
  multMid: 'rgba(255,255,255,0.65)',
  multActive: '#FFFFFF',
  line: 'rgba(255,255,255,0.80)',
  lineGlow: 'rgba(232,65,66,0.20)',
  pastBox: 'rgba(232,65,66,',             // Avalanche red visited highlight
  pointer: 'rgba(255,255,255,0.90)',
  header: 'rgba(5,7,9,0.95)',
  headerLine: 'rgba(232,65,66,0.25)',
  title: '#FFFFFF',
  liveGreen: spermTheme.success,
  liveRed: AVAX_RED,
  hoverFill: 'rgba(232,65,66,0.08)',
  hoverBorder: 'rgba(255,255,255,0.50)',
  selFill: 'rgba(232,65,66,0.18)',
  selBorder: 'rgba(232,65,66,0.80)',
  vrfWinRow: 'rgba(232,65,66,0.12)',
  vrfWinBorder: 'rgba(232,65,66,0.45)',
}

// ── Ghost colors (red variants for other users' selections) ──────────────────────
const GHOST_COLORS = [
  { fill: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.18)', text: 'rgba(255,255,255,0.50)' },
  { fill: 'rgba(232,65,66,0.05)', border: 'rgba(232,65,66,0.22)', text: 'rgba(255,140,141,0.60)' },
  { fill: 'rgba(232,65,66,0.07)', border: 'rgba(232,65,66,0.28)', text: 'rgba(255,150,151,0.66)' },
  { fill: 'rgba(232,65,66,0.09)', border: 'rgba(232,65,66,0.33)', text: 'rgba(255,160,161,0.72)' },
  { fill: 'rgba(232,65,66,0.11)', border: 'rgba(232,65,66,0.38)', text: 'rgba(255,170,171,0.78)' },
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
    lerpY: 0.0, // Client-side interpolated Y for smoothness
    lerpAngle: 0.0,
    zoom: 1.0,
    marketPaused: false,
    isMobile: false,
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
    state.current.isMobile = width < 768
    // Auto-zoom out slightly on mobile
    state.current.zoom = state.current.isMobile ? 0.85 : 1.0
  }

  function yToRow(ny: number): number {
    // ny=0 is at row 250 (center)
    // ny * 30 is the row offset from center.
    return Math.floor(ny * 30) + 250
  }

  function rowToPrice(row: number): string {
    const s = state.current
    if (s.currentPrice === 0) return `ROW ${row}`
    // Basic linear mapping for axis labels.
    // In a real app, this should match the server's price-to-Y mapping.
    // The server uses simY = (row-250)/30 roughly.
    // Let's just show the row index for now, or a mock price calculation.
    return `$${(s.currentPrice * (1 + (row - 250) * 0.0001)).toFixed(6)}`
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

    const zoom = s.zoom
    const colW = COLUMN_WIDTH_BASE * zoom
    const rowH = ROW_HEIGHT_BASE * zoom

    const ptrFrac = s.isMobile ? 0.45 : 0.30

    // Viewport calculation
    const rightMargin = Math.round(W * (1 - ptrFrac))
    const viewX = s.currentX * zoom - (W - rightMargin)

    // Vertical Camera logic: follow the interpolated pointer Y
    const ptrWorldY = (s.lerpY * 30) * rowH + (250 * rowH)
    const viewY = ptrWorldY - (H / 2)

    const now = Date.now()
    const roundRadius = Math.min(10, rowH * 0.34)

    const drawRoundedRect = (x: number, y: number, w: number, h: number, radius: number) => {
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, radius)
    }

    const curColX = Math.floor(s.currentX / COLUMN_WIDTH_BASE) * COLUMN_WIDTH_BASE
    // Use lerpY (visual pointer position) so the row highlight matches the pointer dot exactly
    const curRow = Math.floor(s.lerpY * 30) + 250

    // 1. Background
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, W, H)

    // 2. Cyber Mesh Grid
    ctx.save()
    ctx.lineWidth = 0.5
    // Horizontal lines relative to viewY
    const firstRowVisible = Math.floor(viewY / rowH)
    const lastRowVisible = Math.ceil((viewY + H) / rowH)

    for (let r = firstRowVisible; r <= lastRowVisible; r++) {
      const y = r * rowH - viewY
      const opacity = r % 5 === 0 ? 0.08 : 0.03
      ctx.strokeStyle = `rgba(232,65,66,${opacity})`
      ctx.beginPath()
      ctx.moveTo(PRICE_AXIS_WIDTH, y)
      ctx.lineTo(W, y)
      ctx.stroke()
    }
    // Vertical lines (at column boundaries)
    for (const col of s.columns) {
      const sx = col.x * zoom - viewX
      if (sx < PRICE_AXIS_WIDTH || sx > W) continue
      ctx.strokeStyle = `rgba(232,65,66,0.04)`
      ctx.beginPath()
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, H)
      ctx.stroke()
    }
    ctx.restore()


    // 3. Per-column content
    // Box is selectable if its colX is strictly ahead of the pointer's current column
    const sels = s.selections
    const hovBox = s.hoverBox

    for (const col of s.columns) {
      const sx = col.x * zoom - viewX
      if (sx < PRICE_AXIS_WIDTH - colW || sx > W + colW) continue
      if (!s.renderedCols.has(col.id)) s.renderedCols.add(col.id)

      const visited = s.visitedCols.get(col.x)
      const curColX = Math.floor(s.currentX / 50) * 50
      const isCurrent = col.x === curColX
      const isSelectable = col.x > curColX + (50 * 10)   // block 10 columns ahead for safety

      for (let r = firstRowVisible; r <= lastRowVisible; r++) {
        if (r < 0 || r >= ROW_COUNT) continue
        const boxTop = r * rowH - viewY
        const boxData = col.boxes[r]
        const mult = boxData?.multiplier ?? 1.5
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

        // Visited / active highlight — only exact current row, no past-column fills
        let drewYellow = false
        if (isCurrent && r === curRow) {
          ctx.fillStyle = C.pastBox + '0.20)'
          drawRoundedRect(sx + 1.5, boxTop + 1.5, colW - 3, rowH - 3, roundRadius)
          ctx.fill()

          ctx.strokeStyle = 'rgba(245,245,242,0.82)'
          ctx.lineWidth = 1.8
          drawRoundedRect(sx + 1.5, boxTop + 1.5, colW - 3, rowH - 3, roundRadius)
          ctx.stroke()

          ctx.fillStyle = C.multActive
          ctx.font = `800 ${13 * zoom}px 'Outfit', sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${mult}×`, sx + colW / 2, boxTop + rowH / 2)
          ctx.textBaseline = 'alphabetic'
          drewYellow = true
          if (!sel) continue
        }

        // Selection result flash (win / lose)
        if (isResolved && sel) {
          const age = (now - sel.resultTime) / 1000
          const alpha = Math.max(0, 1 - age / 2.5)
          if (alpha > 0.01) {
            ctx.fillStyle = sel.result === 'win'
              ? `rgba(152,214,194,${(alpha * 0.22).toFixed(2)})`
              : `rgba(227,150,170,${(alpha * 0.22).toFixed(2)})`
            drawRoundedRect(sx + 1.5, boxTop + 1.5, colW - 3, rowH - 3, roundRadius)
            ctx.fill()
            ctx.strokeStyle = sel.result === 'win'
              ? `rgba(152,214,194,${(alpha * 0.84).toFixed(2)})`
              : `rgba(227,150,170,${alpha.toFixed(2)})`
            ctx.lineWidth = 1.8
            drawRoundedRect(sx + 1.5, boxTop + 1.5, colW - 3, rowH - 3, roundRadius)
            ctx.stroke()
          }
          continue
        }

        // Pending selection — multi-layer pulse animation
        if (isPending) {
          const pulse = (Math.sin(now / 300) + 1) / 2   // 0→1 slow breathe
          const pulse2 = (Math.sin(now / 150) + 1) / 2   // 0→1 fast inner ring
          const cx = sx + colW / 2
          const cy = boxTop + rowH / 2

          // Layer 1: outer radial glow (large, soft)
          ctx.save()
          const outerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, colW * 0.85)
          outerGlow.addColorStop(0, `rgba(232,65,66,${(0.18 + pulse * 0.12).toFixed(2)})`)
          outerGlow.addColorStop(1, 'rgba(232,65,66,0)')
          ctx.fillStyle = outerGlow
          ctx.beginPath()
          ctx.ellipse(cx, cy, colW * 0.85, rowH * 0.85, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()

          // Layer 2: filled background — pulsing opacity
          ctx.fillStyle = `rgba(232,65,66,${(0.08 + pulse * 0.10).toFixed(2)})`
          drawRoundedRect(sx + 1.5, boxTop + 1.5, colW - 3, rowH - 3, roundRadius)
          ctx.fill()

          // Layer 3: sharp outer border with double-stroke glow
          ctx.save()
          ctx.shadowColor = 'rgba(232,65,66,0.70)'
          ctx.shadowBlur = 14 + pulse * 14
          ctx.strokeStyle = `rgba(255,90,95,${(0.55 + pulse2 * 0.40).toFixed(2)})`
          ctx.lineWidth = 1.5 + pulse2 * 1.0
          drawRoundedRect(sx + 1.5, boxTop + 1.5, colW - 3, rowH - 3, roundRadius)
          ctx.stroke()
          ctx.restore()

          // Layer 4: inner ring — tight bright pulse
          ctx.save()
          ctx.shadowColor = '#FF5A5F'
          ctx.shadowBlur = 6 + pulse2 * 8
          ctx.strokeStyle = `rgba(255,120,121,${(0.30 + pulse2 * 0.50).toFixed(2)})`
          ctx.lineWidth = 0.8
          drawRoundedRect(sx + 3, boxTop + 3, colW - 6, rowH - 6, Math.max(2, roundRadius - 1))
          ctx.stroke()
          ctx.restore()

          // Layer 5: center bright dot
          ctx.save()
          const dotR = Math.min(colW, rowH) * (0.06 + pulse * 0.03)
          const dotGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotR * 2)
          dotGrad.addColorStop(0, `rgba(255,200,200,${(0.85 + pulse * 0.15).toFixed(2)})`)
          dotGrad.addColorStop(0.4, `rgba(232,65,66,${(0.60 + pulse * 0.25).toFixed(2)})`)
          dotGrad.addColorStop(1, 'rgba(232,65,66,0)')
          ctx.fillStyle = dotGrad
          ctx.shadowColor = '#FF5A5F'
          ctx.shadowBlur = 10 + pulse * 8
          ctx.beginPath()
          ctx.arc(cx, cy, dotR * 2, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()

          // Layer 6: multiplier text — JetBrains Mono with glow
          ctx.save()
          ctx.shadowColor = 'rgba(255,90,95,0.80)'
          ctx.shadowBlur = 10 + pulse * 6
          ctx.fillStyle = `rgba(255,${Math.round(210 + pulse2 * 45)},${Math.round(210 + pulse2 * 45)},1)`
          ctx.font = `700 ${12 * zoom}px 'JetBrains Mono', monospace`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${mult}×`, cx, cy)
          ctx.restore()
          ctx.textBaseline = 'alphabetic'
          continue
        }

        // Hover in selectable zone
        if (isHovered && isSelectable) {
          ctx.fillStyle = C.hoverFill
          drawRoundedRect(sx + 1.5, boxTop + 1.5, colW - 3, rowH - 3, roundRadius)
          ctx.fill()
          ctx.strokeStyle = C.hoverBorder
          ctx.lineWidth = 1.3
          drawRoundedRect(sx + 1.5, boxTop + 1.5, colW - 3, rowH - 3, roundRadius)
          ctx.stroke()
          ctx.save()
          ctx.shadowColor = 'rgba(245,245,242,0.36)'
          ctx.shadowBlur = 6
          ctx.fillStyle = C.multMid
          ctx.font = `600 ${11 * zoom}px Inter, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${mult}×`, sx + colW / 2, boxTop + rowH / 2)
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
            ctx.strokeStyle = gc.border
            ctx.lineWidth = 1.2
            ctx.setLineDash([4, 3])
            drawRoundedRect(sx + 1.5, boxTop + 1.5, colW - 3, rowH - 3, roundRadius)
            ctx.stroke()
            ctx.setLineDash([])
            ctx.save()
            ctx.shadowColor = gc.border
            ctx.shadowBlur = 4
            ctx.fillStyle = gc.text
            ctx.font = `500 ${11 * zoom}px Inter, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(`${mult}×`, sx + colW / 2, boxTop + rowH / 2)
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
        ctx.font = isSelectable ? `600 ${11 * zoom}px Inter, sans-serif` : `500 ${11 * zoom}px Inter, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${mult}×`, sx + colW / 2, boxTop + rowH / 2)
        ctx.restore()
        ctx.textBaseline = 'alphabetic'
      }
    }

    // 4. (History line hidden)


    // 5. Pointer — sperm shape (anatomical head + fluid tail)
    if (s.history.length === 0) return
    const last2 = s.history[s.history.length - 1]
    const dotX = last2.x * zoom - viewX

    // Smoothly interpolate the Y position on every frame
    const targetY = last2.y
    s.lerpY += (targetY - s.lerpY) * 0.025 // Smoother chase — was 0.04
    const dotY = (s.lerpY * 30 + 250) * rowH - viewY

    // Direction angle from previous LERP position — with additional smoothing
    const prev2 = s.history.length > 1 ? s.history[s.history.length - 2] : last2
    const targetAngle = Math.atan2((targetY - s.lerpY) * 30 * rowH, (last2.x - prev2.x) * zoom || 1)

    // Normalize angle jump for smoothing
    if (Math.abs(targetAngle - s.lerpAngle) > Math.PI) {
      if (targetAngle > s.lerpAngle) s.lerpAngle += Math.PI * 2
      else s.lerpAngle -= Math.PI * 2
    }
    s.lerpAngle += (targetAngle - s.lerpAngle) * 0.05
    const angle = s.lerpAngle

    ctx.save()

    // Soft glow behind head
    const grd = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, 25)
    grd.addColorStop(0, 'rgba(232,65,66,0.28)')
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
    const turbulence = Math.min(0.8, Math.abs(targetY - s.lerpY) * 4)

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
      ctx.strokeStyle = `rgba(232,65,66,${alpha.toFixed(2)})`
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

    // ── Cyber Orb Head ──
    ctx.translate(dotX, dotY)
    ctx.rotate(angle)

    const headW = 10, headH = 8

    // Outer refraction glow
    const headGrd = ctx.createRadialGradient(2, 0, 0, 0, 0, 12)
    headGrd.addColorStop(0, 'rgba(255,255,255,0.4)')
    headGrd.addColorStop(0.6, 'rgba(232,65,66,0.12)')
    headGrd.addColorStop(1, 'rgba(232,65,66,0)')

    ctx.fillStyle = headGrd
    ctx.beginPath()
    ctx.ellipse(0, 0, 12, 10, 0, 0, Math.PI * 2)
    ctx.fill()

    // Sharp Cyber Shell
    ctx.beginPath()
    ctx.moveTo(headW, 0)
    ctx.bezierCurveTo(headW, -headH, -headW * 0.4, -headH, -headW, 0)
    ctx.bezierCurveTo(-headW * 0.4, headH, headW, headH, headW, 0)
    ctx.closePath()

    ctx.fillStyle = '#020205'
    ctx.fill()
    ctx.strokeStyle = 'rgba(232,65,66,0.7)'
    ctx.lineWidth = 1.2
    ctx.stroke()

    // Internal Core (Orb)
    ctx.beginPath()
    ctx.arc(2, 0, 4.5, 0, Math.PI * 2)
    const coreGrd = ctx.createLinearGradient(-4, -4, 4, 4)
    coreGrd.addColorStop(0, '#FFFFFF')
    coreGrd.addColorStop(1, '#E84142')
    ctx.fillStyle = coreGrd
    ctx.shadowColor = '#E84142'
    ctx.shadowBlur = 10
    ctx.fill()
    ctx.shadowBlur = 0

    // Glossy highlight
    ctx.beginPath()
    ctx.ellipse(3, -2, 2, 1, Math.PI / 4, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.fill()

    ctx.restore()

    if (s.lastPtr) {
      const lblW = 85, lblH = 26
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

    // ── Price Axis (Left) ──
    ctx.save()
    ctx.fillStyle = 'rgba(10, 8, 20, 0.95)'
    ctx.fillRect(0, 0, PRICE_AXIS_WIDTH, H)
    ctx.strokeStyle = spermTheme.borderChrome
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PRICE_AXIS_WIDTH, 0)
    ctx.lineTo(PRICE_AXIS_WIDTH, H)
    ctx.stroke()

    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.font = '600 10px "JetBrains Mono", monospace'

    for (let r = firstRowVisible; r <= lastRowVisible; r++) {
      if (r < 0 || r >= ROW_COUNT) continue
      const y = r * rowH - viewY
      if (r % 5 === 0) {
        ctx.fillStyle = spermTheme.textPrimary
        ctx.fillText(rowToPrice(r), PRICE_AXIS_WIDTH - 8, y)
        ctx.strokeStyle = 'rgba(232,65,66,0.30)'
        ctx.beginPath()
        ctx.moveTo(PRICE_AXIS_WIDTH - 5, y)
        ctx.lineTo(PRICE_AXIS_WIDTH, y)
        ctx.stroke()
      } else {
        ctx.strokeStyle = 'rgba(232,65,66,0.12)'
        ctx.beginPath()
        ctx.moveTo(PRICE_AXIS_WIDTH - 3, y)
        ctx.lineTo(PRICE_AXIS_WIDTH, y)
        ctx.stroke()
      }
    }
    ctx.restore()

    // 6. Prediction Ghost Path (if hovering)
    if (s.hoverBox) {
      const hX = s.hoverBox.colX * zoom + colW / 2
      const hY = s.hoverBox.row * rowH + rowH / 2 - viewY

      // Calculate a "predicted" curve from head to hover target
      const dx = hX - dotX
      const dy = hY - dotY

      ctx.save()
      ctx.setLineDash([5, 5])
      ctx.strokeStyle = 'rgba(232,65,66,0.30)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(dotX, dotY)
      // Quadratic curve for a more organic path
      ctx.quadraticCurveTo(dotX + dx * 0.5, dotY, hX, hY)
      ctx.stroke()
      ctx.restore()

      // Ghost target highlight
      ctx.fillStyle = 'rgba(232,65,66,0.08)'
      const hSX = hX - colW / 2 - viewX
      const hSY = s.hoverBox.row * rowH - viewY
      drawRoundedRect(hSX + 1.5, hSY + 1.5, colW - 3, rowH - 3, roundRadius)
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
      ctx.strokeStyle = 'rgba(232,65,66,0.45)'
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
        ctx.fillText(isWin ? '✓  WIN' : '✗  MISS', W / 2, toastY + toastH / 2)
        ctx.restore()
      }
    }

    // ── Market Pause Overlay ──
    if (s.marketPaused) {
      ctx.save()
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillRect(0, 0, W, H)

      const bannerH = 100
      ctx.fillStyle = 'rgba(10, 10, 15, 0.85)'
      ctx.fillRect(0, H / 2 - bannerH / 2, W, bannerH)

      ctx.strokeStyle = '#E84142'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, H / 2 - bannerH / 2)
      ctx.lineTo(W, H / 2 - bannerH / 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, H / 2 + bannerH / 2)
      ctx.lineTo(W, H / 2 + bannerH / 2)
      ctx.stroke()

      ctx.fillStyle = '#fff'
      ctx.font = '700 24px "Outfit", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'rgba(232, 65, 66, 0.8)'
      ctx.shadowBlur = 15
      ctx.fillText('FEED PAUSED — BETTING DISABLED', W / 2, H / 2 - 10)

      ctx.font = '500 14px "Inter", sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.shadowBlur = 0
      ctx.fillText('The price feed is temporarily stale. Waiting for Binance data...', W / 2, H / 2 + 25)
      ctx.restore()
    }
  } // End draw function

  // ── Render loop ──────────────────────────────────────────────────────────────
  function loop() {
    try { draw() } catch (e) { console.error('[DRAW ERROR]', e) }
    rafRef.current = requestAnimationFrame(loop)
  }

  // Keep walletRef current so WS closure can access it without re-connecting
  useEffect(() => { walletRef.current = address ?? null }, [address])
  useEffect(() => { sessionWalletRef.current = sessionAddress ?? null }, [sessionAddress])

  // ── Mount ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)

    // Zoom handler
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = state.current
      const delta = e.deltaY > 0 ? 0.94 : 1.06
      s.zoom = Math.max(0.7, Math.min(2.0, s.zoom * delta))
    }
    canvasRef.current?.addEventListener('wheel', onWheel, { passive: false })

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
      const getWsUrl = () => {
        if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // In production (Render/Vercel), we don't want to append :3000
        const host = window.location.hostname === 'localhost' ? 'localhost:3000' : 'spermdotfun-socket.onrender.com';
        return `${protocol}//${host}`;
      };
      const ws = new WebSocket(getWsUrl())
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
          if (typeof data.price === 'number' && data.price > 0) {
            s.currentPrice = data.price
            window.dispatchEvent(new CustomEvent('sprmfun:price', { detail: { price: s.currentPrice } }))
          }

          s.columns = (data.columns as any[]).map((col: any) => ({
            id: col.id, x: col.x as number, boxes: col.boxes as Box[],
          }))
          s.history = (data.history as any[]).map((pt: any) => ({
            x: pt.x as number, y: pt.y as number,
          }))
          s.currentX = data.currentX as number
          s.prevColX = Math.floor(s.currentX / COLUMN_WIDTH_BASE) * COLUMN_WIDTH_BASE

          for (const pt of s.history) {
            const colX = Math.floor(pt.x / COLUMN_WIDTH_BASE) * COLUMN_WIDTH_BASE
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
          if (typeof data.price === 'number' && data.price > 0) {
            s.currentPrice = data.price
            window.dispatchEvent(new CustomEvent('sprmfun:price', { detail: { price: s.currentPrice } }))
          }
          s.currentX = data.currentX as number
          s.lastPointerTime = Date.now()
          s.pointerCount++
          if (s.pointerCount % 100 === 0) {
            const maxColX = s.columns.reduce((m, c) => Math.max(m, c.x), 0)
            const aheadCols = Math.round((maxColX - s.currentX) / COLUMN_WIDTH_BASE)
            console.log(`[PTR] tick=${s.pointerCount}  currentX=${Math.round(s.currentX)}  cols=${s.columns.length}  ahead=${aheadCols} cols`)
          }

          const pt: PtPoint = { x: s.currentX, y: data.y as number }
          s.history.push(pt)
          if (s.history.length > MAX_HISTORY) s.history.shift()
          s.lastPtr = { y: pt.y }

          const colX = Math.floor(s.currentX / COLUMN_WIDTH_BASE) * COLUMN_WIDTH_BASE
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

          const pruneBeforeX = colX - 30 * COLUMN_WIDTH_BASE
          for (const [k] of s.visitedCols) {
            if (k < pruneBeforeX) s.visitedCols.delete(k)
          }

          // Prune ghost selections for columns the pointer has already passed
          let ghostChanged = false
          for (const [gkey] of s.ghostAll) {
            const gColX = parseInt(gkey.split('_')[0])
            if (gColX < colX - COLUMN_WIDTH_BASE) { s.ghostAll.delete(gkey); ghostChanged = true }
          }
          if (ghostChanged) resampleGhosts(s)

        } else if (data.type === 'grid') {
          ; (data.columns as any[]).forEach((col: any) => {
            s.columns.push({ id: col.id, x: col.x as number, boxes: col.boxes as Box[] })
          })
          const pruneBeforeX = s.currentX - 2 * (s.W || 1920)
          const pruneAfterX = s.currentX + 55 * COLUMN_WIDTH_BASE
          s.columns = s.columns.filter(col => col.x >= pruneBeforeX && col.x <= pruneAfterX)
          const maxColX = s.columns.reduce((m, c) => Math.max(m, c.x), 0)
          const aheadCols = Math.round((maxColX - s.currentX) / COLUMN_WIDTH_BASE)
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

          // Resolve pending selections speculatively.
          // RULE: Only mark definitive LOSES (head never crossed that row).
          //       WINS are NOT shown here — they are confirmed by the server's bet_resolved.
          //       This prevents the visual tail from causing false WIN flashes.
          const now2 = Date.now()
          for (const [key, sel] of s.selections) {
            if (s.currentX < sel.colX + COLUMN_WIDTH_BASE) continue
            if (sel.result !== 'pending') continue

            const visited = s.visitedCols.get(sel.colX)
            if (visited) {
              // No padding: only the exact head path counts
              const missedHead = sel.row < visited.minRow || sel.row > visited.maxRow
              if (missedHead) {
                sel.result = 'lose'
                sel.resultTime = now2
                s.lastResult = 'lose'
                s.lastResultTime = now2
                setTimeout(() => { s.selections.delete(key) }, 3000)
              }
              // potential win — leave pending for server to confirm
            } else {
              const winRow = s.vrfPath.get(sel.colX)
              if (winRow === undefined) continue
              if (sel.row !== winRow) {
                sel.result = 'lose'
                sel.resultTime = now2
                s.lastResult = 'lose'
                s.lastResultTime = now2
                setTimeout(() => { s.selections.delete(key) }, 3000)
              }
            }
          }

        } else if (data.type === 'bet_resolved') {
          // Server confirms on-chain resolution — update visual if not already resolved
          const key = `${data.box_x}_${data.box_row}`
          const sel = s.selections.get(key)
          const now2 = Date.now()
          const result = data.won ? 'win' as const : 'lose' as const
          if (sel) {
            // Allow server to override a speculative "lose" into a "win"
            if (sel.result === 'pending' || (sel.result === 'lose' && result === 'win')) {
              sel.result = result
              sel.resultTime = now2
            }
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

        } else if (data.type === 'bet_receipt') {
          // Server finished on-chain resolution
          window.dispatchEvent(new CustomEvent('sprmfun:betreceipt', { detail: data }))

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
        } else if (data.type === 'market_paused') {
          s.marketPaused = data.paused
        } else if (data.type === 'house_bank') {
          window.dispatchEvent(new CustomEvent('sprmfun:house_bank', { detail: data }))
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
      const s = state.current
      const zoom = s.zoom
      const W = s.W, H = s.H
      if (!W || !H) return null

      const ptrFrac = s.isMobile ? 0.45 : 0.30
      const rightMargin = Math.round(W * (1 - ptrFrac))
      const viewX = (s.currentX * zoom) - (W - rightMargin)
      const worldX = (mouseX + viewX) / zoom

      // Find the column that contains this world X position using actual column data
      const col = s.columns.find(c => worldX >= c.x && worldX < c.x + COLUMN_WIDTH_BASE)
      if (!col) return null

      const curColX = Math.floor(s.currentX / COLUMN_WIDTH_BASE) * COLUMN_WIDTH_BASE
      if (col.x <= curColX + 10 * COLUMN_WIDTH_BASE) return null

      const viewY = (s.lerpY * 30 + 250) * (ROW_HEIGHT_BASE * zoom) - (s.H / 2)
      const worldY = mouseY + viewY
      const row = Math.max(0, Math.min(ROW_COUNT - 1, Math.floor(worldY / (ROW_HEIGHT_BASE * zoom))))
      return { colX: col.x, row }
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

    function onClick(e: MouseEvent | TouchEvent) {
      if (s.marketPaused) return
      const rect = canvas.getBoundingClientRect()

      let clientX, clientY
      if ('touches' in e) {
        clientX = e.touches[0].clientX
        clientY = e.touches[0].clientY
      } else {
        clientX = e.clientX
        clientY = e.clientY
      }

      const box = getBoxAt(clientX - rect.left, clientY - rect.top)
      if (!box) return
      const key = `${box.colX}_${box.row}`
      const existing = s.selections.get(key)
      if (existing?.result === 'pending') {
        s.selections.delete(key)
        sendGhost('ghost_deselect', box.colX, box.row)
      } else if (!existing) {
        // Exact match first, then closest column within half column width
        let col = s.columns.find(c => c.x === box.colX)
        if (!col) {
          let bestDist = COLUMN_WIDTH_BASE / 2
          for (const c of s.columns) {
            const d = Math.abs(c.x - box.colX)
            if (d < bestDist) { bestDist = d; col = c }
          }
          if (col) console.log(`[CLICK] colX fuzzy match: wanted=${box.colX} got=${col.x}`)
        }
        const bdata = col?.boxes[box.row]
        // Diagnostics — remove once issue is resolved
        if (!col) {
          const xs = s.columns.map(c => c.x)
          console.warn(`[CLICK] ❌ Column NOT FOUND colX=${box.colX} row=${box.row}. Available: min=${Math.min(...xs)} max=${Math.max(...xs)} count=${xs.length}`)
        } else if (!bdata) {
          console.warn(`[CLICK] ❌ Box NOT FOUND col.x=${col.x} row=${box.row} boxes.length=${col.boxes.length}`)
        } else {
          console.log(`[CLICK] ✓ col=${col.x} row=${box.row} mult=${bdata.multiplier}x mult_num=${bdata.mult_num} mult_den=${bdata.mult_den}`)
        }
        const multNum = bdata?.mult_num ?? 150
        const multDen = bdata?.mult_den ?? 100
        const multDisp = bdata?.multiplier ?? 1.5
        s.selections.set(key, { colX: box.colX, row: box.row, result: 'pending', resultTime: 0 })
        sendGhost('ghost_select', box.colX, box.row)
        if (selectSfx.current) { selectSfx.current.currentTime = 0; selectSfx.current.play().catch(() => { }) }
        window.dispatchEvent(new CustomEvent('sprmfun:select', {
          detail: {
            colX: box.colX, row: box.row,
            multNum,
            multDen,
            multDisp,
          },
        }))
      }
    }

    function onTouchStart(e: TouchEvent) {
      // Basic betting interaction on tap
      onClick(e)
    }

    function onTouchMove(e: TouchEvent) {
      // Prevent scrolling while interacting with grid
      if (s.marketPaused) return
      const rect = canvas.getBoundingClientRect()
      const box = getBoxAt(e.touches[0].clientX - rect.left, e.touches[0].clientY - rect.top)
      s.hoverBox = box
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
    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('sprmfun:deselect', onDeselect)
    return () => {
      canvas.removeEventListener('mousemove', onMouseMove)
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('mouseleave', onMouseLeave)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
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
