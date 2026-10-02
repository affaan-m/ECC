'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const runner = path.join(__dirname, 'run-all.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-runner-output-'));
let passed = 0;
let failed = 0;
try {
  const preload = path.join(dir, 'fixture.cjs');
  // Execute the production runner with two controlled suite results. Avoid
  // recursively running this test or the repository suite in this regression.
  fs.writeFileSync(preload, `
    const fs = require('node:fs');
    const path = require('node:path');
    const cp = require('node:child_process');
    const vm = require('node:vm');
    const runner = ${JSON.stringify(runner)};
    const root = ${JSON.stringify(__dirname)};
    const names = ['fixture-a.test.js', 'fixture-b.test.js'];
    const fixtureFs = { ...fs,
      readdirSync: (dir, options) => path.resolve(dir) === root
      ? names.map(name => ({ name, isDirectory: () => false, isFile: () => true }))
      : fs.readdirSync(dir, options),
      existsSync: p => names.some(name => p === path.join(root, name)) || fs.existsSync(p),
    };
    const fixtureCp = { ...cp, spawnSync: (_command, args) => {
      const first = path.basename(args[0]) === names[0];
      const failure = !first && process.env.ECC_RUNNER_FIXTURE_FAILURE === '1';
      return { status: failure ? 1 : 0, signal: null, error: undefined,
        stdout: first ? 'x'.repeat(256 * 1024) + '\\nEND_BUFFERED_SUITE\\nPassed: 1\\nFailed: 0\\n'
          : (failure ? 'FAIL deliberate-fixture-failure\\nPassed: 0\\nFailed: 1\\n' : 'END_LAST_SUITE\\nPassed: 1\\nFailed: 0\\n'),
        stderr: failure ? 'fixture stderr diagnostic\\n' : '' };
    }};
    vm.runInNewContext(fs.readFileSync(runner, 'utf8'), {
      require: name => name === 'fs' || name === 'node:fs' ? fixtureFs
        : name === 'child_process' || name === 'node:child_process' ? fixtureCp : require(name),
      console, process, __dirname: path.dirname(runner), __filename: runner,
    }, { filename: runner });
  `);
  for (const failure of [false, true]) {
    try {
      const result = spawnSync(process.execPath, [preload], {
        encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, GITHUB_ACTIONS: 'true', ECC_RUNNER_FIXTURE_FAILURE: failure ? '1' : '0' },
      });
      assert.ifError(result.error);
      assert.strictEqual(result.status, failure ? 1 : 0);
      assert.ok(result.stdout.includes('END_BUFFERED_SUITE'), 'large suite output must drain');
      assert.ok(result.stdout.includes('Final Results'), 'final totals must drain');
      assert.match(result.stdout, failure ? /Failed:\s+1/ : /Total Tests:\s+2/);
      if (failure) {
        assert.ok(result.stdout.includes('fixture stderr diagnostic'));
        assert.ok(result.stdout.includes('::error file=tests/fixture-b.test.js::'));
      } else assert.ok(result.stdout.includes('END_LAST_SUITE'));
      passed++;
      console.log(`  ✓ piped ${failure ? 'failure diagnostics' : 'success output'} drain before exit`);
    } catch (error) {
      failed++;
      console.error(`  ✗ piped output (${failure ? 'failure' : 'success'}): ${error.message}`);
    }
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\nPassed: ${passed}\nFailed: ${failed}`);
process.exitCode = failed ? 1 : 0;
