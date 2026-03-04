"use client";

import { type CSSProperties, type ReactNode, useMemo } from "react";
import {
  type ProfilePnlPoint,
  type ProfileStats,
  type ProfileTimeFilter,
} from "@/lib/profile/types";
import { spermTheme } from "@/components/theme/spermTheme";

interface StatsTabProps {
  stats: ProfileStats;
  pnlSeries: ProfilePnlPoint[];
  filter: ProfileTimeFilter;
  onChangeFilter: (filter: ProfileTimeFilter) => void;
  loading?: boolean;
  error?: string;
}

const filters: ProfileTimeFilter[] = ["24H", "7D", "1M", "ALL"];

function formatSigned(value: number): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${Math.abs(value).toFixed(4)}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export default function StatsTab({
  stats,
  pnlSeries,
  filter,
  onChangeFilter,
  loading,
  error,
}: StatsTabProps) {
  const chart = useMemo(() => {
    const width = 1200;
    const height = 320;

    if (!pnlSeries.length) {
      return {
        width,
        height,
        linePath: `M0 ${height / 2} L${width} ${height / 2}`,
        areaPath: `M0 ${height / 2} L${width} ${height / 2} L${width} ${height} L0 ${height} Z`,
        zeroY: height / 2,
      };
    }

    const points = pnlSeries.map((point, idx) => ({
      x:
        pnlSeries.length === 1 ? width : (idx / (pnlSeries.length - 1)) * width,
      value: point.cumulativeNet,
    }));

    const values = points.map((point) => point.value);
    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const span = Math.max(0.0001, max - min);

    const normalized = points.map((point) => {
      const y = height - ((point.value - min) / span) * height;
      return { x: point.x, y };
    });

    const linePath = normalized
      .map((point, idx) => `${idx === 0 ? "M" : "L"}${point.x} ${point.y}`)
      .join(" ");
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    const areaPath = `${linePath} L${last.x} ${height} L${first.x} ${height} Z`;
    const zeroY = height - ((0 - min) / span) * height;

    return { width, height, linePath, areaPath, zeroY };
  }, [pnlSeries]);
  const pnlValue = pnlSeries.length
    ? pnlSeries[pnlSeries.length - 1].cumulativeNet
    : stats.netProfit;

  return (
    <section style={{ display: "grid", gap: 14 }}>
      <style>{`
        .stats-metrics {
          display: grid;
          gap: 10px;
          grid-template-columns: 1fr;
        }
        @media (min-width: 640px) {
          .stats-metrics {
            gap: 12px;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          }
        }
      `}</style>
      <div style={headerWrap}>
        <div style={headerKicker}>Player Performance</div>
        <div style={headerTitle}>Your Stats</div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 4,
          overflowX: "auto",
          paddingBottom: 2,
        }}
      >
        {filters.map((item) => {
          const active = item === filter;
          return (
            <button
              key={item}
              onClick={() => onChangeFilter(item)}
              style={{
                border: active
                  ? `1px solid ${spermTheme.accentBorder}`
                  : `1px solid ${spermTheme.borderSoft}`,
                background: active
                  ? spermTheme.accentSoft
                  : "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                color: active ? spermTheme.accent : spermTheme.textSecondary,
                borderRadius: 12,
                padding: "10px 14px",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {item}
            </button>
          );
        })}
      </div>

      {error && (
        <div
          style={{
            border: `1px solid ${spermTheme.error}`,
            borderRadius: 12,
            background: "rgba(227,150,170,0.12)",
            color: spermTheme.error,
            padding: "10px 12px",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div
        className="stats-metrics"
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "1fr",
          opacity: loading ? 0.6 : 1,
        }}
      >
        <div
          style={kpiCard(
            "rgba(32,24,50,0.82)",
            "rgba(24,18,38,0.74)",
            "rgba(197,140,255,0.34)",
            "rgba(197,140,255,0.20)",
          )}
        >
          <div style={kpiIcon("rgba(70,52,102,0.7)", "rgba(197,140,255,0.32)")}>
            {metricGlyph("controller", spermTheme.accent)}
          </div>
          <div>
            <div style={kpiTitle}>Total Games Played</div>
            <div style={kpiValue}>{stats.gamesPlayed}</div>
          </div>
        </div>

        <div
          style={kpiCard(
            "rgba(32,24,50,0.82)",
            "rgba(24,18,38,0.74)",
            "rgba(197,140,255,0.34)",
            "rgba(197,140,255,0.20)",
          )}
        >
          <div style={kpiIcon("rgba(70,52,102,0.7)", "rgba(197,140,255,0.32)")}>
            {metricGlyph("record", spermTheme.accent)}
          </div>
          <div>
            <div style={kpiTitle}>P&amp;L</div>
            <div
              style={{
                ...kpiValue,
                color: pnlValue >= 0 ? spermTheme.success : spermTheme.error,
              }}
            >
              {formatSigned(pnlValue)}
            </div>
          </div>
        </div>

        <div
          style={kpiCard(
            "rgba(32,24,50,0.82)",
            "rgba(24,18,38,0.74)",
            "rgba(197,140,255,0.34)",
            "rgba(197,140,255,0.20)",
          )}
        >
          <div style={kpiIcon("rgba(70,52,102,0.7)", "rgba(197,140,255,0.32)")}>
            {metricGlyph("trend", spermTheme.accent)}
          </div>
          <div>
            <div style={kpiTitle}>Net Profit</div>
            <div
              style={{
                ...kpiValue,
                color:
                  stats.netProfit >= 0 ? spermTheme.success : spermTheme.error,
              }}
            >
              {formatSigned(stats.netProfit)}
            </div>
          </div>
        </div>

        <div
          style={kpiCard(
            "rgba(32,24,50,0.82)",
            "rgba(24,18,38,0.74)",
            "rgba(197,140,255,0.34)",
            "rgba(197,140,255,0.20)",
          )}
        >
          <div style={kpiIcon("rgba(70,52,102,0.7)", "rgba(197,140,255,0.32)")}>
            {metricGlyph("target", spermTheme.accent)}
          </div>
          <div>
            <div style={kpiTitle}>Win Rate</div>
            <div style={kpiValue}>{stats.winRate.toFixed(2)}%</div>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "relative",
          border: `1px solid ${spermTheme.accentBorder}`,
          borderRadius: 18,
          padding: 18,
          background: `linear-gradient(180deg, ${spermTheme.bgElevated}, rgba(10,9,19,0.84))`,
          backdropFilter: "blur(14px)",
          overflow: "hidden",
          opacity: loading ? 0.7 : 1,
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -40,
            top: -110,
            width: 260,
            height: 260,
            borderRadius: "50%",
            background: "rgba(197,140,255,0.18)",
            filter: "blur(72px)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            color: spermTheme.textSecondary,
            fontSize: 14,
            marginBottom: 12,
            fontWeight: 700,
          }}
        >
          Cumulative PnL ({filter})
        </div>

        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          width="100%"
          height="340"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="profilePnlFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(197,140,255,0.30)" />
              <stop offset="100%" stopColor="rgba(197,140,255,0.02)" />
            </linearGradient>
          </defs>

          <g opacity={0.24}>
            {[0.2, 0.4, 0.6, 0.8].map((step) => (
              <line
                key={step}
                x1="0"
                y1={chart.height * step}
                x2={chart.width}
                y2={chart.height * step}
                stroke="rgba(255,255,255,0.16)"
                strokeDasharray="5 7"
              />
            ))}
          </g>

          <line
            x1="0"
            y1={chart.zeroY}
            x2={chart.width}
            y2={chart.zeroY}
            stroke="rgba(255,255,255,0.38)"
            strokeDasharray="4 6"
          />
          <path d={chart.areaPath} fill="url(#profilePnlFill)" />
          <path
            d={chart.linePath}
            fill="none"
            stroke={spermTheme.accent}
            strokeWidth="4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>

        {!pnlSeries.length && (
          <div
            style={{
              color: spermTheme.textTertiary,
              fontSize: 13,
              marginTop: 6,
            }}
          >
            No transactions in this timeframe yet.
          </div>
        )}
      </div>
    </section>
  );
}

function kpiCard(
  backgroundFrom: string,
  backgroundTo: string,
  border: string,
  glow: string,
): CSSProperties {
  return {
    border: `1px solid ${border}`,
    borderRadius: 18,
    padding: "18px 16px",
    background: `linear-gradient(155deg, ${backgroundFrom}, ${backgroundTo})`,
    display: "flex",
    alignItems: "center",
    gap: 14,
    minHeight: 112,
    backdropFilter: "blur(10px)",
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.1), 0 14px 26px -16px ${glow}`,
  };
}

function kpiIcon(background: string, border: string): CSSProperties {
  return {
    width: 46,
    height: 46,
    borderRadius: 12,
    display: "grid",
    placeItems: "center",
    background: `linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.01)), ${background}`,
    border: `1px solid ${border}`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)",
  };
}

const kpiTitle: CSSProperties = {
  color: spermTheme.textSecondary,
  fontSize: 12,
  marginBottom: 6,
  fontWeight: 700,
  letterSpacing: 0.8,
  textTransform: "uppercase",
};

const kpiValue: CSSProperties = {
  color: spermTheme.textPrimary,
  fontSize: 34,
  fontWeight: 900,
  lineHeight: 1,
};

const headerWrap: CSSProperties = {
  display: "grid",
  gap: 4,
};

const headerKicker: CSSProperties = {
  color: spermTheme.textSecondary,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 1.4,
  textTransform: "uppercase",
};

const headerTitle: CSSProperties = {
  color: spermTheme.textPrimary,
  fontSize: 42,
  fontWeight: 900,
  lineHeight: 1.05,
  letterSpacing: 0.6,
};

type MetricGlyphType =
  | "controller"
  | "record"
  | "target"
  | "trend"
  | "stack"
  | "payout"
  | "up"
  | "down";

function metricGlyph(type: MetricGlyphType, color: string): ReactNode {
  const stroke = {
    stroke: color,
    strokeWidth: 1.8,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (type) {
    case "controller":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3.5" y="8" width="17" height="8.5" rx="4.2" {...stroke} />
          <path d="M8 12h3.5M9.75 10.25v3.5" {...stroke} />
          <circle cx="16.2" cy="11.3" r="0.9" fill={color} />
          <circle cx="17.9" cy="13.1" r="0.9" fill={color} />
        </svg>
      );
    case "record":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 16.5v-8M11.5 16.5V11M16.5 16.5V6.5" {...stroke} />
          <path d="M5 19h14" {...stroke} />
        </svg>
      );
    case "target":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="7.8" {...stroke} />
          <circle cx="12" cy="12" r="4.7" {...stroke} />
          <circle cx="12" cy="12" r="1.4" fill={color} />
        </svg>
      );
    case "trend":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.5 17.5V6.5M4.5 17.5h15" {...stroke} />
          <path d="M7.5 14.2l3.3-3.3 2.6 2.3 4.2-4.7" {...stroke} />
        </svg>
      );
    case "stack":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <ellipse cx="12" cy="7.8" rx="6" ry="2.2" {...stroke} />
          <path d="M6 7.8v3.5c0 1.3 2.7 2.2 6 2.2s6-.9 6-2.2V7.8" {...stroke} />
          <path
            d="M6 11.3v3.5c0 1.3 2.7 2.2 6 2.2s6-.9 6-2.2v-3.5"
            {...stroke}
          />
        </svg>
      );
    case "payout":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4.5" y="6.5" width="9" height="11" rx="2.2" {...stroke} />
          <path d="M12 12h7M16.2 8l2.8 4-2.8 4" {...stroke} />
        </svg>
      );
    case "up":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" {...stroke} />
          <path d="M12 16.2V8.4M8.9 11.5 12 8.4l3.1 3.1" {...stroke} />
        </svg>
      );
    case "down":
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" {...stroke} />
          <path d="M12 7.8v7.8M8.9 12.5 12 15.6l3.1-3.1" {...stroke} />
        </svg>
      );
    default:
      return null;
  }
}
