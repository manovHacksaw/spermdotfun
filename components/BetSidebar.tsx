"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useEvmWallet } from "@/components/WalletProvider";
import type { ActivePlayerEntry } from "@/hooks/useLiveGameStats";
import { useSprmBalance } from "@/hooks/useSprmBalance";
import { RAIL_COLORS } from "@/components/leftRailShared";
import { useSessionWalletContext } from "@/context/SessionWalletContext";
import { spermTheme } from "@/components/theme/spermTheme";
import { X } from 'lucide-react';

// ── Live feed types ────────────────────────────────────────────────────────
interface FeedItem {
  id: string;
  shortAddr: string;
  amount: number;
  mult?: number;
  type: 'bet' | 'win' | 'lose';
  timestamp: number;
}

const MAX_FEED = 18;

const borderChrome = spermTheme.borderChrome;
const STORAGE_AUTO_CASHOUT = "sprmfun_auto_cashout";
const STORAGE_ADVANCED_BETTING = "sprmfun_advanced_betting";

const quickBtnStyle: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: `1px solid rgba(255,255,255,0.08)`,
  background: "rgba(255,255,255,0.04)",
  color: spermTheme.textSecondary,
  fontSize: 10,
  fontWeight: 700,
  fontFamily: "'JetBrains Mono', monospace",
  cursor: "pointer",
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  transition: "all 0.15s ease",
};

interface BetSidebarProps {
  activePlayers: ActivePlayerEntry[];
  activePlayersCount: number;
  onClose?: () => void;
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
  onClose,
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
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [houseBank, setHouseBank] = useState<number | null>(null);
  const prevPlayersRef = useRef<Map<string, number>>(new Map());

  // ── Live feed: watch activePlayers for new arrivals ───────────────────────
  useEffect(() => {
    const prev = prevPlayersRef.current;
    for (const p of activePlayers) {
      const prevBet = prev.get(p.address) ?? 0;
      if (p.totalBet > prevBet + 0.001) {
        const item: FeedItem = {
          id: `bet-${p.address}-${Date.now()}`,
          shortAddr: p.nickname || p.shortAddr,
          amount: p.totalBet - prevBet,
          type: 'bet',
          timestamp: Date.now(),
        };
        setFeedItems(prev => [item, ...prev].slice(0, MAX_FEED));
      }
      prev.set(p.address, p.totalBet);
    }
    prevPlayersRef.current = prev;
  }, [activePlayers]);

  // ── Live feed: watch bet resolutions ─────────────────────────────────────
  useEffect(() => {
    const onResult = (e: Event) => {
      const { user, won, payout, bet_amount } = (e as CustomEvent).detail;
      const short = user ? `${String(user).slice(0, 5)}…${String(user).slice(-4)}` : 'Anon';
      const item: FeedItem = {
        id: `res-${user}-${Date.now()}`,
        shortAddr: short,
        amount: won ? payout : (bet_amount ?? 0),
        type: won ? 'win' : 'lose',
        timestamp: Date.now(),
      };
      setFeedItems(prev => [item, ...prev].slice(0, MAX_FEED));
    };
    window.addEventListener('sprmfun:betresult', onResult);
    return () => window.removeEventListener('sprmfun:betresult', onResult);
  }, []);

  useEffect(() => {
    const onHouseBank = (e: Event) => {
      const { balance } = (e as CustomEvent).detail;
      setHouseBank(balance);
    };
    window.addEventListener('sprmfun:house_bank', onHouseBank);
    return () => window.removeEventListener('sprmfun:house_bank', onHouseBank);
  }, []);

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
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        background: "#11141A",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.05)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
        margin: "10px",
      }}
    >
      {/* Panel header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingBottom: 16, borderBottom: `1px solid rgba(255,255,255,0.06)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#E84142",
            boxShadow: "0 0 6px #E84142",
          }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{
              fontSize: 14, fontWeight: 800, letterSpacing: '0.08em',
              color: "#9BA3AF",
              textTransform: "uppercase",
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              BET SLIP
            </span>
            <span style={{ fontSize: 10, color: spermTheme.textTertiary, letterSpacing: '0.02em' }}>
              Live Betting Panel
            </span>
          </div>
        </div>
        {activePlayersCount > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 800,
            padding: "4px 10px", borderRadius: 8,
            background: "rgba(34,197,94,0.15)",
            color: "#22C55E",
            fontFamily: "'JetBrains Mono', monospace",
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            {activePlayersCount} live
          </span>
        )}
        {houseBank !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: spermTheme.textTertiary, letterSpacing: '0.05em' }}>HOUSE LIQ</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: spermTheme.success, fontFamily: "'JetBrains Mono', monospace" }}>
              {houseBank.toLocaleString(undefined, { maximumFractionDigits: 0 })} SPRM
            </span>
          </div>
        )}
      </div>

      {onClose && (
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid ${spermTheme.borderChrome}`,
            borderRadius: 6,
            color: spermTheme.textSecondary,
            cursor: 'pointer',
            zIndex: 10,
          }}
        >
          <X size={16} />
        </button>
      )}

      {/* ── INSTANT MODE WARNING ── */}
      {activeWallet === 'instant' && isActive && (
        <div style={{
          background: 'rgba(232,65,66,0.08)',
          border: `1px solid rgba(232,65,66,0.35)`,
          borderRadius: 10, padding: '14px',
          display: 'flex', alignItems: 'center', gap: 12,
          transition: 'all 0.2s ease',
        }}>
          <div style={{ fontSize: 18 }}>⚡</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{
              fontSize: 11, fontWeight: 800, color: spermTheme.error,
              letterSpacing: '0.05em', fontFamily: "'JetBrains Mono', monospace",
            }}>
              INSTANT BETTING ACTIVE
            </div>
            <div style={{ fontSize: 11, color: spermTheme.textSecondary, lineHeight: 1.4, fontFamily: "'Outfit', sans-serif" }}>
              Direct interactions execute <span style={{ color: spermTheme.textPrimary, fontWeight: 700 }}>{presetAmount} SPRM</span> instantly.
            </div>
          </div>
        </div>
      )}

      {/* ── BET SETTINGS CARD ─────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
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
          <div style={{
            width: 3, height: 16, borderRadius: 2,
            background: "linear-gradient(180deg, #E84142, #FF5A5F)",
          }} />
          <span style={{
            fontSize: 11, fontWeight: 800,
            color: spermTheme.textTertiary,
            letterSpacing: '0.1em', textTransform: "uppercase",
            fontFamily: "'JetBrains Mono', monospace",
            flex: 1,
          }}>
            Bet Settings
          </span>
          <span style={{
            fontSize: 9, color: spermTheme.textTertiary,
            transition: "transform 0.2s",
            display: "inline-block",
            transform: settingsOpen ? "rotate(0deg)" : "rotate(-90deg)",
          }}>
            ▼
          </span>
        </div>

        {/* Collapsible body */}
        {settingsOpen && (
          <>
            {/* Default amount input */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{
                fontSize: 10, fontWeight: 800,
                color: spermTheme.textSecondary,
                letterSpacing: '0.08em', textTransform: "uppercase",
                fontFamily: "'JetBrains Mono', monospace",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                Amount
                <span style={{ color: spermTheme.accent, fontSize: 10 }}>🔺 SPRM</span>
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type="number"
                  min="0.01"
                  step="0.5"
                  value={presetAmount}
                  onChange={(e) => setPresetAmount(e.target.value)}
                  style={{
                    background: "#0F1319",
                    border: `1px solid rgba(255,255,255,0.06)`,
                    borderRadius: 10,
                    padding: "14px",
                    color: spermTheme.textPrimary,
                    fontSize: 22,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 700,
                    outline: "none",
                    width: "100%",
                    boxSizing: "border-box",
                    transition: "all 0.2s ease",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = spermTheme.accent;
                    e.target.style.boxShadow = `0 0 8px ${spermTheme.accent}66`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(255,255,255,0.06)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <span style={{
                  position: "absolute", right: 12, top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 9, fontWeight: 700,
                  color: spermTheme.textTertiary,
                  fontFamily: "'JetBrains Mono', monospace",
                  letterSpacing: 1, pointerEvents: "none",
                }}>
                  SPRM
                </span>
              </div>

              {/* Preset buttons */}
              <div style={{ display: "flex", gap: 5 }}>
                {[0.5, 1, 2, 5, 10].map((value) => {
                  const isActive = presetAmount === String(value);
                  return (
                    <button
                      key={value}
                      onClick={() => setPresetAmount(String(value))}
                      style={{
                        flex: 1,
                        background: isActive ? "rgba(232,65,66,0.2)" : "#161A22",
                        border: `1px solid ${isActive ? spermTheme.accent : "rgba(255,255,255,0.05)"}`,
                        borderRadius: 8,
                        padding: "8px 12px",
                        color: isActive ? spermTheme.accentBright : spermTheme.textSecondary,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontFamily: "'JetBrains Mono', monospace",
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={(e) => !isActive && (e.currentTarget.style.transform = 'translateY(-1px)')}
                      onMouseLeave={(e) => !isActive && (e.currentTarget.style.transform = 'translateY(0)')}
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
                background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)`,
                margin: '4px 0',
              }}
            />

            {/* Quick bet toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "4px 0" }}>
              <div>
                <div style={{ fontSize: 13, color: spermTheme.textPrimary, fontWeight: 700, marginBottom: 2 }}>
                  Quick Bet
                </div>
                <div style={{ fontSize: 11, color: spermTheme.textTertiary, lineHeight: 1.4 }}>
                  Skip confirmation for instant action
                </div>
              </div>
              <button
                onClick={() => setQuickBet(!quickBet)}
                style={{
                  width: 42, height: 22, borderRadius: 12, flexShrink: 0,
                  background: quickBet ? spermTheme.accent : "#1A1F2A",
                  border: 'none',
                  cursor: "pointer", position: "relative", transition: "all 0.2s ease",
                }}
              >
                <span style={{
                  position: "absolute", top: 3,
                  left: quickBet ? 23 : 3,
                  width: 16, height: 16, borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                  transition: "all 0.2s ease",
                }} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Live Bet Feed ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 5, height: 5, borderRadius: "50%", background: "#E84142",
              boxShadow: "0 0 5px rgba(232,65,66,0.9)", animation: "pulse-dot 1.4s infinite",
            }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, color: spermTheme.textTertiary, textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" }}>
              Live Feed
            </span>
          </div>
          {feedItems.length > 0 && (
            <button onClick={() => setFeedItems([])} style={{ background: "transparent", border: "none", fontSize: 9, color: spermTheme.textTertiary, cursor: "pointer" }}>
              clear
            </button>
          )}
        </div>

        <style>{`
          @keyframes feedIn {
            from { opacity: 0; transform: translateY(-5px) scale(0.97); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>

        {feedItems.length === 0 ? (
          <div style={{
            background: "rgba(255,255,255,0.02)", border: `1px solid ${spermTheme.borderChrome}`,
            borderRadius: 10, padding: "18px 12px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          }}>
            <div style={{ fontSize: 20, opacity: 0.3 }}>⚡</div>
            <div style={{ fontSize: 11, color: spermTheme.textTertiary, textAlign: "center", lineHeight: 1.6 }}>
              Waiting for activity…
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 200, overflowY: "auto" }}>
            {feedItems.map((item) => {
              const isWin = item.type === 'win';
              const isLose = item.type === 'lose';
              return (
                <div key={item.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "6px 10px", borderRadius: 8,
                  background: isWin ? "rgba(16,185,129,0.07)" : isLose ? "rgba(239,68,68,0.05)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isWin ? "rgba(16,185,129,0.18)" : isLose ? "rgba(239,68,68,0.14)" : "rgba(255,255,255,0.05)"}`,
                  animation: "feedIn 0.28s ease",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{
                      width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                      background: isWin ? spermTheme.success : isLose ? spermTheme.error : "#E84142",
                    }} />
                    <span style={{ fontSize: 11, color: spermTheme.textSecondary, fontFamily: "'JetBrains Mono', monospace" }}>
                      {item.shortAddr}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700,
                      color: isWin ? spermTheme.success : isLose ? spermTheme.error : "#FF5A5F",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {isWin ? "+" : ""}{item.amount.toFixed(2)}
                    </span>
                    <span style={{
                      fontSize: 9, padding: "1px 5px", borderRadius: 4, fontWeight: 700,
                      background: isWin ? "rgba(16,185,129,0.12)" : isLose ? "rgba(239,68,68,0.10)" : "rgba(232,65,66,0.10)",
                      color: isWin ? spermTheme.success : isLose ? spermTheme.error : "#E84142",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>
                      {isWin ? "WIN" : isLose ? "MISS" : "BET"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Active bettors compact list */}
        {sortedPlayers.length > 0 && (
          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: 9, color: spermTheme.textTertiary, letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", marginBottom: 3 }}>
              Active · {sortedPlayers.length}
            </div>
            {sortedPlayers.map((player) => {
              const isMe = address === player.address || sessionAddress === player.address;
              const displayName = isMe ? "YOU" : player.nickname || player.shortAddr;
              const avatarColor = walletColor(player.address);
              return (
                <div key={player.address} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "5px 9px", borderRadius: 7,
                  background: isMe ? "rgba(232,65,66,0.06)" : "rgba(255,255,255,0.025)",
                  border: `1px solid ${isMe ? "rgba(232,65,66,0.18)" : "rgba(255,255,255,0.04)"}`,
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 5, background: avatarColor, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 8, fontWeight: 800, color: "#fff",
                    border: isMe ? "1.5px solid rgba(232,65,66,0.5)" : "1px solid rgba(255,255,255,0.08)",
                  }}>
                    {isMe ? "⚡" : displayName.slice(0, 2).toUpperCase()}
                  </div>
                  <span style={{ flex: 1, fontSize: 11, color: isMe ? "#FF5A5F" : spermTheme.textSecondary, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {displayName}
                  </span>
                  <span style={{ fontSize: 10, color: spermTheme.textTertiary, fontFamily: "'JetBrains Mono', monospace" }}>
                    {player.totalBet.toFixed(1)}
                  </span>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: spermTheme.success, boxShadow: "0 0 4px rgba(16,185,129,0.6)" }} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── SESSION WALLET CARD ─────────────────────────────── */}
      {address && (
        <div style={{
          border: `1px solid ${isActive && (sessionAvaxBalance ?? 0) > 0.005 ? "rgba(232,65,66,0.2)" : spermTheme.borderChrome}`,
          borderRadius: 16, padding: '16px',
          display: 'flex', flexDirection: 'column', gap: 12,
          background: isActive ? "linear-gradient(180deg, rgba(232,65,66,0.05) 0%, rgba(0,0,0,0.1) 100%)" : 'rgba(255,255,255,0.01)',
          backdropFilter: "blur(10px)",
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
                color: spermTheme.textSecondary, textTransform: "uppercase",
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                Session Wallet
              </span>
            </div>
            {isActive && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 8,
                background: (sessionAvaxBalance ?? 0) > 0.005 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                color: (sessionAvaxBalance ?? 0) > 0.005 ? '#22C55E' : spermTheme.error,
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {(sessionAvaxBalance ?? 0) > 0.005 ? '● READY' : '⚠ LOW GAS'}
              </span>
            )}
          </div>

          {!isActive ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: spermTheme.textSecondary, lineHeight: 1.6 }}>
                Lock SPRM for gasless instant bets. Sends 0.05 AVAX for gas.
              </div>
              <button
                onClick={() => createSession()}
                disabled={fundStatus === 'pending'}
                style={{
                  padding: '12px 0',
                  background: 'linear-gradient(135deg,#E84142,#FF5A5F)',
                  border: 'none', borderRadius: 10,
                  color: '#fff', fontSize: 13, fontWeight: 600,
                  cursor: fundStatus === 'pending' ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => !fundStatus && (e.currentTarget.style.boxShadow = '0 8px 20px rgba(232,65,66,.35)')}
                onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
              >
                {fundStatus === 'pending' ? 'Sending AVAX…' : fundStatus === 'done' ? '✓ Session Created' : '⚡ Start Session'}
              </button>
              {fundError && <div style={{ fontSize: 11, color: spermTheme.error }}>{fundError}</div>}
            </div>
          ) : (
            <>
              {/* Balances */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px', borderRadius: 10, background: '#0F1319', border: `1px solid rgba(255,255,255,0.05)` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: spermTheme.textTertiary }}>Gas (AVAX)</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: spermTheme.textPrimary, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                      {sessionAvaxBalance !== null ? sessionAvaxBalance.toFixed(4) : '…'}
                    </span>
                    <button onClick={() => topUpGas()} disabled={fundStatus === 'pending'}
                      style={{ padding: '2px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 5, color: spermTheme.textSecondary, fontSize: 10, fontWeight: 700, cursor: fundStatus === 'pending' ? 'wait' : 'pointer', fontFamily: "'JetBrains Mono', monospace" }}>
                      {fundStatus === 'pending' ? '…' : '+0.05'}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: spermTheme.textTertiary }}>Locked SPRM</span>
                  <span style={{ color: spermTheme.textPrimary, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                    {sessionSprmBalance !== null ? sessionSprmBalance.toFixed(2) : '…'}
                  </span>
                </div>
              </div>

              {/* Deposit */}
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="number" min="1" step="1" value={depositAmt}
                  onChange={e => setDepositAmt(e.target.value)}
                  style={{
                    flex: 1,
                    background: '#0F1319',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    color: spermTheme.textPrimary,
                    fontSize: 14,
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: 'none',
                    transition: 'all 0.2s ease'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = spermTheme.accent;
                    e.target.style.boxShadow = `0 0 8px ${spermTheme.accent}44`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(255,255,255,0.06)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <button onClick={() => deposit(parseFloat(depositAmt) || 50)} disabled={depositStatus === 'pending'}
                  style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #E84142, #FF5A5F)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 600, cursor: depositStatus === 'pending' ? 'wait' : 'pointer', fontFamily: 'inherit', transition: 'all 0.2s ease' }}>
                  {depositStatus === 'pending' ? '…' : depositStatus === 'done' ? '✓' : 'Lock'}
                </button>
              </div>
              {depositError && <div style={{ fontSize: 11, color: spermTheme.error }}>{depositError}</div>}

              {/* Instant mode toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: spermTheme.textSecondary, fontWeight: 600 }}>Instant mode</span>
                <button onClick={() => setActiveWallet(activeWallet === 'instant' ? 'primary' : 'instant')}
                  style={{
                    width: 42, height: 22, borderRadius: 12,
                    background: activeWallet === 'instant' ? spermTheme.success : '#1A1F2A',
                    border: 'none',
                    cursor: 'pointer', position: 'relative', transition: 'all 0.2s'
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 3,
                    left: activeWallet === 'instant' ? 23 : 3,
                    width: 16, height: 16, borderRadius: "50%",
                    background: '#fff',
                    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                    transition: 'all 0.2s'
                  }} />
                </button>
              </div>

              {/* Withdraw + Destroy */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => withdrawAll()} disabled={withdrawStatus === 'pending' || !sessionSprmBalance}
                  style={{ flex: 1, padding: '10px 0', background: '#161A22', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, color: spermTheme.textSecondary, fontSize: 12, fontWeight: 600, cursor: withdrawStatus === 'pending' ? 'wait' : 'pointer', fontFamily: 'inherit', transition: 'all 0.2s ease' }}>
                  {withdrawStatus === 'pending' ? 'Withdrawing…' : withdrawStatus === 'done' ? '✓ Withdrawn' : 'Withdraw'}
                </button>
                <button onClick={() => destroySession()}
                  style={{ padding: '10px 16px', background: 'rgba(232,65,66,0.12)', border: '1px solid #E84142', borderRadius: 10, color: spermTheme.accentBright, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s ease' }}>
                  End
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!address && (
        <div style={{
          background: "rgba(232,65,66,0.05)",
          border: "1px solid rgba(232,65,66,0.20)",
          borderRadius: 10, padding: "14px",
          fontSize: 12, color: "rgba(255,130,131,0.85)", lineHeight: 1.6,
        }}>
          Connect your wallet to start betting.
        </div>
      )}
    </div>
  );
}
