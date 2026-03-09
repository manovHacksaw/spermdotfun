"use client";

import { spermTheme } from "@/components/theme/spermTheme";
import { type ProfileSettings } from "@/lib/profile/types";
import { useState } from "react";

interface ReferralsTabProps {
    settings: ProfileSettings;
    loading?: boolean;
}

export default function ReferralsTab({ settings, loading }: ReferralsTabProps) {
    const [copied, setCopied] = useState(false);
    const referralLink = typeof window !== "undefined"
        ? `${window.location.origin}?ref=${settings.referralCode}`
        : `https://sprm.fun?ref=${settings.referralCode}`;

    const copyToClipboard = () => {
        navigator.clipboard.writeText(referralLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <section style={{ display: "grid", gap: 20 }}>
            <div style={headerWrap}>
                <div style={headerKicker}>Growth & Rewards</div>
                <div style={headerTitle}>Referral Program</div>
            </div>

            <div style={infoCard}>
                <p style={{ color: spermTheme.textSecondary, fontSize: 14, lineHeight: 1.6 }}>
                    Invite your friends to <strong>SPRM.FUN</strong> and earn
                    <span style={{ color: spermTheme.accent, fontWeight: 800 }}> 0.5% </span>
                    of every bet they place, forever. Rewards are credited instantly to your account in SPRM.
                </p>
            </div>

            <div style={mainGrid}>
                <div style={rowCard}>
                    <div style={label}>Your Referral Code</div>
                    <div style={codeValue}>{settings.referralCode || "—"}</div>
                </div>

                <div style={rowCard}>
                    <div style={label}>Total Earnings</div>
                    <div style={earningsValue}>
                        {settings.referralEarned?.toFixed(4) || "0.0000"}
                        <span style={{ fontSize: 14, marginLeft: 6, opacity: 0.6 }}>SPRM</span>
                    </div>
                </div>
            </div>

            <div style={linkSection}>
                <div style={label}>Your Unique Referral Link</div>
                <div style={linkInputWrap}>
                    <input
                        readOnly
                        value={referralLink}
                        style={linkInput}
                    />
                    <button onClick={copyToClipboard} style={copyButton}>
                        {copied ? "COPIED!" : "COPY LINK"}
                    </button>
                </div>
            </div>

            {loading && <div style={{ color: spermTheme.textTertiary, fontSize: 12 }}>Syncing referral data...</div>}
        </section>
    );
}

const headerWrap = { display: "grid", gap: 4 };
const headerKicker = { color: spermTheme.textSecondary, fontSize: 12, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase" as const };
const headerTitle = { color: spermTheme.textPrimary, fontSize: 32, fontWeight: 900 };

const infoCard = {
    background: "rgba(255,255,255,0.03)",
    border: `1px solid ${spermTheme.borderSoft}`,
    borderRadius: 16,
    padding: 16,
};

const mainGrid = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
};

const rowCard = {
    background: spermTheme.bgElevated,
    border: `1px solid ${spermTheme.borderSoft}`,
    borderRadius: 16,
    padding: 20,
    display: "grid",
    gap: 8,
};

const label = {
    color: spermTheme.textTertiary,
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
};

const codeValue = {
    color: spermTheme.accent,
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: 2,
};

const earningsValue = {
    color: spermTheme.success,
    fontSize: 28,
    fontWeight: 900,
};

const linkSection = {
    display: "grid",
    gap: 10,
};

const linkInputWrap = {
    display: "flex",
    gap: 8,
};

const linkInput: any = {
    flex: 1,
    background: "rgba(0,0,0,0.2)",
    border: `1px solid ${spermTheme.borderSoft}`,
    borderRadius: 12,
    padding: "12px 14px",
    color: spermTheme.textSecondary,
    fontSize: 13,
    outline: "none",
};

const copyButton = {
    background: spermTheme.accent,
    color: "#fff",
    border: "none",
    borderRadius: 12,
    padding: "0 20px",
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
    transition: "transform 0.1s",
};
