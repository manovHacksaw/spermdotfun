"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useEvmWallet } from "@/components/WalletProvider";
import { useRouter } from "next/navigation";
import {
  Volume2,
  VolumeX,
  ChevronDown,
  Bell,
  User,
  ReceiptText,
  ArrowLeftRight,
  Settings as SettingsIcon,
  Trophy,
  Handshake,
  BadgeDollarSign,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import { useUsername } from "@/hooks/useUsername";
import { useSessionWalletContext } from "@/context/SessionWalletContext";
import { useSprmBalance } from "@/hooks/useSprmBalance";
import { type ProfileTab } from "@/lib/profile/types";
import { spermTheme } from "@/components/theme/spermTheme";
import { ConnectButton } from '@rainbow-me/rainbowkit';

function getAvatarColor(addr: string) {
  const palettes = [
    ["#f5f5f2", "#c58cff"],
    ["#dcd2ec", "#a786cf"],
    ["#eee8f7", "#8f74bb"],
    ["#cbc0df", "#7d65a5"],
    ["#f3eefc", "#b494dd"],
    ["#bdb1d3", "#6f5a93"],
  ];
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = addr.charCodeAt(i) + ((h << 5) - h);
  return palettes[Math.abs(h) % palettes.length];
}

export default function TopHeader() {
  const router = useRouter();
  const { address, connected, disconnect, connect } = useEvmWallet();
  const { balance } = useSprmBalance(address);

  const [walletOpen, setWalletOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(35);
  const [vw, setVw] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1200,
  );
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isNarrow = vw < 900;
  const isTiny = vw < 640;
  const btnSize = isTiny ? 28 : isNarrow ? 30 : 34;

  // Session wallet deposit inputs
  const [sessionDepositSprm, setSessionDepositSprm] = useState("5");

  const session = useSessionWalletContext();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const walletRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const addrStr = address ?? "";
  const shortAddr = addrStr
    ? `${addrStr.slice(0, 6)}…${addrStr.slice(-4)}`
    : "";
  const { username, initials } = useUsername(addrStr || null);
  const [av1, av2] = getAvatarColor(addrStr || "anon");

  // ── Audio ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio("/delosound-energetic-sports-471133.mp3");
    audio.loop = true;
    audio.volume = volume / 100;
    audio.play().catch(() => { });
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (audioRef.current)
      audioRef.current.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("sprmfun:balance", { detail: { balance } }),
    );
  }, [balance]);

  const loadProfileVolume = useCallback(async (wallet: string) => {
    try {
      const response = await fetch(
        `/api/profile/overview?wallet=${encodeURIComponent(wallet)}&range=24H&txLimit=1`,
      );
      if (!response.ok) return;
      const payload = await response.json();
      const nextVolume = Number(payload?.settings?.volume);
      if (Number.isFinite(nextVolume)) {
        setVolume(Math.max(0, Math.min(100, Math.round(nextVolume))));
      }
    } catch {
      // ignore network failures so header keeps operating
    }
  }, []);

  useEffect(() => {
    if (!addrStr) {
      setVolume(35);
      return;
    }
    void loadProfileVolume(addrStr);
  }, [addrStr, loadProfileVolume]);

  useEffect(() => {
    const onSettingsUpdated = (event: Event) => {
      const detail = (
        event as CustomEvent<{ wallet?: string; volume?: number }>
      ).detail;
      if (!addrStr) return;
      if (detail?.wallet && detail.wallet !== addrStr) return;
      if (Number.isFinite(detail?.volume)) {
        setVolume(
          Math.max(0, Math.min(100, Math.round(Number(detail?.volume)))),
        );
        return;
      }
      void loadProfileVolume(addrStr);
    };
    window.addEventListener(
      "sprmfun:profile_settings_updated",
      onSettingsUpdated as EventListener,
    );
    return () =>
      window.removeEventListener(
        "sprmfun:profile_settings_updated",
        onSettingsUpdated as EventListener,
      );
  }, [addrStr, loadProfileVolume]);

  const [avaxPrice, setAvaxPrice] = useState<number | null>(null);
  useEffect(() => {
    const onPrice = (e: Event) => {
      const detail = (e as CustomEvent<{ price: number }>).detail;
      setAvaxPrice(detail.price);
    };
    window.addEventListener("sprmfun:price", onPrice as EventListener);
    return () => window.removeEventListener("sprmfun:price", onPrice as EventListener);
  }, []);

  // ── Outside click ─────────────────────────────────────────────────────────
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (walletRef.current && !walletRef.current.contains(e.target as Node))
        setWalletOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node))
        setProfileOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const goToProfileTab = (tab: ProfileTab) => {
    setWalletOpen(false);
    setProfileOpen(false);
    router.push(`/profile?tab=${tab}`);
  };

  const profileMenuItems = [
    { icon: User, label: "Profile", tab: "stats" as const },
    { icon: ReceiptText, label: "Transactions", tab: "transactions" as const },
    { icon: ArrowLeftRight, label: "Transfer Funds", tab: "transfer" as const },
    { icon: SettingsIcon, label: "Settings", tab: "settings" as const },
  ];

  const disabledMenuItems = [
    { icon: Trophy, label: "Achievements" },
    { icon: Handshake, label: "Affiliates" },
    { icon: BadgeDollarSign, label: "Cashback" },
    { icon: ShieldCheck, label: "Fairness" },
  ];

  const NAV_ITEMS = [
    { label: "PLAY",        href: "/",          active: true  },
    { label: "LEADERBOARD", href: "/profile",    active: false },
    { label: "FAUCET",      href: "/faucet",     active: false },
  ];

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 56,
        zIndex: 200,
        background: spermTheme.bgPanel,
        borderBottom: `1px solid ${spermTheme.borderChrome}`,
        display: "flex",
        alignItems: "center",
        paddingLeft: isTiny ? 10 : 16,
        paddingRight: isTiny ? 8 : 16,
        gap: isTiny ? 6 : 12,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* ── Logo ── */}
      <button
        onClick={() => router.push("/")}
        style={{
          flexShrink: 0,
          border: "none",
          cursor: "pointer",
          padding: "0 4px",
          display: "flex",
          alignItems: "center",
          gap: 2,
          background: "transparent",
        }}
        type="button"
        aria-label="Home"
      >
        <span style={{ fontSize: isTiny ? 15 : 18, fontWeight: 800, color: spermTheme.textPrimary, letterSpacing: -0.5 }}>
          SPRM
        </span>
        <span style={{ fontSize: isTiny ? 15 : 18, fontWeight: 800, color: spermTheme.accent, letterSpacing: -0.5 }}>
          .FUN
        </span>
      </button>

      {/* ── Nav tabs (hidden on tiny) ── */}
      {!isTiny && (
        <nav style={{ display: "flex", alignItems: "center", gap: 2 }}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.label}
              onClick={() => router.push(item.href)}
              style={{
                background: item.active ? spermTheme.accentSoft : "transparent",
                border: `1px solid ${item.active ? spermTheme.accentBorder : "transparent"}`,
                borderRadius: 6,
                padding: "5px 12px",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 0.5,
                color: item.active ? spermTheme.accentBright : spermTheme.textSecondary,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}

      {/* ── Spacer ── */}
      <div style={{ flex: 1 }} />

      {/* ── AVAX Live price ── */}
      {avaxPrice !== null && !isTiny && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(139,92,246,0.06)",
            border: `1px solid ${spermTheme.borderAccent}`,
            borderRadius: 6,
            padding: "5px 10px",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: spermTheme.success,
              boxShadow: `0 0 6px ${spermTheme.success}`,
              animation: "pulse-dot 2s infinite",
            }}
          />
          <span style={{ fontSize: 10, color: spermTheme.textSecondary, fontWeight: 600, letterSpacing: 0.5 }}>AVAX</span>
          <span style={{ fontSize: 13, color: spermTheme.textPrimary, fontWeight: 700 }}>${avaxPrice.toFixed(2)}</span>
        </div>
      )}

        {/* ── RIGHT CLUSTER ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: isTiny ? 4 : 8,
            minWidth: 0,
          }}
        >
          {/* PRIMARY wallet dropdown */}
          {connected &&
            (() => {
              const isPrimary = session.activeWallet === "primary";
              const showInstant = !isPrimary && session.isActive;
              const headerIcon = showInstant ? "⚡" : "💎";
              const headerLabel = showInstant ? "INSTA" : "PRIMARY";
              const headerBal = showInstant
                ? (session.sessionSprmBalance?.toFixed(4) ?? "0.0000")
                : balance !== null
                  ? balance.toFixed(4)
                  : "0.0000";
              const headerColor = showInstant
                ? spermTheme.accent
                : spermTheme.textPrimary;
              const headerBg = `linear-gradient(135deg, ${av1}, ${av2})`;
              return (
                <div ref={walletRef} style={{ position: "relative" }}>
                  <button
                    onClick={() => setWalletOpen((o) => !o)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: isTiny ? 4 : 8,
                      background: walletOpen ? spermTheme.accentSoft : spermTheme.bgCard,
                      border: `1px solid ${walletOpen ? spermTheme.accentBorder : spermTheme.borderChrome}`,
                      borderRadius: 7,
                      padding: isTiny ? "0 8px" : "0 12px",
                      height: btnSize,
                      color: "#fff",
                      cursor: "pointer",
                      fontFamily: "'JetBrains Mono', monospace",
                      transition: "all 0.15s ease",
                      minWidth: 0,
                      overflow: "hidden",
                    }}
                  >
                    {!isTiny && (
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 5,
                          flexShrink: 0,
                          background: headerBg,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          overflow: "hidden",
                        }}
                      >
                        {headerIcon}
                      </div>
                    )}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        lineHeight: 1.1,
                        minWidth: 0,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 9,
                          letterSpacing: 1,
                          color: "rgba(245,245,242,0.58)",
                          marginBottom: 2,
                        }}
                      >
                        {headerLabel}
                      </div>
                      <div
                        style={{
                          fontSize: isTiny ? 11 : 13,
                          fontWeight: 700,
                          color: headerColor,
                          fontFamily: "inherit",
                          lineHeight: 1,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {headerBal} SPRM
                      </div>
                    </div>
                    <ChevronDown
                      size={16}
                      style={{
                        color: "rgba(245,245,242,0.46)",
                        transform: walletOpen ? "rotate(180deg)" : "none",
                        transition: "transform 0.15s",
                      }}
                    />
                  </button>

                  {walletOpen && (
                    <div
                      style={{
                        position: "absolute",
                        top: "calc(100% + 10px)",
                        right: 0,
                        width: 320,
                        borderRadius: 8,
                        border: `1px solid ${spermTheme.borderChrome}`,
                        background: spermTheme.bgPanel,
                        backdropFilter: "blur(32px)",
                        WebkitBackdropFilter: "blur(32px)",
                        boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
                        zIndex: 420,
                      }}
                    >
                      <div
                        style={{
                          borderRadius: 15,
                          padding: "11px 10px 10px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            color: "rgba(245,245,242,0.56)",
                            letterSpacing: 1,
                            paddingLeft: 3,
                          }}
                        >
                          Select Wallet:
                        </div>

                        {/* SPRM row (clickable selector) */}
                        <button
                          onClick={() => session.setActiveWallet("primary")}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            width: "100%",
                            background:
                              session.activeWallet === "primary"
                                ? "rgba(197,140,255,0.14)"
                                : "rgba(245,245,242,0.04)",
                            border: `1px solid ${session.activeWallet === "primary" ? "rgba(197,140,255,0.45)" : "rgba(245,245,242,0.14)"}`,
                            borderRadius: 10,
                            padding: "9px 10px",
                            cursor: "pointer",
                            transition: "all 0.15s",
                            textAlign: "left",
                            fontFamily: "inherit",
                          }}
                        >
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 9,
                              background: `linear-gradient(135deg, ${av1}, ${av2})`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 14,
                              flexShrink: 0,
                              overflow: "hidden",
                            }}
                          >
                            💎
                          </div>
                          <div style={{ flex: 1, fontFamily: "'JetBrains Mono', monospace" }}>
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                color: spermTheme.textTertiary,
                                marginBottom: 4,
                                letterSpacing: 1.5
                              }}
                            >
                              SPRM_PRIMARY
                            </div>
                            <div
                              style={{
                                fontSize: 24,
                                color: "#F5F5F2",
                                fontWeight: 900,
                                lineHeight: 1,
                              }}
                            >
                              {balance !== null ? balance.toFixed(4) : "0.0000"}
                            </div>
                          </div>
                          {session.activeWallet === "primary" && (
                            <div
                              style={{
                                fontSize: 9,
                                background: "rgba(197,140,255,0.18)",
                                border: "1px solid rgba(197,140,255,0.48)",
                                borderRadius: 4,
                                padding: "2px 6px",
                                color: "#C58CFF",
                                fontWeight: 800,
                                letterSpacing: 0.5,
                              }}
                            >
                              ACTIVE
                            </div>
                          )}
                        </button>

                        {/* ── INSTA WALLET (live) ── */}
                        <div
                          style={{
                            background:
                              session.activeWallet === "instant"
                                ? "rgba(197,140,255,0.14)"
                                : "rgba(245,245,242,0.04)",
                            border: `1px solid ${session.activeWallet === "instant" && session.isActive ? "rgba(197,140,255,0.52)" : "rgba(245,245,242,0.14)"}`,
                            borderRadius: 10,
                            overflow: "hidden",
                            transition: "all 0.15s",
                          }}
                        >
                          {/* Header row (clickable when session is active) */}
                          <div
                            onClick={() => {
                              if (session.isActive)
                                session.setActiveWallet("instant");
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "9px 10px",
                              borderBottom: session.isActive
                                ? "1px solid rgba(245,245,242,0.14)"
                                : "none",
                              cursor: session.isActive ? "pointer" : "default",
                            }}
                          >
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 9,
                                background: `linear-gradient(135deg, ${av1}, ${av2})`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 18,
                                flexShrink: 0,
                              }}
                            >
                              👛
                            </div>
                            <div style={{ flex: 1 }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  marginBottom: 2,
                                  flexWrap: "wrap",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 900,
                                    color: "rgba(245,245,242,0.92)",
                                    letterSpacing: 0.5,
                                  }}
                                >
                                  INSTA WALLET
                                </div>
                                <div
                                  style={{
                                    fontSize: 7,
                                    background: session.isActive
                                      ? "rgba(197,140,255,0.18)"
                                      : "rgba(245,245,242,0.08)",
                                    border: "1px solid rgba(245,245,242,0.14)",
                                    borderRadius: 3,
                                    padding: "1px 5px",
                                    color: "rgba(197,140,255,0.92)",
                                    letterSpacing: 0.6,
                                  }}
                                >
                                  {session.isActive ? "LIVE" : "OFF"}
                                </div>
                              </div>
                              <div
                                style={{
                                  fontSize: 24,
                                  color: spermTheme.accent,
                                  fontWeight: 900,
                                  lineHeight: 1,
                                  fontFamily: "'JetBrains Mono', monospace"
                                }}
                              >
                                {session.isActive
                                  ? (session.sessionSprmBalance?.toFixed(4) ??
                                    "0.0000")
                                  : "0.0000"}
                              </div>
                              {session.isActive && (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    marginTop: 3,
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 10,
                                      color: "rgba(245,245,242,0.62)",
                                      fontFamily: "monospace",
                                    }}
                                  >
                                    {session.sessionAddress
                                      ? `${session.sessionAddress.slice(0, 6)}…${session.sessionAddress.slice(-4)}`
                                      : ""}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 9,
                                      color: "rgba(245,245,242,0.46)",
                                    }}
                                  >
                                    (needs AVAX for gas)
                                  </span>
                                </div>
                              )}
                            </div>
                            {session.isActive &&
                              session.activeWallet === "instant" && (
                                <div
                                  style={{
                                    fontSize: 9,
                                    background: "rgba(197,140,255,0.18)",
                                    border: "1px solid rgba(197,140,255,0.52)",
                                    borderRadius: 4,
                                    padding: "2px 6px",
                                    color: "#C58CFF",
                                    fontWeight: 800,
                                    letterSpacing: 0.5,
                                  }}
                                >
                                  ACTIVE
                                </div>
                              )}
                          </div>

                          {/* ── No session → CREATE button ── */}
                          {!session.isActive && (
                            <div
                              style={{
                                padding: "9px 10px",
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 10,
                                  color: "rgba(245,245,242,0.66)",
                                  lineHeight: 1.45,
                                }}
                              >
                                Fund once, bet silently without MetaMask popup on
                                every bet. Session wallet needs a small AVAX balance for gas.
                              </div>
                              <button
                                onClick={() => {
                                  session.createSession();
                                  session.setActiveWallet("instant");
                                }}
                                style={{
                                  width: "100%",
                                  padding: "8px 0",
                                  background: "rgba(197,140,255,0.14)",
                                  border: "1px solid rgba(197,140,255,0.52)",
                                  borderRadius: 8,
                                  color: "#C58CFF",
                                  cursor: "pointer",
                                  fontSize: 12,
                                  fontWeight: 800,
                                  fontFamily: "inherit",
                                }}
                              >
                                ⚡ CREATE SESSION
                              </button>
                            </div>
                          )}

                          {/* ── Active session panel ── */}
                          {session.isActive && (
                            <div
                              style={{
                                padding: "9px 10px",
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                              }}
                            >
                              {/* Address */}
                              <div
                                style={{
                                  fontSize: 9,
                                  color: "rgba(245,245,242,0.62)",
                                  fontFamily: "monospace",
                                  letterSpacing: 0.5,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {session.sessionAddress?.slice(0, 10)}…
                                {session.sessionAddress?.slice(-8)}
                              </div>

                              {/* Deposit form */}
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 6,
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 9,
                                    color: "rgba(245,245,242,0.72)",
                                    letterSpacing: 1,
                                    fontWeight: 800,
                                  }}
                                >
                                  DEPOSIT SPRM (one MetaMask approval)
                                </div>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={sessionDepositSprm}
                                  onChange={(e) =>
                                    setSessionDepositSprm(e.target.value)
                                  }
                                  placeholder="Amount (SPRM)"
                                  style={{
                                    width: "100%",
                                    background: "rgba(245,245,242,0.06)",
                                    border: "1px solid rgba(245,245,242,0.16)",
                                    borderRadius: 6,
                                    padding: "7px 10px",
                                    color: "#F5F5F2",
                                    fontSize: 14,
                                    fontWeight: 800,
                                    fontFamily: "inherit",
                                    outline: "none",
                                    boxSizing: "border-box",
                                  }}
                                />
                                <button
                                  disabled={session.depositStatus === "pending"}
                                  onClick={() =>
                                    session.deposit(
                                      parseFloat(sessionDepositSprm) || 0,
                                    )
                                  }
                                  style={{
                                    width: "100%",
                                    padding: "8px 0",
                                    background:
                                      session.depositStatus === "done"
                                        ? "rgba(197,140,255,0.24)"
                                        : session.depositStatus === "error"
                                          ? "rgba(227,150,170,0.18)"
                                          : "rgba(245,245,242,0.14)",
                                    border: `1px solid ${session.depositStatus === "done" ? "rgba(197,140,255,0.86)" : session.depositStatus === "error" ? "#E396AA" : "rgba(245,245,242,0.34)"}`,
                                    borderRadius: 7,
                                    color:
                                      session.depositStatus === "done"
                                        ? "#C58CFF"
                                        : session.depositStatus === "error"
                                          ? "#E396AA"
                                          : "#F5F5F2",
                                    cursor:
                                      session.depositStatus === "pending"
                                        ? "wait"
                                        : "pointer",
                                    fontSize: 13,
                                    fontWeight: 900,
                                    fontFamily: "inherit",
                                  }}
                                >
                                  {session.depositStatus === "pending"
                                    ? "⏳ FUNDING…"
                                    : session.depositStatus === "done"
                                      ? "✓ FUNDED"
                                      : session.depositStatus === "error"
                                        ? `✗ ${session.depositError}`
                                        : "⚡ FUND SESSION"}
                                </button>
                              </div>

                              {/* Withdraw + Destroy */}
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  disabled={
                                    session.withdrawStatus === "pending"
                                  }
                                  onClick={() => session.withdrawAll()}
                                  style={{
                                    flex: 1,
                                    padding: "7px 0",
                                    background:
                                      session.withdrawStatus === "done"
                                        ? "rgba(197,140,255,0.18)"
                                        : "rgba(245,245,242,0.10)",
                                    border: `1px solid ${session.withdrawStatus === "done" ? "rgba(197,140,255,0.86)" : session.withdrawStatus === "error" ? "#E396AA" : "rgba(245,245,242,0.28)"}`,
                                    borderRadius: 7,
                                    color:
                                      session.withdrawStatus === "done"
                                        ? "#C58CFF"
                                        : session.withdrawStatus === "error"
                                          ? "#E396AA"
                                          : "#F5F5F2",
                                    cursor:
                                      session.withdrawStatus === "pending"
                                        ? "wait"
                                        : "pointer",
                                    fontSize: 11,
                                    fontWeight: 800,
                                    fontFamily: "inherit",
                                  }}
                                >
                                  {session.withdrawStatus === "pending"
                                    ? "⏳…"
                                    : session.withdrawStatus === "done"
                                      ? "✓ DONE"
                                      : session.withdrawStatus === "error"
                                        ? "✗ FAILED"
                                        : "↩ WITHDRAW ALL"}
                                </button>
                                <button
                                  onClick={() => {
                                    session.destroySession();
                                    setWalletOpen(false);
                                  }}
                                  style={{
                                    padding: "7px 10px",
                                    background: "rgba(227,150,170,0.12)",
                                    border: "1px solid rgba(227,150,170,0.45)",
                                    borderRadius: 7,
                                    color: spermTheme.error,
                                    cursor: "pointer",
                                    fontSize: 11,
                                    fontWeight: 800,
                                    fontFamily: "inherit",
                                  }}
                                  title="Delete session keypair from localStorage"
                                >
                                  🗑 DESTROY
                                </button>
                              </div>

                              {session.withdrawError && (
                                <div style={{ fontSize: 10, color: "#E396AA" }}>
                                  {session.withdrawError}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 9,
                            color: "rgba(245,245,242,0.52)",
                            textAlign: "center",
                            marginTop: 1,
                          }}
                        >
                          All bets settled in SPRM
                        </div>

                        {(balance === null || balance < 2) && (
                          <button
                            onClick={() => {
                              window.dispatchEvent(
                                new CustomEvent("sprmfun:faucet"),
                              );
                              setWalletOpen(false);
                            }}
                            style={{
                              width: "100%",
                              padding: "9px 0",
                              background: "rgba(197,140,255,0.14)",
                              border: "1px solid rgba(197,140,255,0.48)",
                              borderRadius: 9,
                              color: "#C58CFF",
                              cursor: "pointer",
                              fontSize: 12,
                              fontWeight: 800,
                              fontFamily: "inherit",
                            }}
                          >
                            + GET TOKENS
                          </button>
                        )}

                        <button
                          onClick={() => goToProfileTab("transfer")}
                          style={{
                            width: "100%",
                            padding: "10px 0",
                            background: "rgba(245,245,242,0.06)",
                            border: "1px solid rgba(245,245,242,0.14)",
                            borderRadius: 10,
                            color: "#F5F5F2",
                            cursor: "pointer",
                            fontSize: 14,
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 7,
                            fontFamily: "inherit",
                          }}
                        >
                          ⇄ Transfer Funds
                        </button>
                        <button
                          disabled
                          title="Coming Soon"
                          style={{
                            width: "100%",
                            padding: "10px 0",
                            background: "rgba(245,245,242,0.04)",
                            border: "1px solid rgba(245,245,242,0.12)",
                            borderRadius: 10,
                            color: "rgba(245,245,242,0.46)",
                            cursor: "not-allowed",
                            fontSize: 13,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 7,
                            fontFamily: "inherit",
                          }}
                        >
                          ⚙ Manage Wallet (Coming Soon)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          {/* Mute */}
          <button
            onClick={() => {
              setMuted((m) => !m);
              if (audioRef.current && audioRef.current.paused)
                audioRef.current.play().catch(() => { });
            }}
            style={{
              background: spermTheme.bgCard,
              border: `1px solid ${spermTheme.borderChrome}`,
              borderRadius: 6,
              height: btnSize,
              width: btnSize,
              cursor: "pointer",
              color: spermTheme.textSecondary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? (
              <VolumeX size={14} />
            ) : (
              <Volume2 size={14} />
            )}
          </button>

          {/* Bell — hidden on small screens */}
          {!isTiny && (
            <button
              style={{
                background: spermTheme.bgCard,
                border: `1px solid ${spermTheme.borderChrome}`,
                borderRadius: 6,
                height: btnSize,
                width: btnSize,
                cursor: "pointer",
                color: spermTheme.textSecondary,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                position: "relative",
              }}
            >
              <Bell size={14} />
              <div
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: spermTheme.accent,
                  border: `1.5px solid ${spermTheme.bgPanel}`,
                }}
              />
            </button>
          )}

          {/* Profile avatar + dropdown — real connect button when disconnected */}
          {connected ? (
            <div ref={profileRef} style={{ position: "relative" }}>
              <button
                onClick={() => setProfileOpen((o) => !o)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: profileOpen ? spermTheme.accentSoft : spermTheme.bgCard,
                  border: `1px solid ${profileOpen ? spermTheme.accentBorder : spermTheme.borderChrome}`,
                  borderRadius: 7,
                  padding: "0 8px 0 4px",
                  height: btnSize,
                  cursor: "pointer",
                  color: "#fff",
                  fontFamily: "inherit",
                  transition: "all 0.15s",
                }}
              >
                {/* Avatar */}
                <div
                  style={{
                    width: isTiny ? 22 : 24,
                    height: isTiny ? 22 : 24,
                    borderRadius: 5,
                    flexShrink: 0,
                    background: `linear-gradient(135deg, ${av1}, ${av2})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 800,
                    color: "rgba(10,7,18,0.7)",
                  }}
                >
                  {initials}
                </div>
                <ChevronDown
                  size={12}
                  style={{
                    color: spermTheme.textSecondary,
                    transform: profileOpen ? "rotate(180deg)" : "none",
                    transition: "transform 0.15s",
                  }}
                />
              </button>

              {profileOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 10px)",
                    right: 0,
                    width: 284,
                    borderRadius: 8,
                    border: `1px solid ${spermTheme.borderChrome}`,
                    background: 'rgba(0,0,0,0.85)',
                    backdropFilter: "blur(32px)",
                    WebkitBackdropFilter: "blur(32px)",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
                    zIndex: 450,
                  }}
                >
                  <div
                    style={{
                      borderRadius: 15,
                      padding: "11px 11px 10px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    {/* Avatar + address */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "3px 2px 10px",
                        borderBottom: "1px solid rgba(245,245,242,0.14)",
                      }}
                    >
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 10,
                          background: `linear-gradient(135deg, ${av1}, ${av2})`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 15,
                          fontWeight: 800,
                          color: "rgba(10,7,18,0.62)",
                          flexShrink: 0,
                          boxShadow: "0 8px 22px rgba(0,0,0,0.28)",
                        }}
                      >
                        {initials}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 800,
                            color: "rgba(245,245,242,0.92)",
                            marginBottom: 2,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {username || "Connecting…"}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "rgba(245,245,242,0.62)",
                            fontFamily: "monospace",
                          }}
                        >
                          {shortAddr}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      {profileMenuItems.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.label}
                            onClick={() => goToProfileTab(item.tab)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              background: "transparent",
                              border: "none",
                              borderRadius: 8,
                              padding: "8px 8px",
                              color: "rgba(245,245,242,0.82)",
                              cursor: "pointer",
                              fontSize: 15,
                              fontFamily: "inherit",
                              textAlign: "left",
                              transition: "background 0.12s",
                            }}
                          >
                            <Icon
                              size={14}
                              style={{
                                color: "rgba(197,140,255,0.94)",
                                flexShrink: 0,
                              }}
                            />
                            <span>{item.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div
                      style={{
                        height: 1,
                        background: "rgba(245,245,242,0.14)",
                      }}
                    />

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      {disabledMenuItems.map((item) => {
                        const Icon = item.icon;
                        return (
                          <button
                            key={item.label}
                            disabled
                            title="Coming Soon"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              background: "transparent",
                              border: "none",
                              borderRadius: 8,
                              padding: "8px 8px",
                              color: "rgba(245,245,242,0.52)",
                              cursor: "not-allowed",
                              fontSize: 15,
                              fontFamily: "inherit",
                              textAlign: "left",
                            }}
                          >
                            <Icon
                              size={14}
                              style={{
                                color: "rgba(245,245,242,0.44)",
                                flexShrink: 0,
                              }}
                            />
                            <span>{item.label} (Coming Soon)</span>
                          </button>
                        );
                      })}
                    </div>

                    <div
                      style={{
                        height: 1,
                        background: "rgba(245,245,242,0.14)",
                      }}
                    />

                    <button
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: "transparent",
                        border: "none",
                        borderRadius: 8,
                        padding: "8px 8px",
                        color: "rgba(227,150,170,0.86)",
                        cursor: "pointer",
                        fontSize: 15,
                        fontFamily: "inherit",
                        textAlign: "left",
                      }}
                      onClick={() => {
                        disconnect();
                        setProfileOpen(false);
                      }}
                    >
                      <LogOut
                        size={14}
                        style={{
                          color: "rgba(227,150,170,0.86)",
                          flexShrink: 0,
                        }}
                      />
                      <span>DISCONNECT_SYSTEM</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Connect Wallet button for EVM (handled by RainbowKit) */
            <ConnectButton.Custom>
              {({
                account,
                chain,
                openAccountModal,
                openChainModal,
                openConnectModal,
                authenticationStatus,
                mounted,
              }) => {
                const ready = mounted && authenticationStatus !== 'loading';
                const hasConnected =
                  ready &&
                  account &&
                  chain &&
                  (!authenticationStatus ||
                    authenticationStatus === 'authenticated');
                return (
                  <div
                    {...(!ready && {
                      'aria-hidden': true,
                      style: {
                        opacity: 0,
                        pointerEvents: 'none',
                        userSelect: 'none',
                      },
                    })}
                  >
                    {(() => {
                      if (!hasConnected) {
                        return (
                          <button
                            onClick={openConnectModal}
                            type="button"
                            style={{
                              background: `linear-gradient(135deg, ${spermTheme.accent}, ${spermTheme.accentBright})`,
                              border: "none",
                              borderRadius: 7,
                              fontSize: 12,
                              height: btnSize,
                              padding: isTiny ? "0 10px" : "0 16px",
                              fontFamily: "inherit",
                              color: "#fff",
                              cursor: "pointer",
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                              boxShadow: `0 4px 14px ${spermTheme.accentGlow}`,
                            }}
                          >
                            Connect Wallet
                          </button>
                        );
                      }
                      if (chain.unsupported) {
                        return (
                          <button
                            onClick={openChainModal}
                            type="button"
                            style={{
                              background: 'rgba(227,150,170,0.12)',
                              border: '1px solid rgba(227,150,170,0.45)',
                              borderRadius: isTiny ? 8 : 10,
                              fontSize: isTiny ? 10 : 12,
                              height: btnSize,
                              padding: isTiny ? "0 8px" : "0 16px",
                              fontFamily: "inherit",
                              color: spermTheme.error,
                              cursor: "pointer",
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                            }}
                          >
                            Wrong Network
                          </button>
                        );
                      }
                      return (
                        <div style={{ display: 'flex', gap: 12 }}>
                          {/* Add native balance here if desired in the future */}
                        </div>
                      );
                    })()}
                  </div>
                );
              }}
            </ConnectButton.Custom>
          )}
        </div>
    </div>
  );
}
