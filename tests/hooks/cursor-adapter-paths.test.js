'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const adapterPath = path.join(repoRoot, '.cursor', 'hooks', 'adapter.js');

function samePath(actual, expected) {
  assert.strictEqual(fs.realpathSync(actual), fs.realpathSync(expected));
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function withTempProject(layout, fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-cursor-adapter-'));
  const cursorHooksDir = path.join(tempRoot, '.cursor', 'hooks');
  const cursorScriptsDir = path.join(tempRoot, '.cursor', 'scripts', 'hooks');
  fs.mkdirSync(cursorHooksDir, { recursive: true });
  fs.mkdirSync(cursorScriptsDir, { recursive: true });

  fs.copyFileSync(adapterPath, path.join(cursorHooksDir, 'adapter.js'));
  fs.writeFileSync(path.join(cursorScriptsDir, 'marker.js'), 'module.exports = { marker: true };\n');

  if (layout === 'repo-root-scripts') {
    const repoScriptsDir = path.join(tempRoot, 'scripts', 'hooks');
    fs.mkdirSync(repoScriptsDir, { recursive: true });
    fs.writeFileSync(path.join(repoScriptsDir, 'marker.js'), 'module.exports = { marker: true };\n');
  }

  try {
    fn(tempRoot, path.join(cursorHooksDir, 'adapter.js'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

let passed = 0;
let failed = 0;

console.log('\ncursor adapter path resolution tests');
console.log('─'.repeat(50));

if (test('resolveScriptPath prefers installed .cursor/scripts layout', () => {
  withTempProject('cursor-only', (tempRoot, adapterFile) => {
    const adapter = require(adapterFile);
    const resolved = adapter.resolveScriptPath('scripts', 'hooks', 'marker.js');
    samePath(
      resolved,
      path.join(tempRoot, '.cursor', 'scripts', 'hooks', 'marker.js')
    );
  });
})) passed++; else failed++;

if (test('resolveScriptPath falls back to repo-root scripts layout', () => {
  withTempProject('repo-root-scripts', (tempRoot, adapterFile) => {
    fs.rmSync(path.join(tempRoot, '.cursor', 'scripts'), { recursive: true, force: true });
    const adapter = require(adapterFile);
    const resolved = adapter.resolveScriptPath('scripts', 'hooks', 'marker.js');
    samePath(
      resolved,
      path.join(tempRoot, 'scripts', 'hooks', 'marker.js')
    );
  });
})) passed++; else failed++;

if (test('getCursorFilePath reads args.filePath', () => {
  const adapter = require(adapterPath);
  assert.strictEqual(
    adapter.getCursorFilePath({ args: { filePath: '/tmp/example.m' } }),
    '/tmp/example.m'
  );
})) passed++; else failed++;

if (test('before-shell-execution-block-no-verify loads in installed layout', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-cursor-shell-'));
  const hooksDir = path.join(tempRoot, '.cursor', 'hooks');
  const scriptsDir = path.join(tempRoot, '.cursor', 'scripts');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(path.join(scriptsDir, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(scriptsDir, 'lib'), { recursive: true });

  for (const rel of [
    ['.cursor/hooks/adapter.js', '.cursor/hooks/adapter.js'],
    ['.cursor/hooks/before-shell-execution-block-no-verify.js', '.cursor/hooks/before-shell-execution-block-no-verify.js'],
    ['scripts/hooks/block-no-verify.js', '.cursor/scripts/hooks/block-no-verify.js'],
    ['scripts/lib/shell-split.js', '.cursor/scripts/lib/shell-split.js'],
  ]) {
    fs.copyFileSync(path.join(repoRoot, rel[0]), path.join(tempRoot, rel[1]));
  }

  try {
    const result = spawnSync(
      'node',
      [path.join(hooksDir, 'before-shell-execution-block-no-verify.js')],
      {
        input: JSON.stringify({ command: 'git status' }),
        encoding: 'utf8',
        cwd: tempRoot,
        timeout: 10000,
      }
    );
    assert.strictEqual(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
