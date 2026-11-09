#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readSessionEvents } = require('./lib/copilot-native-events');
const { sessionId } = require('./lib/copilot-sessions');

const EDIT_TOOLS = new Set(['edit', 'create', 'apply_patch', 'create_file', 'str_replace_editor']);
const TEST_COMMANDS = new Set(['npm test', 'npm run test', 'pnpm test', 'pnpm run test',
  'yarn test', 'bun test', 'pytest', 'python -m pytest', 'python3 -m pytest', 'dotnet test', 'go test ./...']);
const RULE = 'tests-after-edit';
const report = (status, evidence = {}) => ({ schema: 'ecc.copilot.skill-comply.v1', rule: RULE, status, ...evidence });

function inside(root, file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return false;
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function rootEvent(event) {
  return !event.ephemeral && !event.checkpoint && !event.agentId && !event.data?.parentToolCallId
    && !event.data?.mcpServerName && !event.data?.mcpToolName;
}

function invocationMatches(event, name, skillPath) {
  return event.type === 'skill.invoked' && event.data?.name === name
    && [undefined, 'project'].includes(event.data.source)
    && [undefined, 'user-invoked', 'agent-invoked'].includes(event.data.trigger)
    && typeof event.data.path === 'string' && path.isAbsolute(event.data.path)
    && path.relative(skillPath, event.data.path) === '';
}

function turnWindow(events, name, skillPath) {
  const invocation = events.findLastIndex(event => invocationMatches(event, name, skillPath));
  if (invocation < 0) return { status: 'skill-not-observed' };
  const prior = events.slice(0, invocation);
  const start = prior.findLastIndex(event => ['assistant.turn_start', 'assistant.turn_end', 'abort'].includes(event.type));
  if (start < 0 || prior[start].type !== 'assistant.turn_start'
    || typeof prior[start].data?.turnId !== 'string' || !prior[start].data.turnId) return { status: 'turn-unavailable' };
  const turnId = prior[start].data.turnId;
  const later = events.slice(invocation + 1);
  const end = later.findIndex(event => ['assistant.turn_start', 'assistant.turn_end', 'abort'].includes(event.type));
  if (end < 0 || later[end].type !== 'assistant.turn_end'
    || later[end].data?.turnId !== turnId) return { status: 'turn-unavailable' };
  const window = [...prior.slice(start + 1), events[invocation], ...later.slice(0, end)];
  const invocationIndex = invocation - start - 1;
  const activations = [...prior.slice(start + 1), ...later.slice(0, end)].some(event => event.type === 'skill.invoked'
    && event.data?.trigger !== 'context-load');
  return activations ? { status: 'ambiguous-skill' } : { window, turnId, invocationIndex };
}

function collectCalls(events, turnId) {
  const calls = new Map();
  for (const [index, event] of events.entries()) {
    const data = event.data;
    if (!['tool.execution_start', 'tool.execution_complete'].includes(event.type)
      || typeof data?.toolCallId !== 'string' || !data.toolCallId || data.toolCallId.length > 256) continue;
    const record = calls.get(data.toolCallId) || {};
    const key = event.type === 'tool.execution_start' ? 'start' : 'end';
    if (record[key] || (data.turnId !== undefined && data.turnId !== turnId)) record.ambiguous = true;
    if (key === 'start' && EDIT_TOOLS.has(data.toolName)) record.edit = true;
    record[key] ||= { index, data };
    calls.set(data.toolCallId, record);
  }
  return [...calls.values()];
}

function closedCall(call) {
  return !call.ambiguous && call.end && call.end.index > call.start.index
    && typeof call.end.data.success === 'boolean';
}

function testCommand(call, cwd) {
  const { toolName, arguments: args } = call.start.data;
  return (toolName === 'bash' || toolName === 'powershell') && typeof args?.command === 'string'
    && (args.cwd === undefined || (typeof args.cwd === 'string' && path.isAbsolute(args.cwd) && path.relative(cwd, args.cwd) === ''))
    && args.mode !== 'async' && TEST_COMMANDS.has(args.command.trim());
}

function testOutcome(call, cwd) {
  if (!closedCall(call)) return 'unknown-test-outcome';
  const data = call.end.data;
  const blocks = Array.isArray(data.result?.contents)
    ? data.result.contents.filter(block => block?.type === 'shell_exit') : [];
  if (blocks.some(block => block.cwd !== undefined
    && (typeof block.cwd !== 'string' || !path.isAbsolute(block.cwd) || path.relative(cwd, block.cwd) !== ''))) return 'unknown-test-outcome';
  const codes = blocks.map(block => block.exitCode);
  if (data.shellExecution !== undefined) codes.push(data.shellExecution?.exitCode);
  if (!codes.length || !Number.isSafeInteger(codes[0]) || codes.some(code => code !== codes[0])) return 'unknown-test-outcome';
  if (codes[0] !== 0) return 'failed';
  return data.success ? 'passed' : 'unknown-test-outcome';
}

function evaluate(events, cwd, name, skillPath) {
  if (events.some(event => event.type === 'session.snapshot_rewind')) return report('journal-rewound');
  const { status, window, turnId, invocationIndex } = turnWindow(events.filter(rootEvent), name, skillPath);
  if (status) return report(status);
  const calls = collectCalls(window, turnId);
  const edits = calls.filter(call => (call.edit || call.end?.data.fileEdits?.length)
    && (call.end?.index ?? Infinity) > invocationIndex);
  if (edits.some(call => !call.start || !closedCall(call) || !Array.isArray(call.end.data.fileEdits)
    || call.end.data.fileEdits.some(edit => !['create', 'edit', 'delete'].includes(edit?.kind)
      || typeof edit.path !== 'string' || !path.isAbsolute(edit.path)))) {
    return report('unknown-edit-outcome', { association: 'same-turn-after-invocation' });
  }
  const lastEdit = edits.filter(call => call.end.data.fileEdits.some(edit =>
    ['create', 'edit', 'delete'].includes(edit?.kind) && inside(cwd, edit.path)))
    .reduce((latest, call) => Math.max(latest, call.end.index), -1);
  const evidence = { association: 'same-turn-after-invocation' };
  if (lastEdit < 0) return report('edit-not-observed', evidence);
  const test = calls.findLast(call => call.start && call.start.index > lastEdit && testCommand(call, cwd));
  return report(test ? testOutcome(test, cwd) : 'test-not-observed', { ...evidence, editObserved: true });
}

function run(args, cwd, env = process.env) {
  if (args.length !== 4 || args[0] !== '--session' || args[2] !== '--skill' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(args[3])) {
    throw new Error('Usage: copilot-skill-comply.js --session ID --skill PROJECT_SKILL');
  }
  const id = sessionId(args[1]);
  const skill = path.join(cwd, '.github', 'skills', args[3], 'SKILL.md');
  let events;
  try {
    if (path.relative(skill, fs.realpathSync(skill)) !== '' || !fs.lstatSync(skill).isFile()) return report('skill-unavailable');
    ({ events } = readSessionEvents(id, cwd, env));
  } catch { return report('journal-unavailable'); }
  return evaluate(events, cwd, args[3], skill);
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(run(process.argv.slice(2), fs.realpathSync(process.cwd()))) + '\n'); }
  catch { process.stderr.write('Usage: copilot-skill-comply.js --session ID --skill PROJECT_SKILL\n'); process.exitCode = 1; }
}
