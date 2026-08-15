/**
 * Tests for scripts/install-rules.js (the /install-ecc-rules CLI)
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { testAsync, banner, summary } = require('../lib/helpers/mini-test-runner');
const { main } = require('../../scripts/install-rules.js');

const REPO_ROOT = path.join(__dirname, '..', '..');

function makeTempProjectDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-install-rules-cli-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return dir;
}

function makeOutput() {
  const chunks = [];
  return {
    write: chunk => {
      chunks.push(chunk);
      return true;
    },
    text: () => chunks.join('')
  };
}

let passed = 0;
let failed = 0;

async function run(name, fn) {
  if (await testAsync(name, fn)) passed += 1;
  else failed += 1;
}

async function main_() {
  banner('install-rules CLI');

  await run('--help prints usage and exits 0', async () => {
    const output = makeOutput();
    const code = await main(['--help'], { output, errorOutput: makeOutput() });
    assert.strictEqual(code, 0);
    assert.match(output.text(), /Usage: install-rules\.js/);
  });

  await run('rejects an unknown argument', async () => {
    const errorOutput = makeOutput();
    const code = await main(['--bogus'], { output: makeOutput(), errorOutput });
    assert.strictEqual(code, 1);
    assert.match(errorOutput.text(), /Unknown argument/);
  });

  await run('rejects --target with a missing or flag-shaped value', async () => {
    const errorOutput = makeOutput();
    const code = await main(['--target', '--yes'], { output: makeOutput(), errorOutput });
    assert.strictEqual(code, 1);
    assert.match(errorOutput.text(), /--target requires a value/);
  });

  await run('defaults to the project-scoped target when --target is omitted', async () => {
    const projectRoot = makeTempProjectDir({ 'requirements.txt': 'flask\n' });
    const output = makeOutput();
    const code = await main(['--dry-run', '--json'], {
      output,
      errorOutput: makeOutput(),
      projectRoot,
      sourceRoot: REPO_ROOT
    });
    assert.strictEqual(code, 0);
    const parsed = JSON.parse(output.text());
    const installRoot = parsed.plan.installRoot || parsed.plan.targetRoot;
    assert.ok(
      installRoot.startsWith(projectRoot),
      `expected a project-scoped install root under ${projectRoot}, got ${installRoot}`
    );
  });

  await run('--dry-run --json produces a real rules-core plan without installing anything', async () => {
    const projectRoot = makeTempProjectDir({ 'requirements.txt': 'flask\n' });
    const output = makeOutput();
    const code = await main(['--target', 'claude-project', '--dry-run', '--json'], {
      output,
      errorOutput: makeOutput(),
      projectRoot,
      sourceRoot: REPO_ROOT
    });
    assert.strictEqual(code, 0);
    const parsed = JSON.parse(output.text());
    assert.deepStrictEqual(parsed.languages, ['python']);
    assert.ok(parsed.plan.operations.length > 0);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude')), 'dry-run must not create any files');
  });

  await run('refuses to install without --yes outside an interactive terminal', async () => {
    const projectRoot = makeTempProjectDir({ 'requirements.txt': 'flask\n' });
    const errorOutput = makeOutput();
    const code = await main(['--target', 'claude-project'], {
      output: makeOutput(),
      errorOutput,
      projectRoot,
      sourceRoot: REPO_ROOT,
      interactive: false
    });
    assert.strictEqual(code, 1);
    assert.match(errorOutput.text(), /--yes/);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude')), 'must not install without confirmation');
  });

  await run('an interactive "no" answer cancels without installing', async () => {
    const projectRoot = makeTempProjectDir({ 'requirements.txt': 'flask\n' });
    const output = makeOutput();
    const code = await main(['--target', 'claude-project'], {
      output,
      errorOutput: makeOutput(),
      projectRoot,
      sourceRoot: REPO_ROOT,
      interactive: true,
      confirm: async () => false
    });
    assert.strictEqual(code, 0);
    assert.match(output.text(), /Cancelled/);
    assert.ok(!fs.existsSync(path.join(projectRoot, '.claude')), 'must not install after cancellation');
  });

  await run('--json is honored on the interactive confirm-and-apply path (no --yes)', async () => {
    const projectRoot = makeTempProjectDir({ 'requirements.txt': 'flask\n' });
    const output = makeOutput();
    const code = await main(['--target', 'claude-project', '--json'], {
      output,
      errorOutput: makeOutput(),
      projectRoot,
      sourceRoot: REPO_ROOT,
      interactive: true,
      confirm: async () => true
    });
    assert.strictEqual(code, 0);
    const parsed = JSON.parse(output.text());
    assert.strictEqual(parsed.status, 'applied');
    assert.ok(parsed.result.operations.length > 0);
    assert.ok(
      fs.existsSync(path.join(projectRoot, '.claude', 'ecc', 'install-state.json')),
      'expected install-state to be written'
    );
  });

  await run('--yes installs rules-core end-to-end into a project-scoped target', async () => {
    const projectRoot = makeTempProjectDir({ 'requirements.txt': 'flask\n' });
    const output = makeOutput();
    const code = await main(['--target', 'claude-project', '--yes'], {
      output,
      errorOutput: makeOutput(),
      projectRoot,
      sourceRoot: REPO_ROOT
    });
    assert.strictEqual(code, 0);
    assert.ok(
      fs.existsSync(path.join(projectRoot, '.claude', 'rules', 'ecc', 'common')),
      'expected common rules to be installed'
    );
    assert.ok(
      fs.existsSync(path.join(projectRoot, '.claude', 'ecc', 'install-state.json')),
      'expected install-state to be written'
    );
  });

  summary(passed, failed);
}

main_();
