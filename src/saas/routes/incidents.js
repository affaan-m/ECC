'use strict';

/**
 * Incidents REST API
 *
 * GET    /incidents              — list (paginated, filterable)
 * GET    /incidents/:id          — get single incident + timeline
 * POST   /incidents              — create manually
 * PATCH  /incidents/:id          — update status / fields
 * GET    /incidents/:id/events   — timeline events
 * POST   /incidents/:id/events   — add a comment/event
 * POST   /incidents/:id/resolve  — resolve the incident
 */

const db = require('../db/client');
const { classifySeverity, sanitizeText } = require('../services/incident-classifier');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s) => UUID_RE.test(s);

// ─── List Incidents ───────────────────────────────────────────────────────────

async function listIncidents(req, res) {
  const orgId = req.org.id;
  const {
    status, severity, service,
    limit = '25', offset = '0',
  } = req.query;

  const lim = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const off = Math.max(parseInt(offset, 10) || 0, 0);

  const conditions = ['org_id = $1'];
  const params = [orgId];
  let idx = 2;

  if (status && ['open', 'investigating', 'mitigating', 'resolved'].includes(status)) {
    conditions.push(`status = $${idx++}`);
    params.push(status);
  }
  if (severity && ['1','2','3','4'].includes(String(severity))) {
    conditions.push(`severity = $${idx++}`);
    params.push(parseInt(severity, 10));
  }
  if (service) {
    conditions.push(`service ILIKE $${idx++}`);
    params.push(`%${sanitizeText(service, 100)}%`);
  }

  const where = conditions.join(' AND ');

  const [rows, count] = await Promise.all([
    db.query(
      `SELECT id, title, service, severity, status, source_type, summary,
              created_at, resolved_at, duration_secs
       FROM incidents WHERE ${where}
       ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, lim, off]
    ),
    db.query(`SELECT COUNT(*) FROM incidents WHERE ${where}`, params),
  ]);

  return res.json({
    incidents: rows.rows,
    total: parseInt(count.rows[0].count, 10),
    limit: lim,
    offset: off,
  });
}

// ─── Get Incident ─────────────────────────────────────────────────────────────

async function getIncident(req, res) {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid incident ID' });
  }

  const result = await db.query(
    `SELECT i.*, pm.id as postmortem_id, pm.status as postmortem_status
     FROM incidents i
     LEFT JOIN postmortems pm ON pm.incident_id = i.id
     WHERE i.id = $1 AND i.org_id = $2`,
    [req.params.id, req.org.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  // Strip raw_payload from response (may contain sensitive data)
  const incident = { ...result.rows[0] };
  delete incident.raw_payload;

  return res.json(incident);
}

// ─── Create Incident (manual) ─────────────────────────────────────────────────

async function createIncident(req, res) {
  const { title, service, severity, summary } = req.body || {};

  if (!title || !service) {
    return res.status(400).json({ error: 'title and service are required' });
  }

  const sev = severity
    ? Math.min(Math.max(parseInt(severity, 10), 1), 4)
    : classifySeverity(`${title} ${summary || ''}`);

  const result = await db.query(
    `INSERT INTO incidents (org_id, title, service, severity, status, source_type, summary)
     VALUES ($1, $2, $3, $4, 'open', 'manual', $5)
     RETURNING id, title, service, severity, status, summary, created_at`,
    [req.org.id, sanitizeText(title, 200), sanitizeText(service, 100), sev, sanitizeText(summary || '', 500)]
  );

  const incident = result.rows[0];

  await db.query(
    `INSERT INTO audit_log (org_id, user_id, action, resource_type, resource_id, metadata)
     VALUES ($1, $2, 'incident.created', 'incident', $3, $4)`,
    [req.org.id, req.user?.id || null, incident.id, JSON.stringify({ manual: true, severity: sev })]
  );

  return res.status(201).json(incident);
}

// ─── Update Incident ──────────────────────────────────────────────────────────

async function updateIncident(req, res) {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid incident ID' });
  }

  const allowed = ['status', 'severity', 'root_cause', 'mitigation', 'summary'];
  const updates = [];
  const params = [];
  let idx = 1;

  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = $${idx++}`);
      params.push(
        field === 'severity'
          ? Math.min(Math.max(parseInt(req.body[field], 10), 1), 4)
          : sanitizeText(String(req.body[field]), 2000)
      );
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  params.push(req.params.id, req.org.id);

  const result = await db.query(
    `UPDATE incidents SET ${updates.join(', ')}
     WHERE id = $${idx} AND org_id = $${idx + 1}
     RETURNING id, title, service, severity, status, summary, root_cause, mitigation, updated_at`,
    params
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  await db.query(
    `INSERT INTO incident_events (incident_id, actor, event_type, message)
     VALUES ($1, $2, 'status_change', $3)`,
    [req.params.id, req.user?.email || 'api', `Updated: ${Object.keys(req.body).join(', ')}`]
  );

  return res.json(result.rows[0]);
}

// ─── Get Timeline Events ──────────────────────────────────────────────────────

async function getEvents(req, res) {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid incident ID' });
  }

  // Verify org ownership
  const check = await db.query(
    'SELECT id FROM incidents WHERE id = $1 AND org_id = $2',
    [req.params.id, req.org.id]
  );
  if (check.rows.length === 0) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  const events = await db.query(
    `SELECT id, actor, event_type, message, created_at
     FROM incident_events WHERE incident_id = $1 ORDER BY created_at ASC`,
    [req.params.id]
  );

  return res.json({ events: events.rows });
}

// ─── Add Comment / Event ──────────────────────────────────────────────────────

async function addEvent(req, res) {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid incident ID' });
  }

  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });

  const check = await db.query(
    'SELECT id FROM incidents WHERE id = $1 AND org_id = $2',
    [req.params.id, req.org.id]
  );
  if (check.rows.length === 0) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  const result = await db.query(
    `INSERT INTO incident_events (incident_id, actor, event_type, message)
     VALUES ($1, $2, 'comment', $3)
     RETURNING id, actor, event_type, message, created_at`,
    [req.params.id, req.user?.email || 'api', sanitizeText(message, 2000)]
  );

  return res.status(201).json(result.rows[0]);
}

// ─── Resolve ──────────────────────────────────────────────────────────────────

async function resolveIncident(req, res) {
  if (!isUuid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid incident ID' });
  }

  const result = await db.query(
    `UPDATE incidents SET status = 'resolved', resolved_at = NOW()
     WHERE id = $1 AND org_id = $2 AND status != 'resolved'
     RETURNING id, title, severity, status, resolved_at, duration_secs`,
    [req.params.id, req.org.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Incident not found or already resolved' });
  }

  const incident = result.rows[0];

  await db.query(
    `INSERT INTO incident_events (incident_id, actor, event_type, message)
     VALUES ($1, $2, 'status_change', 'Incident resolved')`,
    [incident.id, req.user?.email || 'api']
  );

  await db.query(
    `INSERT INTO audit_log (org_id, user_id, action, resource_type, resource_id)
     VALUES ($1, $2, 'incident.resolved', 'incident', $3)`,
    [req.org.id, req.user?.id || null, incident.id]
  );

  return res.json(incident);
}

module.exports = { listIncidents, getIncident, createIncident, updateIncident, getEvents, addEvent, resolveIncident };
