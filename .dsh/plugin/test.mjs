/**
 * Self-check for the translation layer: the one runnable thing that fails if
 * the matcher, codec, merge, or payload rules break.
 *
 *   node test.mjs
 *   HOOKS_JSON=/path/to/hooks.json node test.mjs   # also parse a real config
 *
 * No test framework: a fixture config exercises every shape the parser and the
 * matchers care about.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  blocksToText,
  ccToolInput,
  ccToolResponse,
  matchesMatcher,
  matchesTool,
  mergeHookOutputs,
  parseHookOutput,
  parseHooks,
  substitute,
} from './index.js';

const fixture = {
  hooks: {
    SessionStart: [
      { matcher: 'startup|resume|clear|compact', hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/start.js', timeout: 5 }] },
    ],
    PreToolUse: [
      { matcher: 'Edit|Write|MultiEdit', hooks: [{ type: 'command', command: 'node gate.js' }] },
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'node bash-gate.js' }] },
      { matcher: '.*', hooks: [{ type: 'command', command: 'node observe.js' }, { type: 'prompt', prompt: 'not a command hook' }] },
    ],
    PostToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node post.js' }] }],
    PostToolUseFailure: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node fail.js' }] }],
    PreCompact: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node compact.js' }] }],
    Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node stop.js' }] }],
    SessionEnd: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node end.js' }] }],
    Notification: [{ matcher: '.*', hooks: [{ type: 'command', command: 'node unsupported-event.js' }] }],
  },
};

const { parsed, skippedEvents, skippedHandlers } = parseHooks(fixture, { CLAUDE_PLUGIN_ROOT: '/plug' });

// Every ECC-shaped event is served; only events with no DSH hook point drop out.
assert.deepEqual(
  Object.keys(parsed).sort(),
  ['PostToolUse', 'PostToolUseFailure', 'PreCompact', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop'],
  'all supported events parsed',
);
assert.deepEqual(skippedEvents, ['Notification'], 'unsupported event reported, not swallowed');
assert.deepEqual(skippedHandlers, ['PreToolUse:prompt'], 'non-command handler reported');

// Substitution and timeout normalization.
const sessionStart = parsed.SessionStart[0].hooks[0];
assert.equal(sessionStart.command, 'node /plug/start.js');
assert.equal(sessionStart.timeoutSec, 5);
assert.equal(substitute('node ${CLAUDE_PLUGIN_ROOT}/x.js', { CLAUDE_PLUGIN_ROOT: '/ecc' }), 'node /ecc/x.js');
assert.equal(substitute('node ${CLAUDE_PROJECT_DIR}/x.js', {}), 'node ${CLAUDE_PROJECT_DIR}/x.js', 'unknown vars stay literal');

// Matchers: Claude Code names select DSH tools; literals stay exact.
assert.ok(matchesTool('Bash', 'bash'), 'Bash selects bash');
assert.ok(matchesTool('Edit|Write|MultiEdit', 'edit'));
assert.ok(matchesTool('Edit|Write|MultiEdit', 'write'));
assert.ok(matchesTool('.*', 'anything'));
assert.ok(matchesTool(undefined, 'bash'), 'absent matcher matches all');
assert.ok(!matchesTool('Bash', 'edit'), 'unrelated tool does not match');
assert.ok(!matchesTool('Skill', 'bash'), 'literal matcher stays exact');
assert.ok(matchesTool('Skill', 'skill'));
assert.ok(matchesMatcher('Bash', 'Bash') && !matchesMatcher('Bash', 'bash'), 'protocol matcher is case-sensitive');
assert.ok(matchesMatcher('^Edit', 'Editor'), 'non-literal patterns are regexes');
assert.ok(!matchesMatcher('[unclosed', 'anything'), 'invalid regex is a non-match, not a throw');

// Payload translation.
assert.deepEqual(ccToolInput('bash', { command: 'ls', description: 'List' }), { command: 'ls', description: 'List' });
assert.deepEqual(ccToolInput('skill', { name: 'ponytail' }), { skill: 'ponytail', args: '' });
assert.equal(ccToolInput('web_search', { queries: ['a', 'b'] }).query, 'a b');
assert.deepEqual(ccToolInput('grep', { pattern: 'x', include: '*.js' }), { pattern: 'x', glob: '*.js' });
assert.deepEqual(
  ccToolInput('edit', { file_path: '/a', old_string: 'x', new_string: 'y' }),
  { file_path: '/a', old_string: 'x', new_string: 'y' },
  'edit input passes through unchanged',
);
assert.deepEqual(ccToolResponse('bash', 'out'), { stdout: 'out', stderr: '', interrupted: false });
assert.equal(ccToolResponse('write', 'ok'), 'ok');
assert.equal(blocksToText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]), 'ab');

// Codec: decisions, the event-name guard, and exit-2 blocking.
const deny = parseHookOutput(0, JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '[Fact-Forcing Gate]' },
}), '', 'PreToolUse');
assert.equal(deny.decision, 'deny');
assert.equal(deny.reason, '[Fact-Forcing Gate]');
const mislabelled = parseHookOutput(0, JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PostToolUse', permissionDecision: 'deny' },
}), '', 'PreToolUse');
assert.equal(mislabelled.decision, undefined, 'a hook answering for another event cannot deny here');
const blocked = parseHookOutput(2, '', 'nope\n', 'Stop');
assert.equal(blocked.decision, 'block');
assert.equal(blocked.reason, 'nope');
const context = parseHookOutput(0, JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: '[Hook] WARNING' },
}), '', 'PreToolUse');
assert.equal(context.additionalContext, '[Hook] WARNING');

// Merge: deny beats ask beats allow, reasons join, context accumulates.
const merged = mergeHookOutputs([deny, blocked, context, { decision: 'ask', reason: 'sure?' }]);
assert.equal(merged.decision, 'deny');
assert.equal(merged.reason, '[Fact-Forcing Gate]\n\nnope', 'reasons join with a blank line');
assert.deepEqual(merged.additionalContext, ['[Hook] WARNING']);
assert.equal(mergeHookOutputs([]).decision, 'none');

// Optional: parse a real hooks.json passed by the caller.
const realPath = process.env.HOOKS_JSON;
if (realPath) {
  const real = parseHooks(JSON.parse(readFileSync(realPath, 'utf8')));
  const points = Object.keys(real.parsed);
  const commands = Object.values(real.parsed).flat().flatMap((group) => group.hooks).length;
  assert.ok(points.length >= 7, `expected >=7 events in ${realPath}, got ${points.length}`);
  console.log(`real config ${realPath}: ${commands} commands across ${points.length} events (${points.join(', ')})`);
}

console.log('ok — matcher, codec, merge and payload translation verified');

/* ---------------------------------------------------------------- *
 * Runtime wiring: apply the plugin against a mock harness and assert
 * the decisions listeners actually return. The translation checks
 * above pass even when a configured hook cannot run; these do not.
 * ---------------------------------------------------------------- */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from './index.js';

const work = mkdtempSync(join(tmpdir(), 'cc-hooks-test-'));
const configPath = join(work, 'hooks.json');
writeFileSync(configPath, JSON.stringify({
  hooks: {
    PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'gate' }] }],
    PostToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'success-hook' }] }],
    PostToolUseFailure: [{ matcher: '.*', hooks: [{ type: 'command', command: 'failure-hook' }] }],
  },
}));

/** A harness stand-in: records commands, answers with canned hook output. */
function harness(respond) {
  const handlers = {};
  const ran = [];
  return {
    handlers,
    ran,
    ctx: {
      logger: { warn: () => {} },
      on: (event, fn) => { handlers[event] = fn; },
      effect: () => () => {},
      get: () => undefined,
      shell: {
        resolve: (request) => request,
        execute: async (spec) => {
          ran.push(spec.command);
          const answer = respond(spec.command) ?? {};
          return {
            result: async () => ({
              exitCode: answer.exitCode ?? 0,
              stdout: { text: answer.stdout ?? '' },
              stderr: { text: answer.stderr ?? '' },
            }),
          };
        },
      },
    },
  };
}

const json = (o) => JSON.stringify(o);
const exec = (extra) => ({ callId: 'call-1', name: 'write', arguments: { file_path: '/tmp/x.md', content: 'x' }, signal: new AbortController().signal, ...extra });

// A denying PreToolUse hook stops the call.
{
  const h = harness(() => ({ stdout: json({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '[Gate] stop' } }) }));
  apply(h.ctx, { configPath, dshHome: work, logPath: join(work, 'a.log'), transcript: 'off' });
  const decision = await h.handlers['tools/pre-execute'](exec(), async () => ({ kind: 'allow' }));
  assert.equal(decision.kind, 'deny', 'denying hook denies the call');
  assert.equal(decision.reason, '[Gate] stop');
}

// `continue: false` also stops the call, before next().
{
  const h = harness(() => ({ stdout: json({ continue: false, stopReason: 'halt' }) }));
  apply(h.ctx, { configPath, dshHome: work, logPath: join(work, 'b.log'), transcript: 'off' });
  let delegated = false;
  const decision = await h.handlers['tools/pre-execute'](exec(), async () => { delegated = true; return { kind: 'allow' }; });
  assert.equal(decision.kind, 'deny', 'continue:false denies');
  assert.equal(decision.reason, 'halt');
  assert.equal(delegated, false, 'continue:false never reaches next()');
}

// PreToolUse context is buffered and delivered with that call's result.
{
  const h = harness((command) => (command === 'gate'
    ? { stdout: json({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: '[Hook] WARNING' } }) }
    : { stdout: '' }));
  apply(h.ctx, { configPath, dshHome: work, logPath: join(work, 'c.log'), transcript: 'off' });
  const call = exec();
  await h.handlers['tools/pre-execute'](call, async () => ({ kind: 'allow' }));
  const upper = call.callId.toUpperCase();
  const decision = await h.handlers['tools/post-execute'](call, { isError: false, content: [{ type: 'text', text: 'ok' }] }, async () => ({ kind: 'accept' }));
  const contexts = decision.additionalContexts ?? [];
  assert.equal(contexts.length, 1, 'held context is attached to the result');
  assert.ok(JSON.stringify(contexts[0]).includes('[Hook] WARNING'), `context text survives (${upper})`);
}

// A failed call runs only the failure hook; a successful one only the success hook.
{
  const h = harness(() => ({ stdout: '' }));
  apply(h.ctx, { configPath, dshHome: work, logPath: join(work, 'd.log'), transcript: 'off' });
  h.ran.length = 0;
  await h.handlers['tools/post-execute'](exec({ callId: 'fail-1' }), { isError: true, content: [], error: { message: 'boom' } }, async () => ({ kind: 'accept' }));
  assert.deepEqual(h.ran, ['failure-hook'], `failure path ran ${JSON.stringify(h.ran)}`);
  h.ran.length = 0;
  await h.handlers['tools/post-execute'](exec({ callId: 'ok-1' }), { isError: false, content: [{ type: 'text', text: 'ok' }] }, async () => ({ kind: 'accept' }));
  assert.deepEqual(h.ran, ['success-hook'], `success path ran ${JSON.stringify(h.ran)}`);
}

console.log('ok — runtime wiring verified (deny, continue:false, context hand-off, failure routing)');
