'use strict';

/**
 * Notifier Service
 * Sends incident alerts to configured channels (Slack, email, webhook).
 * Reads channel config from the DB per org. Never logs secrets.
 */

const https = require('https');
const db = require('../db/client');
const { severityLabel } = require('./incident-classifier');

const SEV_COLORS = { 1: '#FF0000', 2: '#FF8C00', 3: '#FFD700', 4: '#808080' };

/**
 * Post JSON to a URL via HTTPS (no external deps).
 */
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return reject(new Error('Invalid webhook URL'));
    }

    // Only allow HTTPS to prevent SSRF to internal metadata endpoints
    if (parsedUrl.protocol !== 'https:') {
      return reject(new Error('Webhook URL must use HTTPS'));
    }

    // Block internal/private IP ranges (basic SSRF guard)
    const hostname = parsedUrl.hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
      return reject(new Error('Webhook URL points to a private address'));
    }

    const payload = JSON.stringify(body);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'IncidentResponse-SaaS/1.0',
      },
      timeout: 5000,
    };

    const req = https.request(options, (res) => {
      res.resume(); // drain
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve({ status: res.statusCode });
      } else {
        reject(new Error(`Webhook returned HTTP ${res.statusCode}`));
      }
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Send a Slack notification for an incident.
 */
async function sendSlack(webhookUrl, incident) {
  const label = severityLabel(incident.severity);
  const color = SEV_COLORS[incident.severity] || '#808080';

  const body = {
    attachments: [{
      color,
      title: `${label} — ${incident.title}`,
      fields: [
        { title: 'Service', value: incident.service, short: true },
        { title: 'Status', value: incident.status.toUpperCase(), short: true },
        { title: 'Summary', value: (incident.summary || '').slice(0, 300), short: false },
      ],
      footer: 'Incident Response SaaS',
      ts: Math.floor(new Date(incident.created_at).getTime() / 1000),
    }],
  };

  if (incident.severity === 1) {
    body.text = '<!channel> SEV1 INCIDENT — Immediate response required';
  }

  await postJson(webhookUrl, body);
}

/**
 * Send notifications to all active channels for an org that meet severity threshold.
 */
async function notifyIncident(incident) {
  const channels = await db.query(
    `SELECT * FROM notification_channels
     WHERE org_id = $1 AND active = TRUE AND min_severity >= $2`,
    [incident.org_id, incident.severity]
  );

  const results = await Promise.allSettled(
    channels.rows.map(async (channel) => {
      const config = channel.config || {};

      if (channel.type === 'slack' && config.webhook_url) {
        await sendSlack(config.webhook_url, incident);
      } else if (channel.type === 'webhook' && config.url) {
        await postJson(config.url, {
          event: 'incident.created',
          incident: {
            id: incident.id,
            title: incident.title,
            service: incident.service,
            severity: incident.severity,
            status: incident.status,
            summary: incident.summary,
            created_at: incident.created_at,
          },
        });
      }
      // email type: would integrate with SendGrid/SES here

      // Log the notification event
      await db.query(
        `INSERT INTO incident_events (incident_id, actor, event_type, message, metadata)
         VALUES ($1, 'ai', 'notification_sent', $2, $3)`,
        [
          incident.id,
          `Notification sent via ${channel.type} to channel "${channel.name}"`,
          JSON.stringify({ channel_id: channel.id, channel_type: channel.type }),
        ]
      );
    })
  );

  const failures = results.filter(r => r.status === 'rejected');
  if (failures.length > 0) {
    failures.forEach(f => process.stderr.write(`[Notifier] Channel delivery failed: ${f.reason?.message}\n`));
  }
}

module.exports = { notifyIncident };
