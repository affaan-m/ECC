'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ecc-eval-harness-${prefix}-`));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function finish(title) {
  console.log(`\n${title}: Results: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

// npm.cmd needs a shell on Windows; invoke npm's JS entrypoint instead so
// temporary paths containing spaces or shell characters remain literal argv.
function runNpm(args, options = {}) {
  let binary = 'npm';
  let commandArgs = args;
  if (process.platform === 'win32') {
    const dirs = [path.dirname(process.execPath), ...(process.env.PATH || '').split(path.delimiter)];
    const candidates = [process.env.npm_execpath,
      ...dirs.filter(Boolean).map(dir => path.join(dir, 'node_modules/npm/bin/npm-cli.js'))];
    const cli = candidates.find(file => file && path.basename(file) === 'npm-cli.js' && fs.existsSync(file));
    if (!cli) throw new Error('npm-cli.js not found; use a Node installation with npm or run through npm');
    binary = process.execPath;
    commandArgs = [cli, ...args];
  }
  return spawnSync(binary, commandArgs, {
    encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
    ...options, shell: false,
  });
}

const fixedClock = () => new Date('2026-09-02T00:00:00.000Z');

module.exports = { test, tempDir, cleanup, finish, fixedClock, runNpm };
