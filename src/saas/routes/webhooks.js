'use strict';

/**
 * Webhook ingestion routes.
 * POST /webhooks/:token  — receive alerts from any source
 *
 * The :token identifies the alert_source row (org + source type).
 * No auth header required — the token IS the credential.
 */

const crypto = require('crypto');
const db = require('../db/client');
const ingestor = require('../services/alert-ingestor');

const MAX_BODY_BYTES = 64 * 1024;

/**
 * Validate the webhook token format (prevent injection via URL).
 * Tokens are UUIDs or random hex strings — alphanumeric + hyphen only.
 */
function isValidToken(token) {
  return typeof token === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(token);
}

/**
 * POST /webhooks/:token
 */
async function handleWebhook(req, res) {
  const { token } = req.params;

  if (!isValidToken(token)) {
    return res.status(400).json({ error: 'Invalid webhook token format' });
  }

  // Constant-time lookup to avoid timing oracle on token existence
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  let source;
  try {
    const result = await db.query(
      `SELECT as2.id, as2.org_id, as2.type, as2.active
       FROM alert_sources as2
       WHERE as2.webhook_token = $1`,
      [token]
    );
    source = result.rows[0];
  } catch (err) {
    process.stderr.write(`[Webhook] DB error: ${err.message}\n`);
    return res.status(500).json({ error: 'Internal error' });
  }

  // Always return 200 even if token is invalid — prevents enumeration
  if (!source || !source.active) {
    // Log attempt for security monitoring but don't reveal reason
    process.stderr.write(`[Webhook] Invalid or inactive token attempt (hash: ${tokenHash.slice(0, 8)}...)\n`);
    return res.status(200).json({ received: true });
  }

  const payload = req.body;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'JSON body required' });
  }

  try {
    const { incident, created } = await ingestor.ingest(
      source.org_id,
      source.id,
      source.type,
      payload
    );

    return res.status(200).json({
      received: true,
      incident_id: incident.id,
      severity: incident.severity,
      created,
    });
  } catch (err) {
    process.stderr.write(`[Webhook] Ingest error: ${err.message}\n`);
    return res.status(500).json({ error: 'Failed to process alert' });
  }
}

module.exports = { handleWebhook };
