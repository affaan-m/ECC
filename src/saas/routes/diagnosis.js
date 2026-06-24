'use strict';

/**
 * AI Diagnosis Routes (Team+ plan required)
 *
 * POST /incidents/:id/diagnose    — AI root cause diagnosis
 * POST /incidents/:id/postmortem  — AI postmortem generation
 * POST /runbooks/generate         — AI runbook generation
 */

const db = require('../db/client');
const ai = require('../services/ai-diagnosis');
const { sanitizeText } = require('../services/incident-classifier');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s) => UUID_RE.test(s);

// ─── AI Diagnose ──────────────────────────────────────────────────────────────

async function diagnoseIncident(req, res) {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid incident ID' });

  const [incResult, eventsResult] = await Promise.all([
    db.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, req.org.id]),
    db.query(
      'SELECT actor, event_type, message, created_at FROM incident_events WHERE incident_id = $1 ORDER BY created_at ASC',
      [id]
    ),
  ]);

  if (incResult.rows.length === 0) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  const incident = incResult.rows[0];
  // Strip raw_payload — never send to AI
  delete incident.raw_payload;

  let diagnosis;
  try {
    diagnosis = await ai.diagnose(incident, eventsResult.rows);
  } catch (err) {
    process.stderr.write(`[Diagnosis] AI error: ${err.message}\n`);
    return res.status(503).json({ error: 'AI diagnosis temporarily unavailable', detail: err.message });
  }

  // Persist diagnosis results back to the incident
  if (diagnosis.type === 'structured' && diagnosis.data?.root_cause) {
    const rootCause = sanitizeText(diagnosis.data.root_cause, 1000);
    const mitigation = diagnosis.data.mitigations?.[0]?.action
      ? sanitizeText(`Recommended: ${diagnosis.data.mitigations[0].action}`, 1000)
      : null;

    await db.query(
      `UPDATE incidents SET root_cause = COALESCE(root_cause, $1)
       WHERE id = $2 AND root_cause IS NULL`,
      [rootCause, id]
    );

    await db.query(
      `INSERT INTO incident_events (incident_id, actor, event_type, message, metadata)
       VALUES ($1, 'ai', 'diagnosis', $2, $3)`,
      [
        id,
        `AI diagnosis: ${rootCause.slice(0, 200)}`,
        JSON.stringify({ confidence: diagnosis.data.confidence, model: process.env.AI_MODEL || 'claude-sonnet-4-6' }),
      ]
    );
  }

  await db.query(
    `INSERT INTO audit_log (org_id, user_id, action, resource_type, resource_id)
     VALUES ($1, $2, 'incident.ai_diagnosis', 'incident', $3)`,
    [req.org.id, req.user?.id || null, id]
  );

  return res.json({
    incident_id: id,
    diagnosis: diagnosis.data || { raw: diagnosis.raw },
  });
}

// ─── AI Postmortem ────────────────────────────────────────────────────────────

async function generatePostmortem(req, res) {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Invalid incident ID' });

  const [incResult, eventsResult] = await Promise.all([
    db.query('SELECT * FROM incidents WHERE id = $1 AND org_id = $2', [id, req.org.id]),
    db.query(
      'SELECT actor, event_type, message, created_at FROM incident_events WHERE incident_id = $1 ORDER BY created_at ASC',
      [id]
    ),
  ]);

  if (incResult.rows.length === 0) return res.status(404).json({ error: 'Incident not found' });

  const incident = { ...incResult.rows[0] };
  delete incident.raw_payload;

  let result;
  try {
    result = await ai.generatePostmortem(incident, eventsResult.rows);
  } catch (err) {
    process.stderr.write(`[Diagnosis] Postmortem AI error: ${err.message}\n`);
    return res.status(503).json({ error: 'AI postmortem generation temporarily unavailable' });
  }

  // Persist the postmortem
  if (result.type === 'structured' && result.data) {
    const d = result.data;
    const upsert = await db.query(
      `INSERT INTO postmortems
         (incident_id, org_id, title, summary, timeline, root_cause, contributing_factors,
          what_went_well, action_items, lessons_learned, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft')
       ON CONFLICT (incident_id) DO UPDATE SET
         title = EXCLUDED.title, summary = EXCLUDED.summary,
         timeline = EXCLUDED.timeline, root_cause = EXCLUDED.root_cause,
         contributing_factors = EXCLUDED.contributing_factors,
         what_went_well = EXCLUDED.what_went_well,
         action_items = EXCLUDED.action_items,
         lessons_learned = EXCLUDED.lessons_learned,
         updated_at = NOW()
       RETURNING id`,
      [
        id, req.org.id,
        sanitizeText(d.title || `Postmortem: ${incident.title}`, 200),
        sanitizeText(d.summary || '', 1000),
        JSON.stringify(Array.isArray(d.timeline) ? d.timeline : []),
        sanitizeText(d.root_cause || '', 2000),
        Array.isArray(d.contributing_factors) ? d.contributing_factors.map(f => sanitizeText(f, 200)) : [],
        Array.isArray(d.what_went_well) ? d.what_went_well.map(f => sanitizeText(f, 200)) : [],
        JSON.stringify(Array.isArray(d.action_items) ? d.action_items : []),
        sanitizeText(d.lessons_learned || '', 1000),
      ]
    );

    await db.query(
      `INSERT INTO incident_events (incident_id, actor, event_type, message)
       VALUES ($1, 'ai', 'postmortem', 'AI postmortem generated (draft)')`,
      [id]
    );

    return res.status(201).json({
      postmortem_id: upsert.rows[0].id,
      postmortem: result.data,
    });
  }

  return res.json({ postmortem: { raw: result.raw } });
}

// ─── AI Runbook Generation ────────────────────────────────────────────────────

async function generateRunbook(req, res) {
  const { scenario, service } = req.body || {};
  if (!scenario) return res.status(400).json({ error: 'scenario is required' });

  let result;
  try {
    result = await ai.generateRunbook(
      sanitizeText(scenario, 200),
      sanitizeText(service || '', 200)
    );
  } catch (err) {
    process.stderr.write(`[Diagnosis] Runbook AI error: ${err.message}\n`);
    return res.status(503).json({ error: 'AI runbook generation temporarily unavailable' });
  }

  // Persist to runbooks table
  if (result.type === 'structured' && result.data) {
    const d = result.data;
    await db.query(
      `INSERT INTO runbooks (org_id, title, scenario, content, tags)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        req.org.id,
        sanitizeText(d.title || scenario, 200),
        sanitizeText(d.scenario || scenario, 100),
        result.raw,
        Array.isArray(d.tags) ? d.tags.map(t => sanitizeText(t, 50)) : [],
      ]
    );
  }

  return res.json({ runbook: result.data || { raw: result.raw } });
}

module.exports = { diagnoseIncident, generatePostmortem, generateRunbook };
