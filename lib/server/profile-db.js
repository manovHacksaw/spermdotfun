let CachedPool = null

function loadPgPool() {
  if (CachedPool) return CachedPool
  try {
    CachedPool = require('pg').Pool
    return CachedPool
  } catch {
    return null
  }
}

const MIGRATION_SQL = [
  `
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
  `,
  `
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
  `,
  `
  CREATE INDEX IF NOT EXISTS profile_transactions_wallet_resolved_idx
  ON profile_transactions (source_wallet, resolved_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS wallet_links (
    id BIGSERIAL PRIMARY KEY,
    main_wallet TEXT NOT NULL,
    session_wallet TEXT NOT NULL,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unlinked_at TIMESTAMPTZ
  );
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS wallet_links_active_session_unique
  ON wallet_links (session_wallet)
  WHERE unlinked_at IS NULL;
  `,
  `
  CREATE INDEX IF NOT EXISTS wallet_links_main_active_idx
  ON wallet_links (main_wallet, linked_at DESC)
  WHERE unlinked_at IS NULL;
  `,
  `
  CREATE TABLE IF NOT EXISTS profile_auth_nonces (
    nonce TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    message TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS profile_auth_nonces_wallet_idx
  ON profile_auth_nonces (wallet_address, expires_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS profile_auth_sessions (
    token_hash TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS profile_auth_sessions_wallet_idx
  ON profile_auth_sessions (wallet_address, expires_at DESC);
  `,
  `
  CREATE TABLE IF NOT EXISTS profile_backfill_state (
    job_name TEXT PRIMARY KEY,
    before_signature TEXT,
    processed_count BIGINT NOT NULL DEFAULT 0,
    inserted_count BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `,
]

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function createProfileDb({
  databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
  autoMigrate = process.env.PROFILE_DB_AUTO_MIGRATE !== 'false',
  logger = console,
} = {}) {
  let pool = null
  let ready = false

  async function runMigrations() {
    if (!pool) throw new Error('Pool not initialized')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const statement of MIGRATION_SQL) {
        await client.query(statement)
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async function init() {
    if (!databaseUrl) {
      ready = false
      logger.warn('[PROFILE][DB] SUPABASE_DB_URL (or DATABASE_URL) not set; profile APIs disabled.')
      return false
    }

    const Pool = loadPgPool()
    if (!Pool) {
      ready = false
      logger.error('[PROFILE][DB] Missing `pg` dependency; run `npm install pg` to enable profile APIs.')
      return false
    }

    pool = new Pool({
      connectionString: databaseUrl,
      max: parsePositiveInt(process.env.PROFILE_DB_POOL_MAX, 10),
      idleTimeoutMillis: parsePositiveInt(process.env.PROFILE_DB_IDLE_TIMEOUT_MS, 30_000),
      connectionTimeoutMillis: parsePositiveInt(process.env.PROFILE_DB_CONNECT_TIMEOUT_MS, 8_000),
    })

    await pool.query('SELECT 1')
    if (autoMigrate) {
      await runMigrations()
      logger.log('[PROFILE][DB] migrations applied')
    }

    ready = true
    logger.log('[PROFILE][DB] connection ready (Supabase-compatible Postgres)')
    return true
  }

  async function query(text, params) {
    if (!pool) throw new Error('Profile DB is not initialized')
    return pool.query(text, params)
  }

  async function healthCheck() {
    if (!pool) return false
    try {
      await pool.query('SELECT 1')
      return true
    } catch {
      return false
    }
  }

  async function close() {
    ready = false
    if (!pool) return
    const localPool = pool
    pool = null
    await localPool.end()
  }

  return {
    init,
    close,
    query,
    runMigrations,
    healthCheck,
    isReady: () => ready,
    isEnabled: () => Boolean(databaseUrl),
  }
}

module.exports = {
  createProfileDb,
}
