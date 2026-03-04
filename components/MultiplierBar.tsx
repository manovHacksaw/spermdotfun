"use client";

import { useEffect, useState, useRef } from "react";
import { spermTheme } from "@/components/theme/spermTheme";

interface MultEntry {
  colX: number;
  multiplier: number;
  winRow: number;
  timestamp: number;
}

// Color scheme based on multiplier value
function getMultStyle(mult: number): {
  bg: string;
  border: string;
  text: string;
} {
  if (mult >= 10) {
    // Golden/yellow for 10x+
    return {
      bg: "rgba(255,200,80,0.18)",
      border: "rgba(255,200,80,0.55)",
      text: "rgba(255,210,100,0.95)",
    };
  }
  if (mult >= 3) {
    // Green for 3-10x
    return {
      bg: "rgba(140,220,180,0.14)",
      border: "rgba(140,220,180,0.45)",
      text: "rgba(150,230,190,0.92)",
    };
  }
  if (mult >= 1.5) {
    // Purple for 1.5-3x
    return {
      bg: "rgba(197,140,255,0.14)",
      border: "rgba(197,140,255,0.45)",
      text: "rgba(210,170,255,0.92)",
    };
  }
  // Gray/dim for below 1.5x
  return {
    bg: "rgba(245,245,242,0.06)",
    border: "rgba(245,245,242,0.18)",
    text: "rgba(245,245,242,0.60)",
  };
}

export default function MultiplierBar() {
  const [history, setHistory] = useState<MultEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.hostname}:3001`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "init" && msg.multHistory) {
          setHistory(msg.multHistory);
        } else if (msg.type === "mult_history") {
          setHistory(msg.history);
        }
      } catch {}
    };

    return () => {
      ws.close();
    };
  }, []);

  // Auto-scroll to show newest entries (now on the left)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
    }
  }, [history]);

  if (history.length === 0) return null;

  // Reverse so newest entries appear on the left
  const reversed = [...history].reverse();

  return (
    <div
      ref={scrollRef}
      style={{
        display: "flex",
        gap: 6,
        padding: "8px 12px",
        overflowX: "auto",
        overflowY: "hidden",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        background: "rgba(0,0,0,0.32)",
        borderBottom: `1px solid ${spermTheme.borderSoft}`,
        borderRadius: "20px 20px 0 0",
      }}
      className="multiplier-bar-scroll"
    >
      <style>{`
        .multiplier-bar-scroll::-webkit-scrollbar { display: none; }
      `}</style>
      {/* Shield icon at start */}
      <div
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: 8,
          background: "rgba(245,245,242,0.06)",
          border: "1px solid rgba(245,245,242,0.14)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(245,245,242,0.50)",
          fontSize: 14,
        }}
      >
        ◇
      </div>
      {reversed.map((entry, i) => {
        const style = getMultStyle(entry.multiplier);
        return (
          <div
            key={`${entry.colX}-${i}`}
            style={{
              flexShrink: 0,
              padding: "5px 12px",
              borderRadius: 8,
              background: style.bg,
              border: `1px solid ${style.border}`,
              color: style.text,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.3,
              whiteSpace: "nowrap",
            }}
          >
            {entry.multiplier.toFixed(2)}x
          </div>
        );
      })}
    </div>
  );
}
