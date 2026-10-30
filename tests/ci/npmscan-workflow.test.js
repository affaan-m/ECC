'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const root = path.resolve(__dirname, '../..');
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/npmscan.yml'), 'utf8'));
const steps = workflow.jobs.scan.steps;
const guard = steps.find(step => step.id === 'input-safety');
const scanner = steps.find(step => String(step.uses || '').startsWith('NPMscan/npmscan-action@'));
assert.ok(guard && scanner, 'the external scan needs an input guard');
assert.ok(steps.indexOf(guard) < steps.indexOf(scanner));
assert.equal(scanner.if, "steps.input-safety.outputs.safe == 'true'");
assert.deepEqual(workflow.on.pull_request.paths, ['package.json', 'package-lock.json', 'yarn.lock']);
assert.equal(workflow.permissions.contents, 'read');
assert.equal(workflow.jobs.scan.permissions['pull-requests'], 'write');
assert.equal(scanner.with.mode, 'warn');
assert.equal(scanner.with['fail-on-error'], false);
assert.match(scanner.uses, /@[a-f0-9]{40}$/);

let passed = 0;
for (const kind of ['regular', 'missing', 'symlink', 'directory']) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-npmscan-inputs-'));
  const checkout = path.join(temporary, 'checkout');
  const output = path.join(temporary, 'output');
  const secret = path.join(temporary, 'synthetic-private.txt');
  fs.mkdirSync(checkout);
  fs.writeFileSync(secret, 'SYNTHETIC_PRIVATE_BYTES_FOR_LOCAL_TEST_ONLY');
  try {
    const input = path.join(checkout, 'package.json');
    if (kind === 'regular') fs.writeFileSync(input, '{"name":"fixture"}');
    if (kind === 'symlink') {
      try { fs.symlinkSync(secret, input); }
      catch (error) {
        if (process.platform === 'win32' && error.code === 'EPERM') {
          console.log('  SKIP symbolic-link fixture: Windows privilege unavailable');
          continue;
        }
        throw error;
      }
    }
    if (kind === 'directory') fs.mkdirSync(input);
    const run = spawnSync('bash', ['-e', '-c', guard.run], {
      cwd: checkout, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, GITHUB_OUTPUT: output },
    });
    assert.equal(run.status, 0, run.stderr);
    const safe = /^safe=true$/m.test(fs.readFileSync(output, 'utf8'));
    assert.equal(safe, kind === 'regular' || kind === 'missing');
    // Local stand-in for the pinned action's `cp "$file" "$after"` and POST:
    // the original unguarded read follows a checkout symlink to private bytes.
    let posted = '';
    const scannerStub = () => { if (fs.existsSync(input)) posted = fs.readFileSync(input, 'utf8'); };
    if (kind === 'symlink') {
      scannerStub();
      assert.match(posted, /SYNTHETIC_PRIVATE_BYTES/);
      posted = '';
    }
    if (safe) scannerStub();
    assert.doesNotMatch(posted, /SYNTHETIC_PRIVATE_BYTES/);
    console.log(`  PASS ${kind} input ${safe ? 'allows bounded scan' : 'skips external scan'}`);
    passed += 1;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
console.log(`Passed: ${passed}, Failed: 0`);
