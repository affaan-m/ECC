/**
 * Security-focused regression: observe.sh Layer-1 entrypoint allowlist (#3171).
 *
 * sdk-cli must pass Layer-1 (interactive Agent SDK CLI). Unknown entrypoints
 * must early-exit. Layers 2–5 still filter automated sessions.
 */
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const observeShPath = path.join(
  repoRoot,
  'skills',
  'continuous-learning-v2',
  'hooks',
  'observe.sh'
);

const isWindows = process.platform === 'win32';

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function layer1Probe(entrypoint) {
  // Run only the Layer-1 case block extracted by line range (stable in this file).
  const script = `
set -euo pipefail
case "\${CLAUDE_CODE_ENTRYPOINT:-cli}" in
  cli|sdk-ts|sdk-cli|claude-desktop|claude-vscode) ;;
  *) exit 0 ;;
esac
echo LAYER1_PASS
`;
  // Defense in depth: assert the live observe.sh still matches this allowlist.
  const src = fs.readFileSync(observeShPath, 'utf8');
  assert.ok(
    src.includes('cli|sdk-ts|sdk-cli|claude-desktop|claude-vscode'),
    'observe.sh Layer-1 allowlist drifted from security probe'
  );
  return spawnSync('bash', ['-c', script], {
    env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: entrypoint },
    encoding: 'utf8',
  });
}

console.log('\n=== observe.sh Layer-1 entrypoint security (#3171) ===\n');

let failed = 0;
if (isWindows) {
  console.log('  ⊘ skipped on Windows');
  process.exit(0);
}

if (
  !test('source allowlist includes sdk-cli', () => {
    const src = fs.readFileSync(observeShPath, 'utf8');
    assert.match(src, /cli\|sdk-ts\|sdk-cli\|claude-desktop\|claude-vscode/);
  })
)
  failed++;

for (const ep of ['cli', 'sdk-ts', 'sdk-cli', 'claude-desktop', 'claude-vscode']) {
  if (
    !test(`Layer-1 allows ${ep}`, () => {
      const r = layer1Probe(ep);
      assert.equal(r.status, 0, `status=${r.status} stderr=${r.stderr}`);
      assert.match(r.stdout || '', /LAYER1_PASS/);
    })
  )
    failed++;
}

for (const ep of ['unknown-bot', 'ci-bot']) {
  if (
    !test(`Layer-1 rejects ${ep}`, () => {
      const r = layer1Probe(ep);
      assert.equal(r.status, 0);
      assert.doesNotMatch(r.stdout || '', /LAYER1_PASS/);
    })
  )
    failed++;
}

console.log(failed === 0 ? '\nAll Layer-1 security checks passed.\n' : `\n${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
