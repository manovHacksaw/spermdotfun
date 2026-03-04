"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  TOP_HEADER_HEIGHT,
  computeRailWidth,
} from "@/components/leftRailShared";
import { spermTheme } from "@/components/theme/spermTheme";

const TopHeader = dynamic(() => import("@/components/TopHeader"), {
  ssr: false,
});
const StockGrid = dynamic(() => import("@/components/StockGrid"), {
  ssr: false,
});
const GameHUD = dynamic(() => import("@/components/GameHUD"), { ssr: false });
const LeftRail = dynamic(() => import("@/components/LeftRail"), { ssr: false });
const MultiplierBar = dynamic(() => import("@/components/MultiplierBar"), {
  ssr: false,
});

export default function Home() {
  // Start at 0 so server and client match (avoids hydration mismatch); update after mount
  const [leftRailWidth, setLeftRailWidth] = useState(0);

  useEffect(() => {
    const syncLayout = () =>
      setLeftRailWidth(computeRailWidth(window.innerWidth));
    const onRailWidth = (e: Event) =>
      setLeftRailWidth((e as CustomEvent<number>).detail);
    syncLayout();
    window.addEventListener("resize", syncLayout);
    window.addEventListener("sprmfun:railwidth", onRailWidth);
    window.addEventListener("sprmfun:railwidth", onRailWidth);
    return () => {
      window.removeEventListener("resize", syncLayout);
      window.removeEventListener("sprmfun:railwidth", onRailWidth);
    };
  }, []);

  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        background: spermTheme.bgBase,
        display: "flex",
      }}
    >
      <TopHeader />
      <LeftRail />
      <div
        style={{
          position: "fixed",
          left: leftRailWidth,
          top: TOP_HEADER_HEIGHT,
          right: 0,
          bottom: 0,
          overflow: "hidden",
          transition: "left 0.22s ease",
          padding: 20,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Game console box — fills all space to the right of rail */}
        <div
          style={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            borderRadius: 20,
            overflow: "hidden",
            border: "1px solid rgba(197,140,255,0.28)",
            boxShadow:
              "0 0 0 1px rgba(245,245,242,0.06), 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
            background: spermTheme.bgBase,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <MultiplierBar />
          <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
            <StockGrid />
            <GameHUD />
          </div>
        </div>
      </div>
    </main>
  );
}
