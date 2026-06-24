#!/usr/bin/env node
/**
 * Incident Alert Ingestion Hook (PostToolUse / Stop)
 *
 * Parses incoming alert payloads from Datadog, PagerDuty, CloudWatch,
 * Prometheus, or custom webhooks. Classifies severity, formats a triage
 * summary, and optionally sends a Slack notification to the on-call channel.
 *
 * Environment Variables:
 *   SLACK_WEBHOOK_URL    — Post incident alert to Slack channel
 *   ONCALL_EMAIL         — Escalation email for SEV1 (logged only)
 *   INCIDENT_LOG_FILE    — Append incident log (default: /tmp/incidents.log)
 *
 * Hook ID : stop:incident-alert-ingest
 * Profiles: standard, strict
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const { log } = require('../lib/utils');

const INCIDENT_LOG = process.env.INCIDENT_LOG_FILE || '/tmp/incidents.log';
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL || '';
const ONCALL_EMAIL = process.env.ONCALL_EMAIL || '';

const SEV_RULES = [
  { level: 1, label: 'SEV1 - CRITICAL', keywords: ['down', 'outage', 'data loss', 'corruption', 'payment', 'unavailable', 'p1', 'critical'] },
  { level: 2, label: 'SEV2 - HIGH',     keywords: ['degraded', 'latency', 'error rate', 'auth fail', 'p2', 'high', 'timeout'] },
  { level: 3, label: 'SEV3 - MEDIUM',   keywords: ['warning', 'elevated', 'minor', 'p3', 'medium'] },
  { level: 4, label: 'SEV4 - LOW',      keywords: ['info', 'low', 'cosmetic', 'logging', 'p4'] },
];

const SOURCE_ICONS = {
  datadog: '[DD]',
  pagerduty: '[PD]',
  cloudwatch: '[CW]',
  prometheus: '[PM]',
  grafana: '[GF]',
  manual: '[MN]',
  unknown: '[??]',
};

/**
 * Classify alert severity based on keyword matching.
 * Returns the first matching SEV rule, defaulting to SEV3.
 */
function classifySeverity(text) {
  const lower = (text || '').toLowerCase();
  for (const rule of SEV_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule;
    }
  }
  return SEV_RULES[2]; // default SEV3
}

/**
 * Parse alert payload from various sources into a normalized object.
 * Treats all input values as untrusted — only extracts known safe fields.
 */
function parseAlert(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const safe = (val, maxLen = 500) => {
    if (typeof val !== 'string') return '';
    // Strip control characters and limit length
    // eslint-disable-next-line no-control-regex
    return val.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, maxLen).trim();
  };

  // Normalize across Datadog, PagerDuty, CloudWatch, Prometheus, custom
  return {
    source: safe(payload.source || payload.alert_source || 'unknown', 50).toLowerCase(),
    service: safe(payload.service || payload.alert_service || payload.tags?.find?.(t => t.startsWith('service:'))?.slice(8) || 'unknown', 100),
    summary: safe(payload.summary || payload.alert_title || payload.message || payload.description || '', 400),
    severity: safe(payload.severity || payload.alert_type || payload.priority || '', 50),
    timestamp: safe(payload.timestamp || payload.fired_at || new Date().toISOString(), 50),
    alert_key: safe(payload.alert_key || payload.incident_key || payload.id || '', 100),
    region: safe(payload.region || payload.tags?.find?.(t => t.startsWith('region:'))?.slice(7) || '', 50),
  };
}

/**
 * Format a triage summary for logging and Slack.
 */
function formatTriageSummary(alert, sev) {
  const icon = SOURCE_ICONS[alert.source] || SOURCE_ICONS.unknown;
  const lines = [
    `${icon} INCIDENT ALERT — ${sev.label}`,
    `Service  : ${alert.service}`,
    `Summary  : ${alert.summary}`,
    `Source   : ${alert.source}`,
    `Time     : ${alert.timestamp}`,
  ];
  if (alert.region) lines.push(`Region   : ${alert.region}`);
  if (alert.alert_key) lines.push(`Alert ID : ${alert.alert_key}`);
  lines.push('');
  lines.push('Next: Run `/incident diagnose ' + alert.service + '` to investigate root cause.');
  if (sev.level === 1) {
    lines.push('');
    lines.push('ACTION REQUIRED: SEV1 — Page on-call lead immediately.');
    if (ONCALL_EMAIL) lines.push(`Escalate to: ${ONCALL_EMAIL}`);
  }
  return lines.join('\n');
}

/**
 * Append incident to the log file for audit trail.
 */
function logIncident(summary) {
  try {
    fs.appendFileSync(INCIDENT_LOG, `[${new Date().toISOString()}]\n${summary}\n${'─'.repeat(60)}\n`);
  } catch (err) {
    log(`[IncidentIngest] Could not write to log file: ${err.message}`);
  }
}

/**
 * Post a notification to Slack via incoming webhook.
 * Uses execFileSync with curl to avoid importing an HTTP library.
 */
function notifySlack(summary, sev) {
  if (!SLACK_WEBHOOK) return;

  const color = sev.level === 1 ? '#FF0000' : sev.level === 2 ? '#FF8C00' : '#FFD700';
  const payload = JSON.stringify({
    attachments: [{
      color,
      title: `Incident Alert — ${sev.label}`,
      text: summary,
      footer: 'ECC Incident Response',
      ts: Math.floor(Date.now() / 1000),
    }],
  });

  try {
    execFileSync('curl', [
      '-s', '-o', '/dev/null',
      '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '--data', payload,
      '--max-time', '5',
      SLACK_WEBHOOK,
    ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000 });
  } catch (err) {
    log(`[IncidentIngest] Slack notification failed: ${err.message}`);
  }
}

/**
 * Main entry point for run-with-flags.js.
 */
function run(raw) {
  try {
    const input = raw.trim() ? JSON.parse(raw) : {};

    // Check if the last assistant message contains an incident alert payload
    const lastMsg = input.last_assistant_message || '';
    let alertData = null;

    // Allow alert to be embedded as JSON in the message or passed as tool_input
    if (input.tool_input && typeof input.tool_input === 'object') {
      alertData = parseAlert(input.tool_input);
    }

    // If no structured alert found, check for a custom_alert field at top level
    if (!alertData && input.alert) {
      alertData = parseAlert(input.alert);
    }

    if (!alertData) {
      // No alert payload to process — pass through silently
      return raw;
    }

    const sev = classifySeverity(`${alertData.summary} ${alertData.severity} ${alertData.service}`);
    const summary = formatTriageSummary(alertData, sev);

    log(`[IncidentIngest] ${sev.label} — ${alertData.service}: ${alertData.summary.slice(0, 80)}`);

    logIncident(summary);
    notifySlack(summary, sev);

    if (sev.level === 1) {
      // Print SEV1 prominently to stderr so it surfaces immediately
      process.stderr.write(`\n${'!'.repeat(60)}\n${summary}\n${'!'.repeat(60)}\n\n`);
    }
  } catch (err) {
    log(`[IncidentIngest] Error: ${err.message}`);
  }

  return raw;
}

module.exports = { run };

if (require.main === module) {
  const MAX_STDIN = 512 * 1024;
  let data = '';
  let truncated = false;

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (data.length < MAX_STDIN) {
      const remaining = MAX_STDIN - data.length;
      data += chunk.substring(0, remaining);
      if (chunk.length > remaining) truncated = true;
    } else {
      truncated = true;
    }
  });
  process.stdin.on('end', () => {
    const output = run(data);
    if (truncated) {
      log('[IncidentIngest] stdin exceeded limit; suppressing pass-through');
      return;
    }
    if (output) process.stdout.write(output);
  });
}
