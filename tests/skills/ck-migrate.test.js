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

const NUMBERED_V1_CONTEXT = [
  '# Project: app',
  '',
  '## What This Is',
  'CLI tool for notes',
  '',
  '## Tech Stack',
  'Node.js, SQLite',
  '',
  '## Current Goal',
  'Ship v2',
  '',
  '## Where I Left Off',
  '1. Finished schema draft',
  '2. Wired CLI flags',
  '',
  '## Next Steps',
  '1. Add migration command',
  '2. Write integration tests',
  '10. Tag release',
  '',
  '## Blockers',
  '1. Waiting on fixture review',
  '',
  '## Do Not Do',
  '1. Do not add external dependencies',
  '- Keep zero network calls',
  '',
  '## Decisions Made',
  '| Decision | Why | Date |',
  '|----------|-----|------|',
  '| Use SQLite | Local file | 2026-01-10 |',
  '',
].join('\n');

const CRLF_V1_CONTEXT = [
  '# Project: win-app',
  '',
  '## What This Is',
  'Windows desktop helper',
  '',
  '## Tech Stack',
  '- TypeScript',
  '- Electron',
  '',
  '## Current Goal',
  'Package installer',
  '',
  '## Where I Left Off',
  'Session 1 (2026-01-05):',
  'Initial scaffold ready',
  'Session 2 (2026-01-10):',
  '- Signed binary locally',
  '',
  '## Next Steps',
  '1. Verify installer hash',
  '2. Test clean uninstall',
  '',
  '## Blockers',
  '- None',
  '',
  '## Do Not Do',
  '- Do not write to global registry',
  '',
  '## Decisions Made',
  '| Decision | Why | Date |',
  '|----------|-----|------|',
  '| Portable zip | Simpler updates | 2026-01-10 |',
  '',
].join('\r\n');

function test(description, fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ck-migrate-'));
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

function runMigrate(home, args = []) {
  return spawnSync(process.execPath, [path.join(commandsDir, 'migrate.mjs'), ...args], {
    encoding: 'utf8',
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

function seedV1Project(home, name, contextMd, meta = null) {
  const project = path.join(home, name);
  const contextDir = path.join(home, '.claude', 'ck', 'contexts', name);
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(contextDir, { recursive: true });
  fs.writeFileSync(path.join(contextDir, 'CONTEXT.md'), contextMd, 'utf8');
  if (meta !== null) {
    fs.writeFileSync(path.join(contextDir, 'meta.json'), JSON.stringify(meta), 'utf8');
  }
  fs.writeFileSync(path.join(home, '.claude', 'ck', 'projects.json'), JSON.stringify({
    [project]: { name, contextDir: name, lastUpdated: '2026-01-10' },
  }));
  return { project, contextDir };
}

console.log('\nck migrate tests:');

test('preserves numbered list items in Next Steps, Do Not Do, and Where I Left Off', home => {
  const { contextDir } = seedV1Project(home, 'app', NUMBERED_V1_CONTEXT, {
    lastUpdated: '2026-01-10',
    lastSessionId: 'deadbeef1234',
    lastSessionSummary: 'Drafted schema',
  });

  const result = runMigrate(home);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);

  const context = JSON.parse(fs.readFileSync(path.join(contextDir, 'context.json'), 'utf8'));
  assert.strictEqual(context.description, 'CLI tool for notes');
  assert.deepStrictEqual(context.stack, ['Node.js', 'SQLite']);
  assert.strictEqual(context.goal, 'Ship v2');
  assert.deepStrictEqual(context.constraints, [
    'Do not add external dependencies',
    'Keep zero network calls',
  ]);
  assert.strictEqual(context.sessions.length, 1);
  assert.strictEqual(context.sessions[0].leftOff, 'Finished schema draft\nWired CLI flags');
  assert.deepStrictEqual(context.sessions[0].nextSteps, [
    'Add migration command',
    'Write integration tests',
    'Tag release',
  ]);
  assert.deepStrictEqual(context.sessions[0].blockers, ['Waiting on fixture review']);
  assert.deepStrictEqual(context.sessions[0].decisions, [
    { what: 'Use SQLite', why: 'Local file', date: '2026-01-10' },
  ]);
});

test('keeps mixed prose and unpunctuated leading numbers intact in Where I Left Off', home => {
  const mixedMd = [
    '# Project: mixed',
    '',
    '## Where I Left Off',
    'Investigating login',
    '1. Add retries',
    '2026 release planning',
    'Keep cookie compatibility',
    '',
    '## Next Steps',
    '2026 release planning',
    '1. Ship retries',
    '',
  ].join('\n');
  const { contextDir } = seedV1Project(home, 'mixed', mixedMd);

  const result = runMigrate(home);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);

  const context = JSON.parse(fs.readFileSync(path.join(contextDir, 'context.json'), 'utf8'));
  assert.strictEqual(
    context.sessions[0].leftOff,
    'Investigating login\nAdd retries\n2026 release planning\nKeep cookie compatibility'
  );
  assert.deepStrictEqual(context.sessions[0].nextSteps, ['Ship retries']);
});

test('migrates CRLF CONTEXT.md files without dropping sections', home => {
  const { contextDir } = seedV1Project(home, 'win-app', CRLF_V1_CONTEXT);

  const result = runMigrate(home);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);

  const context = JSON.parse(fs.readFileSync(path.join(contextDir, 'context.json'), 'utf8'));
  assert.strictEqual(context.description, 'Windows desktop helper');
  assert.deepStrictEqual(context.stack, ['TypeScript', 'Electron']);
  assert.strictEqual(context.goal, 'Package installer');
  assert.deepStrictEqual(context.constraints, ['Do not write to global registry']);
  assert.strictEqual(context.sessions.length, 2);
  assert.strictEqual(context.sessions[0].date, '2026-01-05');
  assert.strictEqual(context.sessions[0].leftOff, 'Initial scaffold ready');
  assert.strictEqual(context.sessions[1].date, '2026-01-10');
  assert.strictEqual(context.sessions[1].leftOff, 'Signed binary locally');
  assert.deepStrictEqual(context.sessions[1].nextSteps, [
    'Verify installer hash',
    'Test clean uninstall',
  ]);
  assert.deepStrictEqual(context.sessions[1].blockers, []);
  assert.deepStrictEqual(context.sessions[1].decisions, [
    { what: 'Portable zip', why: 'Simpler updates', date: '2026-01-10' },
  ]);
});

test('refuses to overwrite an unreadable or non-v2 context.json', home => {
  const originalMd = '# Project: app\n\n## What This Is\nKeep me safe\n';
  const { contextDir } = seedV1Project(home, 'app', originalMd);
  const contextJsonPath = path.join(contextDir, 'context.json');
  const contextMdPath = path.join(contextDir, 'CONTEXT.md');

  for (const damaged of [
    '{"version": 2, "sessions": [{"summary": "partial"}',
    '[{"version": 2}]',
    '{"version": 3, "sessions": []}',
  ]) {
    fs.writeFileSync(contextJsonPath, damaged, 'utf8');
    fs.writeFileSync(contextMdPath, originalMd, 'utf8');

    const result = runMigrate(home);
    assert.strictEqual(result.status, 1, result.stdout + result.stderr);
    assert.strictEqual(fs.readFileSync(contextJsonPath, 'utf8'), damaged);
    assert.strictEqual(fs.readFileSync(contextMdPath, 'utf8'), originalMd);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
