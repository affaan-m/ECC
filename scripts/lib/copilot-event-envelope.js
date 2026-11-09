'use strict';

// Only interpretation lives here. Payloads never select programs, permissions,
// runtime roots or policy IDs, and no operation is executed by this module.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const MAX_STDIN_BYTES = 1024 * 1024;
const EVENTS = Object.freeze({
  preToolUse: 'PreToolUse', postToolUse: 'PostToolUse',
  postToolUseFailure: 'PostToolUseFailure',
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

function decodeArgs(value) {
  return object(typeof value === 'string' ? JSON.parse(value) : value, 'Tool arguments');
}

function alias(input, names, decode = value => value) {
  const present = names.filter(name => Object.hasOwn(input, name));
  const values = present.map(name => decode(input[name]));
  if (values.some(value => !isDeepStrictEqual(value, values[0]))) throw new Error(`Conflicting ${names[0]} aliases`);
  return values[0];
}

function identity(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 256
    || [...value].some(character => character.charCodeAt(0) < 32)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function toolOutcome(event, input) {
  if (event === 'preToolUse') return { status: 'not-run', source: null };
  if (event === 'postToolUseFailure') return { status: 'failed', source: 'postToolUseFailure' };
  if (event !== 'postToolUse') return { status: 'not-applicable', source: null };
  const result = alias(input, ['toolResult', 'tool_result']);
  if (result === undefined) return { status: 'unknown', source: null };
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { status: 'unknown', source: 'toolResult' };
  if ((Object.hasOwn(result, 'success') && typeof result.success !== 'boolean')
    || (Object.hasOwn(result, 'exitCode') && !Number.isSafeInteger(result.exitCode))) {
    return { status: 'unknown', source: 'toolResult:invalid' };
  }
  const success = typeof result.success === 'boolean' ? result.success : undefined;
  const exit = Number.isInteger(result.exitCode) ? result.exitCode === 0 : undefined;
  const nativeType = alias(result, ['resultType', 'result_type']);
  if (nativeType !== undefined && !['success', 'failure'].includes(nativeType)) return { status: 'unknown', source: 'toolResult:invalid' };
  const markers = [success, exit, nativeType === undefined ? undefined : nativeType === 'success'].filter(value => value !== undefined);
  if (markers.some(value => value !== markers[0])) return { status: 'unknown', source: 'toolResult:conflict' };
  const value = markers[0];
  if (value === true && ((result.error !== undefined && result.error !== null && result.error !== false)
    || result.isError === true || (result.signal !== undefined && result.signal !== null && result.signal !== ''))) {
    return { status: 'unknown', source: 'toolResult:conflict' };
  }
  return { status: value === undefined ? 'unknown' : (value ? 'succeeded' : 'failed'), source: value === undefined ? null : 'toolResult' };
}

function parseEventEnvelope(event, payload) {
  const input = object(payload, 'Hook payload');
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) throw new Error('Unsupported Copilot envelope version');
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_STDIN_BYTES) throw new Error('Copilot envelope exceeds 1 MiB');
  const normalized = normalizeInput(event, input);
  const nativeName = alias(input, ['toolName', 'tool_name']);
  return {
    schemaVersion: 1,
    event,
    sessionId: identity(normalized.session_id, 'session ID'),
    callId: identity(alias(input, ['toolCallId', 'tool_call_id']), 'tool call ID'),
    turnId: identity(alias(input, ['turnId', 'turn_id']), 'turn ID'),
    workspace: { requested: normalized.cwd, canonical: fs.realpathSync(normalized.cwd) },
    tool: /ToolUse(?:Failure)?$/.test(event) ? { nativeName, name: normalized.tool_name, args: normalized.tool_input } : null,
    outcome: toolOutcome(event, input)
  };
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
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) throw new Error('Unsupported Copilot envelope version');
  const cwd = input.cwd ?? process.cwd();
  if (typeof cwd !== 'string' || cwd.includes('\0') || !path.isAbsolute(cwd)) throw new Error('Hook cwd must be absolute');
  const toolName = alias(input, ['toolName', 'tool_name']);
  const rawArgs = alias(input, ['toolArgs', 'tool_input'], decodeArgs);
  const toolInput = /ToolUse(?:Failure)?$/.test(event)
    ? normalizeToolInput(toolName, object(typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs, 'Tool arguments'), cwd)
    : undefined;
  if (/ToolUse(?:Failure)?$/.test(event) && (typeof toolName !== 'string' || !toolName)) throw new Error('Missing tool name');
  return {
    ...input, cwd, hook_event_name: EVENTS[event],
    session_id: alias(input, ['sessionId', 'session_id']),
    transcript_path: alias(input, ['transcriptPath', 'transcript_path']),
    ...(toolInput ? { tool_name: Object.hasOwn(TOOL_NAMES, toolName) ? TOOL_NAMES[toolName] : toolName, tool_input: toolInput } : {}),
  };
}

function deny(reason) {
  return { permissionDecision: 'deny', permissionDecisionReason: reason || 'ECC hook failed; tool execution denied.' };
}

function translateHookOutput(event, result) {
  const status = Object.hasOwn(result, 'status') ? result.status : result.exitCode;
  const diagnostic = String(result.stderr || '').trim().slice(0, 8192);
  if (event === 'preToolUse' && (result.error || result.signal || status !== 0)) {
    return deny(diagnostic || 'ECC hook execution failed or timed out.');
  }
  const raw = String(result.stdout || '').trim();
  let parsed = {};
  try {
    if (raw) parsed = object(JSON.parse(raw), 'Hook output');
  } catch {
    return event === 'preToolUse' ? deny('Invalid ECC hook output.') : {};
  }
  let fields;
  try { fields = parsed.hookSpecificOutput === undefined ? {} : object(parsed.hookSpecificOutput, 'Hook output fields'); }
  catch { return event === 'preToolUse' ? deny('Invalid ECC hook output.') : {}; }
  const decision = fields.permissionDecision;
  if (event === 'preToolUse' && decision !== undefined && !['allow', 'deny', 'ask'].includes(decision)) {
    return deny('Invalid ECC permission decision.');
  }
  const permission = event === 'preToolUse' && ['allow', 'deny', 'ask'].includes(decision)
    ? { permissionDecision: decision, ...(decision === 'deny'
      ? { permissionDecisionReason: (typeof fields.permissionDecisionReason === 'string'
        && fields.permissionDecisionReason.trim() ? fields.permissionDecisionReason.slice(0, 8192)
        : diagnostic || 'Blocked by ECC policy.') }
      : {}) } : {};
  const context = [typeof fields.additionalContext === 'string' ? fields.additionalContext : '',
    event === 'postToolUse' ? diagnostic : ''].filter(Boolean).join('\n');
  return { ...permission, ...(context ? { additionalContext: context } : {}) };
}

function aggregateHookOutputs(event, outputs) {
  if (!Object.hasOwn(EVENTS, event) || !Array.isArray(outputs)) throw new Error('Invalid hook output aggregation');
  const decision = event === 'preToolUse'
    ? ['deny', 'ask', 'allow'].map(value => outputs.find(output => output.permissionDecision === value)).find(Boolean)
    : undefined;
  const context = outputs.map(output => typeof output.additionalContext === 'string' ? output.additionalContext : '')
    .filter(Boolean).join('\n').slice(0, 10000);
  return { ...(decision ? { permissionDecision: decision.permissionDecision,
    ...(decision.permissionDecision === 'deny' ? { permissionDecisionReason: decision.permissionDecisionReason || 'Blocked by ECC policy.' } : {}) } : {}),
  ...(context ? { additionalContext: context } : {}) };
}

module.exports = { parseEventEnvelope, normalizeInput, translateHookOutput, aggregateHookOutputs, MAX_STDIN_BYTES, EVENTS, TOOL_NAMES };
