"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import ChatSidebar from "@/components/ChatSidebar";
import BetSidebar from "@/components/BetSidebar";
import { useLiveGameStats } from "@/hooks/useLiveGameStats";
import {
  BET_PANEL_WIDTH,
  CHAT_PANEL_WIDTH,
  MOBILE_BREAKPOINT,
  RAIL_COLORS,
  TOP_HEADER_HEIGHT,
  panelBlurGradientStyle,
  panelBlurLayerStyle,
  panelBlurTintStyle,
  panelFrameStyle,
  getLayoutMode,
  computeRailWidth,
  type LayoutMode,
} from "@/components/leftRailShared";
import { spermTheme } from "@/components/theme/spermTheme";

type CompactTab = "chat" | "bets";
const FULL_COLLAPSED_WIDTH = 0;

export default function LeftRail() {
  const getRailWidth = (
    vw: number,
    nextMode: LayoutMode,
    nextChatOpen: boolean,
    nextBetOpen: boolean,
  ) => {
    if (nextMode === "full") {
      const fullWidth =
        (nextChatOpen ? CHAT_PANEL_WIDTH : 0) +
        (nextBetOpen ? BET_PANEL_WIDTH : 0);
      return fullWidth > 0 ? fullWidth : FULL_COLLAPSED_WIDTH;
    }
    return computeRailWidth(vw, nextBetOpen);
  };

  const [mode, setMode] = useState<LayoutMode>(() =>
    typeof window !== "undefined" ? getLayoutMode(window.innerWidth) : "full",
  );
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    typeof window !== "undefined"
      ? getRailWidth(
          window.innerWidth,
          getLayoutMode(window.innerWidth),
          true,
          true,
        )
      : 540,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [compactTab, setCompactTab] = useState<CompactTab>("chat");
  const [chatOpen, setChatOpen] = useState(true);
  const [betOpen, setBetOpen] = useState(true);

  const CHAT_TOGGLE_TOP = "calc(58% - 92px)";
  const BET_TOGGLE_TOP = "calc(58% + 4px)";
  const isFullCollapsed = mode === "full" && !chatOpen && !betOpen;

  const { leaderboard, activePlayers, activePlayersCount } = useLiveGameStats();

  // Dispatch sidebar width to page.tsx on every change
  useEffect(() => {
    const w = mode === "mobile" ? 0 : sidebarWidth;
    window.dispatchEvent(new CustomEvent("sprmfun:railwidth", { detail: w }));
  }, [mode, sidebarWidth]);

  // Track viewport and recompute mode + width
  useEffect(() => {
    const onResize = () => {
      const vw = window.innerWidth;
      const newMode = getLayoutMode(vw);
      setMode(newMode);
      setSidebarWidth(getRailWidth(vw, newMode, chatOpen, betOpen));
      if (vw >= MOBILE_BREAKPOINT) setMobileOpen(false);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [betOpen, chatOpen]);

  // When panel open state changes in full mode, update width
  useEffect(() => {
    if (mode !== "full") return;
    setSidebarWidth(getRailWidth(window.innerWidth, mode, chatOpen, betOpen));
  }, [betOpen, chatOpen, mode]);

  // ── Mobile: floating toggle button when sidebar is closed ──
  if (mode === "mobile" && !mobileOpen) {
    return (
      <button
        onClick={() => setMobileOpen(true)}
        style={{
          position: "fixed",
          bottom: 20,
          left: 20,
          width: 48,
          height: 48,
          borderRadius: 24,
          background: spermTheme.bgChromeSoft,
          border: `1px solid ${spermTheme.borderChrome}`,
          color: RAIL_COLORS.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          boxShadow:
            "0 10px 24px rgba(0,0,0,0.42), inset 0 0 0 1px rgba(255,255,255,0.04)",
          cursor: "pointer",
        }}
      >
        <Menu size={24} />
      </button>
    );
  }

  const isMobileOverlay = mode === "mobile" && mobileOpen;

  return (
    <>
      {/* Backdrop for mobile overlay */}
      {isMobileOverlay && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 9998,
          }}
        />
      )}

      <div
        style={{
          position: "fixed",
          left: 0,
          top: isMobileOverlay ? 0 : TOP_HEADER_HEIGHT,
          bottom: 0,
          width: isMobileOverlay
            ? Math.min(320, window.innerWidth * 0.85)
            : sidebarWidth,
          zIndex: isMobileOverlay ? 9999 : 100,
          background: "transparent",
          borderRight:
            isMobileOverlay || isFullCollapsed
              ? "none"
              : `1px solid ${RAIL_COLORS.border}`,
          overflow: "visible",
          transition: "width 0.22s ease",
        }}
      >
        {!isFullCollapsed && (
          <div style={panelBlurLayerStyle}>
            <div style={panelBlurGradientStyle} />
            <div style={panelBlurTintStyle} />
          </div>
        )}

        {!isFullCollapsed && (
          <div style={panelFrameStyle}>
            {/* Mobile close button */}
            {isMobileOverlay && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  padding: "10px",
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => setMobileOpen(false)}
                  style={{
                    background: spermTheme.bgChromeSoft,
                    border: `1px solid ${spermTheme.borderChrome}`,
                    borderRadius: "50%",
                    width: 32,
                    height: 32,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: spermTheme.textPrimary,
                    cursor: "pointer",
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            )}

            {mode === "full" ? (
              /* ── Desktop dual-panel layout ── */
              <div
                style={{
                  display: "flex",
                  flex: 1,
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: chatOpen ? CHAT_PANEL_WIDTH : 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    minHeight: 0,
                    flexShrink: 0,
                    transition: "width 0.22s ease",
                  }}
                >
                  <div
                    style={{
                      opacity: chatOpen ? 1 : 0,
                      transition: "opacity 0.22s ease",
                      width: CHAT_PANEL_WIDTH,
                      minHeight: 0,
                      flex: 1,
                    }}
                  >
                    <ChatSidebar leaderboard={leaderboard} />
                  </div>
                </div>

                {/* Bet panel */}
                <div
                  style={{
                    width: betOpen ? BET_PANEL_WIDTH : 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    minHeight: 0,
                    flexShrink: 0,
                    transition: "width 0.22s ease",
                    borderLeft:
                      betOpen && chatOpen
                        ? `1px solid ${RAIL_COLORS.border}`
                        : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      flex: 1,
                      overflow: "hidden",
                      minHeight: 0,
                      opacity: betOpen ? 1 : 0,
                      transition: "opacity 0.22s ease",
                      width: BET_PANEL_WIDTH,
                    }}
                  >
                    <BetSidebar
                      activePlayers={activePlayers}
                      activePlayersCount={activePlayersCount}
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* ── Compact / mobile: tabbed single panel ── */
              <>
                <div
                  style={{
                    display: "flex",
                    borderBottom: `1px solid ${RAIL_COLORS.border}`,
                    background: RAIL_COLORS.tabBg,
                    flexShrink: 0,
                  }}
                >
                  {(
                    [
                      { id: "chat", label: "CHAT" },
                      { id: "bets", label: "BETS" },
                    ] as { id: CompactTab; label: string }[]
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setCompactTab(tab.id)}
                      style={{
                        flex: 1,
                        padding: "10px 6px",
                        background:
                          compactTab === tab.id
                            ? RAIL_COLORS.tabActiveBg
                            : "transparent",
                        border: "none",
                        borderBottom:
                          compactTab === tab.id
                            ? "2px solid rgba(245,245,242,0.5)"
                            : "2px solid transparent",
                        color:
                          compactTab === tab.id
                            ? spermTheme.textPrimary
                            : RAIL_COLORS.textDim,
                        cursor: "pointer",
                        fontSize: 11,
                        letterSpacing: 1.1,
                        fontWeight: 600,
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
                  {compactTab === "chat" ? (
                    <ChatSidebar leaderboard={leaderboard} />
                  ) : (
                    <BetSidebar
                      activePlayers={activePlayers}
                      activePlayersCount={activePlayersCount}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Floating CHAT toggle */}
        {mode === "full" && (
          <button
            onClick={() => setChatOpen(!chatOpen)}
            title={chatOpen ? "Collapse chat panel" : "Expand chat panel"}
            style={{
              position: "absolute",
              top: CHAT_TOGGLE_TOP,
              left: chatOpen ? CHAT_PANEL_WIDTH - 14 : 6,
              width: 28,
              height: 80,
              background: RAIL_COLORS.tabBg,
              border: `1px solid ${RAIL_COLORS.accent}`,
              borderRadius: 14,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: RAIL_COLORS.accent,
              fontSize: 10,
              zIndex: 11,
              transition: "all 0.22s ease",
              boxShadow:
                "0 8px 22px rgba(0,0,0,0.36), inset 0 0 0 1px rgba(255,255,255,0.04)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = spermTheme.accentSoft;
              e.currentTarget.style.boxShadow = `0 10px 26px rgba(0,0,0,0.42), inset 0 0 0 1px ${spermTheme.accentBorder}`;
              e.currentTarget.style.transform = "scale(1.03)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = RAIL_COLORS.tabBg;
              e.currentTarget.style.boxShadow =
                "0 8px 22px rgba(0,0,0,0.36), inset 0 0 0 1px rgba(255,255,255,0.04)";
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  writingMode: "vertical-rl",
                  letterSpacing: 2,
                  fontSize: 10,
                  fontWeight: 800,
                }}
              >
                CHAT
              </span>
              <span style={{ fontSize: 10 }}>{chatOpen ? "◀" : "▶"}</span>
            </div>
          </button>
        )}

        {/* Floating BETS toggle — outside panelFrame so overflow:hidden doesn't clip it */}
        {mode === "full" && (
          <button
            onClick={() => setBetOpen(!betOpen)}
            title={betOpen ? "Collapse bets panel" : "Expand bets panel"}
            style={{
              position: "absolute",
              top: BET_TOGGLE_TOP,
              left: chatOpen
                ? CHAT_PANEL_WIDTH - 14
                : betOpen
                  ? BET_PANEL_WIDTH - 14
                  : 6,
              width: 28,
              height: 80,
              background: RAIL_COLORS.tabBg,
              border: `1px solid ${RAIL_COLORS.accent}`,
              borderRadius: 14,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: RAIL_COLORS.accent,
              fontSize: 10,
              zIndex: 10,
              transition: "all 0.22s ease",
              boxShadow:
                "0 8px 22px rgba(0,0,0,0.36), inset 0 0 0 1px rgba(255,255,255,0.04)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = spermTheme.accentSoft;
              e.currentTarget.style.boxShadow = `0 10px 26px rgba(0,0,0,0.42), inset 0 0 0 1px ${spermTheme.accentBorder}`;
              e.currentTarget.style.transform = "scale(1.03)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = RAIL_COLORS.tabBg;
              e.currentTarget.style.boxShadow =
                "0 8px 22px rgba(0,0,0,0.36), inset 0 0 0 1px rgba(255,255,255,0.04)";
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  writingMode: "vertical-rl",
                  letterSpacing: 2,
                  fontSize: 10,
                  fontWeight: 800,
                }}
              >
                BETS
              </span>
              <span style={{ fontSize: 10 }}>{betOpen ? "◀" : "▶"}</span>
            </div>
          </button>
        )}
      </div>
    </>
  );
}
