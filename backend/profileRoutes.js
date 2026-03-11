// ── HTTP utilities + /api/profile/* route handler ─────────────────────────────

const { GAME_ADDRESS } = require('./config');
const { state } = require('./state');

function setCorsHeaders(res, origin, ALLOWED_ORIGIN) {
  const allowedOrigins = [
    ALLOWED_ORIGIN,
    'https://spermdotfun.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001'
  ];

  let finalOrigin = ALLOWED_ORIGIN;
  if (origin && (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app'))) {
    finalOrigin = origin;
  }

  res.setHeader('Access-Control-Allow-Origin', finalOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Profile-Admin-Key, X-Admin-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendProfileError(res, error) {
  const code = error?.code;
  if (code === 'UNAUTHORIZED') return sendJson(res, 401, { error: error.message || 'Unauthorized' });
  if (code === 'INVALID_WALLET') return sendJson(res, 400, { error: error.message || 'Invalid wallet address' });
  if (code === 'INVALID_CURSOR') return sendJson(res, 400, { error: error.message || 'Invalid cursor' });
  if (code === 'INVALID_NONCE') return sendJson(res, 400, { error: error.message || 'Invalid nonce' });
  if (code === 'INVALID_JSON_BODY') return sendJson(res, 400, { error: error.message || 'Invalid JSON body' });
  if (code === 'NONCE_EXPIRED' || code === 'NONCE_USED') return sendJson(res, 401, { error: error.message || 'Nonce is not valid' });
  if (code === 'INVALID_SIGNATURE') return sendJson(res, 401, { error: error.message || 'Invalid signature' });
  if (code === 'INVALID_LINK') return sendJson(res, 400, { error: error.message || 'Invalid wallet link request' });
  console.error('[PROFILE] API error:', error);
  return sendJson(res, 500, { error: 'Internal profile API error' });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('error', reject);
    req.on('end', () => {
      if (!body.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(Object.assign(new Error('Invalid JSON body'), { code: 'INVALID_JSON_BODY' })); }
    });
  });
}

function parseBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

async function requireProfileSession(req, res, profileService) {
  const token = parseBearerToken(req);
  if (!token) { sendJson(res, 401, { error: 'Missing bearer token' }); return null; }
  try { return await profileService.authenticateAccessToken(token); }
  catch (error) { sendProfileError(res, error); return null; }
}

async function handleProfileApiRequest(req, res, parsedUrl, profileService) {
  const pathname = parsedUrl.pathname || '';
  if (!pathname.startsWith('/api/profile/')) return false;

  if (!profileService.isReady()) {
    sendJson(res, 503, { error: 'Profile backend is unavailable. Configure SUPABASE_DB_URL (or DATABASE_URL).' });
    return true;
  }

  try {
    if (req.method === 'POST' && pathname === '/api/profile/auth/challenge') {
      const body = await readJsonBody(req);
      sendJson(res, 200, await profileService.createAuthChallenge(body.wallet));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/profile/auth/verify') {
      const body = await readJsonBody(req);
      const result = await profileService.verifyAuthChallenge({ wallet: body.wallet, nonce: body.nonce, signature: body.signature });
      sendJson(res, 200, { accessToken: result.accessToken, expiresAt: result.expiresAt });
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/profile/overview') {
      const wallet = parsedUrl.query.wallet;
      if (!wallet || typeof wallet !== 'string') { sendJson(res, 400, { error: 'Missing wallet query parameter' }); return true; }
      const range = typeof parsedUrl.query.range === 'string' ? parsedUrl.query.range : '7D';
      const txLimit = Number.parseInt(String(parsedUrl.query.txLimit ?? '25'), 10);
      sendJson(res, 200, await profileService.getOverview({ wallet, range, txLimit: Number.isFinite(txLimit) ? txLimit : 25 }));
      return true;
    }

    if (req.method === 'GET' && pathname === '/api/profile/transactions') {
      const wallet = parsedUrl.query.wallet;
      if (!wallet || typeof wallet !== 'string') { sendJson(res, 400, { error: 'Missing wallet query parameter' }); return true; }
      const range = typeof parsedUrl.query.range === 'string' ? parsedUrl.query.range : 'ALL';
      const limit = Number.parseInt(String(parsedUrl.query.limit ?? '25'), 10);
      const cursor = typeof parsedUrl.query.cursor === 'string' ? parsedUrl.query.cursor : null;
      sendJson(res, 200, await profileService.getTransactions({ wallet, range, limit: Number.isFinite(limit) ? limit : 25, cursor }));
      return true;
    }

    if (req.method === 'PATCH' && pathname === '/api/profile/settings') {
      const session = await requireProfileSession(req, res, profileService);
      if (!session) return true;
      const body = await readJsonBody(req);
      sendJson(res, 200, await profileService.updateSettingsWithToken({ tokenWallet: session.wallet, patch: body }));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/profile/session-links') {
      const session = await requireProfileSession(req, res, profileService);
      if (!session) return true;
      const body = await readJsonBody(req);
      sendJson(res, 200, await profileService.linkSessionWallet({ mainWallet: session.wallet, sessionWallet: body.sessionWallet }));
      return true;
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/profile/session-links/')) {
      const session = await requireProfileSession(req, res, profileService);
      if (!session) return true;
      const sessionWallet = decodeURIComponent(pathname.slice('/api/profile/session-links/'.length));
      sendJson(res, 200, await profileService.unlinkSessionWallet({ mainWallet: session.wallet, sessionWallet }));
      return true;
    }

    if (req.method === 'POST' && pathname === '/api/profile/backfill') {
      const adminKey = req.headers['x-profile-admin-key'] || req.headers['x-admin-key'];
      const expectedAdminKey = process.env.PROFILE_ADMIN_KEY || '';
      if (!expectedAdminKey) { sendJson(res, 501, { error: 'PROFILE_ADMIN_KEY is not configured' }); return true; }
      if (!adminKey || String(adminKey) !== expectedAdminKey) { sendJson(res, 403, { error: 'Forbidden' }); return true; }
      if (state.profileBackfillInFlight) { sendJson(res, 409, { error: 'Backfill is already running' }); return true; }
      const body = await readJsonBody(req);
      const maxSignatures = Number.parseInt(String(body.maxSignatures ?? ''), 10);
      const pageSize = Number.parseInt(String(body.pageSize ?? ''), 10);
      const resetCursor = body.resetCursor === true;
      state.profileBackfillInFlight = true;
      try {
        const result = await profileService.runBackfill({
          provider: state.evmProvider, contractAddress: GAME_ADDRESS,
          pageSize: Number.isFinite(pageSize) ? pageSize : 500,
          maxSignatures: Number.isFinite(maxSignatures) ? maxSignatures : Infinity,
          resetCursor, jobName: 'bet_resolved_full',
        });
        sendJson(res, 200, result);
      } finally {
        state.profileBackfillInFlight = false;
      }
      return true;
    }

    sendJson(res, 404, { error: 'Unknown profile API route' });
    return true;
  } catch (error) {
    sendProfileError(res, error);
    return true;
  }
}

module.exports = { setCorsHeaders, sendJson, handleProfileApiRequest };
