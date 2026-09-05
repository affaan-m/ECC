/**
 * Regression coverage for #2924: passthrough hooks must not truncate
 * stdout when forwarding payloads larger than the OS pipe buffer.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const payload = JSON.stringify({
  session_id: 'large-passthrough-test',
  hook_event_name: 'PostToolUse',
  tool_input: { file_path: 'notes.txt' },
  pad: 'x'.repeat(200 * 1024),
});

const hooks = [
  'scripts/hooks/post-edit-typecheck.js',
  'scripts/hooks/post-edit-format.js',
];

for (const hook of hooks) {
  const result = spawnSync('node', [path.join(repoRoot, hook)], {
    input: payload,
    encoding: 'utf8',
    cwd: repoRoot,
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });

  assert.strictEqual(result.status, 0, `${hook}: expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.strictEqual(result.stdout, payload, `${hook}: passthrough payload was truncated`);
  assert.doesNotThrow(() => JSON.parse(result.stdout), `${hook}: stdout must remain valid JSON`);
}

console.log(`✓ ${hooks.length} passthrough hooks preserve a 200KB payload`);
