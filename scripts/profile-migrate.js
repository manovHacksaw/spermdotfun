#!/usr/bin/env node
require('dotenv').config()

const { createProfileDb } = require('../lib/server/profile-db')

async function main() {
  const db = createProfileDb({ autoMigrate: true, logger: console })
  try {
    const ready = await db.init()
    if (!ready) {
      console.error('[PROFILE][MIGRATE] SUPABASE_DB_URL (or DATABASE_URL) not configured')
      process.exitCode = 1
      return
    }
    console.log('[PROFILE][MIGRATE] done')
  } finally {
    await db.close()
  }
}

main().catch((error) => {
  console.error('[PROFILE][MIGRATE] failed:', error)
  process.exitCode = 1
})
