"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import TopHeader from "@/components/TopHeader";
import LeftRail from "@/components/LeftRail";
import GlobalChat from "@/components/GlobalChat";
import ConnectGate from "@/components/profile/ConnectGate";
import ProfileHeaderCard from "@/components/profile/ProfileHeaderCard";
import ProfileTabs from "@/components/profile/ProfileTabs";
import StatsTab from "@/components/profile/StatsTab";
import TransferTab from "@/components/profile/TransferTab";
import TransactionsTab from "@/components/profile/TransactionsTab";
import SettingsTab from "@/components/profile/SettingsTab";
import ReferralsTab from "@/components/profile/ReferralsTab";
import {
  DUAL_PANEL_WIDTH,
  LEFT_RAIL_BREAKPOINT,
  MOBILE_BREAKPOINT,
  SINGLE_PANEL_WIDTH,
  TOP_HEADER_HEIGHT,
} from "@/components/leftRailShared";
import { spermTheme } from "@/components/theme/spermTheme";
import { useProfileData } from "@/hooks/useProfileData";
import { useSprmBalance } from "@/hooks/useSprmBalance";
import { useSessionWalletContext } from "@/context/SessionWalletContext";
import { type ProfileTab } from "@/lib/profile/types";

const allowedTabs: ProfileTab[] = [
  "stats",
  "referrals",
  "transfer",
  "transactions",
  "settings",
];

function normalizeTab(value: string | null): ProfileTab {
  if (value && allowedTabs.includes(value as ProfileTab))
    return value as ProfileTab;
  return "stats";
}

function ProfilePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { connected, publicKey, signMessage } = useWallet();
  const session = useSessionWalletContext();
  // Start at 0 to avoid hydration mismatch; update after mount
  const [leftRailWidth, setLeftRailWidth] = useState(0);

  const walletAddress = publicKey?.toBase58() ?? null;
  const { balance: primarySprmBalance } = useSprmBalance(walletAddress);
  const {
    settings,
    stats,
    pnlSeries,
    statsRange,
    setStatsRange,
    statsLoading,
    statsError,
    transactions,
    transactionsLoading,
    transactionsError,
    transactionsHasMore,
    loadMoreTransactions,
    loadingMoreTransactions,
    saveSettings,
    settingsSaving,
    settingsError,
  } = useProfileData(walletAddress, signMessage ?? undefined);

  const tabParam = searchParams.get("tab");
  const activeTab = normalizeTab(tabParam);

  useEffect(() => {
    if (tabParam === activeTab) return;
    router.replace(`/profile?tab=${activeTab}`);
  }, [activeTab, router, tabParam]);

  useEffect(() => {
    const syncLayout = () => {
      const vw = window.innerWidth;
      if (vw < MOBILE_BREAKPOINT) {
        setLeftRailWidth(0);
      } else if (vw < LEFT_RAIL_BREAKPOINT) {
        setLeftRailWidth(SINGLE_PANEL_WIDTH);
      } else {
        setLeftRailWidth(DUAL_PANEL_WIDTH);
      }
    };
    const onRailWidth = (e: Event) => {
      setLeftRailWidth((e as CustomEvent<number>).detail);
    };
    syncLayout();
    window.addEventListener("resize", syncLayout);
    window.addEventListener("sprmfun:railwidth", onRailWidth);
    return () => {
      window.removeEventListener("resize", syncLayout);
      window.removeEventListener("sprmfun:railwidth", onRailWidth);
    };
  }, []);

  const content = useMemo(() => {
    if (!walletAddress) return null;

    if (activeTab === "transfer") return <TransferTab />;
    if (activeTab === "transactions") {
      return (
        <TransactionsTab
          transactions={transactions}
          loading={transactionsLoading}
          error={transactionsError}
          hasMore={transactionsHasMore}
          loadingMore={loadingMoreTransactions}
          onLoadMore={loadMoreTransactions}
        />
      );
    }
    if (activeTab === "settings") {
      return (
        <SettingsTab
          walletAddress={walletAddress}
          settings={settings}
          onSave={saveSettings}
          saving={settingsSaving}
          errorMessage={settingsError}
        />
      );
    }
    if (activeTab === "referrals") {
      return <ReferralsTab settings={settings} loading={statsLoading} />;
    }

    return (
      <StatsTab
        stats={stats}
        pnlSeries={pnlSeries}
        filter={statsRange}
        onChangeFilter={setStatsRange}
        loading={statsLoading}
        error={statsError}
      />
    );
  }, [
    activeTab,
    loadMoreTransactions,
    loadingMoreTransactions,
    pnlSeries,
    saveSettings,
    settings,
    settingsError,
    settingsSaving,
    setStatsRange,
    stats,
    statsError,
    statsLoading,
    statsRange,
    transactions,
    transactionsError,
    transactionsHasMore,
    transactionsLoading,
    walletAddress,
  ]);

  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        background: spermTheme.bgBase,
        overflow: "hidden",
      }}
    >
      <TopHeader />
      <LeftRail />
      <GlobalChat />

      <div
        style={{
          position: "relative",
          height: "100%",
          paddingTop: TOP_HEADER_HEIGHT,
          overflow: "auto",
          marginLeft: leftRailWidth,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at 12% 18%, rgba(197,140,255,0.18) 0%, rgba(7,6,16,0) 42%), radial-gradient(circle at 82% 30%, rgba(197,140,255,0.10) 0%, rgba(7,6,16,0) 45%), radial-gradient(circle at 60% 86%, rgba(197,140,255,0.07) 0%, rgba(7,6,16,0) 50%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(rgba(197,140,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(197,140,255,0.04) 1px, transparent 1px)",
              backgroundSize: "72px 72px",
              opacity: 0.14,
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 520,
              height: 520,
              borderRadius: "50%",
              filter: "blur(95px)",
              background: "rgba(197,140,255,0.18)",
              left: -120,
              top: 60,
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 460,
              height: 460,
              borderRadius: "50%",
              filter: "blur(90px)",
              background: "rgba(197,140,255,0.12)",
              right: -120,
              top: 140,
            }}
          />
        </div>

        <div
          style={{
            position: "relative",
            maxWidth: 1360,
            margin: "0 auto",
            padding: "20px 16px 64px",
          }}
        >
          <style>{`
            @media (min-width: 640px) {
              .profile-content { padding: 28px 22px 64px !important; }
            }
          `}</style>
          <div style={{ marginBottom: 18 }}>
            <div
              style={{
                color: spermTheme.textPrimary,
                fontSize: 28,
                fontWeight: 900,
                letterSpacing: 1.2,
              }}
            >
              PROFILE
            </div>
            <div
              style={{
                color: spermTheme.textSecondary,
                fontSize: 13,
                marginTop: 4,
              }}
            >
              Wallet-scoped stats, transfers, transaction history and settings.
            </div>
          </div>
          <style>{`
            @media (min-width: 640px) {
              .profile-title { font-size: 42px !important; letter-spacing: 1.5px !important; }
              .profile-subtitle { font-size: 14px !important; }
            }
          `}</style>

          {!connected || !walletAddress ? (
            <ConnectGate />
          ) : (
            <>
              <ProfileHeaderCard
                walletAddress={walletAddress}
                nickname={settings.nickname}
                primarySprmBalance={primarySprmBalance}
                sessionSprmBalance={session.sessionSprmBalance}
                sessionSolBalance={session.sessionAvaxBalance}
              />

              <ProfileTabs
                activeTab={activeTab}
                onChange={(tab) => router.push(`/profile?tab=${tab}`)}
              />

              {content}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <main
          style={{
            width: "100vw",
            height: "100vh",
            background: spermTheme.bgBase,
          }}
        />
      }
    >
      <ProfilePageContent />
    </Suspense>
  );
}
