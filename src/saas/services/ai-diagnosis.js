'use strict';

/**
 * AI Diagnosis Service
 *
 * Uses the Claude API to diagnose incidents, identify root cause,
 * suggest mitigations, and generate blameless postmortems.
 *
 * Required env:
 *   ANTHROPIC_API_KEY   — Claude API key
 *
 * Optional env:
 *   AI_MODEL            — Claude model ID (default: claude-sonnet-4-6)
 *   AI_MAX_TOKENS       — Max response tokens (default: 2048)
 *
 * All incident data is sanitized before sending to the API.
 * Raw payloads are never forwarded — only structured fields.
 */

const https = require('https');
const { sanitizeText } = require('./incident-classifier');

const ANTHROPIC_API = 'api.anthropic.com';
const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = Math.min(parseInt(process.env.AI_MAX_TOKENS || '2048', 10), 4096);
const API_VERSION = '2023-06-01';

function getApiKey() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  return process.env.ANTHROPIC_API_KEY;
}

// ─── Claude API client ────────────────────────────────────────────────────────

function claudeRequest(messages, systemPrompt) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
    });

    const options = {
      hostname: ANTHROPIC_API,
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': getApiKey(),
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
      timeout: 60000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error?.message || `Claude API HTTP ${res.statusCode}`));
          } else {
            resolve(parsed.content?.[0]?.text || '');
          }
        } catch {
          reject(new Error('Invalid Claude API response'));
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Claude API timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Data sanitizer for AI input ─────────────────────────────────────────────

/**
 * Build a safe, structured incident context string for the AI.
 * Never includes raw_payload or any secrets.
 */
function buildIncidentContext(incident, events = []) {
  const lines = [
    `Title: ${sanitizeText(incident.title, 200)}`,
    `Service: ${sanitizeText(incident.service, 100)}`,
    `Severity: SEV${incident.severity}`,
    `Status: ${sanitizeText(incident.status, 50)}`,
    `Source: ${sanitizeText(incident.source_type || 'manual', 50)}`,
    `Started: ${incident.created_at}`,
  ];

  if (incident.summary) {
    lines.push(`Summary: ${sanitizeText(incident.summary, 500)}`);
  }
  if (incident.root_cause) {
    lines.push(`Known root cause: ${sanitizeText(incident.root_cause, 500)}`);
  }
  if (incident.mitigation) {
    lines.push(`Mitigation applied: ${sanitizeText(incident.mitigation, 500)}`);
  }

  if (events.length > 0) {
    lines.push('\nTimeline:');
    events.slice(-20).forEach(ev => {
      lines.push(`  [${ev.created_at}] ${sanitizeText(ev.actor, 50)}: ${sanitizeText(ev.message, 300)}`);
    });
  }

  return lines.join('\n');
}

// ─── Diagnosis ────────────────────────────────────────────────────────────────

const DIAGNOSIS_SYSTEM = `You are a senior Site Reliability Engineer (SRE) performing incident diagnosis.
Given an incident report, you will:
1. Identify the most likely root cause based on the evidence
2. Suggest 2-3 immediate mitigation actions (ordered by priority)
3. List what additional information would confirm the diagnosis
4. Assess blast radius (what else might be affected)

Format your response as structured JSON matching this schema:
{
  "root_cause": "One clear sentence describing the most likely root cause",
  "confidence": "high|medium|low",
  "evidence": ["observed fact 1", "observed fact 2"],
  "mitigations": [
    { "action": "action description", "priority": 1, "rationale": "why this helps" }
  ],
  "investigate_next": ["what to check next 1", "what to check next 2"],
  "blast_radius": "description of what else might be affected",
  "estimated_resolution_time": "X minutes|X hours"
}

Rules:
- Base diagnosis only on the evidence provided — do not invent facts
- If evidence is insufficient, say so in root_cause and set confidence to low
- Never suggest deleting data or removing security controls as mitigations
- Keep all text concise and actionable`;

async function diagnose(incident, events = []) {
  const context = buildIncidentContext(incident, events);

  const response = await claudeRequest(
    [{ role: 'user', content: `Diagnose this incident:\n\n${context}` }],
    DIAGNOSIS_SYSTEM
  );

  // Parse JSON response — fall back to raw text if parse fails
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) return { type: 'structured', data: JSON.parse(jsonMatch[0]), raw: response };
  } catch { /* ignore parse error */ }

  return { type: 'text', data: null, raw: response };
}

// ─── Postmortem Generation ────────────────────────────────────────────────────

const POSTMORTEM_SYSTEM = `You are writing a blameless postmortem for a production incident.
Generate a complete, professional postmortem report.

Format as JSON:
{
  "title": "Postmortem: <incident title>",
  "summary": "2-3 sentence executive summary",
  "timeline": [
    { "time": "HH:MM UTC", "event": "what happened" }
  ],
  "root_cause": "Technical root cause explanation",
  "contributing_factors": ["factor 1", "factor 2"],
  "what_went_well": ["observation 1", "observation 2"],
  "what_went_poorly": ["observation 1", "observation 2"],
  "action_items": [
    { "action": "specific action", "owner": "team or role", "priority": "P1|P2|P3", "due": "timeframe" }
  ],
  "lessons_learned": "Key takeaway for the team"
}

Rules:
- Blameless: focus on systems and processes, not individuals
- Action items must be specific and measurable
- Timeline must be in chronological order
- Do not speculate beyond the evidence provided`;

async function generatePostmortem(incident, events = []) {
  const context = buildIncidentContext(incident, events);

  const durationMins = incident.duration_secs
    ? Math.round(incident.duration_secs / 60)
    : null;

  const prompt = [
    `Generate a blameless postmortem for this resolved incident:`,
    '',
    context,
    durationMins ? `\nTotal duration: ${durationMins} minutes` : '',
  ].join('\n');

  const response = await claudeRequest(
    [{ role: 'user', content: prompt }],
    POSTMORTEM_SYSTEM
  );

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) return { type: 'structured', data: JSON.parse(jsonMatch[0]), raw: response };
  } catch { /* ignore */ }

  return { type: 'text', data: null, raw: response };
}

// ─── Runbook Generation ───────────────────────────────────────────────────────

const RUNBOOK_SYSTEM = `You are an SRE generating an operational runbook.
Create a clear, step-by-step runbook for a specific failure scenario.

Format as JSON:
{
  "title": "Runbook: <scenario>",
  "scenario": "scenario identifier",
  "description": "When to use this runbook",
  "prerequisites": ["required access 1", "required access 2"],
  "steps": [
    { "step": 1, "title": "step title", "commands": ["command 1"], "expected_output": "what success looks like", "on_failure": "what to do if this fails" }
  ],
  "escalation": "When and how to escalate",
  "rollback": "How to undo these steps if needed"
}`;

async function generateRunbook(scenario, serviceContext = '') {
  const prompt = serviceContext
    ? `Generate a runbook for: ${sanitizeText(scenario, 200)}\nService context: ${sanitizeText(serviceContext, 300)}`
    : `Generate a runbook for: ${sanitizeText(scenario, 200)}`;

  const response = await claudeRequest(
    [{ role: 'user', content: prompt }],
    RUNBOOK_SYSTEM
  );

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) return { type: 'structured', data: JSON.parse(jsonMatch[0]), raw: response };
  } catch { /* ignore */ }

  return { type: 'text', data: null, raw: response };
}

module.exports = { diagnose, generatePostmortem, generateRunbook, buildIncidentContext };
