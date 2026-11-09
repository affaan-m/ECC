#!/usr/bin/env node
'use strict';

const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { COPILOT_HOOKS } = require('../lib/copilot-hooks');
const { isHookEnabled } = require('../lib/hook-flags');

const { parseEventEnvelope, normalizeInput, translateHookOutput: translateOutput, aggregateHookOutputs, MAX_STDIN_BYTES } = require('../lib/copilot-event-envelope');

function deny(reason) {
  return { permissionDecision: 'deny', permissionDecisionReason: reason || 'ECC hook failed; tool execution denied.' };
}

function runHook(event, id, raw, options = {}) {
  const hook = COPILOT_HOOKS.find(candidate => candidate.id === id && candidate.event === event);
  const failure = message => ({ exitCode: 1, stdout: JSON.stringify(event === 'preToolUse' ? deny(message) : {}), stderr: message });
  if (!hook) return failure('Unknown Copilot hook event or policy ID.');
  const env = options.env || process.env;
  // Existing ECC controls are honored, but Claude plugin option fallbacks must
  // not accidentally enable/disable this independent Copilot installation.
  const hookEnv = Object.fromEntries(Object.entries(env).filter(([key]) => ![
    'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED', 'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE',
  ].includes(key)));
  if (!isHookEnabled(id, { env: hookEnv, profiles: ['standard', 'strict'] })) {
    return { exitCode: 0, stdout: '{}', stderr: '' };
  }
  try {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_STDIN_BYTES) throw new Error('ECC hook input exceeded 1 MiB.');
    const payload = JSON.parse(raw);
    const input = normalizeInput(event, payload);
    if (!hook.tools.includes(input.tool_name)) return { exitCode: 0, stdout: '{}', stderr: '' };
    validateTarget(input);
    const targets = id === 'post:edit:console-warn' && input.tool_input.edits?.length
      ? [...new Set([input.tool_input.file_path, ...input.tool_input.edits.map(edit => edit.file_path)].filter(Boolean))]
      : [input.tool_input.file_path];
    const deadline = Date.now() + 8000;
    const started = performance.now();
    const results = targets.map(target => spawnSync(process.execPath, [path.join(__dirname, hook.script)], {
      input: JSON.stringify({ ...input, tool_input: { ...input.tool_input, ...(target ? { file_path: target } : {}) } }),
      cwd: input.cwd, env: hookEnv, encoding: 'utf8', timeout: Math.max(1, Math.min(hook.timeoutMs, deadline - Date.now())), maxBuffer: MAX_STDIN_BYTES, shell: false,
    }));
    const durationMs = performance.now() - started;
    let telemetryDiagnostic = '';
    if (hookEnv.ECC_COPILOT_TELEMETRY === '1') {
      try {
        const envelope = parseEventEnvelope(event, payload);
        if (envelope.sessionId) {
          const { recordHookMetric } = require('../lib/copilot-telemetry');
          recordHookMetric({ workspace: envelope.workspace.canonical, sessionId: envelope.sessionId,
            // A local delivery ID measures this actual hook invocation; it is
            // never assigned to the envelope as a native tool call identity.
            eventId: crypto.createHash('sha256').update(`${envelope.callId || crypto.randomUUID()}:${event}:${id}`).digest('hex'), hookId: id,
            status: results.some(result => result.error?.code === 'ETIMEDOUT') ? 'timeout'
              : results.some(result => result.error || result.status !== 0) ? 'failure' : 'success', durationMs }, hookEnv);
        }
      } catch { telemetryDiagnostic = 'ECC telemetry unavailable; hook decision preserved.'; }
    }
    const outputs = results.map(result => translateOutput(event, result));
    const combined = aggregateHookOutputs(event, outputs);
    return {
      exitCode: results.some(result => result.error || result.status !== 0) ? 1 : 0,
      stdout: JSON.stringify(combined),
      stderr: [...results.map(result => result.stderr || (result.error ? 'ECC hook execution failed.' : '')), telemetryDiagnostic].filter(Boolean).join('\n').slice(0, 8192),
    };
  } catch (error) {
    // Do not include tool arguments or commands in adapter diagnostics.
    return failure(error instanceof SyntaxError ? 'Invalid Copilot hook JSON.' : error.message);
  }
}

function validateTarget(input) {
  if (input.tool_name === 'Bash' && typeof input.tool_input.command !== 'string') throw new Error('Missing shell command.');
  if (['Edit', 'Write'].includes(input.tool_name) && !input.tool_input.file_path && !input.tool_input.edits?.length) {
    throw new Error('Missing write target path.');
  }
}

function main() {
  const [, , event, id] = process.argv;
  let raw = '';
  let bytes = 0;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    bytes += Buffer.byteLength(chunk);
    if (bytes <= MAX_STDIN_BYTES) raw += chunk;
  });
  process.stdin.on('end', () => {
    const result = runHook(event, id, bytes > MAX_STDIN_BYTES ? ' '.repeat(MAX_STDIN_BYTES + 1) : raw);
    if (result.stderr) process.stderr.write(`${result.stderr}\n`);
    process.stdout.write(`${result.stdout}\n`);
    process.exitCode = result.exitCode;
  });
  process.stdin.on('error', () => { process.exitCode = 1; });
}

module.exports = { normalizeInput, translateOutput, runHook, MAX_STDIN_BYTES };
if (require.main === module) main();
