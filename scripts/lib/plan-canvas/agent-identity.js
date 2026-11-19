'use strict';

/**
 * Which coding agent is driving a canvas session.
 *
 * The browser shows "Claude Code · listening" instead of an anonymous pill so
 * the human can tell which terminal to look at. Detection is best effort and
 * environment-based: every harness exports at least one distinctive variable
 * into the shells it spawns. `ECC_CANVAS_AGENT` overrides the guess outright.
 */

const path = require('path');

const HARNESS_MARKERS = [
  ['Claude Code', ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']],
  ['Codex', ['CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_THREAD_ID', 'CODEX_CI']],
  ['Cursor', ['CURSOR_AGENT', 'CURSOR_TRACE_ID', 'CURSOR_SESSION_ID']],
  ['Gemini CLI', ['GEMINI_CLI', 'GEMINI_CLI_SESSION']],
  ['OpenCode', ['OPENCODE', 'OPENCODE_SESSION_ID', 'OPENCODE_SERVER_URL']],
  ['Copilot', ['COPILOT_AGENT', 'GITHUB_COPILOT_CLI', 'COPILOT_CLI_SESSION']],
  ['Kimi', ['KIMI_CLI', 'KIMI_SESSION_ID']],
  ['Qwen Code', ['QWEN_CODE', 'QWEN_CLI']]
];

function detectAgentName(env = process.env) {
  const override = env.ECC_CANVAS_AGENT;
  if (typeof override === 'string' && override.trim()) return override.trim().slice(0, 60);
  for (const [name, markers] of HARNESS_MARKERS) {
    if (markers.some(marker => typeof env[marker] === 'string' && env[marker] !== '')) return name;
  }
  return 'agent';
}

// Compact descriptor the CLI attaches to `await` so the server can show who
// is listening. The cwd is reduced to its basename: enough to tell projects
// apart without leaking a full path into the browser.
function agentDescriptor({ env = process.env, cwd = process.cwd() } = {}) {
  return {
    name: detectAgentName(env),
    project: path.basename(cwd) || cwd
  };
}

function sanitizeAgentDescriptor(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : '';
  if (!name) return null;
  const descriptor = { name };
  if (typeof raw.project === 'string' && raw.project.trim()) descriptor.project = raw.project.trim().slice(0, 120);
  return descriptor;
}

// The ?agent= query value: a JSON descriptor, or a bare harness name.
function agentFromParam(raw) {
  if (!raw) return null;
  try {
    return sanitizeAgentDescriptor(JSON.parse(raw));
  } catch {
    return sanitizeAgentDescriptor({ name: raw });
  }
}

module.exports = { HARNESS_MARKERS, agentDescriptor, agentFromParam, detectAgentName, sanitizeAgentDescriptor };
