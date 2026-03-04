#!/usr/bin/env node
require('dotenv').config()

const { PublicKey, Connection } = require('@solana/web3.js')
const { createProfileService } = require('../lib/server/profile-service')

function parseFlag(name, fallback = undefined) {
  const arg = process.argv.find((item) => item.startsWith(`--${name}=`))
  if (!arg) return fallback
  return arg.slice(name.length + 3)
}

function parseNumberFlag(name, fallback) {
  const raw = parseFlag(name)
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || 'http://127.0.0.1:8899'
  const programId = new PublicKey(process.env.PROFILE_BACKFILL_PROGRAM_ID || 'AouUDBc5RzydyxEUtrH3nf65ZMeZxxVgMzG4cUat8Cd6')
  const resetCursor = parseFlag('reset-cursor', 'false') === 'true'
  const maxSignatures = parseNumberFlag('max-signatures', Number.POSITIVE_INFINITY)

  const connection = new Connection(rpcUrl, { commitment: 'confirmed' })

  const profileService = createProfileService({ logger: console })
  try {
    const ready = await profileService.init()
    if (!ready) {
      throw new Error('SUPABASE_DB_URL (or DATABASE_URL) is required for profile backfill')
    }

    const result = await profileService.runBackfill({
      connection,
      programId,
      jobName: 'bet_resolved_full',
      pageSize: 500,
      maxSignatures,
      resetCursor,
    })

    console.log('[PROFILE][BACKFILL] complete')
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await profileService.close()
  }
}

main().catch((error) => {
  console.error('[PROFILE][BACKFILL] failed:', error)
  process.exitCode = 1
})
