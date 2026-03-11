"use client";

import { useEffect, useState, useRef } from "react";
import { spermTheme } from "@/components/theme/spermTheme";

interface MultEntry {
  colX: number;
  multiplier: number;
  winRow: number;
  timestamp: number;
}

// Color scheme based on multiplier value — AVAX theme
function getMultStyle(mult: number): {
  bg: string;
  border: string;
  text: string;
  glow?: string;
} {
  if (mult >= 10) {
    // Gold — legendary
    return {
      bg: "rgba(245,158,11,0.15)",
      border: "rgba(245,158,11,0.50)",
      text: "#F59E0B",
      glow: "0 0 8px rgba(245,158,11,0.25)",
    };
  }
  if (mult >= 5) {
    // AVAX Red — big win
    return {
      bg: "rgba(232,65,66,0.14)",
      border: "rgba(232,65,66,0.50)",
      text: "#FF5A5F",
      glow: "0 0 8px rgba(232,65,66,0.20)",
    };
  }
  if (mult >= 2) {
    // Soft red — solid win
    return {
      bg: "rgba(232,65,66,0.08)",
      border: "rgba(232,65,66,0.30)",
      text: "rgba(255,120,121,0.92)",
    };
  }
  if (mult >= 1.5) {
    // Green — small win
    return {
      bg: "rgba(16,185,129,0.10)",
      border: "rgba(16,185,129,0.30)",
      text: "rgba(52,211,153,0.90)",
    };
  }
  // Dim — near-bust
  return {
    bg: "rgba(255,255,255,0.04)",
    border: "rgba(255,255,255,0.10)",
    text: "rgba(155,163,175,0.70)",
  };
}

export default function MultiplierBar() {
  const [history, setHistory] = useState<MultEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.hostname}:3000`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "init" && msg.multHistory) {
          setHistory(msg.multHistory);
        } else if (msg.type === "mult_history") {
          setHistory(msg.history);
        }
      } catch { }
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
        alignItems: "center",
        gap: 5,
        padding: "7px 12px",
        overflowX: "auto",
        overflowY: "hidden",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        background: "transparent",
      }}
      className="multiplier-bar-scroll"
    >
      <style>{`
        .multiplier-bar-scroll::-webkit-scrollbar { display: none; }
      `}</style>
      {/* Label */}
      <div
        style={{
          flexShrink: 0,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 1.5,
          color: "rgba(155,163,175,0.5)",
          fontFamily: "'JetBrains Mono', monospace",
          textTransform: "uppercase",
          marginRight: 4,
          whiteSpace: "nowrap",
        }}
      >
        HISTORY
      </div>
      {/* Divider */}
      <div style={{ flexShrink: 0, width: 1, height: 16, background: "rgba(255,255,255,0.08)", marginRight: 4 }} />

      {reversed.map((entry, i) => {
        const s = getMultStyle(entry.multiplier);
        return (
          <div
            key={`${entry.colX}-${i}`}
            style={{
              flexShrink: 0,
              padding: "4px 10px",
              borderRadius: 6,
              background: s.bg,
              border: `1px solid ${s.border}`,
              color: s.text,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.5,
              whiteSpace: "nowrap",
              fontFamily: "'JetBrains Mono', monospace",
              boxShadow: s.glow ?? "none",
              animation: i === 0 ? "pill-in 0.25s ease" : "none",
            }}
          >
            {entry.multiplier.toFixed(2)}×
          </div>
        );
      })}
    </div>
  );
}
