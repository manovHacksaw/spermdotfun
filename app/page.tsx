"use client";

import dynamic from "next/dynamic";
import { TOP_HEADER_HEIGHT, CHAT_PANEL_WIDTH, BET_PANEL_WIDTH } from "@/components/leftRailShared";
import { spermTheme } from "@/components/theme/spermTheme";
import { useLiveGameStats } from "@/hooks/useLiveGameStats";

const TopHeader    = dynamic(() => import("@/components/TopHeader"),    { ssr: false });
const StockGrid    = dynamic(() => import("@/components/StockGrid"),    { ssr: false });
const GameHUD      = dynamic(() => import("@/components/GameHUD"),      { ssr: false });
const MultiplierBar = dynamic(() => import("@/components/MultiplierBar"), { ssr: false });
const ChatSidebar  = dynamic(() => import("@/components/ChatSidebar"),  { ssr: false });
const BetSidebar   = dynamic(() => import("@/components/BetSidebar"),   { ssr: false });
const OnboardingGuide = dynamic(() => import("@/components/OnboardingGuide"), { ssr: false });

const SIDEBAR_STYLE: React.CSSProperties = {
  flexShrink: 0,
  display: "flex",
  flexDirection: "column",
  height: "100%",
  overflow: "hidden",
  background: spermTheme.bgPanel,
  borderColor: spermTheme.borderChrome,
  borderStyle: "solid",
  borderWidth: 0,
};

export default function Home() {
  const { leaderboard, activePlayers, activePlayersCount } = useLiveGameStats();

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
      <TopHeader />

      {/* Body — below header */}
      <div
        style={{
          display: "flex",
          flex: 1,
          marginTop: TOP_HEADER_HEIGHT,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* ── LEFT: Chat ── */}
        <div
          style={{
            ...SIDEBAR_STYLE,
            width: CHAT_PANEL_WIDTH,
            borderRightWidth: 1,
          }}
        >
          <ChatSidebar leaderboard={leaderboard} />
        </div>

        {/* ── CENTER: Game ── */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: spermTheme.bgBase,
          }}
        >
          {/* Multiplier ticker */}
          <div
            style={{
              flexShrink: 0,
              borderBottom: `1px solid ${spermTheme.borderChrome}`,
            }}
          >
            <MultiplierBar />
          </div>

          {/* Game canvas area */}
          <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
            <StockGrid />
            <GameHUD />
          </div>
        </div>

        {/* ── RIGHT: Bet Slip ── */}
        <div
          style={{
            ...SIDEBAR_STYLE,
            width: BET_PANEL_WIDTH,
            borderLeftWidth: 1,
          }}
        >
          <BetSidebar
            activePlayers={activePlayers}
            activePlayersCount={activePlayersCount}
          />
        </div>
      </div>

      <OnboardingGuide />
    </main>
  );
}
