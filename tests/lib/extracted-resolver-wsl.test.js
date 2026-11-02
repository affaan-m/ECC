'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
let passed = 0;
let failed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
// These tests execute extracted JavaScript with simulated POSIX path/OS/filesystem APIs.
// Serialized Bash quoting is covered separately by serialized-hook-wsl.test.js.
test('INLINE_RESOLVE extracted expression converts Windows CLAUDE_CONFIG_DIR on simulated WSL', () => {
  const { INLINE_RESOLVE } = require('../../scripts/lib/resolve-ecc-root');
  // INLINE_RESOLVE is formatted for embedding inside bash double-quoted `node -e "..."` strings,
  // where `\\\\` is unescaped by the shell to `\\` before Node parses the JS source.
  const jsResolveExpr = INLINE_RESOLVE.replace(/\\\\\\\\/g, '\\\\');
  const scriptContent = `
    'use strict';
    const Module = require('module');
    const realOs = require('os');
    const realFs = require('fs');
    const posixPath = require('path').posix;
    const mockedFs = new Proxy(realFs, {
      get(target, prop) {
        if (prop === 'readdirSync') return () => [];
        if (prop === 'readFileSync') {
          return function(fp, enc) {
            if (fp === '/proc/version') return 'Linux version 5.15.0-microsoft-standard-WSL2';
            return target.readFileSync(fp, enc);
          };
        }
        return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
      },
    });
    const mockedOs = new Proxy(realOs, {
      get(target, prop) {
        if (prop === 'platform') return () => 'linux';
        if (prop === 'homedir') return () => '/home/wsluser';
        return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
      },
    });
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'fs') return mockedFs;
      if (request === 'os') return mockedOs;
      if (request === 'path') return posixPath;
      if (request.endsWith('/scripts/lib/resolve-ecc-root')) {
        const error = new Error('No installed resolver in this fixture');
        error.code = 'MODULE_NOT_FOUND';
        throw error;
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    process.env.CLAUDE_PLUGIN_ROOT = '';
    process.env.CLAUDE_CONFIG_DIR = 'C:\\\\Users\\\\x\\\\.claude';
    const result = ${jsResolveExpr};
    process.stdout.write(result + '\\n');
  `;

  const result = spawnSync(process.execPath, ['-e', scriptContent], { encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  assert.strictEqual(result.status, 0, `Resolver subprocess failed: ${result.stderr}`);
  assert.strictEqual(result.stdout.trim(), '/mnt/c/Users/x/.claude');
});

test('codex-hooks.json extracted resolver converts Windows CLAUDE_CONFIG_DIR to /mnt/... on simulated WSL', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', 'codex-hooks.json'), 'utf8'));
  const hookEvents = config.hooks || {};

  let hookResolverJS = null;
  outer: for (const entries of Object.values(hookEvents)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry.hooks) continue;
      for (const hook of entry.hooks) {
        if (typeof hook.command !== 'string') continue;
        if (hook.command.includes('CLAUDE_CONFIG_DIR') && hook.command.includes('proc/version')) {
          const m = hook.command.match(/const r=(\(function\(\)\{.*?\}\)\(\))/s);
          if (m) { hookResolverJS = m[1]; break outer; }
        }
      }
    }
  }
  assert.ok(hookResolverJS, 'Could not extract inline resolver IIFE from codex-hooks.json');
  const jsResolveExpr = hookResolverJS.replace(/\\\\\\\\/g, '\\\\');

  const scriptContent = `
    'use strict';
    const Module = require('module');
    const realOs = require('os');
    const realFs = require('fs');
    const posixPath = require('path').posix;
    const mockedFs = new Proxy(realFs, {
      get(target, prop) {
        if (prop === 'readdirSync') return () => [];
        if (prop === 'readFileSync') {
          return function(fp, enc) {
            if (fp === '/proc/version') return 'Linux version 5.15.0-microsoft-standard-WSL2';
            return target.readFileSync(fp, enc);
          };
        }
        return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
      },
    });
    const mockedOs = new Proxy(realOs, {
      get(target, prop) {
        if (prop === 'platform') return () => 'linux';
        if (prop === 'homedir') return () => '/home/wsluser';
        return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
      },
    });
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'fs') return mockedFs;
      if (request === 'os') return mockedOs;
      if (request === 'path') return posixPath;
      if (request.endsWith('/scripts/lib/resolve-ecc-root')) {
        const error = new Error('No installed resolver in this fixture');
        error.code = 'MODULE_NOT_FOUND';
        throw error;
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    process.env.CLAUDE_PLUGIN_ROOT = '';
    process.env.CLAUDE_CONFIG_DIR = 'C:\\\\Users\\\\test\\\\.claude';
    const r = ${jsResolveExpr};
    process.stdout.write(r + '\\n');
  `;

  const result = spawnSync(process.execPath, ['-e', scriptContent], { encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  assert.strictEqual(result.status, 0, `Hook resolver subprocess failed: ${result.stderr}`);
  assert.strictEqual(result.stdout.trim(), '/mnt/c/Users/test/.claude');
});


console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
