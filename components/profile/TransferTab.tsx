"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSessionWalletContext } from "@/context/SessionWalletContext";
import { useSprmBalance } from "@/hooks/useSprmBalance";
import { spermTheme } from "@/components/theme/spermTheme";

const MIN_SESSION_SOL = 0.0025;
const TARGET_SESSION_SOL = 0.005;
const SOL_TOPUP_AMOUNT = 0.02; // ~6–7 bets worth of fees

export default function TransferTab() {
  const { publicKey } = useWallet();
  const session = useSessionWalletContext();
  const { balance: primarySprmBalance } = useSprmBalance(publicKey);

  const [depositSprm, setDepositSprm] = useState("5");
  const [lastAutoTopUp, setLastAutoTopUp] = useState(0);
  const [solTopUpStatus, setSolTopUpStatus] = useState<
    "idle" | "pending" | "done" | "error"
  >("idle");

  const sessionSol = session.sessionSolBalance ?? 0;
  const autoSolTopUp = useMemo(() => {
    if (!session.isActive) return 0;
    if (sessionSol >= MIN_SESSION_SOL) return 0;
    return Math.max(0, TARGET_SESSION_SOL - sessionSol);
  }, [session.isActive, sessionSol]);

  const solIsLow = session.isActive && sessionSol < MIN_SESSION_SOL;

  const onDeposit = async () => {
    const amount = Math.max(0, Number(depositSprm || 0));
    if (amount <= 0) return;
    setLastAutoTopUp(autoSolTopUp);
    await session.deposit(amount, autoSolTopUp);
  };

  const onTopUpSol = async () => {
    setSolTopUpStatus("pending");
    try {
      await session.deposit(0, SOL_TOPUP_AMOUNT);
      setSolTopUpStatus("done");
      setTimeout(() => setSolTopUpStatus("idle"), 3000);
    } catch {
      setSolTopUpStatus("error");
      setTimeout(() => setSolTopUpStatus("idle"), 3000);
    }
  };

  const statusText =
    session.depositStatus === "pending"
      ? "Funding session..."
      : session.depositStatus === "done"
        ? "Session funded."
        : session.depositStatus === "error"
          ? `Deposit failed: ${session.depositError}`
          : null;

  return (
    <section style={{ display: "grid", gap: 14 }}>
      <style>{`
        .transfer-title {
          font-size: 28px;
        }
        .transfer-balance-grid {
          display: grid;
          gap: 12px;
          grid-template-columns: 1fr;
        }
        @media (min-width: 640px) {
          .transfer-title {
            font-size: 44px;
          }
          .transfer-balance-grid {
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          }
        }
      `}</style>
      <div
        className="transfer-title"
        style={{
          color: spermTheme.textPrimary,
          fontWeight: 900,
          letterSpacing: 1,
        }}
      >
        TRANSFER FUNDS
      </div>

      <div
        style={{
          border: `1px solid ${spermTheme.accentBorder}`,
          borderRadius: 18,
          background: `linear-gradient(180deg, ${spermTheme.bgElevated}, rgba(10,9,19,0.84))`,
          backdropFilter: "blur(14px)",
          padding: 18,
        }}
      >
        <div
          style={{
            color: spermTheme.textPrimary,
            fontWeight: 800,
            marginBottom: 8,
            fontSize: 20,
          }}
        >
          SPRM Transfer
        </div>
        <div
          style={{
            color: spermTheme.textSecondary,
            fontSize: 14,
            marginBottom: 14,
            lineHeight: 1.5,
          }}
        >
          Transfer funds between your main wallet and Insta Wallet. SPRM is
          enabled in v1; other assets are shown as placeholders.
        </div>

        <div
          className="transfer-balance-grid"
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "1fr",
            marginBottom: 14,
          }}
        >
          <div
            style={balanceCard(
              "rgba(197,140,255,0.14)",
              "rgba(197,140,255,0.32)",
            )}
          >
            <div style={balanceLabel}>Primary Wallet</div>
            <div style={balanceValue(spermTheme.textPrimary)}>
              {(primarySprmBalance ?? 0).toFixed(4)} SPRM
            </div>
          </div>
          <div
            style={balanceCard(
              solIsLow ? "rgba(227,150,170,0.10)" : "rgba(197,140,255,0.12)",
              solIsLow ? "rgba(227,150,170,0.45)" : "rgba(197,140,255,0.32)",
            )}
          >
            <div style={balanceLabel}>Insta Wallet</div>
            <div style={balanceValue(spermTheme.accent)}>
              {(session.sessionSprmBalance ?? 0).toFixed(4)} SPRM
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 6,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  color: solIsLow ? spermTheme.error : spermTheme.textSecondary,
                  fontSize: 12,
                }}
              >
                {solIsLow ? "⚠ " : ""}
                {(session.sessionSolBalance ?? 0).toFixed(5)} SOL{" "}
                {solIsLow ? "— low fees!" : "for fees"}
              </div>
              {session.isActive && (
                <button
                  onClick={onTopUpSol}
                  disabled={solTopUpStatus === "pending"}
                  title={`Send ${SOL_TOPUP_AMOUNT} SOL from main wallet for tx fees (~0.003 SOL per bet)`}
                  style={{
                    border: `1px solid ${solIsLow ? spermTheme.error : spermTheme.accentBorder}`,
                    background: solIsLow
                      ? "rgba(227,150,170,0.18)"
                      : spermTheme.accentSoft,
                    color: solIsLow ? spermTheme.error : spermTheme.accent,
                    borderRadius: 8,
                    padding: "3px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {solTopUpStatus === "pending"
                    ? "Sending…"
                    : solTopUpStatus === "done"
                      ? "✓ Sent"
                      : `+ ${SOL_TOPUP_AMOUNT} SOL`}
                </button>
              )}
            </div>
            <div
              style={{
                color: spermTheme.textTertiary,
                fontSize: 11,
                marginTop: 4,
              }}
            >
              ~0.003 SOL per bet · {SOL_TOPUP_AMOUNT} SOL ≈{" "}
              {Math.floor(SOL_TOPUP_AMOUNT / 0.003)} bets
            </div>
          </div>
        </div>

        {!session.isActive ? (
          <div
            style={{
              border: `1px solid ${spermTheme.accentBorder}`,
              borderRadius: 14,
              background: spermTheme.accentSoft,
              padding: 16,
            }}
          >
            <div
              style={{
                color: spermTheme.textSecondary,
                fontSize: 14,
                marginBottom: 10,
              }}
            >
              Insta Wallet is not active. Create it once and keep betting
              without repeated wallet popups.
            </div>
            <button onClick={session.createSession} style={primaryGreenButton}>
              Create Session Wallet
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <input
                type="number"
                min="0"
                step="0.01"
                value={depositSprm}
                onChange={(e) => setDepositSprm(e.target.value)}
                placeholder="Amount (SPRM)"
                style={{
                  border: `1px solid ${spermTheme.accentBorder}`,
                  background: "rgba(7,9,16,0.68)",
                  color: spermTheme.textPrimary,
                  borderRadius: 12,
                  padding: "0 14px",
                  fontFamily: "inherit",
                  outline: "none",
                  width: "100%",
                  flex: "1 1 220px",
                  height: 50,
                  fontSize: 18,
                  fontWeight: 700,
                }}
              />
              <button
                onClick={onDeposit}
                disabled={session.depositStatus === "pending"}
                style={primaryGreenButton}
              >
                {session.depositStatus === "pending"
                  ? "Funding..."
                  : "Transfer To Insta Wallet"}
              </button>
            </div>

            {autoSolTopUp > 0 && (
              <div style={{ color: spermTheme.textSecondary, fontSize: 13 }}>
                Auto fee top-up enabled: +{autoSolTopUp.toFixed(5)} SOL will be
                added for smooth session betting.
              </div>
            )}

            {lastAutoTopUp > 0 && session.depositStatus === "done" && (
              <div style={{ color: spermTheme.textSecondary, fontSize: 13 }}>
                Last deposit included {lastAutoTopUp.toFixed(5)} SOL fee top-up.
              </div>
            )}

            {statusText && (
              <div
                style={{
                  color:
                    session.depositStatus === "error"
                      ? spermTheme.error
                      : spermTheme.textSecondary,
                  fontSize: 13,
                }}
              >
                {statusText}
              </div>
            )}

            <button
              onClick={() => session.withdrawAll()}
              disabled={session.withdrawStatus === "pending"}
              style={withdrawButton(session.withdrawStatus === "error")}
            >
              {session.withdrawStatus === "pending"
                ? "Withdrawing..."
                : "Withdraw All Back To Primary"}
            </button>

            {session.withdrawError && (
              <div style={{ color: spermTheme.error, fontSize: 13 }}>
                {session.withdrawError}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          border: `1px solid ${spermTheme.borderSoft}`,
          borderRadius: 16,
          background: "rgba(255,255,255,0.03)",
          padding: 14,
        }}
      >
        <div
          style={{
            color: spermTheme.textSecondary,
            fontSize: 13,
            marginBottom: 10,
            fontWeight: 700,
          }}
        >
          Select Asset
        </div>
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          <button style={assetButton(true)}>
            <span style={{ fontWeight: 800 }}>SPRM</span>
            <span style={{ color: spermTheme.textPrimary }}>Enabled</span>
          </button>
          {["SOL", "USDC", "BONK"].map((symbol) => (
            <button
              key={symbol}
              disabled
              title="Coming Soon"
              style={assetButton(false)}
            >
              <span style={{ fontWeight: 700 }}>{symbol}</span>
              <span style={{ color: spermTheme.textTertiary }}>
                Coming Soon
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function balanceCard(background: string, border: string) {
  return {
    border: `1px solid ${border}`,
    borderRadius: 14,
    padding: 14,
    background,
  };
}

const balanceLabel: CSSProperties = {
  color: spermTheme.textSecondary,
  fontSize: 12,
  marginBottom: 6,
  fontWeight: 700,
};

function balanceValue(color: string): CSSProperties {
  return {
    color,
    fontWeight: 900,
    fontSize: 28,
    lineHeight: 1,
  };
}

const primaryGreenButton: CSSProperties = {
  border: `1px solid ${spermTheme.accentBorder}`,
  background: spermTheme.accentSoft,
  color: spermTheme.accent,
  borderRadius: 12,
  padding: "0 18px",
  minHeight: 50,
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 14,
};

function withdrawButton(error: boolean): CSSProperties {
  return {
    border: `1px solid ${error ? spermTheme.error : spermTheme.accentBorder}`,
    background: spermTheme.accentSoft,
    color: error ? spermTheme.error : spermTheme.textPrimary,
    borderRadius: 12,
    height: 48,
    padding: "0 14px",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 14,
    width: "fit-content",
  };
}

function assetButton(active: boolean): CSSProperties {
  return {
    border: active
      ? `1px solid ${spermTheme.accentBorder}`
      : `1px solid ${spermTheme.borderSoft}`,
    background: active ? spermTheme.accentSoft : "rgba(255,255,255,0.03)",
    color: active ? spermTheme.textPrimary : spermTheme.textTertiary,
    borderRadius: 12,
    minHeight: 56,
    padding: "10px 12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    cursor: active ? "default" : "not-allowed",
    fontSize: 13,
  };
}
