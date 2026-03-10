const { test, before, after, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { Pool } = require('pg')

const { createProfileDb } = require('../../lib/server/profile-db')
const { createProfileService } = require('../../lib/server/profile-service')
const { createTransactionalDbAdapter } = require('./helpers/test-db-adapter')
const { createDeterministicWallet, signMessage } = require('./helpers/wallet-crypto')
const { encodeBetResolvedLog } = require('./helpers/bet-resolved-log')

const DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
const HAS_DB = Boolean(DB_URL)
const SKIP_REASON = 'SUPABASE_DB_URL (or DATABASE_URL) must be set to run profile acceptance tests'

const silentLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
}

let pool = null
let client = null
let activeServices = []

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

async function createService(options = {}) {
  assert.ok(client, 'Missing transaction client')
  const db = createTransactionalDbAdapter(client)
  const service = createProfileService({
    db,
    logger: silentLogger,
    ...options,
  })

  const ready = await service.init()
  assert.equal(ready, true, 'Profile service should initialize for tests')

  activeServices.push(service)
  return service
}

async function closeService(service) {
  if (!service) return
  try {
    await service.close()
  } finally {
    activeServices = activeServices.filter((entry) => entry !== service)
  }
}

async function closeActiveServices() {
  const services = activeServices.slice().reverse()
  activeServices = []
  for (const service of services) {
    try {
      await service.close()
    } catch {
      // ignore close errors during test teardown
    }
  }
}

async function insertTransactionRow({
  txSignature,
  eventIndex = 0,
  sourceWallet,
  game = 'crash',
  boxX = null,
  boxRow = null,
  winningRow = null,
  won,
  betAmount,
  payout,
  seedIndex = null,
  resolvedAt,
}) {
  const result = await client.query(
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
      $1, $2, NULL, $3, $4, $5, $6, $7, $8,
      $9::NUMERIC, $10::NUMERIC, $11, $12
    )
    RETURNING *
    `,
    [
      txSignature,
      eventIndex,
      sourceWallet,
      game,
      boxX,
      boxRow,
      winningRow,
      Boolean(won),
      Number(betAmount),
      Number(payout),
      seedIndex,
      resolvedAt,
    ],
  )

  return result.rows[0]
}

async function readTransactionRow(txSignature, eventIndex = 0) {
  const result = await client.query(
    `
    SELECT *
    FROM profile_transactions
    WHERE tx_signature = $1
      AND event_index = $2
    LIMIT 1
    `,
    [txSignature, eventIndex],
  )
  return result.rows[0] || null
}

async function waitForTransactionRow(txSignature, eventIndex = 0, { timeoutMs = 3_000, pollMs = 20 } = {}) {
  const start = Date.now()

  while (Date.now() - start <= timeoutMs) {
    const row = await readTransactionRow(txSignature, eventIndex)
    if (row) return row
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  throw new Error(`Timed out waiting for transaction row ${txSignature}:${eventIndex}`)
}

before(async () => {
  if (!HAS_DB) return

  const bootstrapDb = createProfileDb({
    databaseUrl: DB_URL,
    autoMigrate: true,
    logger: silentLogger,
  })

  try {
    const ready = await bootstrapDb.init()
    assert.equal(ready, true, 'Profile DB bootstrap must initialize')
  } finally {
    await bootstrapDb.close()
  }

  pool = new Pool({ connectionString: DB_URL, max: 4 })
  await pool.query('SELECT 1')
})

beforeEach(async () => {
  if (!HAS_DB) return

  client = await pool.connect()
  await client.query('BEGIN')
})

afterEach(async () => {
  if (!HAS_DB) return

  await closeActiveServices()

  if (client) {
    try {
      await client.query('ROLLBACK')
    } finally {
      client.release()
      client = null
    }
  }
})

after(async () => {
  if (!HAS_DB || !pool) return
  await pool.end()
  pool = null
})

test('resolved_at uses chain time when blockTime lookup succeeds', { skip: HAS_DB ? false : SKIP_REASON }, async () => {
  const chainResolvedAt = new Date('2026-01-15T12:34:56.000Z')
  const wallet = createDeterministicWallet('resolved-at-chain').wallet

  const service = await createService({
    getTxResolvedAt: async (txSignature) => {
      assert.equal(txSignature, 'tx-chain-time-1')
      return chainResolvedAt
    },
  })

  service.enqueueResolvedBet({
    txSignature: 'tx-chain-time-1',
    eventIndex: 0,
    sourceWallet: wallet,
    game: 'crash',
    boxX: 140,
    boxRow: 3,
    winningRow: 3,
    won: true,
    betAmount: 1.25,
    payout: 2.5,
    seedIndex: 7,
  })

  const row = await waitForTransactionRow('tx-chain-time-1', 0)
  assert.equal(row.resolved_at.toISOString(), chainResolvedAt.toISOString())

  await closeService(service)
})

test('resolved_at falls back to server time when chain lookup is unavailable', { skip: HAS_DB ? false : SKIP_REASON }, async () => {
  const wallet = createDeterministicWallet('resolved-at-fallback').wallet

  for (const mode of ['null', 'throw']) {
    const txSignature = `tx-fallback-${mode}`
    const service = await createService({
      getTxResolvedAt: async () => {
        if (mode === 'throw') {
          throw new Error('RPC unavailable')
        }
        return null
      },
    })

    const before = Date.now()

    service.enqueueResolvedBet({
      txSignature,
      eventIndex: 0,
      sourceWallet: wallet,
      game: 'crash',
      boxX: 280,
      boxRow: 4,
      winningRow: 4,
      won: true,
      betAmount: 2,
      payout: 3,
      seedIndex: 9,
    })

    const row = await waitForTransactionRow(txSignature, 0)
    const after = Date.now()
    const resolvedAtMs = row.resolved_at.getTime()

    assert.ok(
      resolvedAtMs >= before - 2_000,
      `Expected fallback timestamp >= ${new Date(before - 2_000).toISOString()}, got ${row.resolved_at.toISOString()}`,
    )
    assert.ok(
      resolvedAtMs <= after + 2_000,
      `Expected fallback timestamp <= ${new Date(after + 2_000).toISOString()}, got ${row.resolved_at.toISOString()}`,
    )

    await closeService(service)
  }
})

test('auth success: challenge -> verify -> token auth', { skip: HAS_DB ? false : SKIP_REASON }, async () => {
  const service = await createService()
  const wallet = createDeterministicWallet('auth-success')

  const challenge = await service.createAuthChallenge(wallet.wallet)
  assert.ok(challenge.nonce)
  assert.ok(challenge.message.includes(wallet.wallet))

  const signature = await signMessage(wallet, challenge.message)
  const verifyResult = await service.verifyAuthChallenge({
    wallet: wallet.wallet,
    nonce: challenge.nonce,
    signature,
  })

  assert.ok(verifyResult.accessToken)
  assert.equal(verifyResult.wallet, wallet.wallet)

  const session = await service.authenticateAccessToken(verifyResult.accessToken)
  assert.equal(session.wallet, wallet.wallet)
  assert.ok(new Date(session.expiresAt).getTime() > Date.now())

  await closeService(service)
})

test('auth failures: invalid signature, expired nonce, reused nonce, expired token', { skip: HAS_DB ? false : SKIP_REASON }, async () => {
  const service = await createService()
  const wallet = createDeterministicWallet('auth-failure-main')
  const otherWallet = createDeterministicWallet('auth-failure-other')

  const invalidSigChallenge = await service.createAuthChallenge(wallet.wallet)
  const wrongSignature = await signMessage(otherWallet, invalidSigChallenge.message)
  await assert.rejects(
    service.verifyAuthChallenge({
      wallet: wallet.wallet,
      nonce: invalidSigChallenge.nonce,
      signature: wrongSignature,
    }),
    (error) => {
      assert.equal(error.code, 'INVALID_SIGNATURE')
      return true
    },
  )

  const expiredNonceChallenge = await service.createAuthChallenge(wallet.wallet)
  await client.query(
    `
    UPDATE profile_auth_nonces
    SET expires_at = NOW() - INTERVAL '5 minutes'
    WHERE nonce = $1
    `,
    [expiredNonceChallenge.nonce],
  )

  const expiredNonceSignature = await signMessage(wallet, expiredNonceChallenge.message)
  await assert.rejects(
    service.verifyAuthChallenge({
      wallet: wallet.wallet,
      nonce: expiredNonceChallenge.nonce,
      signature: expiredNonceSignature,
    }),
    (error) => {
      assert.equal(error.code, 'NONCE_EXPIRED')
      return true
    },
  )

  const usedNonceChallenge = await service.createAuthChallenge(wallet.wallet)
  const usedNonceSignature = await signMessage(wallet, usedNonceChallenge.message)
  const verified = await service.verifyAuthChallenge({
    wallet: wallet.wallet,
    nonce: usedNonceChallenge.nonce,
    signature: usedNonceSignature,
  })

  await assert.rejects(
    service.verifyAuthChallenge({
      wallet: wallet.wallet,
      nonce: usedNonceChallenge.nonce,
      signature: usedNonceSignature,
    }),
    (error) => {
      assert.equal(error.code, 'NONCE_USED')
      return true
    },
  )

  await client.query(
    `
    UPDATE profile_auth_sessions
    SET expires_at = NOW() - INTERVAL '5 minutes'
    WHERE token_hash = $1
    `,
    [hashToken(verified.accessToken)],
  )

  await assert.rejects(
    service.authenticateAccessToken(verified.accessToken),
    (error) => {
      assert.equal(error.code, 'UNAUTHORIZED')
      return true
    },
  )

  await closeService(service)
})

test('stats math accuracy for overview aggregates', { skip: HAS_DB ? false : SKIP_REASON }, async () => {
  const service = await createService()
  const wallet = createDeterministicWallet('stats-main').wallet
  const base = new Date('2026-02-01T00:00:00.000Z')

  await insertTransactionRow({
    txSignature: 'stats-1',
    sourceWallet: wallet,
    won: true,
    betAmount: 10,
    payout: 15,
    resolvedAt: new Date(base.getTime() + 1_000),
  })

  await insertTransactionRow({
    txSignature: 'stats-2',
    sourceWallet: wallet,
    won: false,
    betAmount: 20,
    payout: 0,
    resolvedAt: new Date(base.getTime() + 2_000),
  })

  await insertTransactionRow({
    txSignature: 'stats-3',
    sourceWallet: wallet,
    won: true,
    betAmount: 5,
    payout: 8,
    resolvedAt: new Date(base.getTime() + 3_000),
  })

  const overview = await service.getOverview({
    wallet,
    range: 'ALL',
    txLimit: 0,
  })

  const stats = overview.stats
  assert.equal(stats.gamesPlayed, 3)
  assert.equal(stats.wins, 2)
  assert.equal(stats.losses, 1)
  assert.ok(Math.abs(stats.winRate - ((2 / 3) * 100)) < 1e-9)
  assert.equal(stats.totalWagered, 35)
  assert.equal(stats.totalPayout, 23)
  assert.equal(stats.netProfit, -12)
  assert.equal(stats.grossProfit, 8)
  assert.equal(stats.totalLoss, 20)
  assert.ok(Math.abs(stats.avgBet - (35 / 3)) < 1e-9)
  assert.ok(Math.abs(stats.avgPayout - (23 / 3)) < 1e-9)

  await closeService(service)
})

test('wallet-link completeness includes linked session scope and excludes after unlink', { skip: HAS_DB ? false : SKIP_REASON }, async () => {
  const service = await createService()
  const mainWallet = createDeterministicWallet('wallet-link-main').wallet
  const sessionWallet = createDeterministicWallet('wallet-link-session').wallet
  const unrelatedWallet = createDeterministicWallet('wallet-link-unrelated').wallet
  const base = new Date('2026-02-02T00:00:00.000Z')

  const linkResult = await service.linkSessionWallet({
    mainWallet,
    sessionWallet,
  })
  assert.equal(linkResult.mainWallet, mainWallet)
  assert.deepEqual(linkResult.linkedSessionWallets, [sessionWallet])

  await insertTransactionRow({
    txSignature: 'scope-main',
    sourceWallet: mainWallet,
    won: true,
    betAmount: 2,
    payout: 4,
    resolvedAt: new Date(base.getTime() + 1_000),
  })

  await insertTransactionRow({
    txSignature: 'scope-session',
    sourceWallet: sessionWallet,
    won: false,
    betAmount: 3,
    payout: 0,
    resolvedAt: new Date(base.getTime() + 2_000),
  })

  await insertTransactionRow({
    txSignature: 'scope-unrelated',
    sourceWallet: unrelatedWallet,
    won: true,
    betAmount: 9,
    payout: 11,
    resolvedAt: new Date(base.getTime() + 3_000),
  })

  const linkedOverview = await service.getOverview({
    wallet: mainWallet,
    range: 'ALL',
    txLimit: 20,
  })
  assert.equal(linkedOverview.stats.gamesPlayed, 2)
  assert.deepEqual(
    new Set(linkedOverview.transactions.map((item) => item.sourceWallet)),
    new Set([mainWallet, sessionWallet]),
  )

  const linkedTxPage = await service.getTransactions({
    wallet: mainWallet,
    range: 'ALL',
    limit: 20,
  })
  assert.equal(linkedTxPage.items.length, 2)
  assert.deepEqual(
    new Set(linkedTxPage.items.map((item) => item.sourceWallet)),
    new Set([mainWallet, sessionWallet]),
  )

  const unlinkResult = await service.unlinkSessionWallet({
    mainWallet,
    sessionWallet,
  })
  assert.equal(unlinkResult.unlinked, true)

  const unlinkedOverview = await service.getOverview({
    wallet: mainWallet,
    range: 'ALL',
    txLimit: 20,
  })
  assert.equal(unlinkedOverview.stats.gamesPlayed, 1)
  assert.deepEqual(
    new Set(unlinkedOverview.transactions.map((item) => item.sourceWallet)),
    new Set([mainWallet]),
  )

  const unlinkedTxPage = await service.getTransactions({
    wallet: mainWallet,
    range: 'ALL',
    limit: 20,
  })
  assert.equal(unlinkedTxPage.items.length, 1)
  assert.equal(unlinkedTxPage.items[0].sourceWallet, mainWallet)

  await closeService(service)
})

test('transactions pagination returns deterministic non-overlapping pages', { skip: HAS_DB ? false : SKIP_REASON }, async () => {
  const service = await createService()
  const wallet = createDeterministicWallet('pagination-wallet').wallet
  const base = new Date('2026-02-03T00:00:00.000Z')

  for (let i = 0; i < 8; i += 1) {
    await insertTransactionRow({
      txSignature: `pagination-${String(i).padStart(2, '0')}`,
      sourceWallet: wallet,
      won: i % 2 === 0,
      betAmount: i + 1,
      payout: i % 2 === 0 ? i + 2 : 0,
      resolvedAt: new Date(base.getTime() + i * 60_000),
    })
  }

  const collected = []
  const seenIds = new Set()
  let cursor = null

  do {
    const page = await service.getTransactions({
      wallet,
      range: 'ALL',
      limit: 3,
      cursor,
    })

    for (const item of page.items) {
      assert.equal(seenIds.has(item.id), false, `Duplicate transaction returned in pagination: ${item.id}`)
      seenIds.add(item.id)
      collected.push(item)
    }

    if (page.hasMore) {
      assert.ok(page.nextCursor)
      cursor = page.nextCursor
    } else {
      assert.equal(page.nextCursor, null)
      cursor = null
    }
  } while (cursor)

  assert.equal(collected.length, 8)

  const expected = await client.query(
    `
    SELECT tx_signature, event_index
    FROM profile_transactions
    WHERE source_wallet = $1
    ORDER BY resolved_at DESC, tx_signature DESC, event_index DESC
    `,
    [wallet],
  )

  const expectedIds = expected.rows.map((row) => `${row.tx_signature}:${row.event_index}`)
  assert.deepEqual(collected.map((item) => item.id), expectedIds)

  await closeService(service)
})

test('backfill idempotency keeps duplicate inserts at zero on rerun', { skip: HAS_DB ? false : SKIP_REASON }, async () => {
  const service = await createService()
  const firstWallet = createDeterministicWallet('backfill-wallet-1').wallet
  const secondWallet = createDeterministicWallet('backfill-wallet-2').wallet
  const signatures = ['backfill-sig-1', 'backfill-sig-2']

  const txLookup = {
    'backfill-sig-1': {
      blockTime: 1_735_699_200,
      meta: {
        logMessages: [
          encodeBetResolvedLog({
            sourceWallet: firstWallet,
            boxX: 140,
            boxRow: 2,
            winningRow: 2,
            won: true,
            betAmount: 1.5,
            payout: 2.4,
            seedIndex: 11,
          }),
        ],
      },
    },
    'backfill-sig-2': {
      blockTime: 1_735_699_260,
      meta: {
        logMessages: [
          encodeBetResolvedLog({
            sourceWallet: secondWallet,
            boxX: 280,
            boxRow: 7,
            winningRow: 1,
            won: false,
            betAmount: 3,
            payout: 0,
            seedIndex: 12,
          }),
        ],
      },
    },
  }

  const connection = {
    async getSignaturesForAddress(_programId, options = {}) {
      if (options.before) return []
      return signatures.map((signature) => ({ signature }))
    },

    async getTransaction(signature) {
      return txLookup[signature] || null
    },
  }

  const programId = createDeterministicWallet('backfill-program').wallet // arbitrary address used for backfill

  const firstRun = await service.runBackfill({
    connection,
    programId,
    jobName: 'test_backfill_idempotency',
    pageSize: 50,
    maxSignatures: 10,
    resetCursor: true,
  })

  assert.equal(firstRun.run.processed, 2)
  assert.equal(firstRun.run.inserted, 2)

  const secondRun = await service.runBackfill({
    connection,
    programId,
    jobName: 'test_backfill_idempotency',
    pageSize: 50,
    maxSignatures: 10,
    resetCursor: true,
  })

  assert.equal(secondRun.run.processed, 2)
  assert.equal(secondRun.run.inserted, 0)

  const insertedRows = await client.query(
    `
    SELECT COUNT(*)::INTEGER AS total
    FROM profile_transactions
    WHERE tx_signature = ANY($1::text[])
    `,
    [signatures],
  )

  assert.equal(insertedRows.rows[0].total, 2)

  await closeService(service)
})

test('restart persistence behavior: service instance B can read rows inserted by instance A', { skip: HAS_DB ? false : SKIP_REASON }, async () => {
  const wallet = createDeterministicWallet('restart-persistence-wallet').wallet
  const txSignature = 'restart-persistence-1'

  const serviceA = await createService({
    getTxResolvedAt: async () => new Date('2026-02-04T00:00:00.000Z'),
  })

  serviceA.enqueueResolvedBet({
    txSignature,
    eventIndex: 0,
    sourceWallet: wallet,
    game: 'crash',
    boxX: 420,
    boxRow: 5,
    winningRow: 5,
    won: true,
    betAmount: 4,
    payout: 7,
    seedIndex: 19,
  })

  await waitForTransactionRow(txSignature, 0)
  await closeService(serviceA)

  const serviceB = await createService()
  const transactions = await serviceB.getTransactions({
    wallet,
    range: 'ALL',
    limit: 10,
    cursor: null,
  })

  assert.equal(transactions.items.length, 1)
  assert.equal(transactions.items[0].txSignature, txSignature)

  await closeService(serviceB)
})
