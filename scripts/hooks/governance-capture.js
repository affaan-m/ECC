#!/usr/bin/env node
/**
 * Governance Event Capture Hook
 *
 * PreToolUse/PostToolUse hook that detects governance-relevant events
 * and writes them to the governance_events table in the state store.
 *
 * Captured event types:
 *   - secret_detected: Hardcoded secrets in tool input/output
 *   - policy_violation: Actions that violate configured policies
 *   - security_finding: Security-relevant tool invocations
 *   - approval_requested: Operations requiring explicit approval
 *   - hook_input_truncated: Hook input exceeded the safe inspection limit
 *
 * Enable: Set ECC_GOVERNANCE_CAPTURE=1
 * Configure session: Set ECC_SESSION_ID for session correlation
 */

'use strict';

const crypto = require('crypto');

const MAX_STDIN = 1024 * 1024;

// Patterns that indicate potential hardcoded secrets
const SECRET_PATTERNS = [
  { name: 'aws_key', pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/i },
  { name: 'generic_secret', pattern: /(?:secret|password|token|api[_-]?key)\s*[:=]\s*["'][^"']{8,}/i },
  { name: 'private_key', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'github_token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
];

// Tool names that represent security-relevant operations
const SECURITY_RELEVANT_TOOLS = new Set([
  'Bash', // Could execute arbitrary commands
  'PowerShell', // Same, once CLAUDE_CODE_USE_POWERSHELL_TOOL=1 makes it a live shell
]);

// Commands that require governance approval.
// The git/SQL/dd entries are shell-agnostic and match under either shell; the
// PowerShell entries cover delete verbs that share no syntax with POSIX `rm`.
const APPROVAL_COMMANDS = [
  /git\s+push\s+.*--force/,
  /git\s+reset\s+--hard/,
  /rm\s+-rf?\s/,
  /DROP\s+(?:TABLE|DATABASE)/i,
  /DELETE\s+FROM\s+\w+\s*(?:;|$)/i,
  // PowerShell Remove-Item and its aliases with -Recurse. PowerShell accepts any
  // unambiguous parameter prefix, so -Recurse, -Rec and -r must all match.
  /(?:^|[\s;|(])(?:Remove-Item|Remove-ItemProperty|ri|rmdir|rd|del|erase)\b[^;|]*\s-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?\b/i,
  /(?:^|[\s;|(])Clear-(?:Content|Disk)\b/i,
  /(?:^|[\s;|(])Format-Volume\b/i,
];

// File patterns that indicate policy-sensitive paths
const SENSITIVE_PATHS = [
  /\.env(?:\.|$)/,
  /credentials/i,
  /secrets?\./i,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
];

/**
 * Generate a unique event ID.
 */
function generateEventId() {
  return `gov-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Scan text content for hardcoded secrets.
 * Returns array of { name, match } for each detected secret.
 */
function detectSecrets(text) {
  if (!text || typeof text !== 'string') return [];

  const findings = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      findings.push({ name });
    }
  }
  return findings;
}

/**
 * Check if a command requires governance approval.
 */
function detectApprovalRequired(command) {
  if (!command || typeof command !== 'string') return [];

  const findings = [];
  for (const pattern of APPROVAL_COMMANDS) {
    if (pattern.test(command)) {
      findings.push({ pattern: pattern.source });
    }
  }
  return findings;
}

/**
 * Check if a file path is policy-sensitive.
 */
function detectSensitivePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;

  return SENSITIVE_PATHS.some(pattern => pattern.test(filePath));
}

function fingerprintCommand(command) {
  if (!command || typeof command !== 'string') return null;
  return crypto.createHash('sha256').update(command).digest('hex').slice(0, 12);
}

function summarizeCommand(command) {
  if (!command || typeof command !== 'string') {
    return {
      commandName: null,
      commandFingerprint: null,
    };
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return {
      commandName: null,
      commandFingerprint: null,
    };
  }

  return {
    commandName: trimmed.split(/\s+/)[0] || null,
    commandFingerprint: fingerprintCommand(trimmed),
  };
}

function emitGovernanceEvent(event) {
  process.stderr.write(`[governance] ${JSON.stringify(event)}\n`);
}

/**
 * Analyze a hook input payload and return governance events to capture.
 *
 * @param {Object} input - Parsed hook input (tool_name, tool_input, tool_output)
 * @param {Object} [context] - Additional context (sessionId, hookPhase)
 * @returns {Array<Object>} Array of governance event objects
 */
function analyzeForGovernanceEvents(input, context = {}) {
  const events = [];
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const toolOutput = typeof input.tool_output === 'string' ? input.tool_output : '';
  const sessionId = context.sessionId || null;
  const hookPhase = context.hookPhase || 'unknown';

  // 1. Secret detection in tool input content
  const inputText = typeof toolInput === 'object'
    ? JSON.stringify(toolInput)
    : String(toolInput);

  const inputSecrets = detectSecrets(inputText);
  const outputSecrets = detectSecrets(toolOutput);
  const allSecrets = [...inputSecrets, ...outputSecrets];

  if (allSecrets.length > 0) {
    events.push({
      id: generateEventId(),
      sessionId,
      eventType: 'secret_detected',
      payload: {
        toolName,
        hookPhase,
        secretTypes: allSecrets.map(s => s.name),
        location: inputSecrets.length > 0 ? 'input' : 'output',
        severity: 'critical',
      },
      resolvedAt: null,
      resolution: null,
    });
  }

  // 2. Approval-required commands (any shell tool)
  if (SECURITY_RELEVANT_TOOLS.has(toolName)) {
    const command = toolInput.command || '';
    const approvalFindings = detectApprovalRequired(command);
    const commandSummary = summarizeCommand(command);

    if (approvalFindings.length > 0) {
      events.push({
        id: generateEventId(),
        sessionId,
        eventType: 'approval_requested',
        payload: {
          toolName,
          hookPhase,
          ...commandSummary,
          matchedPatterns: approvalFindings.map(f => f.pattern),
          severity: 'high',
        },
        resolvedAt: null,
        resolution: null,
      });
    }
  }

  // 3. Policy violation: writing to sensitive paths
  const filePath = toolInput.file_path || toolInput.path || '';
  if (filePath && detectSensitivePath(filePath)) {
    events.push({
      id: generateEventId(),
      sessionId,
      eventType: 'policy_violation',
      payload: {
        toolName,
        hookPhase,
        filePath: filePath.slice(0, 200),
        reason: 'sensitive_file_access',
        severity: 'warning',
      },
      resolvedAt: null,
      resolution: null,
    });
  }

  // 4. Security-relevant tool usage tracking
  if (SECURITY_RELEVANT_TOOLS.has(toolName) && hookPhase === 'post') {
    const command = toolInput.command || '';
    const hasElevated =
      /sudo\s/.test(command) ||
      /chmod\s/.test(command) ||
      /chown\s/.test(command) ||
      // PowerShell equivalents: UAC elevation and ACL/ownership changes.
      /-Verb\s+RunAs/i.test(command) ||
      /\b(?:Set-Acl|icacls|takeown)\b/i.test(command);
    const commandSummary = summarizeCommand(command);

    if (hasElevated) {
      events.push({
        id: generateEventId(),
        sessionId,
        eventType: 'security_finding',
        payload: {
          toolName,
          hookPhase,
          ...commandSummary,
          reason: 'elevated_privilege_command',
          severity: 'medium',
        },
        resolvedAt: null,
        resolution: null,
      });
    }
  }

  return events;
}

/**
 * Core hook logic — exported so run-with-flags.js can call directly.
 *
 * @param {string} rawInput - Raw JSON string from stdin
 * @returns {string} The original input (pass-through)
 */
function run(rawInput, options = {}) {
  // Gate on feature flag
  if (String(process.env.ECC_GOVERNANCE_CAPTURE || '').toLowerCase() !== '1') {
    return rawInput;
  }

  const sessionId = process.env.ECC_SESSION_ID || null;
  const hookPhase = process.env.CLAUDE_HOOK_EVENT_NAME || 'unknown';

  if (options.truncated) {
    emitGovernanceEvent({
      id: generateEventId(),
      sessionId,
      eventType: 'hook_input_truncated',
      payload: {
        hookPhase: hookPhase.startsWith('Pre') ? 'pre' : 'post',
        sizeLimitBytes: options.maxStdin || MAX_STDIN,
        severity: 'warning',
      },
      resolvedAt: null,
      resolution: null,
    });
  }

  try {
    const input = JSON.parse(rawInput);

    const events = analyzeForGovernanceEvents(input, {
      sessionId,
      hookPhase: hookPhase.startsWith('Pre') ? 'pre' : 'post',
    });

    if (events.length > 0) {
      for (const event of events) {
        emitGovernanceEvent(event);
      }
    }
  } catch {
    // Silently ignore parse errors — never block the tool pipeline.
  }

  return rawInput;
}

// ── stdin entry point ────────────────────────────────
if (require.main === module) {
  let raw = '';
  let truncated = /^(1|true|yes)$/i.test(String(process.env.ECC_HOOK_INPUT_TRUNCATED || ''));
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) {
      const remaining = MAX_STDIN - raw.length;
      raw += chunk.substring(0, remaining);
      if (chunk.length > remaining) {
        truncated = true;
      }
    } else {
      truncated = true;
    }
  });

  process.stdin.on('end', () => {
    const result = run(raw, {
      truncated,
      maxStdin: Number(process.env.ECC_HOOK_INPUT_MAX_BYTES) || MAX_STDIN,
    });
    process.stdout.write(result);
  });
}

module.exports = {
  APPROVAL_COMMANDS,
  SECRET_PATTERNS,
  SECURITY_RELEVANT_TOOLS,
  SENSITIVE_PATHS,
  analyzeForGovernanceEvents,
  detectApprovalRequired,
  detectSecrets,
  detectSensitivePath,
  generateEventId,
  run,
};
