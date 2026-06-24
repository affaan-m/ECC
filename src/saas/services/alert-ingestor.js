'use strict';

/**
 * Alert Ingestor Service
 *
 * Normalizes incoming webhook payloads from Datadog, PagerDuty, CloudWatch,
 * Prometheus, Grafana, and custom sources into the incidents table.
 * Deduplicates by source_alert_id to prevent duplicate incidents.
 */

const db = require('../db/client');
const { classifySeverity, sanitizeText } = require('./incident-classifier');
const notifier = require('./notifier');

const MAX_PAYLOAD_BYTES = 64 * 1024; // 64KB cap on stored raw payload

/**
 * Parse normalized alert fields from a raw webhook payload.
 * All values are sanitized before use.
 */
function parsePayload(type, raw) {
  const s = (val, max = 500) => sanitizeText(String(val || ''), max);

  switch (type) {
    case 'datadog':
      return {
        title: s(raw.alert_title || raw.title),
        service: s(raw.tags?.find?.(t => t.startsWith('service:'))?.slice(8) || raw.service || 'unknown', 100),
        summary: s(raw.alert_title || raw.body || ''),
        external_id: s(raw.alert_id || raw.id || '', 100),
        raw_severity: s(raw.alert_type || raw.priority || ''),
      };

    case 'pagerduty':
      return {
        title: s(raw.messages?.[0]?.event?.name || raw.summary || ''),
        service: s(raw.messages?.[0]?.event?.service?.name || raw.service || 'unknown', 100),
        summary: s(raw.messages?.[0]?.event?.name || raw.summary || ''),
        external_id: s(raw.messages?.[0]?.event?.id || raw.incident_key || '', 100),
        raw_severity: s(raw.messages?.[0]?.event?.severity || raw.priority || ''),
      };

    case 'cloudwatch':
      return {
        title: s(raw.AlarmName || raw.alarm_name || ''),
        service: s(raw.Namespace?.split('/')?.pop() || raw.service || 'unknown', 100),
        summary: s(raw.AlarmDescription || raw.NewStateReason || ''),
        external_id: s(raw.AlarmArn || raw.alarm_id || '', 100),
        raw_severity: s(raw.NewStateValue === 'ALARM' ? 'critical' : 'warning'),
      };

    case 'prometheus':
      return {
        title: s(raw.groupLabels?.alertname || raw.alerts?.[0]?.labels?.alertname || ''),
        service: s(raw.groupLabels?.job || raw.alerts?.[0]?.labels?.job || 'unknown', 100),
        summary: s(raw.alerts?.[0]?.annotations?.summary || raw.alerts?.[0]?.annotations?.description || ''),
        external_id: s(raw.groupKey || '', 100),
        raw_severity: s(raw.alerts?.[0]?.labels?.severity || ''),
      };

    case 'grafana':
      return {
        title: s(raw.title || raw.ruleName || ''),
        service: s(raw.tags?.service || 'unknown', 100),
        summary: s(raw.message || raw.title || ''),
        external_id: s(raw.ruleId || raw.uid || '', 100),
        raw_severity: s(raw.state === 'alerting' ? 'critical' : 'warning'),
      };

    default: // custom
      return {
        title: s(raw.title || raw.summary || 'Alert'),
        service: s(raw.service || 'unknown', 100),
        summary: s(raw.summary || raw.description || raw.message || ''),
        external_id: s(raw.id || raw.alert_id || '', 100),
        raw_severity: s(raw.severity || raw.priority || ''),
      };
  }
}

/**
 * Ingest a raw webhook payload for an org.
 * Returns { incident, created: boolean }.
 */
async function ingest(orgId, sourceId, sourceType, rawPayload) {
  const parsed = parsePayload(sourceType, rawPayload);
  const severity = classifySeverity(`${parsed.title} ${parsed.summary} ${parsed.raw_severity}`);

  // Truncate raw payload for storage
  const safePayload = JSON.parse(
    JSON.stringify(rawPayload).slice(0, MAX_PAYLOAD_BYTES)
  );

  return db.transaction(async (client) => {
    // Upsert — deduplicate on (org_id, source_type, source_alert_id)
    const existing = parsed.external_id
      ? await client.query(
          `SELECT id FROM incidents
           WHERE org_id = $1 AND source_type = $2 AND source_alert_id = $3`,
          [orgId, sourceType, parsed.external_id]
        )
      : { rows: [] };

    if (existing.rows.length > 0) {
      const inc = await client.query('SELECT * FROM incidents WHERE id = $1', [existing.rows[0].id]);
      return { incident: inc.rows[0], created: false };
    }

    const result = await client.query(
      `INSERT INTO incidents
         (org_id, source_id, title, service, severity, status, source_type, source_alert_id, raw_payload, summary)
       VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9)
       RETURNING *`,
      [
        orgId,
        sourceId || null,
        parsed.title || `${sourceType} alert`,
        parsed.service,
        severity,
        sourceType,
        parsed.external_id || null,
        safePayload,
        parsed.summary,
      ]
    );

    const incident = result.rows[0];

    // Log the alert received event
    await client.query(
      `INSERT INTO incident_events (incident_id, actor, event_type, message, metadata)
       VALUES ($1, 'ai', 'alert_received', $2, $3)`,
      [
        incident.id,
        `Alert received from ${sourceType}: ${parsed.summary.slice(0, 200)}`,
        JSON.stringify({ source_type: sourceType, severity, external_id: parsed.external_id }),
      ]
    );

    // Audit log
    await client.query(
      `INSERT INTO audit_log (org_id, action, resource_type, resource_id, metadata)
       VALUES ($1, 'incident.created', 'incident', $2, $3)`,
      [orgId, incident.id, JSON.stringify({ source_type: sourceType, severity })]
    );

    return { incident, created: true };
  }).then(async ({ incident, created }) => {
    if (created) {
      // Fire notifications async — don't block the webhook response
      notifier.notifyIncident(incident).catch((err) => {
        process.stderr.write(`[Ingestor] Notification failed: ${err.message}\n`);
      });
    }
    return { incident, created };
  });
}

module.exports = { ingest };
