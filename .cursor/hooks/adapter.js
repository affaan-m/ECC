#!/usr/bin/env node
/**
 * Cursor-to-Claude Code Hook Adapter
 * Transforms Cursor stdin JSON to Claude Code hook format,
 * then delegates to existing scripts/hooks/*.js
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const MAX_STDIN = 1024 * 1024;
const STDIN_TIMEOUT_MS = 5000;

function readStdin(options = {}) {
  const timeoutMs = options.timeoutMs || STDIN_TIMEOUT_MS;

  return new Promise((resolve) => {
    let data = '';
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeAllListeners('data');
      process.stdin.removeAllListeners('end');
      process.stdin.removeAllListeners('error');
      if (process.stdin.unref) process.stdin.unref();
      resolve(value);
    };

    const timer = setTimeout(() => finish(data), timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (data.length < MAX_STDIN) data += chunk.substring(0, MAX_STDIN - data.length);
    });
    process.stdin.on('end', () => finish(data));
    process.stdin.on('error', () => finish(data));
  });
}

function getPluginRoot() {
  return path.resolve(__dirname, '..', '..');
}

function resolveScriptPath(...segments) {
  const normalized = [...segments];
  const last = normalized[normalized.length - 1];
  if (last && !path.extname(String(last))) {
    normalized[normalized.length - 1] = `${last}.js`;
  }

  const candidates = [
    path.join(__dirname, '..', ...normalized),
    path.join(getPluginRoot(), ...normalized),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const resolveModuleCandidates = [
    path.join(__dirname, '..', 'scripts', 'lib', 'resolve-ecc-root.js'),
    path.join(getPluginRoot(), 'scripts', 'lib', 'resolve-ecc-root.js'),
  ];

  for (const resolveModule of resolveModuleCandidates) {
    if (!fs.existsSync(resolveModule)) continue;
    try {
      const { resolveEccRoot } = require(resolveModule);
      const fallback = path.join(resolveEccRoot(), ...normalized);
      if (fs.existsSync(fallback)) {
        return fallback;
      }
    } catch {
      // try next candidate
    }
  }

  return candidates[0];
}

function getCursorFilePath(cursorInput = {}) {
  return String(
    cursorInput.path
    || cursorInput.file
    || cursorInput.args?.filePath
    || ''
  );
}

function transformToClaude(cursorInput, overrides = {}) {
  return {
    tool_input: {
      command: cursorInput.command || cursorInput.args?.command || '',
      file_path: getCursorFilePath(cursorInput),
      ...overrides.tool_input,
    },
    tool_output: {
      output: cursorInput.output || cursorInput.result || '',
      ...overrides.tool_output,
    },
    transcript_path: cursorInput.transcript_path || cursorInput.transcriptPath || cursorInput.session?.transcript_path || '',
    _cursor: {
      conversation_id: cursorInput.conversation_id,
      hook_event_name: cursorInput.hook_event_name,
      workspace_roots: cursorInput.workspace_roots,
      model: cursorInput.model,
    },
  };
}

function runExistingHook(scriptName, stdinData) {
  const scriptPath = resolveScriptPath('scripts', 'hooks', scriptName);
  try {
    execFileSync('node', [scriptPath], {
      input: typeof stdinData === 'string' ? stdinData : JSON.stringify(stdinData),
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      cwd: process.cwd(),
    });
  } catch (e) {
    if (e.status === 2) process.exit(2); // Forward blocking exit code
  }
}

function hookEnabled(hookId, allowedProfiles = ['standard', 'strict']) {
  const rawProfile = String(process.env.ECC_HOOK_PROFILE || 'standard').toLowerCase();
  const profile = ['minimal', 'standard', 'strict'].includes(rawProfile) ? rawProfile : 'standard';

  const disabled = new Set(
    String(process.env.ECC_DISABLED_HOOKS || '')
      .split(',')
      .map(v => v.trim().toLowerCase())
      .filter(Boolean)
  );

  if (disabled.has(String(hookId || '').toLowerCase())) {
    return false;
  }

  return allowedProfiles.includes(profile);
}

module.exports = {
  readStdin,
  getPluginRoot,
  getCursorFilePath,
  resolveScriptPath,
  transformToClaude,
  runExistingHook,
  hookEnabled,
};
