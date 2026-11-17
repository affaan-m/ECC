'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { parseCodexRollout } = require('../../scripts/lib/session-adapters/codex-worktree');
const { createAdapterRegistry } = require('../../scripts/lib/session-adapters/registry');

const userResponse = text => ({
  type: 'response_item',
  payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
});
const userEvent = message => ({ type: 'event_msg', payload: { type: 'user_message', message } });
const completedUser = content => ({
  type: 'event_msg', payload: {
    type: 'item_completed', thread_id: '019e52db-1234-5678-9abc-123456789abc', turn_id: 'turn',
    item: { type: 'UserMessage', id: 'message', content },
  },
});
const preambles = [
  userResponse('# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nFollow project rules.\n</INSTRUCTIONS>'),
  userResponse('<environment_context>\n<cwd>/repo</cwd>\n</environment_context>'),
  userResponse('<skills_instructions>\nInstalled skill descriptions\n</skills_instructions>'),
];

function withRollout(records, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-objective-'));
  const rollout = path.join(dir, 'rollout-2026-11-17T06-00-00-objective.jsonl');
  try {
    fs.writeFileSync(rollout, [
      { type: 'session_meta', payload: { id: 'objective-test', cwd: dir } },
      ...records,
    ].map(record => JSON.stringify(record)).join('\n') + '\n');
    return callback(rollout, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function objective(records) {
  return withRollout(records, rollout => parseCodexRollout(rollout, { resolveBranchImpl: () => null }).objective);
}

test('native user events preserve markup requests and text resembling harness context', () => {
  for (const request of [
    '# Task\nRepair the parser',
    '<task>Repair the parser</task>',
    'Explain how <cwd> is resolved',
    'Review AGENTS.md instructions and suggest a correction',
    '019e52db-1234-5678-9abc-123456789abc is the failing request ID',
  ]) {
    assert.strictEqual(objective([...preambles, userEvent(request), userResponse(request)]), request);
  }
});

test('completed UserMessage items supply objectives for paginated rollouts', () => {
  const request = '# Fix\nHandle the empty response';
  const records = [...preambles, completedUser([
    { type: 'text', text: '# Fix\n', text_elements: [] },
    { type: 'image', image_url: 'https://example.test/image.png' },
    { type: 'text', text: 'Handle the empty response', text_elements: [] },
  ])];
  assert.strictEqual(objective(records), request);
  assert.strictEqual(objective([completedUser([{ type: 'text', text: 'x'.repeat(400) }])]), 'x'.repeat(277) + '...');
});

test('the first usable native user event wins over context text and later turns', () => {
  const request = '<task>Keep the original objective</task>';
  assert.strictEqual(objective([
    userResponse('Injected runtime note that is not an operator request'),
    ...preambles,
    userEvent('  '),
    completedUser([{ type: 'image', image_url: 'https://example.test/image.png' }]),
    userEvent(`  ${request}\n`),
    completedUser([{ type: 'text', text: '# Later request' }]),
    userEvent('An even later request'),
  ]), request);
  assert.strictEqual(objective([
    completedUser([{ type: 'text', text: '# First completed item' }]),
    userEvent('Later legacy event'),
  ]), '# First completed item');
});

test('missing or malformed user events retain the legacy response-item fallback', () => {
  const legacy = 'Legacy request';
  const invalid = [
    null, {}, { type: 'event_msg' },
    { type: 'response_item', payload: { type: 'user_message', message: 'Wrong envelope' } },
    userEvent(null), userEvent({ text: 'Invalid event text' }), userEvent(''),
    completedUser(null), completedUser('Invalid item content'),
    completedUser([null, { type: 'image', text: 'Not user text' }, { type: 'text', text: 42 }]),
    { type: 'event_msg', payload: { type: 'item_completed', item: null } },
    { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', content: 'Assistant text' } } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Assistant text' } },
  ];
  assert.strictEqual(objective([...preambles, ...invalid, userResponse('019e52db-1234-5678-9abc-123456789abc' + legacy)]), legacy);
  assert.strictEqual(objective([...preambles, ...invalid]), '');
  assert.strictEqual(objective([...preambles, userResponse('y'.repeat(400))]), 'y'.repeat(277) + '...');
});

test('the registry and actual session-inspect CLI expose the native objective', () => {
  const request = '# Repair\nPreserve the operator request';
  withRollout([...preambles, userEvent(request), userResponse(request)], (rollout, dir) => {
    fs.appendFileSync(rollout, '{partial trailing JSON');
    const registry = createAdapterRegistry({
      persistSnapshots: false,
      adapterOptions: { 'codex-worktree': { resolveBranchImpl: () => null } },
    });
    const snapshot = registry.open(rollout).getSnapshot();
    assert.strictEqual(snapshot.workers[0].intent.objective, request);

    const written = path.join(dir, 'snapshot.json');
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '..', '..', 'scripts', 'session-inspect.js'), rollout, '--write', written,
    ], {
      cwd: dir, encoding: 'utf8', timeout: 10000, windowsHide: true,
      env: { ...process.env, HOME: dir, USERPROFILE: dir, ECC_SESSION_RECORDING_DIR: path.join(dir, 'recordings') },
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.workers[0].intent.objective, request);
    assert.strictEqual(JSON.parse(fs.readFileSync(written, 'utf8')).workers[0].intent.objective, request);
  });
});
