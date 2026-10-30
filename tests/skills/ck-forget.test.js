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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ck-forget-'));
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

function run(home, script, args = [], input = '') {
  return spawnSync(process.execPath, [path.join(commandsDir, script), ...args], {
    encoding: 'utf8',
    input,
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home, PWD: home },
  });
}

function init(home, name, projectPath) {
  const result = run(home, 'save.mjs', ['--init'], JSON.stringify({ name, path: projectPath }));
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
}

function contextsDir(home) {
  return path.join(home, '.claude', 'ck', 'contexts');
}

console.log('\nck forget tests:');

test('forgetting a project with a non-ASCII name keeps other projects', home => {
  init(home, 'alpha', path.join(home, 'projA'));
  init(home, 'Проект', path.join(home, 'projB'));
  const projectsFile = path.join(home, '.claude', 'ck', 'projects.json');
  const { contextDir } = JSON.parse(fs.readFileSync(projectsFile, 'utf8'))[path.join(home, 'projB')];
  const targetDir = path.join(contextsDir(home), contextDir);
  assert.ok(fs.existsSync(targetDir), 'selected project directory was not created');

  const result = run(home, 'forget.mjs', ['Проект']);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(!fs.existsSync(targetDir), 'selected project directory was not removed');
  const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
  assert.ok(!(path.join(home, 'projB') in projects), 'selected project is still registered');
  assert.ok(fs.existsSync(path.join(contextsDir(home), 'alpha', 'context.json')), 'alpha context was removed');
});

test('forget refuses to remove the contexts root for a legacy empty contextDir', home => {
  init(home, 'alpha', path.join(home, 'projA'));
  const projectsFile = path.join(home, '.claude', 'ck', 'projects.json');
  const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
  projects[path.join(home, 'projB')] = { name: 'legacy', contextDir: '', lastUpdated: '2026-01-01' };
  fs.writeFileSync(projectsFile, JSON.stringify(projects));
  fs.writeFileSync(path.join(contextsDir(home), 'context.json'), JSON.stringify({ version: 2, sessions: [] }));

  const result = run(home, 'forget.mjs', ['legacy']);
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  assert.ok(fs.existsSync(path.join(contextsDir(home), 'alpha', 'context.json')), 'alpha context was removed');
});

test('forget removes a legacy contextDir whose name starts with dots', home => {
  init(home, 'alpha', path.join(home, 'projA'));
  const projectsFile = path.join(home, '.claude', 'ck', 'projects.json');
  const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
  projects[path.join(home, 'projB')] = { name: 'legacy', contextDir: '..archive', lastUpdated: '2026-01-01' };
  fs.writeFileSync(projectsFile, JSON.stringify(projects));
  const targetDir = path.join(contextsDir(home), '..archive');
  fs.mkdirSync(targetDir);
  fs.writeFileSync(path.join(targetDir, 'context.json'), JSON.stringify({ version: 2, sessions: [] }));

  const result = run(home, 'forget.mjs', ['legacy']);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  assert.ok(!fs.existsSync(targetDir), '..archive directory was not removed');
  assert.ok(fs.existsSync(path.join(contextsDir(home), 'alpha', 'context.json')), 'alpha context was removed');
});

test('forget refuses a legacy contextDir that escapes the contexts root', home => {
  init(home, 'alpha', path.join(home, 'projA'));
  const projectsFile = path.join(home, '.claude', 'ck', 'projects.json');
  const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
  projects[path.join(home, 'projB')] = { name: 'legacy', contextDir: '../outside', lastUpdated: '2026-01-01' };
  fs.writeFileSync(projectsFile, JSON.stringify(projects));
  const outside = path.join(home, '.claude', 'ck', 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'context.json'), JSON.stringify({ version: 2, sessions: [] }));

  const result = run(home, 'forget.mjs', ['legacy']);
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  assert.ok(fs.existsSync(outside), 'directory outside the contexts root was removed');
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
