"use client";

import { useEffect, useMemo, useState } from "react";
import { type ProfileTransaction } from "@/lib/profile/types";
import { spermTheme } from "@/components/theme/spermTheme";

interface TransactionsTabProps {
  transactions: ProfileTransaction[];
  loading?: boolean;
  error?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

function shortId(value?: string): string {
  if (!value) return "N/A";
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function formatSigned(value: number): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${Math.abs(value).toFixed(4)}`;
}

function shortWallet(value?: string): string {
  if (!value) return "Unknown";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export default function TransactionsTab({
  transactions,
  loading,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
}: TransactionsTabProps) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const sync = () => setIsMobile(window.innerWidth < 980);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  const rows = useMemo(() => {
    return [...transactions].sort((a, b) => b.timestamp - a.timestamp);
  }, [transactions]);

  return (
    <section style={{ display: "grid", gap: 14 }}>
      <style>{`
        .transactions-title {
          font-size: 28px;
        }
        @media (min-width: 640px) {
          .transactions-title {
            font-size: 44px;
          }
        }
      `}</style>
      <div
        className="transactions-title"
        style={{
          color: spermTheme.textPrimary,
          fontWeight: 900,
          letterSpacing: 1,
        }}
      >
        TRANSACTIONS
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

      {loading && !rows.length ? (
        <div
          style={{
            border: `1px solid ${spermTheme.accentBorder}`,
            borderRadius: 16,
            background: `linear-gradient(180deg, ${spermTheme.bgElevated}, rgba(10,9,19,0.84))`,
            padding: "18px 16px",
            color: spermTheme.textTertiary,
            fontSize: 14,
          }}
        >
          Loading profile transactions...
        </div>
      ) : !rows.length ? (
        <div
          style={{
            border: `1px solid ${spermTheme.accentBorder}`,
            borderRadius: 16,
            background: `linear-gradient(180deg, ${spermTheme.bgElevated}, rgba(10,9,19,0.84))`,
            padding: "18px 16px",
            color: spermTheme.textTertiary,
            fontSize: 14,
          }}
        >
          No transactions found yet.
        </div>
      ) : isMobile ? (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((tx) => (
            <div
              key={tx.id}
              style={{
                border: `1px solid ${tx.won ? "rgba(152,214,194,0.34)" : spermTheme.accentBorder}`,
                borderRadius: 14,
                background: tx.won
                  ? "linear-gradient(90deg, rgba(152,214,194,0.15), rgba(19,14,35,0.84) 40%)"
                  : `linear-gradient(180deg, ${spermTheme.bgElevated}, rgba(10,9,19,0.84))`,
                padding: 12,
                display: "grid",
                gap: 7,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    color: tx.won ? spermTheme.success : spermTheme.error,
                    fontWeight: 800,
                  }}
                >
                  {tx.won ? "Win" : "Loss"}
                </span>
                <span style={{ color: spermTheme.textTertiary }}>
                  {new Date(tx.timestamp).toLocaleString()}
                </span>
              </div>
              <div style={{ color: spermTheme.textSecondary, fontSize: 13 }}>
                Bet: {tx.betAmount.toFixed(4)} SPRM
              </div>
              <div style={{ color: spermTheme.textSecondary, fontSize: 13 }}>
                Payout: {tx.payout.toFixed(4)} SPRM
              </div>
              <div
                style={{
                  color: tx.net >= 0 ? spermTheme.success : spermTheme.error,
                  fontSize: 14,
                  fontWeight: 800,
                }}
              >
                Net: {formatSigned(tx.net)} SPRM
              </div>
              <div
                style={{
                  color: spermTheme.textTertiary,
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                Tx: {shortId(tx.txSignature)}
              </div>
              <div
                style={{
                  color: spermTheme.textTertiary,
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                Source: {shortWallet(tx.sourceWallet)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            border: `1px solid ${spermTheme.accentBorder}`,
            borderRadius: 16,
            background: `linear-gradient(180deg, ${spermTheme.bgElevated}, rgba(10,9,19,0.84))`,
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 980,
              }}
            >
              <thead>
                <tr>
                  {[
                    "Type",
                    "Bet Amount",
                    "Payout",
                    "Net",
                    "Tx Signature",
                    "Source Wallet",
                    "Time",
                  ].map((head) => (
                    <th
                      key={head}
                      style={{
                        textAlign: "left",
                        padding: "14px 12px",
                        color: spermTheme.textTertiary,
                        fontSize: 12,
                        borderBottom: `1px solid ${spermTheme.borderSoft}`,
                        fontWeight: 800,
                        letterSpacing: 0.4,
                      }}
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((tx) => (
                  <tr
                    key={tx.id}
                    style={{
                      background: tx.won
                        ? "linear-gradient(90deg, rgba(152,214,194,0.15), rgba(19,14,35,0.84) 42%)"
                        : "transparent",
                    }}
                  >
                    <td
                      style={{
                        padding: "13px 12px",
                        color: tx.won ? spermTheme.success : spermTheme.error,
                        fontSize: 14,
                        fontWeight: 800,
                      }}
                    >
                      {tx.won ? "Win" : "Loss"}
                    </td>
                    <td
                      style={{
                        padding: "13px 12px",
                        color: spermTheme.textSecondary,
                        fontSize: 14,
                        fontWeight: 700,
                      }}
                    >
                      {tx.betAmount.toFixed(4)}
                    </td>
                    <td
                      style={{
                        padding: "13px 12px",
                        color: spermTheme.textSecondary,
                        fontSize: 14,
                        fontWeight: 700,
                      }}
                    >
                      {tx.payout.toFixed(4)}
                    </td>
                    <td
                      style={{
                        padding: "13px 12px",
                        color:
                          tx.net >= 0 ? spermTheme.success : spermTheme.error,
                        fontSize: 16,
                        fontWeight: 900,
                      }}
                    >
                      {formatSigned(tx.net)}
                    </td>
                    <td
                      style={{
                        padding: "13px 12px",
                        color: spermTheme.textSecondary,
                        fontSize: 13,
                        fontFamily: "monospace",
                      }}
                    >
                      {shortId(tx.txSignature)}
                    </td>
                    <td
                      style={{
                        padding: "13px 12px",
                        color: spermTheme.textSecondary,
                        fontSize: 13,
                        fontFamily: "monospace",
                      }}
                    >
                      {shortWallet(tx.sourceWallet)}
                    </td>
                    <td
                      style={{
                        padding: "13px 12px",
                        color: spermTheme.textTertiary,
                        fontSize: 13,
                      }}
                    >
                      {new Date(tx.timestamp).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasMore && onLoadMore && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            style={{
              border: `1px solid ${spermTheme.accentBorder}`,
              background: spermTheme.accentSoft,
              color: spermTheme.textPrimary,
              borderRadius: 12,
              minHeight: 44,
              minWidth: 160,
              padding: "0 16px",
              cursor: loadingMore ? "wait" : "pointer",
              fontSize: 14,
              fontWeight: 800,
            }}
          >
            {loadingMore ? "Loading..." : "Load More"}
          </button>
        </div>
      )}
    </section>
  );
}
