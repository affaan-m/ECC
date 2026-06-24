'use strict';

/**
 * Authentication middleware.
 * Supports two modes:
 *   1. Bearer token (API key) — for webhooks and programmatic access
 *   2. Session JWT — for dashboard users
 *
 * Sets req.org and req.user on success.
 */

const crypto = require('crypto');
const db = require('../db/client');

const JWT_SECRET = process.env.JWT_SECRET;
const API_KEY_PREFIX = 'ira_';

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Hash an API key for storage/lookup (SHA-256, not bcrypt — keys are long enough).
 */
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Decode and verify a JWT without external dependencies.
 * Supports HS256 only.
 */
function verifyJwt(token) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not configured');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const [headerB64, payloadB64, sigB64] = parts;
  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (!safeEqual(expected, sigB64)) throw new Error('Invalid JWT signature');

  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('JWT expired');
  }
  return payload;
}

/**
 * Generate a JWT for a user session.
 */
function signJwt(payload, expiresInSeconds = 86400) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not configured');

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  })).toString('base64url');

  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${sig}`;
}

/**
 * Middleware: require a valid API key or JWT.
 * Attaches req.org, req.user (may be null for API key auth), req.authType.
 */
async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';

    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();

      if (token.startsWith(API_KEY_PREFIX)) {
        // API key authentication
        const keyHash = hashApiKey(token);
        const result = await db.query(
          `SELECT ak.id, ak.org_id, ak.scopes, ak.expires_at,
                  o.id as oid, o.name as org_name, o.slug, o.plan
           FROM api_keys ak
           JOIN organizations o ON o.id = ak.org_id
           WHERE ak.key_hash = $1`,
          [keyHash]
        );

        if (result.rows.length === 0) {
          return res.status(401).json({ error: 'Invalid API key' });
        }

        const key = result.rows[0];
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
          return res.status(401).json({ error: 'API key expired' });
        }

        // Update last_used_at async (fire and forget)
        db.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [key.id])
          .catch(() => {});

        req.org = { id: key.org_id, name: key.org_name, slug: key.slug, plan: key.plan };
        req.user = null;
        req.authType = 'api_key';
        req.scopes = key.scopes || [];
        return next();
      }

      // JWT authentication (dashboard sessions)
      const payload = verifyJwt(token);

      const result = await db.query(
        `SELECT u.id, u.email, u.name, u.role, u.oncall, u.org_id,
                o.name as org_name, o.slug, o.plan
         FROM users u
         JOIN organizations o ON o.id = u.org_id
         WHERE u.id = $1`,
        [payload.sub]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'User not found' });
      }

      const user = result.rows[0];
      req.org = { id: user.org_id, name: user.org_name, slug: user.slug, plan: user.plan };
      req.user = { id: user.id, email: user.email, name: user.name, role: user.role, oncall: user.oncall };
      req.authType = 'jwt';
      req.scopes = ['*'];
      return next();
    }

    return res.status(401).json({ error: 'Authorization header required' });
  } catch (err) {
    if (err.message.includes('JWT')) {
      return res.status(401).json({ error: err.message });
    }
    process.stderr.write(`[Auth] Error: ${err.message}\n`);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Middleware: require a specific scope (for API key access).
 */
function requireScope(scope) {
  return (req, res, next) => {
    if (req.authType === 'jwt') return next(); // JWT users have all scopes
    if (!req.scopes || (!req.scopes.includes(scope) && !req.scopes.includes('*'))) {
      return res.status(403).json({ error: `Missing required scope: ${scope}` });
    }
    return next();
  };
}

/**
 * Middleware: require a minimum user role (for dashboard users).
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(); // API key — skip role check
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireScope, requireRole, signJwt, hashApiKey };
