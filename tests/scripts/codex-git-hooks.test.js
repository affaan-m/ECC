'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PRE_PUSH_HOOK = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'codex-git-hooks',
  'pre-push'
);
const PUSH_UPDATE = `refs/heads/main ${'1'.repeat(40)} refs/heads/main ${'2'.repeat(40)}\n`;

console.log('=== Testing Codex git hooks ===\n');

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${description}: ${error.message}`);
    failed++;
  }
}

test('pre-push leaves Python test execution to CI', () => {
  const projectMarkers = [
    ['requirements.txt', 'pytest\n'],
    ['pyproject.toml', '[tool.pytest.ini_options]\n']
  ];

  for (const [projectFile, projectContent] of projectMarkers) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-pre-push-'));
    const binDir = path.join(tempRoot, 'bin');
    const pytestMarker = path.join(tempRoot, 'pytest-ran');

    try {
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(tempRoot, projectFile), projectContent);
      fs.writeFileSync(
        path.join(binDir, 'pytest'),
        '#!/usr/bin/env bash\n: > "$PYTEST_MARKER"\nexit 42\n'
      );
      fs.chmodSync(path.join(binDir, 'pytest'), 0o755);
      spawnSync('git', ['init'], { cwd: tempRoot, stdio: 'ignore' });

      const result = spawnSync('bash', [PRE_PUSH_HOOK], {
        cwd: tempRoot,
        encoding: 'utf8',
        input: PUSH_UPDATE,
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          PYTEST_MARKER: pytestMarker
        }
      });

      assert.strictEqual(result.status, 0, `${projectFile}: ${result.stderr || result.stdout}`);
      assert.strictEqual(
        fs.existsSync(pytestMarker),
        false,
        `${projectFile}: pre-push must not invoke pytest`
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
