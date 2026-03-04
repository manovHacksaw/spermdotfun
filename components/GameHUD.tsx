'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { ethers } from 'ethers'
import { useEvmWallet } from '@/components/WalletProvider'
import { useSessionWalletContext } from '@/context/SessionWalletContext'
import { useSprmBalance } from '@/hooks/useSprmBalance'
import { spermTheme } from '@/components/theme/spermTheme'

// ── Contract constants ────────────────────────────────────────────────────────
const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? ''
const GAME_ADDRESS = process.env.NEXT_PUBLIC_GAME_ADDRESS ?? ''
const RPC_URL = process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc'

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]

const GAME_ABI = [
  'function placeBet(uint32 boxX, uint8 boxRow, uint16 multNum, uint256 amount) returns (uint256 betId)',
  'event BetPlaced(uint256 indexed betId, address indexed player, uint32 boxX, uint8 boxRow, uint16 multNum, uint256 amount)',
]

export default function GameHUD() {
  const { address, signer, connected } = useEvmWallet()

  // Primary wallet SPRM balance
  const { balance, refresh: refreshBalance } = useSprmBalance(address)

  // Session wallet (shared context — no prop drilling)
  const session = useSessionWalletContext()

  // Bet modal state
  const [pendingBet, setPendingBet] = useState<{ colX: number; row: number; multNum: number; multDen: number; multDisp: number } | null>(null)
  const [betAmount, setBetAmount] = useState('1')
  const [betStatus, setBetStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [betError, setBetError] = useState('')

  // Bottom-right toast for instant wallet bets (no modal)
  const [sessionToast, setSessionToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const sessionToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Resolution notification popup
  const [resolution, setResolution] = useState<{ won: boolean; payout: number; txHash?: string; box_row: number } | null>(null)
  const resTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Welcome Guide
  const [showGuide, setShowGuide] = useState(false)
  useEffect(() => {
    const hasSeenGuide = localStorage.getItem('sprmfun_guide_seen')
    if (!hasSeenGuide) setShowGuide(true)
  }, [])

  const closeGuide = () => {
    localStorage.setItem('sprmfun_guide_seen', 'true')
    setShowGuide(false)
  }

  function showSessionToast(msg: string, ok: boolean) {
    if (sessionToastTimer.current) clearTimeout(sessionToastTimer.current)
    setSessionToast({ msg, ok })
    sessionToastTimer.current = setTimeout(() => setSessionToast(null), 3000)
  }

  // Bet settings — initialised from localStorage, kept in sync via sidebar events
  const [presetAmount, setPresetAmount] = useState('1')
  const [quickBet, setQuickBet] = useState(false)

  useEffect(() => {
    setPresetAmount(localStorage.getItem('sprmfun_preset') || '1')
    setQuickBet(localStorage.getItem('sprmfun_quickbet') === 'true')
    function onSettings(e: CustomEvent) {
      if (e.detail.presetAmount !== undefined) setPresetAmount(e.detail.presetAmount)
      if (e.detail.quickBet !== undefined) setQuickBet(e.detail.quickBet)
    }
    window.addEventListener('sprmfun:settings', onSettings as EventListener)
    return () => window.removeEventListener('sprmfun:settings', onSettings as EventListener)
  }, [])

  // ── Cancel modal — deselect the box in the grid ──────────────────────────
  const cancelBet = useCallback((colX: number, row: number) => {
    window.dispatchEvent(new CustomEvent('sprmfun:deselect', { detail: { colX, row } }))
    setPendingBet(null)
  }, [])

  // ── Listen for box-click events from StockGrid ───────────────────────────
  useEffect(() => {
    function onSelect(e: CustomEvent) {
      const { colX, row, multNum, multDen, multDisp } = e.detail
      if (!connected && !session.isActive) return
      const betData = { colX, row, multNum: multNum ?? 150, multDen: multDen ?? 100, multDisp: multDisp ?? 1.5 }
      if (quickBet) {
        setBetAmount(presetAmount)
        setPendingBet(betData)
        setBetStatus('idle')
        setBetError('')
      } else {
        setPendingBet(betData)
        setBetAmount(presetAmount)
        setBetStatus('idle')
        setBetError('')
      }
    }
    window.addEventListener('sprmfun:select', onSelect as EventListener)
    return () => window.removeEventListener('sprmfun:select', onSelect as EventListener)
  }, [connected, quickBet, presetAmount, session.isActive])

  // Notify sidebar when pending bet state changes (for Place Bet button)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('sprmfun:pendingbet', { detail: { hasPending: !!pendingBet } }))
  }, [pendingBet])

  // ── Faucet — redirect to SprmFaucet contract interaction ────────────────
  // The faucet is now an on-chain contract on Fuji.
  // Dispatching sprmfun:faucet opens the faucet flow (handled by profile/transfer page).
  useEffect(() => {
    const onFaucet = () => {
      // Redirect to the transfer page where users can interact with the faucet contract
      window.open(`https://testnet.snowtrace.io/address/${process.env.NEXT_PUBLIC_FAUCET_ADDRESS}`, '_blank')
    }
    window.addEventListener('sprmfun:faucet', onFaucet)
    return () => window.removeEventListener('sprmfun:faucet', onFaucet)
  }, [])

  // ── Listen for resolution results ─────────────────────────────────────────
  useEffect(() => {
    const onResult = (e: CustomEvent) => {
      const { won, payout, txHash, box_row, user: betUser } = e.detail
      // Only show for the active user
      if (betUser === address || betUser === session.sessionAddress) {
        if (resTimer.current) clearTimeout(resTimer.current)
        setResolution({ won, payout, txHash, box_row })
        resTimer.current = setTimeout(() => setResolution(null), 6000)
      }
    }
    window.addEventListener('sprmfun:betresult', onResult as EventListener)
    return () => window.removeEventListener('sprmfun:betresult', onResult as EventListener)
  }, [address, session.sessionAddress])

  // ── Place bet ────────────────────────────────────────────────────────────
  const handlePlaceBet = useCallback(async () => {
    if (!pendingBet) return

    const { colX: box_x, row: box_row, multNum, multDisp } = pendingBet
    const amountTokens = parseFloat(betAmount)
    if (isNaN(amountTokens) || amountTokens <= 0) {
      setBetError('Invalid amount')
      setBetStatus('error')
      return
    }
    const amountRaw = ethers.parseUnits(amountTokens.toString(), 18)

    setBetStatus('submitting')
    setBetError('')

    // Use a window flag to block concurrent betting transactions
    if ((window as any)._sprmBettingInFlight) return
      ; (window as any)._sprmBettingInFlight = true

    // ── Decide which signer to use ────────────────────────────────────────
    const useSession = session.activeWallet === 'instant' && session.isActive && !!session.sessionWallet

    if (!useSession && (!signer || !address)) {
      ; (window as any)._sprmBettingInFlight = false
      return
    }
    if (useSession && !session.sessionWallet) {
      ; (window as any)._sprmBettingInFlight = false
      return
    }

    // ── Balance check before sending ─────────────────────────────────────
    const availableBalance = useSession ? (session.sessionSprmBalance ?? 0) : (balance ?? 0)
    if (amountTokens > availableBalance) {
      const msg = `Insufficient balance: need ${amountTokens} SPRM, have ${availableBalance.toFixed(4)} SPRM`
      if (useSession) {
        showSessionToast('Insufficient balance', false)
        setPendingBet(null)
        setBetStatus('idle')
      } else {
        setBetError(msg)
        setBetStatus('error')
      }
      return
    }

    try {
      let betSigner: ethers.Signer
      let signerAddress: string

      if (useSession) {
        // Connect session wallet to JsonRpcProvider (self-funded AVAX for gas)
        const provider = new ethers.JsonRpcProvider(RPC_URL)
        betSigner = session.sessionWallet!.connect(provider)
        signerAddress = session.sessionWallet!.address
      } else {
        betSigner = signer!
        signerAddress = address!
      }

      if (!TOKEN_ADDRESS || !GAME_ADDRESS) {
        throw new Error('Contract addresses not configured in environment variables')
      }

      // 1. Approve game contract to spend SPRM
      //    We check allowance for BOTH primary and session wallets to avoid redundant txs.
      const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, betSigner)
      const allowance: bigint = await token.allowance(signerAddress, GAME_ADDRESS)

      if (allowance < amountRaw) {
        console.log(`[BET] insufficient allowance: ${ethers.formatEther(allowance)} < ${ethers.formatEther(amountRaw)}. Approving...`)
        // For primary wallet, we approve exactly what's needed for safety.
        // For session wallet, we approve MAX to avoid future prompts.
        const approveAmt = useSession ? ethers.MaxUint256 : amountRaw
        const approveTx = await token.approve(GAME_ADDRESS, approveAmt)
        console.log('[BET] approve tx sent:', approveTx.hash)
        await approveTx.wait()
        console.log('[BET] approve tx confirmed')
      }

      // 2. Call placeBet on the game contract
      // multNum is a uint16 — e.g. 173 for 1.73x
      const game = new ethers.Contract(GAME_ADDRESS, GAME_ABI, betSigner)
      const multNum16 = Math.round(multNum) & 0xFFFF // ensure uint16 range
      const betTx = await game.placeBet(
        box_x,       // uint32 pixel coordinate
        box_row,     // uint8 row index
        multNum16,   // uint16 multiplier numerator (e.g. 173 = 1.73x)
        amountRaw,   // uint256 SPRM amount (18 decimals)
      )
      console.log('[BET] placeBet tx:', betTx.hash)
      const receipt = await betTx.wait()

      // 3. Extract betId from BetPlaced event logs
      let betId: bigint | null = null
      if (receipt && receipt.logs) {
        const gameInterface = new ethers.Interface(GAME_ABI)
        for (const log of receipt.logs) {
          try {
            const parsed = gameInterface.parseLog({ topics: log.topics as string[], data: log.data })
            if (parsed && parsed.name === 'BetPlaced') {
              betId = parsed.args[0] as bigint
              break
            }
          } catch { /* not this event */ }
        }
      }

      console.log('[BET] betId:', betId?.toString())

      // 4. Register the bet with the server for auto-resolution
      fetch('/register-bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          betId: betId?.toString() ?? '',
          user: signerAddress,
          box_x,
          box_row,
          mult_num: multNum16,
          bet_amount: amountTokens,
        }),
      }).then(() => console.log('[BET] register-bet sent to server'))
        .catch(e => console.warn('[BET] register-bet failed:', e.message))

      setBetStatus('done')
      if (useSession) {
        if (session.sessionSprmBalance !== null) session.optimisticDeduct(amountTokens)
        showSessionToast(`Bet placed — ${amountTokens} SPRM @ ${multDisp.toFixed(2)}x`, true)
        setPendingBet(null)
        setBetStatus('idle')
      } else {
        await refreshBalance()
        setTimeout(() => { setPendingBet(null); setBetStatus('idle') }, 1500)
      }
    } catch (err: any) {
      console.error('[BET]', err)
      if (useSession) {
        const isNoGas = err?.code === 'INSUFFICIENT_FUNDS' || err?.message?.includes('insufficient funds')
        const msg = isNoGas
          ? 'Session needs AVAX gas — top up in sidebar'
          : 'Bet failed: ' + (err?.message?.slice(0, 50) ?? 'error')
        showSessionToast(msg, false)
        setPendingBet(null)
        setBetStatus('idle')
      } else {
        setBetError(err?.message?.slice(0, 120) ?? 'Transaction failed')
        setBetStatus('error')
      }
    } finally {
      ; (window as any)._sprmBettingInFlight = false
    }
  }, [signer, address, pendingBet, betAmount, balance, session, refreshBalance])

  // Sidebar "Place Bet" button triggers same handler (must be after handlePlaceBet is defined)
  useEffect(() => {
    function onPlaceBet() {
      if (pendingBet && (connected || session.isActive)) handlePlaceBet()
    }
    window.addEventListener('sprmfun:placebet', onPlaceBet)
    return () => window.removeEventListener('sprmfun:placebet', onPlaceBet)
  }, [pendingBet, connected, session.isActive, handlePlaceBet])

  // ── Auto-fire bet when quickBet is on (skip if instant session is active — it has its own fire) ─
  const isQuickFiring = useRef(false)
  useEffect(() => {
    const sessionInstant = session.activeWallet === 'instant' && session.isActive && !!session.sessionWallet
    if (!quickBet || !pendingBet || betStatus !== 'idle' || isQuickFiring.current || sessionInstant) return
    isQuickFiring.current = true
    handlePlaceBet().finally(() => { isQuickFiring.current = false })
  }, [quickBet, pendingBet, betStatus, handlePlaceBet, session.activeWallet, session.isActive, session.sessionWallet])

  // ── Auto-fire for instant wallet — never show modal ───────────────────────
  const isSessionFiring = useRef(false)
  useEffect(() => {
    const useSession = session.activeWallet === 'instant' && session.isActive && !!session.sessionWallet
    if (!useSession || !pendingBet || betStatus !== 'idle' || isSessionFiring.current) return
    isSessionFiring.current = true
    handlePlaceBet().finally(() => { isSessionFiring.current = false })
  }, [session.activeWallet, session.isActive, session.sessionWallet, pendingBet, betStatus, handlePlaceBet])

  // ── Styles ───────────────────────────────────────────────────────────────
  const hudStyle: React.CSSProperties = {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    pointerEvents: 'none', zIndex: 10,
    fontFamily: "'Outfit', sans-serif",
  }

  const modalOverlayStyle: React.CSSProperties = {
    position: 'absolute', inset: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(12px)',
    pointerEvents: 'all', zIndex: 100,
  }

  const modalStyle: React.CSSProperties = {
    background: spermTheme.bgElevated,
    border: `1px solid ${spermTheme.accentBorder}`,
    borderRadius: 8, padding: '28px 32px',
    minWidth: 320, color: spermTheme.textPrimary,
    display: 'flex', flexDirection: 'column', gap: 18,
    boxShadow: `0 0 40px rgba(212,170,255,0.08)`,
  }

  return (
    <div style={hudStyle}>
      {/* ── Welcome Guide Overlay ── */}
      {showGuide && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 100, pointerEvents: 'all',
        }}>
          <div style={{
            background: spermTheme.bgElevated,
            border: `1px solid ${spermTheme.accentBorder}`,
            borderRadius: 12, padding: 32, maxWidth: 440,
            display: 'flex', flexDirection: 'column', gap: 24,
            color: spermTheme.textPrimary,
            boxShadow: `0 0 60px rgba(0,0,0,0.5), 0 0 30px ${spermTheme.accentGlow}`,
            animation: 'sprmIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
            backdropFilter: 'blur(20px)',
          }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: spermTheme.accent, letterSpacing: 3, fontFamily: "'JetBrains Mono', monospace" }}>SYSTEM_INITIALIZE</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 14, color: spermTheme.textSecondary, lineHeight: 1.6 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ color: spermTheme.accent, fontWeight: 700 }}>01.</div>
                <div>Pick a box in the future. The closer to the current time, the higher the risk!</div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ color: spermTheme.accent, fontWeight: 700 }}>02.</div>
                <div>The <b>Sperm</b> moves based on live AVAX/USDT price momentum. Velocity = Price Change.</div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ color: spermTheme.accent, fontWeight: 700 }}>03.</div>
                <div>Use <b>Instant Wallet</b> for gasless, rapid-fire betting with zero confirmation popups.</div>
              </div>
            </div>

            <button
              onClick={closeGuide}
              style={{
                marginTop: 10, padding: '12px 0',
                background: spermTheme.accentSoft, border: `1.5px solid ${spermTheme.accentBorder}`,
                borderRadius: 10, color: spermTheme.accent, fontWeight: 800,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              GOT IT, LET'S GO!
            </button>
          </div>
        </div>
      )}

      {/* ── Wallet Status Chip (top-left) ── */}
      {(connected || session.isActive) && (
        <div style={{
          position: 'absolute', top: 20, left: 20,
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)',
          border: `1px solid ${spermTheme.borderChrome}`,
          borderRadius: 4, padding: '6px 14px 6px 8px',
          zIndex: 40, pointerEvents: 'all',
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: session.activeWallet === 'instant' ? spermTheme.accent : spermTheme.success,
            boxShadow: `0 0 8px ${session.activeWallet === 'instant' ? spermTheme.accent : spermTheme.success}`,
          }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: spermTheme.textPrimary, letterSpacing: 0.5 }}>
            {session.activeWallet === 'instant' ? 'INSTANT' : 'PRIMARY'}
          </span>
          <span style={{ fontSize: 10, color: spermTheme.textTertiary, borderLeft: `1px solid ${spermTheme.textTertiary}`, paddingLeft: 8, marginLeft: 2 }}>
            {session.activeWallet === 'instant'
              ? `${session.sessionSprmBalance?.toFixed(1) ?? 0} SPRM`
              : `${balance?.toFixed(1) ?? 0} SPRM`}
          </span>
        </div>
      )}

      {/* ── Instant wallet toast (bottom-right) ── */}
      {sessionToast && (
        <div style={{
          position: 'absolute', bottom: 24, right: 24,
          background: sessionToast.ok ? 'rgba(20,34,30,0.95)' : 'rgba(40,22,30,0.95)',
          border: `1.5px solid ${sessionToast.ok ? spermTheme.success : spermTheme.error}`,
          borderRadius: 10, padding: '10px 18px',
          color: sessionToast.ok ? spermTheme.success : spermTheme.error,
          fontSize: 13, fontWeight: 700,
          pointerEvents: 'none', zIndex: 50,
          boxShadow: `0 0 16px ${sessionToast.ok ? 'rgba(152,214,194,0.25)' : 'rgba(227,150,170,0.25)'}`,
        }}>
          {sessionToast.msg}
        </div>
      )}

      {/* ── Resolution Notification (top-center) ── */}
      {resolution && (
        <div style={{
          position: 'absolute', top: 120, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.82)',
          backdropFilter: 'blur(24px)',
          border: `1px solid ${resolution.won ? spermTheme.success : spermTheme.error}`,
          borderRadius: 4, padding: '24px 48px',
          color: resolution.won ? spermTheme.success : spermTheme.error,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
          pointerEvents: 'all', zIndex: 60,
          boxShadow: `0 12px 48px rgba(0,0,0,0.6), 0 0 20px ${resolution.won ? spermTheme.success + '20' : spermTheme.error + '20'}`,
          animation: 'sprmIn 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 1.5 }}>
            {resolution.won ? 'WINNER!' : 'BET SETTLED'}
          </div>
          <div style={{ fontSize: 14, color: spermTheme.textPrimary, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}>
            {resolution.won
              ? `PROFIT: +${resolution.payout.toFixed(3)} SPRM`
              : `SETTLED: LOSS [ROW_${resolution.box_row}]`}
          </div>
          {resolution.txHash && (
            <a
              href={`https://testnet.snowtrace.io/tx/${resolution.txHash}`}
              target="_blank" rel="noreferrer"
              style={{
                fontSize: 10, color: spermTheme.textTertiary, textDecoration: 'none',
                marginTop: 4, display: 'flex', alignItems: 'center', gap: 4,
                opacity: 0.8,
              }}
            >
              View on Snowtrace <span style={{ fontSize: 12 }}>↗</span>
            </a>
          )}
          <style>{`
            @keyframes sprmIn {
              from { opacity: 0; transform: translate(-50%, -30px) scale(0.9); }
              to { opacity: 1; transform: translate(-50%, 0) scale(1); }
            }
          `}</style>
        </div>
      )}

      {/* ── Bet modal (primary wallet only) ── */}
      {pendingBet && (connected || session.isActive) && session.activeWallet !== 'instant' && (
        <div style={modalOverlayStyle} onClick={e => { if (e.target === e.currentTarget) cancelBet(pendingBet.colX, pendingBet.row) }}>
          <div style={modalStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, color: spermTheme.accent }}>PLACE BET</div>

            <div style={{ fontSize: 12, color: spermTheme.textSecondary, lineHeight: 1.6 }}>
              <div>Column X: <span style={{ color: spermTheme.textPrimary }}>{pendingBet.colX}</span></div>
              <div>Row: <span style={{ color: spermTheme.textPrimary }}>
                {pendingBet.row} — {pendingBet.multDisp.toFixed(2)}×
              </span></div>
              <div style={{ marginTop: 4, color: spermTheme.textTertiary, fontSize: 11 }}>
                Multiplier on win (after 2% fee): {(pendingBet.multDisp * 0.98).toFixed(3)}×
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 11, color: spermTheme.textSecondary }}>AMOUNT (SPRM)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number" min="0.01" step="0.5" value={betAmount}
                  onChange={e => setBetAmount(e.target.value)}
                  style={{
                    flex: 1, background: 'rgba(255,255,255,0.05)',
                    border: `1px solid ${spermTheme.accentBorder}`,
                    borderRadius: 6, padding: '7px 10px',
                    color: spermTheme.textPrimary, fontSize: 14, fontFamily: 'inherit', outline: 'none',
                  }}
                />
                {[0.5, 1, 2, 5].map(v => (
                  <button key={v} onClick={() => setBetAmount(String(v))} style={{
                    background: spermTheme.accentSoft,
                    border: `1px solid ${spermTheme.accentBorder}`,
                    borderRadius: 5, padding: '6px 8px',
                    color: spermTheme.accent, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                  }}>{v}</button>
                ))}
              </div>
              {(session.isActive ? session.sessionSprmBalance : balance) !== null && (
                <div style={{ fontSize: 10, color: spermTheme.textTertiary }}>
                  {session.isActive
                    ? <><span style={{ color: spermTheme.accent }}>Session</span>: {session.sessionSprmBalance?.toFixed(2)} SPRM</>
                    : <>Balance: {balance?.toFixed(2)} SPRM</>}
                </div>
              )}
            </div>

            {betError && (
              <div style={{ fontSize: 11, color: spermTheme.error, background: 'rgba(227,150,170,0.08)', borderRadius: 5, padding: '6px 10px' }}>
                {betError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => cancelBet(pendingBet.colX, pendingBet.row)}
                style={{
                  flex: 1, padding: '9px 0',
                  background: 'rgba(255,255,255,0.05)',
                  border: `1px solid ${spermTheme.borderSoft}`,
                  borderRadius: 7, color: spermTheme.textSecondary,
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                }}
              >Cancel</button>
              <button
                onClick={handlePlaceBet}
                disabled={betStatus === 'submitting' || betStatus === 'done'}
                style={{
                  flex: 2, padding: '9px 0',
                  background: betStatus === 'done' ? 'rgba(152,214,194,0.2)' : betStatus === 'error' ? 'rgba(227,150,170,0.15)' : spermTheme.accentSoft,
                  border: `1.5px solid ${betStatus === 'done' ? spermTheme.success : betStatus === 'error' ? spermTheme.error : spermTheme.accentBorder}`,
                  borderRadius: 7,
                  color: betStatus === 'done' ? spermTheme.success : betStatus === 'error' ? spermTheme.error : spermTheme.accent,
                  cursor: betStatus === 'submitting' ? 'wait' : 'pointer',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                }}
              >
                {betStatus === 'submitting' ? 'CONFIRMING…' : betStatus === 'done' ? '✓ BET PLACED' : betStatus === 'error' ? 'RETRY' : 'CONFIRM BET'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!connected && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: spermTheme.bgElevated, border: `1px solid ${spermTheme.accentBorder}`,
          borderRadius: 8, padding: '8px 18px',
          color: spermTheme.textSecondary, fontSize: 12,
          pointerEvents: 'none',
        }}>
          Connect wallet to place bets
        </div>
      )}

    </div>
  )
}
