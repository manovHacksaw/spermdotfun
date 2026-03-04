"use client";

import { useMemo, type CSSProperties } from "react";
import { useUsername } from "@/hooks/useUsername";
import { spermTheme } from "@/components/theme/spermTheme";

interface ProfileHeaderCardProps {
  walletAddress: string;
  nickname: string;
  primarySprmBalance: number | null;
  sessionSprmBalance: number | null;
  sessionSolBalance: number | null;
}

function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export default function ProfileHeaderCard({
  walletAddress,
  nickname,
  primarySprmBalance,
  sessionSprmBalance,
  sessionSolBalance,
}: ProfileHeaderCardProps) {
  const { username, initials } = useUsername(walletAddress);

  const displayName = useMemo(
    () => nickname.trim() || username || "Anonymous",
    [nickname, username],
  );

  const progress = useMemo(() => {
    const primary = Math.max(0, primarySprmBalance ?? 0);
    const session = Math.max(0, sessionSprmBalance ?? 0);
    const total = primary + session;
    if (total <= 0) return 0.12;
    return Math.max(0.08, Math.min(1, session / total));
  }, [primarySprmBalance, sessionSprmBalance]);

  return (
    <section
      style={{
        position: "relative",
        border: `1px solid ${spermTheme.accentBorder}`,
        borderRadius: 24,
        background: `linear-gradient(160deg, ${spermTheme.bgElevated}, rgba(12,10,23,0.82))`,
        backdropFilter: "blur(16px)",
        padding: "18px 16px 16px",
        marginBottom: 22,
        overflow: "hidden",
      }}
    >
      <style>{`
        .profile-header-card {
          padding: 24px 24px 20px !important;
        }
        .profile-avatar {
          width: 56px;
          height: 56px;
          font-size: 20px;
        }
        .profile-name {
          font-size: 24px;
        }
        .profile-metrics {
          grid-template-columns: 1fr;
          gap: 10px;
        }
        @media (min-width: 640px) {
          .profile-avatar {
            width: 72px;
            height: 72px;
            font-size: 24px;
          }
          .profile-name {
            font-size: 34px;
          }
          .profile-metrics {
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 12px;
          }
        }
      `}</style>
      <div
        style={{
          position: "absolute",
          width: 320,
          height: 320,
          right: -90,
          top: -120,
          borderRadius: "50%",
          filter: "blur(70px)",
          background: "rgba(197,140,255,0.20)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 280,
          height: 280,
          left: -120,
          bottom: -180,
          borderRadius: "50%",
          filter: "blur(80px)",
          background: "rgba(197,140,255,0.14)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          display: "flex",
          gap: 16,
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div
          className="profile-avatar"
          style={{
            width: 56,
            height: 56,
            borderRadius: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 900,
            background:
              "linear-gradient(135deg, #f5f5f2, #c58cff 55%, #9c7ac6)",
            color: "rgba(10,8,20,0.9)",
            fontSize: 20,
            boxShadow: "0 16px 32px rgba(197,140,255,0.26)",
            border: "1px solid rgba(255,255,255,0.38)",
          }}
        >
          {initials}
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            className="profile-name"
            style={{
              color: spermTheme.textPrimary,
              fontWeight: 900,
              fontSize: 24,
              lineHeight: 1.1,
            }}
          >
            {displayName}
          </div>
          <div
            style={{
              color: spermTheme.textSecondary,
              fontSize: 13,
              fontFamily: "monospace",
              marginTop: 5,
            }}
          >
            {shortAddress(walletAddress)}
          </div>
        </div>

        <div style={{ minWidth: 180 }}>
          <div
            style={{
              color: spermTheme.textSecondary,
              fontSize: 12,
              marginBottom: 7,
              fontWeight: 700,
            }}
          >
            WALLET READINESS
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div
              style={{
                flex: 1,
                height: 10,
                borderRadius: 999,
                background: "rgba(0,0,0,0.46)",
                overflow: "hidden",
                border: `1px solid ${spermTheme.accentBorder}`,
              }}
            >
              <div
                style={{
                  width: `${Math.round(progress * 100)}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: "linear-gradient(90deg, #c58cff, #f5f5f2)",
                  boxShadow: "0 0 18px rgba(197,140,255,0.45)",
                }}
              />
            </div>
            <div
              style={{
                color: spermTheme.accent,
                fontWeight: 800,
                fontSize: 13,
              }}
            >
              {Math.round(progress * 100)}%
            </div>
          </div>
        </div>
      </div>

      <div
        className="profile-metrics"
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 10,
        }}
      >
        <div
          style={metricCard("rgba(197,140,255,0.16)", "rgba(197,140,255,0.34)")}
        >
          <div style={metricLabel}>PRIMARY SPRM</div>
          <div style={{ ...metricValue, color: spermTheme.textPrimary }}>
            {(primarySprmBalance ?? 0).toFixed(4)}
          </div>
        </div>
        <div
          style={metricCard("rgba(197,140,255,0.12)", "rgba(197,140,255,0.28)")}
        >
          <div style={metricLabel}>INSTA WALLET SPRM</div>
          <div style={{ ...metricValue, color: spermTheme.accent }}>
            {(sessionSprmBalance ?? 0).toFixed(4)}
          </div>
        </div>
        <div
          style={metricCard("rgba(245,245,242,0.08)", "rgba(245,245,242,0.24)")}
        >
          <div style={metricLabel}>FEE BUFFER SOL</div>
          <div style={{ ...metricValue, color: spermTheme.textSecondary }}>
            {(sessionSolBalance ?? 0).toFixed(5)}
          </div>
        </div>
      </div>
    </section>
  );
}

function metricCard(background: string, border: string) {
  return {
    border: `1px solid ${border}`,
    borderRadius: 14,
    padding: "14px 14px 12px",
    background,
    backdropFilter: "blur(6px)",
  };
}

const metricLabel: CSSProperties = {
  color: spermTheme.textSecondary,
  fontSize: 12,
  marginBottom: 6,
  letterSpacing: 0.4,
  fontWeight: 700,
};

const metricValue: CSSProperties = {
  fontSize: 26,
  fontWeight: 900,
  lineHeight: 1.05,
};
