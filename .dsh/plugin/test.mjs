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
  const payloads = [];
  return {
    handlers,
    ran,
    payloads,
    ctx: {
      logger: { warn: () => {} },
      on: (event, fn) => { handlers[event] = fn; },
      effect: () => () => {},
      get: () => undefined,
      shell: {
        resolve: (request) => request,
        execute: async (spec) => {
          ran.push(spec.command);
          try { payloads.push(JSON.parse(spec.stdin)); } catch { payloads.push({}); }
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

/* ---------------------------------------------------------------- *
 * Two more wiring guarantees, both taken from review findings:
 * an empty prompt batch must not re-run prompt hooks, and the
 * transcript must keep the model + token usage the cost tracker reads
 * (event shape copied from a live DSH session log).
 * ---------------------------------------------------------------- */
{
  const sessionQuery = {
    readSurface: async (id) => ({
      session: { id, cwd: '/tmp' },
      events: [
        { type: 'user/message', seq: 1, time: Date.now(), data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }] } },
        { type: 'assistant/message', seq: 2, time: Date.now(), data: {
          message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'hello' }], source: { model: 'test-model' } },
          step: 1, turn: 1, stream: [], usage: { inputTokens: 11, outputTokens: 22 },
        } },
      ],
    }),
  };
  const h = harness(() => ({ stdout: '' }));
  h.ctx.get = (name) => (name === 'sessionQuery' ? sessionQuery : undefined);
  const transcriptDir = join(work, 'transcripts-live-shape');
  apply(h.ctx, { configPath, dshHome: work, logPath: join(work, 'e.log'), transcriptDir, transcriptTtlMs: 60_000 });

  // Empty prompt batches (tool continuations) must delegate without running hooks.
  h.ran.length = 0;
  let delegated = false;
  const step = await h.handlers['agent/pre-step']({ agent: { session: { header: { id: 'sess-shape', cwd: '/tmp' } } }, messages: [], turn: 2, signal: new AbortController().signal }, async () => { delegated = true; return { kind: 'enter', messages: [] }; });
  assert.equal(delegated, true, 'empty batch delegates');
  assert.deepEqual(h.ran, [], `empty batch ran hooks: ${JSON.stringify(h.ran)}`);

  // A lifecycle point must see model + usage in the transcript.
  await h.handlers['agent/turn-stopping']({ agent: { session: { header: { id: 'sess-shape', cwd: '/tmp' } } }, turn: 2, signal: new AbortController().signal });
  const transcript = readFileSync(join(transcriptDir, 'sess-shape.jsonl'), 'utf8');
  assert.ok(transcript.includes('"model":"test-model"'), 'transcript keeps the model');
  assert.ok(transcript.includes('"inputTokens":11'), 'transcript keeps token usage');
}

console.log('ok — transcript shape and prompt-batch routing verified');

/* ---------------------------------------------------------------- *
 * PreCompact guarantees. The harness exposes no awaited
 * pre-compaction point, so the bridge guarantees the two things it
 * can: the hook's transcript is frozen at compaction/start, and the
 * next step waits for the hook (bounded).
 * ---------------------------------------------------------------- */
{
  const precompactConfig = join(work, 'hooks-precompact.json');
  writeFileSync(precompactConfig, JSON.stringify({
    hooks: { PreCompact: [{ matcher: '.*', hooks: [{ type: 'command', command: 'precompact-hook' }] }] },
  }));
  const session = (id) => ({ header: { id, cwd: '/tmp' } });
  const compaction = (seq) => ({ type: 'compaction/start', seq, time: Date.now(), data: { compactionId: `c${seq}` } });

  // Frozen input: the surface is replaced moments after compaction/start.
  let phase = 'original';
  const frozen = harness(() => ({ stdout: '' }));
  frozen.ctx.get = () => ({
    readSurface: async (id) => ({
      session: { id, cwd: '/tmp' },
      events: [{ type: 'user/message', seq: 1, time: Date.now(), data: { id: 'u', role: 'user', content: [{ type: 'text', text: phase }] } }],
    }),
  });
  const frozenDir = join(work, 'transcripts-precompact');
  apply(frozen.ctx, { configPath: precompactConfig, dshHome: work, logPath: join(work, 'f.log'), transcriptDir: frozenDir });
  frozen.handlers['session/event'](session('sess-frozen'), compaction(1));
  phase = 'compacted';
  await new Promise((resolve) => setTimeout(resolve, 50));
  const payload = frozen.payloads.find((p) => p.hook_event_name === 'PreCompact');
  assert.ok(payload !== undefined, 'PreCompact hook ran');
  assert.ok(readFileSync(payload.transcript_path, 'utf8').includes('original'), 'hook read a pre-compaction transcript');

  // The next step waits for the hook, and the wait is bounded.
  let finishedAt = 0;
  const slow = harness(() => ({ stdout: '' }));
  slow.ctx.shell.execute = async (spec) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    finishedAt = Date.now();
    return { result: async () => ({ exitCode: 0, stdout: { text: '' }, stderr: { text: '' } }) };
  };
  apply(slow.ctx, { configPath: precompactConfig, dshHome: work, logPath: join(work, 'g.log'), transcriptDir: join(work, 't-slow') });
  slow.handlers['session/event'](session('sess-slow'), compaction(2));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await slow.handlers['agent/pre-step'](
    { agent: { session: session('sess-slow') }, messages: [{ content: [{ type: 'text', text: 'next' }] }], turn: 2, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [] }),
  );
  assert.ok(finishedAt !== 0 && Date.now() >= finishedAt, 'the step waited for the PreCompact hook');

  const hungLog = join(work, 'h.log');
  const hung = harness(() => ({ stdout: '' }));
  hung.ctx.shell.execute = () => new Promise(() => {});
  apply(hung.ctx, { configPath: precompactConfig, dshHome: work, logPath: hungLog, transcriptDir: join(work, 't-hung'), precompactWaitMs: 100 });
  hung.handlers['session/event'](session('sess-hung'), compaction(3));
  const started = Date.now();
  const decision = await hung.handlers['agent/pre-step'](
    { agent: { session: session('sess-hung') }, messages: [{ content: [{ type: 'text', text: 'next' }] }], turn: 2, signal: new AbortController().signal },
    async () => ({ kind: 'enter', messages: [] }),
  );
  assert.equal(decision.kind, 'enter', 'a hung hook must not stall the step');
  assert.ok(Date.now() - started < 2000, 'the wait stayed bounded');
  assert.ok(readFileSync(hungLog, 'utf8').includes('precompact-wait-timeout'), 'the timeout was recorded');
}

console.log('ok — PreCompact input, step wait and bounded wait verified');
