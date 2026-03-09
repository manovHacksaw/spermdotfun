"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { TOP_HEADER_HEIGHT, CHAT_PANEL_WIDTH, BET_PANEL_WIDTH, MOBILE_BREAKPOINT } from "@/components/leftRailShared";
import { spermTheme } from "@/components/theme/spermTheme";
import { useLiveGameStats } from "@/hooks/useLiveGameStats";
import { useState, useEffect } from "react";

const TopHeader = dynamic(() => import("@/components/TopHeader"), { ssr: false });
const StockGrid = dynamic(() => import("@/components/StockGrid"), { ssr: false });
const GameHUD = dynamic(() => import("@/components/GameHUD"), { ssr: false });
const MultiplierBar = dynamic(() => import("@/components/MultiplierBar"), { ssr: false });
const ChatSidebar = dynamic(() => import("@/components/ChatSidebar"), { ssr: false });
const BetSidebar = dynamic(() => import("@/components/BetSidebar"), { ssr: false });
const OnboardingGuide = dynamic(() => import("@/components/OnboardingGuide"), { ssr: false });

const CARD_PANEL: React.CSSProperties = {
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  background: spermTheme.bgCard,
  border: `1px solid ${spermTheme.borderChrome}`,
  borderRadius: 14,
  boxShadow: "0 2px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.02) inset",
};

function HomeContent() {
  const searchParams = useSearchParams();
  const refCode = searchParams.get("ref");

  useEffect(() => {
    if (refCode) {
      localStorage.setItem("sprmfun_ref", refCode);
      console.log("[REFERRAL] Captured ref code:", refCode);
    }
  }, [refCode]);

  const { leaderboard, activePlayers, activePlayersCount } = useLiveGameStats();
  const [isMobile, setIsMobile] = useState(false);
  const [showBetPanel, setShowBetPanel] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (!mobile) {
        setShowBetPanel(true);
        setShowChatPanel(true);
      }
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const toggleBet = () => setShowBetPanel(prev => !prev);
  const toggleChat = () => setShowChatPanel(prev => !prev);

  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        background: spermTheme.bgBase,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <TopHeader onToggleBet={toggleBet} onToggleChat={toggleChat} />

      {/* Body — dashboard area below header */}
      <div
        style={{
          display: "flex",
          flex: 1,
          marginTop: TOP_HEADER_HEIGHT,
          minHeight: 0,
          overflow: "hidden",
          padding: "8px",
          gap: "8px",
          background: spermTheme.bgBase,
        }}
      >
        {/* ── LEFT: Bet Slip ── */}
        {(showBetPanel || !isMobile) && (
          <div style={{
            ...CARD_PANEL,
            width: isMobile ? "calc(100% - 16px)" : BET_PANEL_WIDTH,
            position: isMobile ? "absolute" : "relative",
            left: isMobile ? 8 : 0,
            top: isMobile ? 8 : 0,
            bottom: isMobile ? 8 : 0,
            zIndex: isMobile ? 100 : 1,
            display: (isMobile && !showBetPanel) ? "none" : "flex"
          }}>
            <BetSidebar
              activePlayers={activePlayers}
              activePlayersCount={activePlayersCount}
              onClose={isMobile ? () => setShowBetPanel(false) : undefined}
            />
          </div>
        )}

        {/* ── CENTER: Game ── */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            overflow: "hidden",
          }}
        >
          {/* Multiplier ticker */}
          <div
            style={{
              flexShrink: 0,
              background: spermTheme.bgCard,
              border: `1px solid ${spermTheme.borderChrome}`,
              borderRadius: 10,
              boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
              overflow: "hidden",
            }}
          >
            <MultiplierBar />
          </div>

          {/* Game canvas area */}
          <div
            style={{
              position: "relative",
              flex: 1,
              minHeight: 0,
              borderRadius: 14,
              overflow: "hidden",
              border: `1px solid ${spermTheme.borderChrome}`,
              boxShadow: "0 2px 16px rgba(0,0,0,0.6)",
            }}
          >
            <StockGrid />
            <GameHUD />
          </div>
        </div>

        {/* ── RIGHT: Chat + Leaderboard ── */}
        {(showChatPanel || !isMobile) && (
          <div style={{
            ...CARD_PANEL,
            width: isMobile ? "calc(100% - 16px)" : CHAT_PANEL_WIDTH,
            position: isMobile ? "absolute" : "relative",
            right: isMobile ? 8 : 0,
            top: isMobile ? 8 : 0,
            bottom: isMobile ? 8 : 0,
            zIndex: isMobile ? 101 : 1,
            display: (isMobile && !showChatPanel) ? "none" : "flex"
          }}>
            <ChatSidebar
              leaderboard={leaderboard}
              onClose={isMobile ? () => setShowChatPanel(false) : undefined}
            />
          </div>
        )}
      </div>

      <OnboardingGuide />
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <main style={{ width: "100vw", height: "100vh", background: spermTheme.bgBase }} />
    }>
      <HomeContent />
    </Suspense>
  );
}
