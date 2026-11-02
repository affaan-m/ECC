#!/usr/bin/env node
/**
 * Runs the documented Step 6 of agents/opensource-forker.md, then the opensource-pipeline fold-in
 * block, in a throwaway dir that already holds FORK_REPORT.md / SANITIZATION_REPORT.md (as if the
 * source project shipped them, with a .gitignore that re-includes them), and checks they stay out
 * of the single published commit.
 *
 * Run with: node tests/skills/opensource-forker-history.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const NAME = 'pre-existing reports stay out of the published fork commit';

function bashBlock(file, after) {
  const section = fs.readFileSync(path.join(ROOT, file), 'utf8').split(after)[1];
  assert.ok(section, `${file} is missing "${after}"`);
  const block = section.match(/```bash\n([\s\S]*?)```/);
  assert.ok(block, `no bash block after "${after}" in ${file}`);
  return block[1];
}

function run(script, dir) {
  const r = spawnSync('bash', ['-ec', script], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
    },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
}

if (process.platform === 'win32') {
  // The documented blocks are bash; a Windows temp path does not survive `cd`.
  console.log(`  - skipped: ${NAME} (bash test on Windows)`);
  console.log('\nPassed: 0');
  console.log('Failed: 0');
  process.exit(0);
}

const step6 = bashBlock('agents/opensource-forker.md', '### Step 6: Clean Git History');
const foldIn = bashBlock('skills/opensource-pipeline/SKILL.md', 'Fold changes in with:');
const publishBlock = bashBlock('skills/opensource-pipeline/SKILL.md', '#### Step 7: GitHub Publish');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oss-forker-'));
let failed = 0;
try {
  for (const f of ['README.md', 'FORK_REPORT.md', 'SANITIZATION_REPORT.md']) {
    fs.writeFileSync(path.join(dir, f), 'x\n');
  }
  // A .gitignore rule outranks .git/info/exclude, so a negation would re-include the reports.
  fs.writeFileSync(path.join(dir, '.gitignore'), '!FORK_REPORT.md\n!SANITIZATION_REPORT.md\n');

  run(step6.replaceAll('TARGET_DIR', dir), dir);
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'packaged\n');
  const out = run(foldIn.replaceAll('{STAGING_PATH}', dir), dir).trim().split('\n');
  assert.strictEqual(out.at(-1), '1', `fold-in must keep one commit, got: ${out.at(-1)}`);

  const files = spawnSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  assert.strictEqual(files, '.gitignore\nCLAUDE.md\nREADME.md', `commit must not hold the reports, got: ${files}`);
  const scanned = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  const bin = path.join(dir, '.git', 'test-bin');
  const published = path.join(dir, '.git', 'published-marker');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\ntouch "${published}"\n`, { mode: 0o755 });
  const publish = publishBlock
    .replaceAll('{STAGING_PATH}', dir)
    .replaceAll('{SCANNED_COMMIT}', scanned);
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const clean = spawnSync('bash', ['-ec', publish], { cwd: dir, encoding: 'utf8', env });
  assert.strictEqual(clean.status, 0, clean.stderr);
  assert.ok(fs.existsSync(published), 'clean scanned commit with only untracked reports should publish');
  fs.rmSync(published);
  fs.writeFileSync(path.join(dir, 'extra.txt'), 'unreviewed\n');
  const dirty = spawnSync('bash', ['-ec', publish], { cwd: dir, encoding: 'utf8', env });
  assert.notStrictEqual(dirty.status, 0, 'other untracked files must block publication');
  assert.ok(!fs.existsSync(published), 'dirty tree must not invoke gh');
  console.log(`  ✓ ${NAME}`);
} catch (err) {
  failed = 1;
  console.log(`  ✗ ${NAME}`);
  console.log(`    Error: ${err.message}`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\nPassed: ${1 - failed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed;
