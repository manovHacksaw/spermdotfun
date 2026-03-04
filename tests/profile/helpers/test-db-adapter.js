function createTransactionalDbAdapter(client) {
  let ready = false

  return {
    async init() {
      ready = true
      return true
    },

    async query(text, params = []) {
      if (!ready) {
        throw new Error('Transactional test DB adapter is not ready')
      }
      return client.query(text, params)
    },

    async close() {
      ready = false
    },

    async healthCheck() {
      if (!ready) return false
      try {
        await client.query('SELECT 1')
        return true
      } catch {
        return false
      }
    },

    isReady: () => ready,
    isEnabled: () => true,
  }
}

module.exports = {
  createTransactionalDbAdapter,
}
