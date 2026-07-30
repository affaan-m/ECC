'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const setupScript = path.join(repoRoot, 'scripts', 'setup.js');
const eccScript = path.join(repoRoot, 'scripts', 'ecc.js');
const fakeClaudeScript = path.join(repoRoot, 'tests', 'fixtures', 'fake-claude-plugin.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function createFixture(state = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc setup cli '));
  const homeDir = path.join(root, 'home');
  const configDir = path.join(root, 'config');
  const projectRoot = path.join(root, 'project');
  const binDir = path.join(root, 'bin');
  const statePath = path.join(root, 'state.json');
  const callsPath = path.join(root, 'calls.jsonl');
  for (const dir of [homeDir, configDir, projectRoot, binDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(statePath, `${JSON.stringify({
    plugins: [],
    marketplaces: [],
    failures: [],
    ...state,
  }, null, 2)}\n`);
  const launcher = path.join(binDir, process.platform === 'win32' ? 'claude.cmd' : 'claude');
  const source = process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${fakeClaudeScript}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${fakeClaudeScript}" "$@"\n`;
  fs.writeFileSync(launcher, source);
  if (process.platform !== 'win32') fs.chmodSync(launcher, 0o755);
  return {
    root,
    homeDir,
    configDir,
    projectRoot,
    binDir,
    statePath,
    callsPath,
  };
}

function runSetup(fixture, args) {
  return spawnSync(process.execPath, [setupScript, ...args], {
    cwd: fixture.projectRoot,
    env: {
      ...process.env,
      HOME: fixture.homeDir,
      USERPROFILE: fixture.homeDir,
      CLAUDE_CONFIG_DIR: fixture.configDir,
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH || ''}`,
      ECC_TEST_CLAUDE_STATE: fixture.statePath,
      ECC_TEST_CLAUDE_CALLS: fixture.callsPath,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
}

function quoteShellArgument(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runInteractiveEccSetup(fixture) {
  if (process.platform === 'win32') {
    return null;
  }

  const command = [
    process.execPath,
    eccScript,
    'setup',
    '--dry-run',
  ];
  const scriptArgs = process.platform === 'darwin'
    ? ['-q', '-e', '/dev/null', ...command]
    : [
      '-q',
      '-e',
      '-c',
      command.map(quoteShellArgument).join(' '),
      '/dev/null',
    ];
  const pseudoTerminalCommand = ['script', ...scriptArgs]
    .map(quoteShellArgument)
    .join(' ');

  return spawnSync('sh', [
    '-c',
    `(sleep 0.1; printf '3\\n'; sleep 0.1; printf '3\\n'; sleep 0.1) | ${pseudoTerminalCommand}`,
  ], {
    cwd: fixture.projectRoot,
    env: {
      ...process.env,
      HOME: fixture.homeDir,
      USERPROFILE: fixture.homeDir,
      CLAUDE_CONFIG_DIR: fixture.configDir,
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH || ''}`,
      ECC_TEST_CLAUDE_STATE: fixture.statePath,
      ECC_TEST_CLAUDE_CALLS: fixture.callsPath,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
}

function readCalls(fixture) {
  if (!fs.existsSync(fixture.callsPath)) return [];
  return fs.readFileSync(fixture.callsPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function hasMutation(fixture) {
  return readCalls(fixture).some(argv => !(
    argv.join(' ') === 'plugin list --json'
    || argv.join(' ') === 'plugin marketplace list --json'
  ));
}

function withFixture(state, fn) {
  const fixture = createFixture(state);
  try {
    fn(fixture);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

console.log('\n=== ECC setup CLI tests ===\n');

test('fresh non-interactive plugin setup requires an explicit scope', () => {
  withFixture({}, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--hooks', 'standard',
      '--yes',
    ]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--scope/i);
    assert.strictEqual(hasMutation(fixture), false);
  });
});

test('an existing install without --scope updates its detected scope', () => {
  withFixture({
    plugins: [{ id: 'ecc@ecc', scope: 'project', enabled: true, version: '1.9.0' }],
    marketplaces: [{
      name: 'ecc',
      source: 'github',
      repo: 'affaan-m/ECC',
      scope: 'project',
    }],
  }, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--hooks', 'strict',
      '--yes',
      '--json',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.action, 'updated');
    assert.strictEqual(payload.scope, 'project');
    assert.ok(readCalls(fixture).some(argv => (
      JSON.stringify(argv) === JSON.stringify([
        'plugin', 'update', 'ecc@ecc', '--scope', 'project',
      ])
    )));
  });
});

test('invalid plugin scopes and hook preferences are rejected before inventory', () => {
  withFixture({}, fixture => {
    for (const args of [
      ['--scope', 'global', '--hooks', 'standard'],
      ['--scope', 'user', '--hooks', 'aggressive'],
    ]) {
      const result = runSetup(fixture, [
        '--mode', 'claude-plugin',
        ...args,
        '--yes',
      ]);
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /invalid/i);
    }
    assert.deepStrictEqual(readCalls(fixture), []);
  });
});

test('non-TTY mutation requires --yes', () => {
  withFixture({}, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--scope', 'user',
      '--hooks', 'standard',
    ]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--yes/i);
    assert.strictEqual(hasMutation(fixture), false);
  });
});

test('dry-run JSON emits JSON only and reads inventory without mutation', () => {
  withFixture({}, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--scope', 'local',
      '--hooks', 'minimal',
      '--dry-run',
      '--json',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(result.stdout.trim(), JSON.stringify(payload, null, 2));
    assert.strictEqual(payload.action, 'would-install');
    assert.strictEqual(payload.scope, 'local');
    assert.strictEqual(hasMutation(fixture), false);
  });
});

test('help explains native scope names in user-facing language', () => {
  const result = spawnSync(process.execPath, [setupScript, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /(?:user.{0,80}global|global.{0,80}user)/is);
  assert.match(result.stdout, /(?:project.{0,80}shared|shared.{0,80}project)/is);
  assert.match(result.stdout, /(?:local.{0,80}private|private.{0,80}local)/is);
  assert.match(result.stdout, /--hooks off\|minimal\|standard\|strict/);
});

test('ecc setup delegates to the focused setup command', () => {
  const result = spawnSync(process.execPath, [eccScript, 'setup', '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /ECC (guided )?setup/i);
  assert.match(result.stdout, /claude-plugin/);
});

test('ecc setup preserves a real terminal for the interactive wizard', () => {
  if (process.platform === 'win32') {
    return;
  }

  withFixture({}, fixture => {
    const result = runInteractiveEccSetup(fixture);
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Where should Claude enable ecc@ecc\?/);
    assert.match(result.stdout, /How should ECC hooks run\?/);
    assert.doesNotMatch(result.stdout, /Interactive setup requires a terminal/);
  });
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
