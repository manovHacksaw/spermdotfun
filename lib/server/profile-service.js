const crypto = require('crypto')
const bs58Module = require('bs58')
const { PublicKey } = require('@solana/web3.js')
const { ed25519 } = require('@noble/curves/ed25519.js')
const { createProfileDb } = require('./profile-db')
const bs58 = bs58Module?.default || bs58Module

const ONE_TOKEN = 10 ** 9
const BET_RESOLVED_EVENT_DISC = crypto.createHash('sha256').update('event:BetResolved').digest().subarray(0, 8)

const PROFILE_DEFAULT_SETTINGS = Object.freeze({
  nickname: '',
  email: '',
  avatarDataUrl: null,
  clientSeed: '',
  referralCode: '',
  referredBy: null,
  referralEarned: 0,
  volume: 35,
})

const PROFILE_RANGES = ['24H', '7D', '1M', 'ALL']

const MAX_NICKNAME_LEN = 40
const MAX_EMAIL_LEN = 120
const MAX_CLIENT_SEED_LEN = 120
const MAX_REFERRAL_CODE_LEN = 120
const MAX_AVATAR_DATA_URL_LEN = 400_000
const MAX_WRITE_QUEUE = 500
const MAX_WRITE_RETRIES = 6

function asFiniteNumber(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

function clampInt(value, min, max) {
  const n = Math.round(asFiniteNumber(value, min))
  return Math.max(min, Math.min(max, n))
}

function toStringSafe(value, maxLen) {
  if (typeof value !== 'string') return ''
  return value.slice(0, maxLen)
}

function normalizeAvatar(value) {
  if (typeof value !== 'string') return null
  if (!value.startsWith('data:image/')) return null
  if (value.length > MAX_AVATAR_DATA_URL_LEN) return null
  return value
}

function normalizeWallet(input) {
  try {
    return new PublicKey(String(input)).toBase58()
  } catch {
    return null
  }
}

function normalizeVolume(input) {
  return clampInt(input, 0, 100)
}

function normalizeSettings(row) {
  if (!row) {
    return { ...PROFILE_DEFAULT_SETTINGS }
  }
  return {
    nickname: toStringSafe(row.nickname, MAX_NICKNAME_LEN),
    email: toStringSafe(row.email, MAX_EMAIL_LEN),
    avatarDataUrl: normalizeAvatar(row.avatar_data_url),
    clientSeed: toStringSafe(row.client_seed, MAX_CLIENT_SEED_LEN),
    referralCode: toStringSafe(row.referral_code, MAX_REFERRAL_CODE_LEN),
    referredBy: normalizeWallet(row.referred_by),
    referralEarned: Number(row.referral_earned || 0),
    volume: normalizeVolume(row.volume),
  }
}

function normalizeSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object') return {}
  const input = patch
  const out = {}

  if ('nickname' in input) out.nickname = toStringSafe(input.nickname, MAX_NICKNAME_LEN)
  if ('email' in input) out.email = toStringSafe(input.email, MAX_EMAIL_LEN)
  if ('clientSeed' in input) out.client_seed = toStringSafe(input.clientSeed, MAX_CLIENT_SEED_LEN)
  if ('referralCode' in input) out.referral_code = toStringSafe(input.referralCode, MAX_REFERRAL_CODE_LEN)
  if ('referredBy' in input) out.referred_by = normalizeWallet(input.referredBy)
  if ('referralEarned' in input) out.referral_earned = Number(input.referralEarned || 0)
  if ('volume' in input) out.volume = normalizeVolume(input.volume)

  if ('avatarDataUrl' in input) {
    if (input.avatarDataUrl === null || input.avatarDataUrl === '') {
      out.avatar_data_url = null
    } else {
      out.avatar_data_url = normalizeAvatar(input.avatarDataUrl)
    }
  }

  return out
}

function parseRange(input) {
  const value = String(input || 'ALL').toUpperCase()
  if (PROFILE_RANGES.includes(value)) return value
  return 'ALL'
}

function rangeStartDate(range) {
  const now = Date.now()
  if (range === '24H') return new Date(now - 24 * 60 * 60 * 1000)
  if (range === '7D') return new Date(now - 7 * 24 * 60 * 60 * 1000)
  if (range === '1M') return new Date(now - 30 * 24 * 60 * 60 * 1000)
  return null
}

function parseLimit(value, fallback, min = 1, max = 100) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function encodeCursor(row) {
  const payload = {
    resolvedAt: row.resolved_at instanceof Date ? row.resolved_at.toISOString() : new Date(row.resolved_at).toISOString(),
    txSignature: row.tx_signature,
    eventIndex: Number(row.event_index),
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodeCursor(cursor) {
  if (!cursor) return null
  try {
    const raw = Buffer.from(String(cursor), 'base64url').toString('utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const resolvedAt = new Date(String(parsed.resolvedAt))
    const txSignature = String(parsed.txSignature || '')
    const eventIndex = Number(parsed.eventIndex)
    if (!txSignature || Number.isNaN(resolvedAt.getTime()) || !Number.isFinite(eventIndex)) {
      return null
    }
    return { resolvedAt, txSignature, eventIndex: Math.trunc(eventIndex) }
  } catch {
    return null
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function parseSignatureBytes(signature) {
  if (Array.isArray(signature)) {
    const arr = Uint8Array.from(signature)
    return arr.length === 64 ? arr : null
  }

  if (signature && typeof signature === 'object' && ArrayBuffer.isView(signature)) {
    const view = new Uint8Array(signature.buffer, signature.byteOffset, signature.byteLength)
    return view.length === 64 ? view : null
  }

  if (typeof signature !== 'string') return null
  const trimmed = signature.trim()
  if (!trimmed) return null

  const attempts = [
    () => bs58.decode(trimmed),
    () => Uint8Array.from(Buffer.from(trimmed, 'base64')),
    () => Uint8Array.from(Buffer.from(trimmed, 'hex')),
  ]

  for (const decode of attempts) {
    try {
      const bytes = decode()
      if (bytes.length === 64) return Uint8Array.from(bytes)
    } catch {
      // continue
    }
  }

  return null
}

function numericToNumber(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  if (typeof value === 'bigint') return Number(value)
  return 0
}

function mapTransactionRow(row) {
  const timestamp = new Date(row.resolved_at).getTime()
  const betAmount = numericToNumber(row.bet_amount)
  const payout = numericToNumber(row.payout)
  return {
    id: `${row.tx_signature}:${row.event_index}`,
    txSignature: row.tx_signature,
    eventIndex: Number(row.event_index),
    wallet: row.source_wallet,
    sourceWallet: row.source_wallet,
    game: row.game,
    betAmount,
    payout,
    net: payout - betAmount,
    won: Boolean(row.won),
    betPda: row.bet_pda || undefined,
    boxX: row.box_x === null || row.box_x === undefined ? undefined : Number(row.box_x),
    boxRow: row.box_row === null || row.box_row === undefined ? undefined : Number(row.box_row),
    winningRow: row.winning_row === null || row.winning_row === undefined ? undefined : Number(row.winning_row),
    seedIndex: row.seed_index === null || row.seed_index === undefined ? undefined : Number(row.seed_index),
    timestamp,
    resolvedAt: new Date(timestamp).toISOString(),
  }
}

function downsampleSeries(points, maxPoints) {
  if (points.length <= maxPoints) return points
  const step = points.length / maxPoints
  const sampled = []
  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.min(points.length - 1, Math.floor(i * step))
    sampled.push(points[index])
  }
  return sampled
}

function decodeBetResolvedEventFromRaw(raw) {
  if (!Buffer.isBuffer(raw)) return null
  if (raw.length < 67) return null
  if (!raw.subarray(0, 8).equals(BET_RESOLVED_EVENT_DISC)) return null

  let offset = 8
  const userBytes = raw.subarray(offset, offset + 32)
  offset += 32

  const boxX = Number(raw.readBigInt64LE(offset))
  offset += 8

  const boxRow = raw.readUInt8(offset)
  offset += 1

  const amountRaw = raw.readBigUInt64LE(offset)
  offset += 8

  const winningRow = raw.readUInt8(offset)
  offset += 1

  const won = raw.readUInt8(offset) !== 0
  offset += 1

  const payoutRaw = raw.readBigUInt64LE(offset)
  offset += 8

  const seedIndexRaw = raw.readBigUInt64LE(offset)

  return {
    sourceWallet: new PublicKey(userBytes).toBase58(),
    boxX,
    boxRow,
    winningRow,
    won,
    betAmount: Number(amountRaw) / ONE_TOKEN,
    payout: Number(payoutRaw) / ONE_TOKEN,
    seedIndex: Number(seedIndexRaw),
  }
}

function extractBetResolvedEvents(logMessages) {
  if (!Array.isArray(logMessages)) return []

  const events = []
  let eventIndex = 0

  for (const line of logMessages) {
    if (typeof line !== 'string' || !line.startsWith('Program data: ')) continue
    try {
      const raw = Buffer.from(line.slice('Program data: '.length), 'base64')
      const parsed = decodeBetResolvedEventFromRaw(raw)
      if (!parsed) continue
      events.push({ ...parsed, eventIndex })
      eventIndex += 1
    } catch {
      // ignore malformed base64/event payloads
    }
  }

  return events
}

function createProfileService({
  logger = console,
  db = createProfileDb({ logger }),
  getTxResolvedAt = null,
} = {}) {
  const authChallengeTtlMs = parseLimit(process.env.PROFILE_AUTH_NONCE_TTL_MS, 5 * 60 * 1000, 30_000, 60 * 60 * 1000)
  const authSessionTtlMs = parseLimit(process.env.PROFILE_AUTH_SESSION_TTL_MS, 24 * 60 * 60 * 1000, 60_000, 30 * 24 * 60 * 60 * 1000)

  let flushTimer = null
  let flushingQueue = false
  const writeQueue = []

  async function init() {
    const ready = await db.init()
    if (ready) {
      flushTimer = setInterval(() => {
        flushResolvedBetQueue().catch((error) => {
          logger.error('[PROFILE] queue flush error:', error?.message || error)
        })
      }, 2_500)
    }
    return ready
  }

  async function close() {
    if (flushTimer) {
      clearInterval(flushTimer)
      flushTimer = null
    }
    await db.close()
  }

  async function resolveWalletScope(requestedWallet) {
    const normalized = normalizeWallet(requestedWallet)
    if (!normalized) {
      throw Object.assign(new Error('Invalid wallet address'), { code: 'INVALID_WALLET' })
    }

    const sessionToMain = await db.query(
      `
      SELECT main_wallet
      FROM wallet_links
      WHERE session_wallet = $1
        AND unlinked_at IS NULL
      ORDER BY linked_at DESC
      LIMIT 1
      `,
      [normalized],
    )

    const mainWallet = sessionToMain.rowCount > 0
      ? sessionToMain.rows[0].main_wallet
      : normalized

    const linkedSessionsResult = await db.query(
      `
      SELECT session_wallet
      FROM wallet_links
      WHERE main_wallet = $1
        AND unlinked_at IS NULL
      ORDER BY linked_at DESC
      `,
      [mainWallet],
    )

    const wallets = new Set([mainWallet])
    for (const row of linkedSessionsResult.rows) {
      wallets.add(row.session_wallet)
    }
    wallets.add(normalized)

    return {
      requestedWallet: normalized,
      mainWallet,
      scopeWallets: Array.from(wallets),
      linkedSessionWallets: linkedSessionsResult.rows.map((row) => row.session_wallet),
    }
  }

  async function getSettingsForWallet(mainWallet) {
    const result = await db.query(
      `
      SELECT nickname, email, avatar_data_url, client_seed, referral_code, volume
      FROM profile_settings
      WHERE wallet_address = $1
      `,
      [mainWallet],
    )
    return normalizeSettings(result.rows[0])
  }

  async function upsertSettings(mainWallet, patch) {
    const normalizedPatch = normalizeSettingsPatch(patch)
    if (Object.keys(normalizedPatch).length === 0) {
      return getSettingsForWallet(mainWallet)
    }

    const existing = await getSettingsForWallet(mainWallet)
    const merged = {
      nickname: Object.prototype.hasOwnProperty.call(normalizedPatch, 'nickname')
        ? normalizedPatch.nickname
        : existing.nickname,
      email: Object.prototype.hasOwnProperty.call(normalizedPatch, 'email')
        ? normalizedPatch.email
        : existing.email,
      avatar_data_url: Object.prototype.hasOwnProperty.call(normalizedPatch, 'avatar_data_url')
        ? normalizedPatch.avatar_data_url
        : existing.avatarDataUrl,
      client_seed: Object.prototype.hasOwnProperty.call(normalizedPatch, 'client_seed')
        ? normalizedPatch.client_seed
        : existing.clientSeed,
      referral_code: Object.prototype.hasOwnProperty.call(normalizedPatch, 'referral_code')
        ? normalizedPatch.referral_code
        : existing.referralCode,
      referred_by: Object.prototype.hasOwnProperty.call(normalizedPatch, 'referred_by')
        ? normalizedPatch.referred_by
        : existing.referredBy,
      referral_earned: Object.prototype.hasOwnProperty.call(normalizedPatch, 'referral_earned')
        ? normalizedPatch.referral_earned
        : existing.referralEarned,
      volume: Object.prototype.hasOwnProperty.call(normalizedPatch, 'volume')
        ? normalizedPatch.volume
        : existing.volume,
    }

    const upsertResult = await db.query(
      `
      INSERT INTO profile_settings (
        wallet_address,
        referral_code,
        referred_by,
        referral_earned,
        volume
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (wallet_address)
      DO UPDATE SET
        nickname = EXCLUDED.nickname,
        email = EXCLUDED.email,
        avatar_data_url = EXCLUDED.avatar_data_url,
        client_seed = EXCLUDED.client_seed,
        referral_code = EXCLUDED.referral_code,
        referred_by = EXCLUDED.referred_by,
        referral_earned = EXCLUDED.referral_earned,
        volume = EXCLUDED.volume,
        updated_at = NOW()
      RETURNING nickname, email, avatar_data_url, client_seed, referral_code, referred_by, referral_earned, volume
      `,
      [
        mainWallet,
        merged.nickname,
        merged.email,
        merged.avatar_data_url,
        merged.client_seed,
        merged.referral_code,
        merged.referred_by,
        merged.referral_earned || 0,
        merged.volume,
      ],
    )

    return normalizeSettings(upsertResult.rows[0])
  }

  async function getStats(scopeWallets, range) {
    const since = rangeStartDate(range)
    const statsResult = await db.query(
      `
      WITH filtered AS (
        SELECT
          won,
          bet_amount,
          payout,
          (payout - bet_amount) AS net
        FROM profile_transactions
        WHERE source_wallet = ANY($1::text[])
          AND ($2::timestamptz IS NULL OR resolved_at >= $2)
      )
      SELECT
        COUNT(*)::INTEGER AS games_played,
        COALESCE(SUM(CASE WHEN won THEN 1 ELSE 0 END), 0)::INTEGER AS wins,
        COALESCE(SUM(CASE WHEN NOT won THEN 1 ELSE 0 END), 0)::INTEGER AS losses,
        COALESCE(SUM(bet_amount), 0) AS total_wagered,
        COALESCE(SUM(payout), 0) AS total_payout,
        COALESCE(SUM(net), 0) AS net_profit,
        COALESCE(SUM(GREATEST(net, 0)), 0) AS gross_profit,
        COALESCE(SUM(GREATEST(-net, 0)), 0) AS total_loss,
        COALESCE(AVG(bet_amount), 0) AS avg_bet,
        COALESCE(AVG(payout), 0) AS avg_payout
      FROM filtered
      `,
      [scopeWallets, since],
    )

    const row = statsResult.rows[0] || {}
    const gamesPlayed = Number(row.games_played || 0)
    const wins = Number(row.wins || 0)
    const losses = Number(row.losses || 0)

    return {
      gamesPlayed,
      wins,
      losses,
      winRate: gamesPlayed > 0 ? (wins / gamesPlayed) * 100 : 0,
      totalWagered: numericToNumber(row.total_wagered),
      totalPayout: numericToNumber(row.total_payout),
      netProfit: numericToNumber(row.net_profit),
      grossProfit: numericToNumber(row.gross_profit),
      totalLoss: numericToNumber(row.total_loss),
      avgBet: numericToNumber(row.avg_bet),
      avgPayout: numericToNumber(row.avg_payout),
    }
  }

  async function getPnlSeries(scopeWallets, range) {
    const since = rangeStartDate(range)
    const result = await db.query(
      `
      SELECT
        (EXTRACT(EPOCH FROM resolved_at) * 1000)::BIGINT AS ts_ms,
        SUM(payout - bet_amount) OVER (
          ORDER BY resolved_at ASC, tx_signature ASC, event_index ASC
        ) AS cumulative_net
      FROM profile_transactions
      WHERE source_wallet = ANY($1::text[])
        AND ($2::timestamptz IS NULL OR resolved_at >= $2)
      ORDER BY resolved_at ASC, tx_signature ASC, event_index ASC
      `,
      [scopeWallets, since],
    )

    const points = result.rows.map((row) => ({
      timestamp: Number(row.ts_ms),
      cumulativeNet: numericToNumber(row.cumulative_net),
    }))

    return downsampleSeries(points, 600)
  }

  async function getTransactions({ scopeWallets, range, limit = 25, cursor = null }) {
    const safeLimit = parseLimit(limit, 25, 1, 100)
    const since = rangeStartDate(range)
    const decodedCursor = decodeCursor(cursor)

    if (cursor && !decodedCursor) {
      throw Object.assign(new Error('Invalid cursor'), { code: 'INVALID_CURSOR' })
    }

    const result = await db.query(
      `
      SELECT
        tx_signature,
        event_index,
        bet_pda,
        source_wallet,
        game,
        box_x,
        box_row,
        winning_row,
        won,
        bet_amount,
        payout,
        seed_index,
        resolved_at
      FROM profile_transactions
      WHERE source_wallet = ANY($1::text[])
        AND ($2::timestamptz IS NULL OR resolved_at >= $2)
        AND (
          $3::timestamptz IS NULL OR
          (resolved_at, tx_signature, event_index) < ($3::timestamptz, $4::text, $5::INTEGER)
        )
      ORDER BY resolved_at DESC, tx_signature DESC, event_index DESC
      LIMIT $6
      `,
      [
        scopeWallets,
        since,
        decodedCursor?.resolvedAt ?? null,
        decodedCursor?.txSignature ?? null,
        decodedCursor?.eventIndex ?? null,
        safeLimit + 1,
      ],
    )

    const hasMore = result.rows.length > safeLimit
    const rows = hasMore ? result.rows.slice(0, safeLimit) : result.rows
    const nextCursor = hasMore ? encodeCursor(rows[rows.length - 1]) : null

    return {
      items: rows.map(mapTransactionRow),
      hasMore,
      nextCursor,
    }
  }

  async function getOverview({ wallet, range = 'ALL', txLimit = 20 }) {
    const parsedRange = parseRange(range)
    const scope = await resolveWalletScope(wallet)
    const [settings, stats, pnlSeries] = await Promise.all([
      getSettingsForWallet(scope.mainWallet),
      getStats(scope.scopeWallets, parsedRange),
      getPnlSeries(scope.scopeWallets, parsedRange),
    ])

    const txBundle = txLimit > 0
      ? await getTransactions({
        scopeWallets: scope.scopeWallets,
        range: parsedRange,
        limit: txLimit,
        cursor: null,
      })
      : { items: [], hasMore: false, nextCursor: null }

    return {
      wallet: scope.mainWallet,
      requestedWallet: scope.requestedWallet,
      linkedSessionWallets: scope.linkedSessionWallets,
      range: parsedRange,
      settings,
      stats,
      pnlSeries,
      transactions: txBundle.items,
      transactionsPageInfo: {
        hasMore: txBundle.hasMore,
        nextCursor: txBundle.nextCursor,
      },
    }
  }

  async function createAuthChallenge(wallet) {
    const normalizedWallet = normalizeWallet(wallet)
    if (!normalizedWallet) {
      throw Object.assign(new Error('Invalid wallet address'), { code: 'INVALID_WALLET' })
    }

    const nonce = crypto.randomBytes(20).toString('base64url')
    const expiresAt = new Date(Date.now() + authChallengeTtlMs)
    const message = [
      'SPRMFUN Profile Login',
      `Wallet: ${normalizedWallet}`,
      `Nonce: ${nonce}`,
      `Expires At: ${expiresAt.toISOString()}`,
      '',
      'Sign this message to authenticate your session.',
    ].join('\n')

    await db.query(
      `
      INSERT INTO profile_auth_nonces (nonce, wallet_address, message, expires_at)
      VALUES ($1, $2, $3, $4)
      `,
      [nonce, normalizedWallet, message, expiresAt],
    )

    await db.query(
      `
      DELETE FROM profile_auth_nonces
      WHERE expires_at < NOW() - INTERVAL '1 hour'
      `,
      [],
    )

    return {
      nonce,
      message,
      expiresAt: expiresAt.toISOString(),
    }
  }

  async function verifyAuthChallenge({ wallet, nonce, signature }) {
    const normalizedWallet = normalizeWallet(wallet)
    if (!normalizedWallet) {
      throw Object.assign(new Error('Invalid wallet address'), { code: 'INVALID_WALLET' })
    }

    if (!nonce || typeof nonce !== 'string') {
      throw Object.assign(new Error('Missing nonce'), { code: 'INVALID_NONCE' })
    }

    const nonceResult = await db.query(
      `
      SELECT nonce, wallet_address, message, expires_at, used_at
      FROM profile_auth_nonces
      WHERE nonce = $1
        AND wallet_address = $2
      LIMIT 1
      `,
      [nonce, normalizedWallet],
    )

    if (nonceResult.rowCount === 0) {
      throw Object.assign(new Error('Nonce not found'), { code: 'INVALID_NONCE' })
    }

    const nonceRow = nonceResult.rows[0]

    if (nonceRow.used_at) {
      throw Object.assign(new Error('Nonce already used'), { code: 'NONCE_USED' })
    }

    if (new Date(nonceRow.expires_at).getTime() < Date.now()) {
      throw Object.assign(new Error('Nonce expired'), { code: 'NONCE_EXPIRED' })
    }

    const signatureBytes = parseSignatureBytes(signature)
    if (!signatureBytes) {
      throw Object.assign(new Error('Invalid signature payload'), { code: 'INVALID_SIGNATURE' })
    }

    const messageBytes = Buffer.from(nonceRow.message, 'utf8')
    const publicKeyBytes = new PublicKey(normalizedWallet).toBytes()
    const isValidSig = ed25519.verify(signatureBytes, messageBytes, publicKeyBytes)

    if (!isValidSig) {
      throw Object.assign(new Error('Signature verification failed'), { code: 'INVALID_SIGNATURE' })
    }

    const markUsed = await db.query(
      `
      UPDATE profile_auth_nonces
      SET used_at = NOW()
      WHERE nonce = $1
        AND used_at IS NULL
      `,
      [nonce],
    )

    if (markUsed.rowCount === 0) {
      throw Object.assign(new Error('Nonce already consumed'), { code: 'NONCE_USED' })
    }

    const accessToken = crypto.randomBytes(32).toString('base64url')
    const accessTokenHash = hashToken(accessToken)
    const expiresAt = new Date(Date.now() + authSessionTtlMs)

    await db.query(
      `
      INSERT INTO profile_auth_sessions (token_hash, wallet_address, expires_at)
      VALUES ($1, $2, $3)
      `,
      [accessTokenHash, normalizedWallet, expiresAt],
    )

    await db.query(
      `
      DELETE FROM profile_auth_sessions
      WHERE expires_at < NOW() - INTERVAL '24 hours'
      `,
      [],
    )

    return {
      wallet: normalizedWallet,
      accessToken,
      expiresAt: expiresAt.toISOString(),
    }
  }

  async function authenticateAccessToken(token) {
    if (!token || typeof token !== 'string') {
      throw Object.assign(new Error('Missing access token'), { code: 'UNAUTHORIZED' })
    }

    const tokenHash = hashToken(token)
    const sessionResult = await db.query(
      `
      SELECT wallet_address, expires_at, revoked_at
      FROM profile_auth_sessions
      WHERE token_hash = $1
      LIMIT 1
      `,
      [tokenHash],
    )

    if (sessionResult.rowCount === 0) {
      throw Object.assign(new Error('Invalid access token'), { code: 'UNAUTHORIZED' })
    }

    const session = sessionResult.rows[0]
    if (session.revoked_at) {
      throw Object.assign(new Error('Session revoked'), { code: 'UNAUTHORIZED' })
    }

    if (new Date(session.expires_at).getTime() < Date.now()) {
      throw Object.assign(new Error('Session expired'), { code: 'UNAUTHORIZED' })
    }

    db.query(
      `
      UPDATE profile_auth_sessions
      SET last_used_at = NOW()
      WHERE token_hash = $1
      `,
      [tokenHash],
    ).catch(() => {
      // best-effort telemetry only
    })

    return {
      wallet: session.wallet_address,
      expiresAt: new Date(session.expires_at).toISOString(),
    }
  }

  async function linkSessionWallet({ mainWallet, sessionWallet }) {
    const normalizedMain = normalizeWallet(mainWallet)
    const normalizedSession = normalizeWallet(sessionWallet)

    if (!normalizedMain || !normalizedSession) {
      throw Object.assign(new Error('Invalid wallet address'), { code: 'INVALID_WALLET' })
    }

    if (normalizedMain === normalizedSession) {
      throw Object.assign(new Error('Session wallet must differ from main wallet'), { code: 'INVALID_LINK' })
    }

    await db.query(
      `
      UPDATE wallet_links
      SET unlinked_at = NOW()
      WHERE session_wallet = $1
        AND unlinked_at IS NULL
      `,
      [normalizedSession],
    )

    await db.query(
      `
      INSERT INTO wallet_links (main_wallet, session_wallet)
      VALUES ($1, $2)
      `,
      [normalizedMain, normalizedSession],
    )

    const scope = await resolveWalletScope(normalizedMain)
    return {
      mainWallet: scope.mainWallet,
      linkedSessionWallets: scope.linkedSessionWallets,
    }
  }

  async function unlinkSessionWallet({ mainWallet, sessionWallet }) {
    const normalizedMain = normalizeWallet(mainWallet)
    const normalizedSession = normalizeWallet(sessionWallet)

    if (!normalizedMain || !normalizedSession) {
      throw Object.assign(new Error('Invalid wallet address'), { code: 'INVALID_WALLET' })
    }

    const result = await db.query(
      `
      UPDATE wallet_links
      SET unlinked_at = NOW()
      WHERE main_wallet = $1
        AND session_wallet = $2
        AND unlinked_at IS NULL
      RETURNING session_wallet
      `,
      [normalizedMain, normalizedSession],
    )

    const scope = await resolveWalletScope(normalizedMain)
    return {
      unlinked: result.rowCount > 0,
      linkedSessionWallets: scope.linkedSessionWallets,
    }
  }

  async function insertResolvedBetRecord(payload) {
    const txSignature = typeof payload.txSignature === 'string' ? payload.txSignature : ''
    if (!txSignature) {
      throw new Error('txSignature is required for profile transaction inserts')
    }

    const sourceWallet = normalizeWallet(payload.sourceWallet)
    if (!sourceWallet) {
      throw new Error('sourceWallet is required for profile transaction inserts')
    }

    const resolvedAt = payload.resolvedAt
      ? new Date(payload.resolvedAt)
      : null

    let resolvedAtDate = resolvedAt
    if (!resolvedAtDate || Number.isNaN(resolvedAtDate.getTime())) {
      if (typeof getTxResolvedAt === 'function') {
        try {
          const maybeDate = await getTxResolvedAt(txSignature)
          if (maybeDate && !Number.isNaN(new Date(maybeDate).getTime())) {
            resolvedAtDate = new Date(maybeDate)
          }
        } catch {
          // fallback below
        }
      }
    }

    if (!resolvedAtDate || Number.isNaN(resolvedAtDate.getTime())) {
      resolvedAtDate = new Date()
    }

    const result = await db.query(
      `
      INSERT INTO profile_transactions (
        tx_signature,
        event_index,
        bet_pda,
        source_wallet,
        game,
        box_x,
        box_row,
        winning_row,
        won,
        bet_amount,
        payout,
        seed_index,
        resolved_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10::NUMERIC, $11::NUMERIC, $12, $13
      )
      ON CONFLICT (tx_signature, event_index) DO NOTHING
      `,
      [
        txSignature,
        Number.isFinite(payload.eventIndex) ? Math.trunc(payload.eventIndex) : 0,
        payload.betPda || null,
        sourceWallet,
        payload.game || 'crash',
        payload.boxX === undefined || payload.boxX === null ? null : Math.trunc(payload.boxX),
        payload.boxRow === undefined || payload.boxRow === null ? null : Math.trunc(payload.boxRow),
        payload.winningRow === undefined || payload.winningRow === null ? null : Math.trunc(payload.winningRow),
        Boolean(payload.won),
        asFiniteNumber(payload.betAmount, 0),
        asFiniteNumber(payload.payout, 0),
        payload.seedIndex === undefined || payload.seedIndex === null ? null : Math.trunc(payload.seedIndex),
        resolvedAtDate,
      ],
    )

    return result.rowCount > 0
  }

  function enqueueResolvedBet(payload) {
    if (!db.isReady()) return

    if (writeQueue.length >= MAX_WRITE_QUEUE) {
      writeQueue.shift()
      logger.warn('[PROFILE] resolved-bet queue full; dropping oldest item')
    }

    writeQueue.push({ payload, attempts: 0 })
    flushResolvedBetQueue().catch((error) => {
      logger.error('[PROFILE] immediate queue flush failed:', error?.message || error)
    })
  }

  async function flushResolvedBetQueue() {
    if (!db.isReady()) return
    if (flushingQueue) return
    if (writeQueue.length === 0) return

    flushingQueue = true
    try {
      while (writeQueue.length > 0) {
        const head = writeQueue[0]
        try {
          await insertResolvedBetRecord(head.payload)
          writeQueue.shift()
        } catch (error) {
          head.attempts += 1
          logger.error(
            `[PROFILE] failed to persist resolved bet (attempt ${head.attempts}/${MAX_WRITE_RETRIES}):`,
            error?.message || error,
          )
          if (head.attempts >= MAX_WRITE_RETRIES) {
            writeQueue.shift()
            logger.error('[PROFILE] dropping unresolved queue item after max retries')
            continue
          }
          break
        }
      }
    } finally {
      flushingQueue = false
    }
  }

  async function ingestSignatureFromChain({ signature, connection }) {
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })

    if (!tx || !tx.meta?.logMessages) return { inserted: 0, found: 0 }

    const resolvedAt = tx.blockTime ? new Date(tx.blockTime * 1000) : new Date()
    const decodedEvents = extractBetResolvedEvents(tx.meta.logMessages)

    let inserted = 0
    for (const event of decodedEvents) {
      const didInsert = await insertResolvedBetRecord({
        txSignature: signature,
        eventIndex: event.eventIndex,
        sourceWallet: event.sourceWallet,
        game: 'crash',
        boxX: event.boxX,
        boxRow: event.boxRow,
        winningRow: event.winningRow,
        won: event.won,
        betAmount: event.betAmount,
        payout: event.payout,
        seedIndex: event.seedIndex,
        resolvedAt,
      })
      if (didInsert) inserted += 1
    }

    return { inserted, found: decodedEvents.length }
  }

  async function readBackfillState(jobName) {
    const result = await db.query(
      `
      SELECT job_name, before_signature, processed_count, inserted_count, updated_at
      FROM profile_backfill_state
      WHERE job_name = $1
      LIMIT 1
      `,
      [jobName],
    )

    if (result.rowCount === 0) {
      return {
        jobName,
        beforeSignature: null,
        processedCount: 0,
        insertedCount: 0,
        updatedAt: null,
      }
    }

    const row = result.rows[0]
    return {
      jobName: row.job_name,
      beforeSignature: row.before_signature,
      processedCount: Number(row.processed_count || 0),
      insertedCount: Number(row.inserted_count || 0),
      updatedAt: row.updated_at,
    }
  }

  async function writeBackfillState({ jobName, beforeSignature, processedCount, insertedCount }) {
    await db.query(
      `
      INSERT INTO profile_backfill_state (job_name, before_signature, processed_count, inserted_count, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (job_name)
      DO UPDATE SET
        before_signature = EXCLUDED.before_signature,
        processed_count = EXCLUDED.processed_count,
        inserted_count = EXCLUDED.inserted_count,
        updated_at = NOW()
      `,
      [jobName, beforeSignature, processedCount, insertedCount],
    )
  }

  async function runBackfill({
    connection,
    programId,
    jobName = 'bet_resolved_full',
    pageSize = 500,
    maxSignatures = Infinity,
    resetCursor = false,
  }) {
    if (!connection || !programId) {
      throw new Error('connection and programId are required for backfill')
    }

    const baseline = await readBackfillState(jobName)

    let beforeSignature = resetCursor ? null : baseline.beforeSignature
    let runProcessed = 0
    let runInserted = 0
    let keepRunning = true

    while (keepRunning && runProcessed < maxSignatures) {
      const remaining = Number.isFinite(maxSignatures) ? Math.max(0, maxSignatures - runProcessed) : pageSize
      const limit = Math.max(1, Math.min(pageSize, Number.isFinite(remaining) ? remaining : pageSize))

      const signatures = await connection.getSignaturesForAddress(programId, {
        before: beforeSignature || undefined,
        limit,
      })

      if (!Array.isArray(signatures) || signatures.length === 0) {
        break
      }

      for (const sigInfo of signatures) {
        if (!sigInfo?.signature) continue

        beforeSignature = sigInfo.signature
        runProcessed += 1

        const decoded = await ingestSignatureFromChain({
          signature: sigInfo.signature,
          connection,
        })

        runInserted += decoded.inserted

        if (runProcessed % 25 === 0) {
          await writeBackfillState({
            jobName,
            beforeSignature,
            processedCount: baseline.processedCount + runProcessed,
            insertedCount: baseline.insertedCount + runInserted,
          })
        }

        if (runProcessed >= maxSignatures) {
          keepRunning = false
          break
        }
      }
    }

    await writeBackfillState({
      jobName,
      beforeSignature,
      processedCount: baseline.processedCount + runProcessed,
      insertedCount: baseline.insertedCount + runInserted,
    })

    const finalState = await readBackfillState(jobName)

    return {
      jobName,
      run: {
        processed: runProcessed,
        inserted: runInserted,
      },
      state: finalState,
    }
  }

  return {
    init,
    close,
    isEnabled: db.isEnabled,
    isReady: db.isReady,
    healthCheck: db.healthCheck,
    createAuthChallenge,
    verifyAuthChallenge,
    authenticateAccessToken,
    getOverview,
    getTransactions: async ({ wallet, range = 'ALL', limit = 25, cursor = null }) => {
      const scope = await resolveWalletScope(wallet)
      const parsedRange = parseRange(range)
      const txs = await getTransactions({
        scopeWallets: scope.scopeWallets,
        range: parsedRange,
        limit,
        cursor,
      })
      return {
        wallet: scope.mainWallet,
        requestedWallet: scope.requestedWallet,
        linkedSessionWallets: scope.linkedSessionWallets,
        range: parsedRange,
        ...txs,
      }
    },
    updateSettingsWithToken: async ({ tokenWallet, patch }) => {
      const scope = await resolveWalletScope(tokenWallet)
      const settings = await upsertSettings(scope.mainWallet, patch)
      return {
        wallet: scope.mainWallet,
        settings,
      }
    },
    getWalletNickname: async (wallet) => {
      const normalized = normalizeWallet(wallet)
      if (!normalized || !db.isReady()) return null
      try {
        const settings = await getSettingsForWallet(normalized)
        return settings.nickname || null
      } catch {
        return null
      }
    },
    linkSessionWallet,
    unlinkSessionWallet,
    getGlobalLeaderboard: async (limit) => getGlobalLeaderboard(db, limit),
    handleReferral: async (args) => handleReferral(db, logger, args),
    ensureReferralCode: async (wallet) => ensureReferralCode(db, wallet),
    creditReferralReward: async (args) => creditReferralReward(db, logger, args),
    enqueueResolvedBet,
    flushResolvedBetQueue,
    ingestSignatureFromChain,
    runBackfill,
    parseRange,
    parseLimit,
    normalizeWallet,
    extractBetResolvedEvents,
  }
}

async function getGlobalLeaderboard(db, limit = 50) {
  const result = await db.query(
    `
    WITH stats AS (
      SELECT
        COALESCE(l.main_wallet, t.source_wallet) AS canonical_wallet,
        t.won,
        t.bet_amount,
        t.payout
      FROM profile_transactions t
      LEFT JOIN wallet_links l ON t.source_wallet = l.session_wallet AND l.unlinked_at IS NULL
    )
    SELECT
      stats.canonical_wallet AS address,
      COALESCE(s.nickname, '') AS nickname,
      COUNT(CASE WHEN stats.won THEN 1 END)::INTEGER AS wins,
      COUNT(CASE WHEN NOT stats.won THEN 1 END)::INTEGER AS losses,
      SUM(stats.bet_amount) AS total_bet,
      SUM(stats.payout) AS total_payout,
      (SUM(stats.payout) - SUM(stats.bet_amount)) AS net_profit
    FROM stats
    LEFT JOIN profile_settings s ON stats.canonical_wallet = s.wallet_address
    GROUP BY stats.canonical_wallet, s.nickname
    ORDER BY net_profit DESC
    LIMIT $1
    `,
    [limit],
  )

  return result.rows.map((row) => ({
    address: row.address,
    nickname: row.nickname,
    shortAddr: `${row.address.slice(0, 4)}…${row.address.slice(-4)}`,
    wins: row.wins,
    losses: row.losses,
    totalBet: Number(row.total_bet || 0),
    totalPayout: Number(row.total_payout || 0),
    netProfit: Number(row.net_profit || 0),
  }))
}

async function findWalletByReferralCode(db, code) {
  if (!code || typeof code !== 'string') return null
  const result = await db.query(
    'SELECT wallet_address FROM profile_settings WHERE referral_code = $1 LIMIT 1',
    [code.toUpperCase()],
  )
  return result.rows[0]?.wallet_address || null
}

async function handleReferral(db, logger, { userWallet, referralCode }) {
  if (!referralCode) return
  const normalizedUser = normalizeWallet(userWallet)
  if (!normalizedUser) return

  const referrerWallet = await findWalletByReferralCode(db, referralCode)
  if (!referrerWallet || referrerWallet === normalizedUser) return

  // Only set if not already referred
  const result = await db.query(
    'SELECT referred_by FROM profile_settings WHERE wallet_address = $1',
    [normalizedUser],
  )
  const existingReferredBy = result.rows[0]?.referred_by

  if (!existingReferredBy) {
    // We use a manual UPDATE here to avoid upserting all other fields if the row doesn't exist
    // But usually profile_settings is created on first bet/interaction.
    // Let's use a safe helper that ensures the row exists.
    await db.query(
      `
      INSERT INTO profile_settings (wallet_address, referred_by, referral_code)
      VALUES ($1, $2, $3)
      ON CONFLICT (wallet_address)
      DO UPDATE SET referred_by = EXCLUDED.referred_by
      WHERE profile_settings.referred_by IS NULL
      `,
      [normalizedUser, referrerWallet, crypto.randomBytes(4).toString('hex').toUpperCase()],
    )
    logger.log(`[PROFILE] User ${normalizedUser} referred by ${referrerWallet}`)
  }
}

async function ensureReferralCode(db, wallet) {
  const normalized = normalizeWallet(wallet)
  if (!normalized) return null

  const result = await db.query(
    'SELECT referral_code FROM profile_settings WHERE wallet_address = $1',
    [normalized],
  )
  let code = result.rows[0]?.referral_code

  if (!code) {
    code = crypto.randomBytes(4).toString('hex').toUpperCase()
    await db.query(
      `
      INSERT INTO profile_settings (wallet_address, referral_code)
      VALUES ($1, $2)
      ON CONFLICT (wallet_address)
      DO UPDATE SET referral_code = EXCLUDED.referral_code
      WHERE profile_settings.referral_code IS NULL
      `,
      [normalized, code],
    )
  }
  return code
}

async function creditReferralReward(db, logger, { referrerWallet, rewardAmount }) {
  if (!referrerWallet || rewardAmount <= 0) return
  const normalized = normalizeWallet(referrerWallet)
  if (!normalized) return

  await db.query(
    `
    INSERT INTO profile_settings (wallet_address, referral_earned, referral_code)
    VALUES ($1, $2, $3)
    ON CONFLICT (wallet_address)
    DO UPDATE SET referral_earned = profile_settings.referral_earned + EXCLUDED.referral_earned
    `,
    [normalized, rewardAmount, crypto.randomBytes(4).toString('hex').toUpperCase()],
  )
  logger.log(`[PROFILE] Credited ${rewardAmount} SPRM referral reward to ${normalized}`)
}

module.exports = {
  createProfileService,
  PROFILE_DEFAULT_SETTINGS,
}
