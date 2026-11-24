#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const { trySymlink } = require('../lib/helpers/symlink-support');

const repoRoot = path.resolve(__dirname, '..', '..');
const commandsDir = path.join(repoRoot, 'skills', 'ck', 'commands');
let passed = 0;
let failed = 0;

function test(description, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ck-init-'));
  try {
    if (fn(home) === false) {
      console.log(`  SKIP ${description}`);
      return;
    }
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

test('saving a summary with YAML punctuation preserves the native memory name', home => {
  const project = path.join(home, 'app');
  fs.mkdirSync(project);
  runOk(home, project, 'save.mjs', ['--init'], { name: 'app', path: project });
  runOk(home, project, 'save.mjs', [], { summary: 'Fix: reconnect #42' });

  const projectsDir = path.join(home, '.claude', 'projects');
  const [projectDir] = fs.readdirSync(projectsDir);
  const memoryDir = path.join(projectsDir, projectDir, 'memory');
  const file = fs.readdirSync(memoryDir).find(name => name.startsWith('ck_') && name.endsWith('.md'));
  assert.ok(file, 'expected a native memory file');
  const markdown = fs.readFileSync(path.join(memoryDir, file), 'utf8');
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert.ok(frontmatter, 'expected YAML frontmatter');
  assert.match(yaml.load(frontmatter[1]).name, /^Session \d{4}-\d{2}-\d{2} — Fix: reconnect #42$/);
});

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

  const forget = run(home, project, 'forget.mjs', ['App Server']);
  assert.strictEqual(forget.status, 0, forget.stdout + forget.stderr);
  assert.deepStrictEqual(fs.readdirSync(contextsDir), []);
});

test('initializing with an unreadable project registry preserves the registry and saved context', home => {
  const project = path.join(home, 'app');
  const other = path.join(home, 'other');
  for (const dir of [project, other]) {
    fs.mkdirSync(dir);
    runOk(home, dir, 'save.mjs', ['--init'], { name: path.basename(dir), path: dir });
  }
  runOk(home, project, 'save.mjs', [], { summary: 'built the parser' });

  const ckDir = path.join(home, '.claude', 'ck');
  const registryFile = path.join(ckDir, 'projects.json');
  const registry = fs.readFileSync(registryFile, 'utf8');
  const contextDir = path.join(ckDir, 'contexts', 'app');
  const savedContext = fs.readFileSync(path.join(contextDir, 'context.json'));
  const savedMarkdown = fs.readFileSync(path.join(contextDir, 'CONTEXT.md'));
  const invalidRegistries = [
    registry.trimEnd().slice(0, -1),
    `\uFEFF${registry}`,
    '[]',
    JSON.stringify({ ...JSON.parse(registry), [other]: {} }),
  ];
  for (const invalid of invalidRegistries) {
    fs.writeFileSync(registryFile, invalid);
    const result = run(home, project, 'save.mjs', ['--init'], JSON.stringify({ name: 'app', path: project }));
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /projects\.json/);
    assert.strictEqual(fs.readFileSync(registryFile, 'utf8'), invalid);
    assert.deepStrictEqual(fs.readFileSync(path.join(contextDir, 'context.json')), savedContext);
    assert.deepStrictEqual(fs.readFileSync(path.join(contextDir, 'CONTEXT.md')), savedMarkdown);
  }
});

test('initializing with a dangling registry symlink preserves the link and saved context', home => {
  const project = path.join(home, 'app');
  fs.mkdirSync(project);
  const registration = { name: 'app', path: project };
  runOk(home, project, 'save.mjs', ['--init'], registration);
  runOk(home, project, 'save.mjs', [], { summary: 'checkpoint' });

  const ckDir = path.join(home, '.claude', 'ck');
  const registry = path.join(ckDir, 'projects.json');
  const missingTarget = path.join(ckDir, 'missing-registry.json');
  const contextDir = path.join(ckDir, 'contexts', 'app');
  const context = path.join(contextDir, 'context.json');
  const markdown = path.join(contextDir, 'CONTEXT.md');
  const savedContext = fs.readFileSync(context);
  const savedMarkdown = fs.readFileSync(markdown);

  fs.unlinkSync(registry);
  if (!trySymlink(missingTarget, registry, 'file')) return false;
  const linkTarget = fs.readlinkSync(registry);
  const result = run(home, project, 'save.mjs', ['--init'], JSON.stringify(registration));
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /cannot read the project registry.*projects\.json/);
  assert.strictEqual(fs.readlinkSync(registry), linkTarget);
  assert.ok(!fs.existsSync(missingTarget), 'init created the missing target');
  assert.deepStrictEqual(fs.readFileSync(context), savedContext);
  assert.deepStrictEqual(fs.readFileSync(markdown), savedMarkdown);
});

test('initializing a registered project whose context cannot be read changes nothing', home => {
  const project = path.join(home, 'app');
  fs.mkdirSync(project);
  runOk(home, project, 'save.mjs', ['--init'], { name: 'app', path: project });
  const contextFile = path.join(home, '.claude', 'ck', 'contexts', 'app', 'context.json');
  const damagedContexts = [
    '{"version": 2, "sessions": [{"summary": "built the parser"}',
    '[{"summary": "built the parser"}]',
    '{"version": 2, "sessions": [null]}',
  ];
  for (const damaged of damagedContexts) {
    fs.writeFileSync(contextFile, damaged);

    const result = run(home, project, 'save.mjs', ['--init'], JSON.stringify({ name: 'app', path: project }));
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /is not a readable ck context/);
    assert.strictEqual(fs.readFileSync(contextFile, 'utf8'), damaged);
  }
});

test('initializing a registered v1 project points to migrate until nothing is left to recover', home => {
  const project = path.join(home, 'app');
  fs.mkdirSync(project);
  const contextDir = path.join(home, '.claude', 'ck', 'contexts', 'app');
  fs.mkdirSync(contextDir, { recursive: true });
  const v1 = '# Project: app\n\n## Where I Left Off\n- wiring the parser\n';
  fs.writeFileSync(path.join(contextDir, 'CONTEXT.md'), v1);
  fs.writeFileSync(path.join(home, '.claude', 'ck', 'projects.json'), JSON.stringify({
    [project]: { name: 'app', contextDir: 'app', lastUpdated: '2026-01-01' },
  }));

  const result = run(home, project, 'save.mjs', ['--init'], JSON.stringify({ name: 'app', path: project }));
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\/ck:migrate/);
  assert.strictEqual(fs.readFileSync(path.join(contextDir, 'CONTEXT.md'), 'utf8'), v1);
  assert.ok(!fs.existsSync(path.join(contextDir, 'context.json')), 'init wrote a context.json');

  fs.rmSync(path.join(contextDir, 'CONTEXT.md'));
  runOk(home, project, 'save.mjs', ['--init'], { name: 'app', path: project });
  assert.ok(fs.existsSync(path.join(contextDir, 'context.json')), 'init did not register the project');
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
