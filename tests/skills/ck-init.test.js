#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const commandsDir = path.join(repoRoot, 'skills', 'ck', 'commands');
let passed = 0;
let failed = 0;

function test(description, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ck-init-'));
  try {
    fn(home);
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${description}: ${error.message}`);
    failed++;
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function run(home, project, script, args = [], input = '') {
  return spawnSync(process.execPath, [path.join(commandsDir, script), ...args], {
    encoding: 'utf8',
    input,
    cwd: project,
    env: { ...process.env, HOME: home, USERPROFILE: home, PWD: project },
  });
}

function runOk(home, project, script, args, payload) {
  const result = run(home, project, script, args, JSON.stringify(payload));
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
}

console.log('\nck init tests:');

test('initializing a registered project again keeps its saved sessions', home => {
  const project = path.join(home, 'app');
  fs.mkdirSync(project);
  runOk(home, project, 'save.mjs', ['--init'], { name: 'app', path: project, goal: 'ship v1' });
  const contextFile = path.join(home, '.claude', 'ck', 'contexts', 'app', 'context.json');
  const registered = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
  fs.writeFileSync(contextFile, JSON.stringify({ ...registered, createdAt: '2026-01-01' }));
  runOk(home, project, 'save.mjs', [], {
    summary: 'built the parser',
    decisions: [{ what: 'use sqlite', why: 'no server' }],
  });

  runOk(home, project, 'save.mjs', ['--init'], { name: 'app', path: project, goal: 'ship v2' });

  const context = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
  assert.strictEqual(context.goal, 'ship v2');
  assert.strictEqual(context.createdAt, '2026-01-01');
  assert.deepStrictEqual(context.sessions.map(s => s.summary), ['built the parser']);
  assert.deepStrictEqual(context.sessions[0].decisions, [{ what: 'use sqlite', why: 'no server' }]);
});

test('initializing a registered project under a new name keeps its context directory', home => {
  const project = path.join(home, 'app');
  fs.mkdirSync(project);
  runOk(home, project, 'save.mjs', ['--init'], { name: 'app', path: project });
  runOk(home, project, 'save.mjs', [], { summary: 'built the parser' });

  runOk(home, project, 'save.mjs', ['--init'], { name: 'App Server', path: project });

  const contextsDir = path.join(home, '.claude', 'ck', 'contexts');
  assert.deepStrictEqual(fs.readdirSync(contextsDir), ['app']);
  const context = JSON.parse(fs.readFileSync(path.join(contextsDir, 'app', 'context.json'), 'utf8'));
  assert.strictEqual(context.displayName, 'App Server');
  assert.deepStrictEqual(context.sessions.map(s => s.summary), ['built the parser']);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
