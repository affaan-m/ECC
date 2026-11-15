const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const LEDGER = path.join(__dirname, '..', '..', 'skills', 'story-lifecycle', 'scripts', 'ledger.js');
const MARKER = '<!-- Derived from story files -->';
const EPIC_HEADER = '| ID | Title | Status |\n| --- | --- | --- |';
const SPRINT_HEADER = '| ID | Title | Points | Status |\n| --- | --- | --- | --- |';
const PREFIX = '# Epic: Auth flow\n\nUser introduction stays here.\n\n';
const SUFFIX = '\n## Notes\n\nKeep this user prose byte for byte.\n';
const ownedTemps = new Set();

function run(root, args) {
  const result = spawnSync(process.execPath, [LEDGER, ...args, '--root', root], {
    encoding: 'utf8', timeout: 10000,
  });
  assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

function read(root, rel) {
  return fs.readFileSync(path.join(root, '.stories', rel), 'utf8');
}

function write(root, rel, text) {
  fs.writeFileSync(path.join(root, '.stories', rel), text);
}

function apply(root, changes) {
  const input = path.join(root, 'changes.json');
  fs.writeFileSync(input, JSON.stringify(changes));
  return run(root, ['apply', '--input', input]);
}

function newRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'story-table-projection-'));
  ownedTemps.add(root);
  execFileSync('git', ['init', '-q', root]);
  run(root, ['init']);
  write(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n${EPIC_HEADER}\n`);
  return root;
}

function story(id, status = 'todo', sprint = 'unassigned') {
  return `# Story: Sign in\n\n**ID:** ${id}\n**Epic:** auth-flow\n**Sprint:** ${sprint}\n**Status:** ${status}\n**Points:** 3\n`;
}

function assertStable(root, rel, expected) {
  assert.strictEqual(read(root, rel), expected);
  assert.deepStrictEqual(run(root, ['status']).drift, []);
  assert.deepStrictEqual(run(root, ['reconcile']).written, []);
  assert.strictEqual(read(root, rel), expected);
  assert.ok(!fs.existsSync(path.join(root, '.stories', '.txn')));
  assert.ok(!fs.existsSync(path.join(root, '.stories', '.lock')));
}

const tests = [
  ...['Sign in | recover', String.raw`Sign\|in | recover`].flatMap(title => ['apply', 'reconcile'].map(command => [
    `${command} preserves title table boundaries for ${JSON.stringify(title)}`, () => {
      const root = newRepo();const [id] = run(root, ['allocate', '--epic', 'auth-flow']).ids;
      write(root, 'sprints/sprint-1.md', `# Sprint 1\n\n${MARKER}\n${SPRINT_HEADER}\n\n## Total Points: 0\n`);
      const raw = story(id, 'todo', '1').replace('Sign in', title);
      if (command === 'apply') apply(root, { create: { [`${id}.md`]: raw } });
      else { apply(root, { create: { [`${id}.md`]: story(id, 'todo', '1') } });write(root, `${id}.md`, raw);run(root, ['reconcile']); }
      const cell = title === 'Sign in | recover' ? String.raw`Sign in \| recover` : String.raw`Sign\\\|in \| recover`;
      assert.ok(read(root, 'epics/auth-flow.md').includes(`| ${id} | ${cell} | todo |\n`));
      assert.ok(read(root, 'sprints/sprint-1.md').includes(`| ${id} | ${cell} | 3 | todo |\n`));
      assert.equal(read(root, `${id}.md`), raw, 'source title bytes stay unchanged');
      assertStable(root, 'epics/auth-flow.md', read(root, 'epics/auth-flow.md'));
      assertStable(root, 'sprints/sprint-1.md', read(root, 'sprints/sprint-1.md'));
    },
  ])),
  ...['epic', 'sprint'].flatMap(kind => ['apply', 'reconcile'].flatMap(command => ['', '\n'].map(gap => [
    `${command} preserves a handwritten ${kind} table below an empty marker with gap ${JSON.stringify(gap)}`, () => {
      const root = newRepo();const rel = kind === 'epic' ? 'epics/auth-flow.md' : 'sprints/sprint-1.md';
      const prefix = kind === 'epic' ? PREFIX : '# Sprint 1\n\n';
      const handwritten = '| Owner | Note |\n| --- | --- |\n| User | Keep every byte |\n';
      const suffix = `${gap}${handwritten}${SUFFIX}${kind === 'sprint' ? '\n## Total Points: 0\n' : ''}`;
      write(root, rel, `${prefix}${MARKER}\n${suffix}`);
      if (command === 'apply') {
        const [id] = run(root, ['allocate', '--epic', 'auth-flow']).ids;
        apply(root, { create: { [`${id}.md`]: story(id) } });
      } else run(root, ['reconcile']);
      const actual = read(root, rel);assert.ok(actual.endsWith(suffix), 'handwritten table and prose must remain byte-identical');
      assert.equal(actual.split(handwritten).length, 2);assertStable(root, rel, actual);
    },
  ]))),
  ['an unrelated table immediately after derived rows survives repeat transitions', () => {
    const root = newRepo();const [id] = run(root, ['allocate', '--epic', 'auth-flow']).ids;
    const user = '| Owner | Note |\n| --- | --- |\n| User | Keep |\n';
    write(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n${EPIC_HEADER}\n${user}${SUFFIX}`);
    apply(root, { create: { [`${id}.md`]: story(id) } });
    assertStable(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n${EPIC_HEADER}\n| ${id} | Sign in | todo |\n${user}${SUFFIX}`);
  }],
  ['an EOF marker without a newline appends its table after the marker', () => {
    const root = newRepo();
    write(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}`);
    const [id] = run(root, ['allocate', '--epic', 'auth-flow']).ids;
    apply(root, { create: { [`${id}.md`]: story(id) } });
    assertStable(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n${EPIC_HEADER}\n| ${id} | Sign in | todo |\n`);
  }],
  ['an empty EOF marker with trailing spaces remains after user prose', () => {
    const root = newRepo();
    write(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}  `);
    run(root, ['reconcile']);
    assertStable(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}  \n${EPIC_HEADER}\n`);
  }],
  ...['\n', ' \t\n\n', '\r\n \t\r\n'].map(gap => [
    `blank whitespace ${JSON.stringify(gap)} before an epic table is preserved without duplicates`, () => {
      const root = newRepo();
      const [id] = run(root, ['allocate', '--epic', 'auth-flow']).ids;
      write(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n${gap}${EPIC_HEADER}\n| stale-99 | Old row | done |\n${SUFFIX}`);
      apply(root, { create: { [`${id}.md`]: story(id) } });
      assertStable(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n${gap}${EPIC_HEADER}\n| ${id} | Sign in | todo |\n${SUFFIX}`);
    },
  ]),
  ['a sprint transition replaces a whitespace-separated table and updates total points', () => {
    const root = newRepo();
    const [id] = run(root, ['allocate', '--epic', 'auth-flow']).ids;
    const prefix = `# Sprint 1\n\n${MARKER}\n \t\n`;
    const suffix = `\n## Total Points: 99\n${SUFFIX}`;
    apply(root, { create: { [`${id}.md`]: story(id),
      'sprints/sprint-1.md': `${prefix}${SPRINT_HEADER}\n| stale-99 | Old row | 99 | done |\n${suffix}` } });
    apply(root, { update: { [`${id}.md`]: story(id, 'in-progress', '1') } });
    assertStable(root, 'sprints/sprint-1.md', `${prefix}${SPRINT_HEADER}\n| ${id} | Sign in | 3 | in-progress |\n${suffix.replace('99', '3')}`);
  }],
  ['reconciliation removes consecutive stale copies of the same derived table', () => {
    const root = newRepo();
    const [id] = run(root, ['allocate', '--epic', 'auth-flow']).ids;
    apply(root, { create: { [`${id}.md`]: story(id) } });
    const current = `${EPIC_HEADER}\n| ${id} | Sign in | todo |\n`;
    const stale = '|ID|Title|Status|\n|---|---|---|\n| stale-99 | Old row | done |\n';
    write(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n${current}\n ${'\t'}\n${stale}\n${stale}${SUFFIX}`);
    assert.deepStrictEqual(run(root, ['status']).drift, ['epics/auth-flow.md']);
    run(root, ['reconcile']);
    assertStable(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n${current}${SUFFIX}`);
  }],
  ['unrelated tables and a later table after prose stay byte-identical', () => {
    const root = newRepo();
    const [id] = run(root, ['allocate', '--epic', 'auth-flow']).ids;
    const userTables = `\n| Owner | Note |\n| --- | --- |\n| User | Keep |\n${SUFFIX}\n${EPIC_HEADER}\n| example-1 | User example | done |\n`;
    write(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n${EPIC_HEADER}\n${userTables}`);
    apply(root, { create: { [`${id}.md`]: story(id) } });
    assertStable(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n${EPIC_HEADER}\n| ${id} | Sign in | todo |\n${userTables}`);
  }],
  ['a stale table ending at EOF is replaced without adding another table', () => {
    const root = newRepo();
    write(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n\n${EPIC_HEADER}\n| stale-99 | Old row | done |`);
    run(root, ['reconcile']);
    assertStable(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n\n${EPIC_HEADER}\n`);
  }],
  ['the initial derived table can use compact Markdown header spacing', () => {
    const root = newRepo();
    write(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n \t\n|ID|Title|Status|\n|---|---|---|\n|stale-99|Old row|done|\n${SUFFIX}`);
    run(root, ['reconcile']);
    assertStable(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n \t\n${EPIC_HEADER}\n${SUFFIX}`);
  }],
  ['inserting a missing table leaves blank lines and following prose intact', () => {
    const root = newRepo();
    const suffix = ` \t\n\n${SUFFIX}`;
    write(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n${suffix}`);
    run(root, ['reconcile']);
    assertStable(root, 'epics/auth-flow.md', `${PREFIX}${MARKER}\n${EPIC_HEADER}\n${suffix}`);
  }],
];

let passed = 0;
let failed = 0;
console.log('\n=== Testing story-lifecycle table projection workflows ===\n');
for (const [name, test] of tests) {
  try {
    test();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}\n    Error: ${error.message}`);
    failed++;
  } finally {
    for (const dir of ownedTemps) fs.rmSync(dir, { recursive: true, force: true });
    ownedTemps.clear();
  }
}
console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
