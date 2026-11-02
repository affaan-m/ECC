#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { COPILOT_HOOKS } = require('../lib/copilot-hooks');
const { isHookEnabled } = require('../lib/hook-flags');

const MAX_STDIN_BYTES = 1024 * 1024;
const EVENTS = Object.freeze({
  preToolUse: 'PreToolUse', postToolUse: 'PostToolUse',
  sessionStart: 'SessionStart', sessionEnd: 'SessionEnd',
  agentStop: 'Stop', preCompact: 'PreCompact', userPromptSubmitted: 'UserPromptSubmit',
});
const TOOL_NAMES = Object.freeze({
  bash: 'Bash', powershell: 'PowerShell', create: 'Write', create_file: 'Write',
  edit: 'Edit', str_replace_editor: 'Edit', apply_patch: 'Edit',
  view: 'Read', grep: 'Grep', rg: 'Grep', glob: 'Glob',
});

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function patchPaths(args) {
  if (Object.hasOwn(args, 'patch') && Object.hasOwn(args, 'input') && args.patch !== args.input) {
    throw new Error('Conflicting patch fields');
  }
  const patch = args.patch ?? args.input;
  if (typeof patch !== 'string' || !patch.startsWith('*** Begin Patch')
    || !patch.trimEnd().endsWith('*** End Patch')) throw new Error('Unsupported apply_patch payload');
  const paths = [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)\r?$/gm)]
    .map(match => match[1].trim());
  if (!paths.length) throw new Error('Patch has no recognized target paths');
  return paths;
}

function resolveToolPath(args, cwd, fallback) {
  const aliases = ['path', 'file_path', 'file'].filter(key => Object.hasOwn(args, key));
  for (const key of aliases) {
    if (typeof args[key] !== 'string' || !args[key].trim() || args[key].includes('\0')) throw new Error('Invalid tool path');
  }
  if (new Set(aliases.map(key => path.resolve(cwd, args[key]))).size > 1) throw new Error('Conflicting tool paths');
  const value = aliases.length ? args[aliases[0]] : fallback;
  return value === undefined ? undefined : path.resolve(cwd, value);
}

function normalizeToolInput(toolName, args, cwd) {
  const target = resolveToolPath(args, cwd);
  const resolvePath = value => {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error('Invalid edit path');
    return path.resolve(cwd, value);
  };
  if (args.edits !== undefined && !Array.isArray(args.edits)) throw new Error('Invalid edit list');
  const edits = toolName === 'apply_patch'
    ? patchPaths(args).map(file => ({ file_path: resolvePath(file) }))
    : (Array.isArray(args.edits) ? args.edits.map(edit => ({
      ...object(edit, 'Edit'), file_path: resolvePath(resolveToolPath(edit, cwd, target)),
    })) : undefined);
  if (edits && edits.length > 64) throw new Error('Too many edit targets for one hook invocation');
  return { ...args, ...(target ? { file_path: resolvePath(target) } : {}), ...(edits ? { edits } : {}) };
}

function normalizeInput(event, payload) {
  if (!Object.hasOwn(EVENTS, event)) throw new Error('Unsupported Copilot hook event');
  const input = object(payload, 'Hook payload');
  const cwd = input.cwd ?? process.cwd();
  if (typeof cwd !== 'string' || cwd.includes('\0') || !path.isAbsolute(cwd)) throw new Error('Hook cwd must be absolute');
  const toolName = input.toolName ?? input.tool_name;
  const rawArgs = input.toolArgs ?? input.tool_input;
  const toolInput = /ToolUse$/.test(event)
    ? normalizeToolInput(toolName, object(typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs, 'Tool arguments'), cwd)
    : undefined;
  if (/ToolUse$/.test(event) && (typeof toolName !== 'string' || !toolName)) throw new Error('Missing tool name');
  return {
    ...input, cwd, hook_event_name: EVENTS[event],
    session_id: input.sessionId ?? input.session_id,
    transcript_path: input.transcriptPath ?? input.transcript_path,
    ...(toolInput ? { tool_name: Object.hasOwn(TOOL_NAMES, toolName) ? TOOL_NAMES[toolName] : toolName, tool_input: toolInput } : {}),
  };
}

function deny(reason) {
  return { permissionDecision: 'deny', permissionDecisionReason: reason || 'ECC hook failed; tool execution denied.' };
}

function translateOutput(event, result) {
  const status = result.status ?? result.exitCode;
  const diagnostic = String(result.stderr || '').trim().slice(0, 8192);
  if (event === 'preToolUse' && (result.error || status !== 0)) {
    return deny(diagnostic || 'ECC hook execution failed or timed out.');
  }
  const raw = String(result.stdout || '').trim();
  let parsed = {};
  try {
    if (raw) parsed = object(JSON.parse(raw), 'Hook output');
  } catch {
    return event === 'preToolUse' ? deny('Invalid ECC hook output.') : {};
  }
  const fields = parsed.hookSpecificOutput || {};
  const decision = fields.permissionDecision;
  const permission = event === 'preToolUse' && ['allow', 'deny', 'ask'].includes(decision)
    ? { permissionDecision: decision, ...(decision === 'deny'
      ? { permissionDecisionReason: fields.permissionDecisionReason || diagnostic || 'Blocked by ECC policy.' }
      : {}) } : {};
  const context = [typeof fields.additionalContext === 'string' ? fields.additionalContext : '',
    event === 'postToolUse' ? diagnostic : ''].filter(Boolean).join('\n');
  return { ...permission, ...(context ? { additionalContext: context } : {}) };
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
    const input = normalizeInput(event, JSON.parse(raw));
    if (!hook.tools.includes(input.tool_name)) return { exitCode: 0, stdout: '{}', stderr: '' };
    validateTarget(input);
    const targets = id === 'post:edit:console-warn' && input.tool_input.edits?.length
      ? [...new Set([input.tool_input.file_path, ...input.tool_input.edits.map(edit => edit.file_path)].filter(Boolean))]
      : [input.tool_input.file_path];
    const deadline = Date.now() + 8000;
    const results = targets.map(target => spawnSync(process.execPath, [path.join(__dirname, hook.script)], {
      input: JSON.stringify({ ...input, tool_input: { ...input.tool_input, ...(target ? { file_path: target } : {}) } }),
      cwd: input.cwd, env: hookEnv, encoding: 'utf8', timeout: Math.max(1, Math.min(hook.timeoutMs, deadline - Date.now())), maxBuffer: MAX_STDIN_BYTES, shell: false,
    }));
    const outputs = results.map(result => translateOutput(event, result));
    const blocked = outputs.find(output => output.permissionDecision === 'deny');
    const context = outputs.map(output => output.additionalContext).filter(Boolean).join('\n').slice(0, 10000);
    return {
      exitCode: results.some(result => result.error || result.status !== 0) ? 1 : 0,
      stdout: JSON.stringify(blocked || { ...outputs[0], ...(context ? { additionalContext: context } : {}) }),
      stderr: results.map(result => result.stderr || (result.error ? 'ECC hook execution failed.' : '')).filter(Boolean).join('\n').slice(0, 8192),
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
