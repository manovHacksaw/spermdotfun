-- Profile backend schema for Supabase Postgres.
-- Run this once in Supabase SQL Editor (or via psql) before starting the app.

CREATE TABLE IF NOT EXISTS profile_settings (
  wallet_address TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  avatar_data_url TEXT,
  client_seed TEXT NOT NULL DEFAULT '',
  referral_code TEXT NOT NULL DEFAULT '',
  volume INTEGER NOT NULL DEFAULT 35,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profile_transactions (
  tx_signature TEXT NOT NULL,
  event_index INTEGER NOT NULL DEFAULT 0,
  bet_pda TEXT,
  source_wallet TEXT NOT NULL,
  game TEXT NOT NULL DEFAULT 'crash',
  box_x BIGINT,
  box_row INTEGER,
  winning_row INTEGER,
  won BOOLEAN NOT NULL,
  bet_amount NUMERIC(30, 9) NOT NULL,
  payout NUMERIC(30, 9) NOT NULL,
  seed_index BIGINT,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tx_signature, event_index)
);

CREATE INDEX IF NOT EXISTS profile_transactions_wallet_resolved_idx
ON profile_transactions (source_wallet, resolved_at DESC);

CREATE TABLE IF NOT EXISTS wallet_links (
  id BIGSERIAL PRIMARY KEY,
  main_wallet TEXT NOT NULL,
  session_wallet TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unlinked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_links_active_session_unique
ON wallet_links (session_wallet)
WHERE unlinked_at IS NULL;

CREATE INDEX IF NOT EXISTS wallet_links_main_active_idx
ON wallet_links (main_wallet, linked_at DESC)
WHERE unlinked_at IS NULL;

CREATE TABLE IF NOT EXISTS profile_auth_nonces (
  nonce TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS profile_auth_nonces_wallet_idx
ON profile_auth_nonces (wallet_address, expires_at DESC);

CREATE TABLE IF NOT EXISTS profile_auth_sessions (
  token_hash TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS profile_auth_sessions_wallet_idx
ON profile_auth_sessions (wallet_address, expires_at DESC);

CREATE TABLE IF NOT EXISTS profile_backfill_state (
  job_name TEXT PRIMARY KEY,
  before_signature TEXT,
  processed_count BIGINT NOT NULL DEFAULT 0,
  inserted_count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
