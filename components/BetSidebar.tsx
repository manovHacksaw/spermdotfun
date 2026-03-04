"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useEvmWallet } from "@/components/WalletProvider";
import type { ActivePlayerEntry } from "@/hooks/useLiveGameStats";
import { useSprmBalance } from "@/hooks/useSprmBalance";
import { RAIL_COLORS } from "@/components/leftRailShared";
import { useSessionWalletContext } from "@/context/SessionWalletContext";
import { spermTheme } from "@/components/theme/spermTheme";

const borderChrome = spermTheme.borderChrome;
const STORAGE_AUTO_CASHOUT = "sprmfun_auto_cashout";
const STORAGE_ADVANCED_BETTING = "sprmfun_advanced_betting";

const quickBtnStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 4,
  border: `1px solid ${spermTheme.borderChrome}`,
  background: "rgba(255,255,255,0.03)",
  color: spermTheme.textSecondary,
  fontSize: 10,
  fontWeight: 700,
  fontFamily: "'JetBrains Mono', monospace",
  cursor: "pointer",
  textTransform: 'uppercase',
  letterSpacing: 1,
};

interface BetSidebarProps {
  activePlayers: ActivePlayerEntry[];
  activePlayersCount: number;
}

function formatLastBet(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function walletColor(address: string): string {
  let hash = 0;
  for (let i = 0; i < address.length; i++)
    hash = (Math.imul(hash, 31) + address.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 42%)`;
}

export default function BetSidebar({
  activePlayers,
  activePlayersCount,
}: BetSidebarProps) {
  const { address } = useEvmWallet();
  const {
    sessionAddress,
    activeWallet,
    setActiveWallet,
    sessionSprmBalance,
    sessionAvaxBalance,
    isActive,
    createSession,
    deposit,
    withdrawAll,
    destroySession,
    depositStatus,
    depositError,
    withdrawStatus,
    fundStatus,
    fundError,
    topUpGas,
  } = useSessionWalletContext();
  const { balance } = useSprmBalance(address);
  const [presetAmount, setPresetAmountState] = useState("1");
  const [quickBet, setQuickBetState] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [hasPendingBet, setHasPendingBet] = useState(false);
  const [autoCashoutMult, setAutoCashoutMult] = useState("2.00");
  const [advancedBetting, setAdvancedBetting] = useState(false);
  const [depositAmt, setDepositAmt] = useState('50');

  useEffect(() => {
    const amount = localStorage.getItem("sprmfun_preset") || "1";
    const quick = localStorage.getItem("sprmfun_quickbet") === "true";
    const autoCash = localStorage.getItem(STORAGE_AUTO_CASHOUT) || "2.00";
    const adv = localStorage.getItem(STORAGE_ADVANCED_BETTING) === "true";
    setPresetAmountState(amount);
    setQuickBetState(quick);
    setAutoCashoutMult(autoCash);
    setAdvancedBetting(adv);
  }, []);

  useEffect(() => {
    const onPending = (e: Event) =>
      setHasPendingBet(
        (e as CustomEvent<{ hasPending: boolean }>).detail.hasPending,
      );
    window.addEventListener("sprmfun:pendingbet", onPending);
    return () => window.removeEventListener("sprmfun:pendingbet", onPending);
  }, []);

  const setPresetAmount = (amount: string) => {
    setPresetAmountState(amount);
    localStorage.setItem("sprmfun_preset", amount);
    window.dispatchEvent(
      new CustomEvent("sprmfun:settings", { detail: { presetAmount: amount } }),
    );
  };

  const setQuickBet = (enabled: boolean) => {
    setQuickBetState(enabled);
    localStorage.setItem("sprmfun_quickbet", String(enabled));
    window.dispatchEvent(
      new CustomEvent("sprmfun:settings", { detail: { quickBet: enabled } }),
    );
  };

  const sortedPlayers = useMemo(
    () =>
      [...activePlayers].sort(
        (a, b) => b.lastBetAt - a.lastBetAt || b.totalBet - a.totalBet,
      ),
    [activePlayers],
  );

  const effectiveBalance =
    activeWallet === "instant" && isActive
      ? (sessionSprmBalance ?? 0)
      : (balance ?? 0);
  const canPlaceBet =
    (address &&
      (balance !== null || (isActive && sessionSprmBalance !== null))) ||
    (isActive && sessionSprmBalance !== null);

  const applyHalf = () => {
    const n = parseFloat(presetAmount) || 0;
    setPresetAmount(String(Math.max(0, n / 2).toFixed(4)));
  };
  const apply2x = () => {
    const n = parseFloat(presetAmount) || 0;
    setPresetAmount(String((n * 2).toFixed(4)));
  };
  const applyMax = () => {
    setPresetAmount(String(Math.max(0, effectiveBalance).toFixed(4)));
  };

  const setAutoCashout = (v: string) => {
    setAutoCashoutMult(v);
    if (v) localStorage.setItem(STORAGE_AUTO_CASHOUT, v);
    else localStorage.removeItem(STORAGE_AUTO_CASHOUT);
  };
  const setAdvancedBettingOn = (on: boolean) => {
    setAdvancedBetting(on);
    localStorage.setItem(STORAGE_ADVANCED_BETTING, String(on));
  };

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "20px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      {/* ── INSTANT MODE WARNING ── */}
      {activeWallet === 'instant' && isActive && (
        <div style={{
          background: 'rgba(227,150,170,0.04)',
          border: `1px solid ${spermTheme.error}`,
          borderRadius: 8, padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 6,
          boxShadow: `0 0 20px ${spermTheme.error}15`,
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, bottom: 0, width: 2,
            background: spermTheme.error,
            animation: 'sprmWarningLine 2s infinite'
          }} />
          <div style={{
            fontSize: 11, fontWeight: 900, color: spermTheme.error,
            letterSpacing: 2, fontFamily: "'JetBrains Mono', monospace"
          }}>
            SYSTEM: INSTANT_BET_ACTIVE
          </div>
          <div style={{ fontSize: 11, color: spermTheme.textSecondary, lineHeight: 1.5, fontFamily: "'Outfit', sans-serif" }}>
            Direct grid interaction will execute <b style={{ color: spermTheme.textPrimary }}>{presetAmount} SPRM</b> transaction immediately.
          </div>
          <style>{`
            @keyframes sprmWarningLine {
              0%, 100% { opacity: 0.3; }
              50% { opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {/* ── BET SETTINGS CARD ─────────────────────────────── */}
      <div
        style={{
          border: `1px solid ${spermTheme.borderChrome}`,
          borderRadius: 12,
          padding: "18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          background: "rgba(255,255,255,0.02)",
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Section header — click to collapse */}
        <div
          onClick={() => setSettingsOpen((o) => !o)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <div
            style={{
              width: 3,
              height: 18,
              borderRadius: 2,
              background: "rgba(245,245,242,0.4)",
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: spermTheme.textPrimary,
              letterSpacing: 2,
              fontFamily: "inherit",
              flex: 1,
            }}
          >
            BET SETTINGS
          </span>
          <span
            style={{
              fontSize: 10,
              color: spermTheme.textTertiary,
              transition: "transform 0.2s",
              display: "inline-block",
              transform: settingsOpen ? "rotate(0deg)" : "rotate(-90deg)",
            }}
          >
            ▼
          </span>
        </div>

        {/* Collapsible body */}
        {settingsOpen && (
          <>
            {/* Default amount input */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label
                style={{
                  fontSize: 11,
                  color: spermTheme.textSecondary,
                  letterSpacing: 1,
                  fontFamily: "inherit",
                  fontWeight: 700,
                }}
              >
                BET AMOUNT
                <span
                  style={{
                    color: RAIL_COLORS.lime,
                    marginLeft: 6,
                    fontSize: 10,
                  }}
                >
                  SPRM
                </span>
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type="number"
                  min="0.01"
                  step="0.5"
                  value={presetAmount}
                  onChange={(e) => setPresetAmount(e.target.value)}
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    backdropFilter: "blur(8px)",
                    WebkitBackdropFilter: "blur(8px)",
                    border: `1px solid ${spermTheme.borderChrome}`,
                    borderRadius: 8,
                    padding: "14px 48px 14px 16px",
                    color: spermTheme.textPrimary,
                    fontSize: 22,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 700,
                    outline: "none",
                    width: "100%",
                    boxSizing: "border-box",
                    boxShadow: "inset 0 2px 8px rgba(0,0,0,0.2)",
                    letterSpacing: 1,
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    right: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 10,
                    color: RAIL_COLORS.textDim,
                    fontFamily: "inherit",
                    pointerEvents: "none",
                  }}
                >
                  SPRM
                </span>
              </div>

              {/* Preset buttons */}
              <div style={{ display: "flex", gap: 6 }}>
                {[0.5, 1, 2, 5, 10].map((value) => {
                  const isActive = presetAmount === String(value);
                  return (
                    <button
                      key={value}
                      onClick={() => setPresetAmount(String(value))}
                      style={{
                        flex: 1,
                        background: isActive
                          ? "rgba(212,170,255,0.08)"
                          : "rgba(255,255,255,0.02)",
                        border: `1px solid ${isActive ? spermTheme.accentBorder : spermTheme.borderFaint}`,
                        borderRadius: 6,
                        padding: "10px 4px",
                        color: isActive
                          ? spermTheme.accent
                          : spermTheme.textTertiary,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "'JetBrains Mono', monospace",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Divider */}
            <div
              style={{
                height: 1,
                background: `linear-gradient(90deg, transparent, ${borderChrome}, transparent)`,
              }}
            />

            {/* Quick bet toggle */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 13,
                    color: RAIL_COLORS.text,
                    fontWeight: 800,
                    marginBottom: 4,
                    fontFamily: "inherit",
                    letterSpacing: 0.5,
                  }}
                >
                  QUICK BET
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: RAIL_COLORS.textDim,
                    lineHeight: 1.5,
                    maxWidth: 160,
                  }}
                >
                  Skip confirm dialog — bet instantly
                </div>
              </div>
              <button
                onClick={() => setQuickBet(!quickBet)}
                style={{
                  width: 56,
                  height: 30,
                  borderRadius: 15,
                  border: `1.5px solid ${quickBet ? "rgba(245,245,242,0.4)" : "rgba(255,255,255,0.16)"}`,
                  flexShrink: 0,
                  background: quickBet
                    ? "rgba(255,255,255,0.14)"
                    : "rgba(255,255,255,0.06)",
                  cursor: "pointer",
                  position: "relative",
                  transition: "all 0.2s ease",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 5,
                    left: quickBet ? 29 : 5,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: quickBet
                      ? "rgba(245,245,242,0.9)"
                      : "rgba(245,245,242,0.35)",
                    transition: "all 0.2s ease",
                  }}
                />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Player list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {sortedPlayers.length === 0 ? (
          <div
            style={{
              background: "rgba(245,245,242,0.04)",
              border: `1px solid rgba(245,245,242,0.14)`,
              borderRadius: 10,
              padding: "16px 14px",
              fontSize: 12,
              color: RAIL_COLORS.textDim,
              lineHeight: 1.6,
              textAlign: "center",
            }}
          >
            No active bettors right now.
          </div>
        ) : (
          sortedPlayers.map((player) => {
            const isMe =
              address === player.address ||
              sessionAddress === player.address;
            const displayName = isMe
              ? "YOU"
              : player.nickname || player.shortAddr;
            const initials = displayName.slice(0, 2).toUpperCase();
            const avatarColor = walletColor(player.address);
            return (
              <div
                key={player.address}
                style={{
                  background: isMe
                    ? "rgba(245,245,242,0.08)"
                    : "rgba(245,245,242,0.04)",
                  border: `1px solid ${isMe ? "rgba(245,245,242,0.2)" : "rgba(245,245,242,0.14)"}`,
                  borderRadius: 12,
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                }}
              >
                {/* Avatar */}
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: avatarColor,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 15,
                    fontWeight: 900,
                    color: "#fff",
                    fontFamily: "inherit",
                    boxShadow: isMe
                      ? `0 0 15px ${avatarColor}40`
                      : `0 2px 8px rgba(0,0,0,0.3)`,
                    border: isMe
                      ? `2px solid ${spermTheme.textPrimary}`
                      : `1px solid ${spermTheme.borderChrome}`,
                  }}
                >
                  {isMe ? "⚡" : initials}
                </div>

                {/* Name + amount */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: isMe ? RAIL_COLORS.lime : RAIL_COLORS.text,
                      fontWeight: 700,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "inherit",
                    }}
                  >
                    {displayName}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      marginTop: 3,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: spermTheme.textSecondary,
                        fontWeight: 700,
                        fontFamily: "inherit",
                      }}
                    >
                      ⦿ {player.totalBet.toFixed(4)}
                    </span>
                  </div>
                </div>

                {/* JOINED badge */}
                <div
                  style={{
                    flexShrink: 0,
                    padding: "4px 10px",
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.08)",
                    border: `1px solid ${borderChrome}`,
                    fontSize: 11,
                    fontWeight: 800,
                    color: spermTheme.textSecondary,
                    fontFamily: "inherit",
                    letterSpacing: 0.5,
                  }}
                >
                  JOINED
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── SESSION WALLET CARD ─────────────────────────────── */}
      {address && (
        <div
          style={{
            border: `1px solid ${isActive && (sessionAvaxBalance ?? 0) > 0.005 ? spermTheme.accentBorder : spermTheme.borderChrome}`,
            borderRadius: 12,
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            background: isActive ? 'rgba(212,170,255,0.02)' : 'rgba(255,255,255,0.02)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: spermTheme.textPrimary, letterSpacing: 2 }}>
              INSTANT SESSION
            </span>
            {isActive && (
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                background: (sessionAvaxBalance ?? 0) > 0.005 ? 'rgba(152,214,194,0.15)' : 'rgba(227,150,170,0.15)',
                color: (sessionAvaxBalance ?? 0) > 0.005 ? spermTheme.success : spermTheme.error,
                border: `1px solid ${(sessionAvaxBalance ?? 0) > 0.005 ? 'rgba(152,214,194,0.3)' : 'rgba(227,150,170,0.3)'}`,
              }}>
                {(sessionAvaxBalance ?? 0) > 0.005 ? '● READY' : '⚠ NEEDS GAS'}
              </span>
            )}
          </div>

          {!isActive ? (
            /* ── Step: Create session ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: spermTheme.textSecondary, lineHeight: 1.6 }}>
                Lock SPRM for gasless instant bets. You'll send 0.05 AVAX to your session wallet for gas.
              </div>
              <button
                onClick={() => createSession()}
                disabled={fundStatus === 'pending'}
                style={{
                  padding: '10px 0', background: 'rgba(245,245,242,0.08)',
                  border: '1.5px solid rgba(245,245,242,0.2)', borderRadius: 10,
                  color: spermTheme.textPrimary, fontSize: 13, fontWeight: 800,
                  cursor: fundStatus === 'pending' ? 'wait' : 'pointer', fontFamily: 'inherit',
                }}
              >
                {fundStatus === 'pending' ? 'Sending AVAX…' : fundStatus === 'done' ? '✓ Session created' : '⚡ Start Session'}
              </button>
              {fundError && <div style={{ fontSize: 11, color: spermTheme.error }}>{fundError}</div>}
            </div>
          ) : (
            <>
              {/* ── AVAX balance + top-up ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: spermTheme.textTertiary }}>Gas (AVAX)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: (sessionAvaxBalance ?? 0) > 0.005 ? spermTheme.textSecondary : spermTheme.error, fontWeight: 700 }}>
                    {sessionAvaxBalance !== null ? sessionAvaxBalance.toFixed(4) : '…'}
                  </span>
                  <button
                    onClick={() => topUpGas()}
                    disabled={fundStatus === 'pending'}
                    style={{
                      padding: '3px 10px', background: 'rgba(245,245,242,0.06)',
                      border: '1px solid rgba(245,245,242,0.16)', borderRadius: 6,
                      color: spermTheme.textSecondary, fontSize: 10, fontWeight: 700,
                      cursor: fundStatus === 'pending' ? 'wait' : 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {fundStatus === 'pending' ? '…' : '+0.05'}
                  </button>
                </div>
              </div>

              {/* ── SPRM balance ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: spermTheme.textTertiary }}>Locked SPRM</span>
                <span style={{ color: spermTheme.textSecondary, fontWeight: 700 }}>
                  {sessionSprmBalance !== null ? sessionSprmBalance.toFixed(2) : '…'}
                </span>
              </div>

              {/* ── Deposit SPRM ── */}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="number" min="1" step="1" value={depositAmt}
                  onChange={e => setDepositAmt(e.target.value)}
                  style={{
                    flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)',
                    borderRadius: 8, padding: '7px 10px', color: spermTheme.textPrimary,
                    fontSize: 13, fontFamily: 'inherit', outline: 'none',
                  }}
                />
                <button
                  onClick={() => deposit(parseFloat(depositAmt) || 50)}
                  disabled={depositStatus === 'pending'}
                  style={{
                    padding: '7px 14px', background: 'rgba(245,245,242,0.08)',
                    border: '1px solid rgba(245,245,242,0.2)', borderRadius: 8,
                    color: spermTheme.textPrimary, fontSize: 12, fontWeight: 800,
                    cursor: depositStatus === 'pending' ? 'wait' : 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {depositStatus === 'pending' ? '…' : depositStatus === 'done' ? '✓' : 'Lock'}
                </button>
              </div>
              {depositError && <div style={{ fontSize: 11, color: spermTheme.error }}>{depositError}</div>}

              {/* ── Instant mode toggle ── */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: spermTheme.textSecondary, fontWeight: 700 }}>Instant mode</span>
                <button
                  onClick={() => setActiveWallet(activeWallet === 'instant' ? 'primary' : 'instant')}
                  style={{
                    width: 48, height: 26, borderRadius: 13,
                    border: `1.5px solid ${activeWallet === 'instant' ? 'rgba(152,214,194,0.5)' : 'rgba(255,255,255,0.16)'}`,
                    background: activeWallet === 'instant' ? 'rgba(152,214,194,0.2)' : 'rgba(255,255,255,0.06)',
                    cursor: 'pointer', position: 'relative', transition: 'all 0.2s',
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 4,
                    left: activeWallet === 'instant' ? 24 : 4,
                    width: 16, height: 16, borderRadius: '50%',
                    background: activeWallet === 'instant' ? 'rgba(152,214,194,0.9)' : 'rgba(245,245,242,0.35)',
                    transition: 'all 0.2s',
                  }} />
                </button>
              </div>

              {/* ── Withdraw + destroy ── */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => withdrawAll()}
                  disabled={withdrawStatus === 'pending' || !sessionSprmBalance}
                  style={{
                    flex: 1, padding: '7px 0', background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8,
                    color: spermTheme.textSecondary, fontSize: 11, fontWeight: 700,
                    cursor: withdrawStatus === 'pending' ? 'wait' : 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {withdrawStatus === 'pending' ? 'Withdrawing…' : withdrawStatus === 'done' ? '✓ Withdrawn' : 'Withdraw SPRM'}
                </button>
                <button
                  onClick={() => destroySession()}
                  style={{
                    padding: '7px 12px', background: 'rgba(227,150,170,0.06)',
                    border: '1px solid rgba(227,150,170,0.2)', borderRadius: 8,
                    color: spermTheme.error, fontSize: 11, fontWeight: 700,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  End
                </button>
              </div>
              {withdrawStatus === 'error' && <div style={{ fontSize: 11, color: spermTheme.error }}>{/* withdrawError */}</div>}
            </>
          )}
        </div>
      )}

      {!address && (
        <div
          style={{
            background: "rgba(227,150,170,0.06)",
            border: "1px solid rgba(227,150,170,0.25)",
            borderRadius: 10,
            padding: "14px 14px",
            fontSize: 12,
            color: "rgba(227,150,170,0.85)",
            lineHeight: 1.6,
          }}
        >
          Connect your wallet (top right) to start betting.
        </div>
      )}
    </div>
  );
}
