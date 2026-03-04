"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { type ProfileSettings } from "@/lib/profile/types";
import { spermTheme } from "@/components/theme/spermTheme";

interface SettingsTabProps {
  walletAddress: string;
  settings: ProfileSettings;
  onSave: (patch: Partial<ProfileSettings>) => Promise<ProfileSettings | void>;
  saving?: boolean;
  errorMessage?: string;
}

const MAX_AVATAR_BYTES = 220 * 1024;

export default function SettingsTab({
  walletAddress,
  settings,
  onSave,
  saving,
  errorMessage,
}: SettingsTabProps) {
  const [draft, setDraft] = useState<ProfileSettings>(settings);
  const [showSeed, setShowSeed] = useState(false);
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle",
  );

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const dispatchVolumeEvent = (volume: number) => {
    window.dispatchEvent(
      new CustomEvent("sprmfun:profile_settings_updated", {
        detail: { wallet: walletAddress, volume },
      }),
    );
  };

  const saveDraft = async () => {
    setSaveState("idle");
    setError("");
    try {
      const saved = await onSave(draft);
      if (saved) setDraft(saved);
      dispatchVolumeEvent(draft.volume);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (saveError: any) {
      const message = saveError?.message ?? "Failed to save settings";
      setError(message);
      setSaveState("error");
    }
  };

  const updateField = <K extends keyof ProfileSettings>(
    key: K,
    value: ProfileSettings[K],
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const onVolumeChange = (value: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    updateField("volume", clamped);
  };

  const onAvatarPick = (file?: File | null) => {
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setError("Avatar too large. Max size is 220KB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (!dataUrl) return;
      setError("");
      updateField("avatarDataUrl", dataUrl);
    };
    reader.readAsDataURL(file);
  };

  return (
    <section style={{ display: "grid", gap: 14 }}>
      <style>{`
        .settings-grid {
          display: grid;
          gap: 14px;
          grid-template-columns: 1fr;
        }
        @media (min-width: 640px) {
          .settings-grid {
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          }
        }
        .settings-title {
          font-size: 28px;
        }
        @media (min-width: 640px) {
          .settings-title {
            font-size: 44px;
          }
        }
      `}</style>
      <div
        className="settings-title"
        style={{
          color: spermTheme.textPrimary,
          fontWeight: 900,
          letterSpacing: 1,
        }}
      >
        SETTINGS
      </div>

      <div
        style={{
          border: `1px solid ${spermTheme.accentBorder}`,
          borderRadius: 18,
          background: `linear-gradient(180deg, ${spermTheme.bgElevated}, rgba(10,9,19,0.84))`,
          backdropFilter: "blur(14px)",
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <div className="settings-grid" style={{ display: "grid", gap: 14 }}>
          <div
            style={{
              border: `1px solid ${spermTheme.accentBorder}`,
              borderRadius: 16,
              background: "rgba(27,20,46,0.65)",
              padding: 14,
              display: "grid",
              gap: 12,
              alignContent: "start",
            }}
          >
            <div
              style={{
                width: "100%",
                aspectRatio: "1 / 1",
                borderRadius: 16,
                border: `1px solid ${spermTheme.accentBorder}`,
                background: draft.avatarDataUrl
                  ? `center / cover no-repeat url(${draft.avatarDataUrl})`
                  : "linear-gradient(140deg, #f5f5f2, #c58cff 58%, #9c7ac6)",
              }}
            />
            <label style={primaryButtonStyle}>
              Upload Avatar
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => onAvatarPick(e.target.files?.[0] ?? null)}
              />
            </label>
            {draft.avatarDataUrl && (
              <button
                onClick={() => {
                  updateField("avatarDataUrl", null);
                }}
                style={secondaryButtonStyle}
                disabled={Boolean(saving)}
              >
                Remove Avatar
              </button>
            )}
            {(error || errorMessage) && (
              <div style={{ color: spermTheme.error, fontSize: 13 }}>
                {error || errorMessage}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <Field label="Nickname">
              <input
                value={draft.nickname}
                onChange={(e) => updateField("nickname", e.target.value)}
                style={inputStyle}
                maxLength={40}
              />
            </Field>

            <Field label="Account Email">
              <input
                type="email"
                value={draft.email}
                onChange={(e) => updateField("email", e.target.value)}
                style={inputStyle}
                maxLength={120}
              />
            </Field>

            <Field label="Client Seed (Profile Metadata)">
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  gridTemplateColumns: "1fr auto",
                }}
              >
                <input
                  type={showSeed ? "text" : "password"}
                  value={draft.clientSeed}
                  onChange={(e) => updateField("clientSeed", e.target.value)}
                  style={inputStyle}
                  maxLength={120}
                />
                <button
                  onClick={() => setShowSeed((v) => !v)}
                  style={secondaryButtonStyle}
                >
                  {showSeed ? "Hide" : "Reveal"}
                </button>
              </div>
              <div style={{ color: spermTheme.textTertiary, fontSize: 12 }}>
                Stored as profile metadata in v1. It is not used in game RNG
                yet.
              </div>
            </Field>

            <Field label="Referral Code">
              <input
                value={draft.referralCode}
                onChange={(e) => updateField("referralCode", e.target.value)}
                style={inputStyle}
                maxLength={120}
              />
            </Field>
          </div>
        </div>

        <div
          style={{
            border: `1px solid ${spermTheme.borderSoft}`,
            borderRadius: 14,
            background: "rgba(255,255,255,0.03)",
            padding: 14,
          }}
        >
          <label
            style={{
              color: spermTheme.textSecondary,
              fontSize: 14,
              fontWeight: 700,
              display: "block",
              marginBottom: 10,
            }}
          >
            Background Audio Volume: {draft.volume}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={draft.volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => void saveDraft()}
            style={primaryButtonStyle}
            disabled={Boolean(saving)}
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
          <button
            onClick={() => {
              setDraft(settings);
              setError("");
              setSaveState("idle");
            }}
            style={secondaryButtonStyle}
            disabled={Boolean(saving)}
          >
            Reset
          </button>
          {saveState === "saved" && (
            <div
              style={{
                color: spermTheme.success,
                fontSize: 13,
                alignSelf: "center",
              }}
            >
              Saved
            </div>
          )}
          {saveState === "error" && (
            <div
              style={{
                color: spermTheme.error,
                fontSize: 13,
                alignSelf: "center",
              }}
            >
              Save failed
            </div>
          )}
        </div>
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
            fontSize: 14,
            marginBottom: 10,
            fontWeight: 800,
          }}
        >
          Connected Accounts
        </div>
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          {["Google", "Discord", "Telegram"].map((provider) => (
            <button
              key={provider}
              disabled
              title="Coming Soon"
              style={accountButtonStyle}
            >
              {provider} (Coming Soon)
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label
        style={{
          color: spermTheme.textSecondary,
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: CSSProperties = {
  border: `1px solid ${spermTheme.accentBorder}`,
  background: "rgba(7,9,16,0.68)",
  color: spermTheme.textPrimary,
  borderRadius: 12,
  height: 48,
  padding: "0 12px",
  fontFamily: "inherit",
  outline: "none",
  fontSize: 16,
  fontWeight: 600,
};

const primaryButtonStyle: CSSProperties = {
  border: `1px solid ${spermTheme.accentBorder}`,
  background: spermTheme.accentSoft,
  color: spermTheme.textPrimary,
  borderRadius: 12,
  height: 46,
  padding: "0 16px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 800,
};

const secondaryButtonStyle: CSSProperties = {
  border: `1px solid ${spermTheme.borderSoft}`,
  background: "rgba(255,255,255,0.04)",
  color: spermTheme.textSecondary,
  borderRadius: 12,
  height: 46,
  padding: "0 16px",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700,
};

const accountButtonStyle: CSSProperties = {
  border: `1px solid ${spermTheme.borderSoft}`,
  background: "rgba(255,255,255,0.03)",
  color: spermTheme.textTertiary,
  borderRadius: 12,
  minHeight: 50,
  padding: "10px 12px",
  fontSize: 13,
  cursor: "not-allowed",
};
