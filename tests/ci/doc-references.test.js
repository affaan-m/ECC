#!/usr/bin/env node
/**
 * Tests for the doc reference audit (scripts/ci/doc-references.js).
 *
 * A synthetic checkout exercises the scope (tracked docs at the root and
 * under docs/, minus docs/releases/ and conventional files), each reference
 * form, and each non-reference: self links, other repositories, binary files
 * and untracked referrers. A smoke run over this repository checks every
 * reported location.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const audit = require('../../scripts/ci/doc-references.js');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'ci', 'doc-references.js');
const REPO_ROOT = path.join(__dirname, '..', '..');
const LARGE_TEXT_BYTES = 2 * 1024 * 1024 + 1;

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

function write(root, relative, content) {
  const file = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
}

function writeReferrers(root) {
  write(root, 'README.md', [
    '# Fixture',
    '[guide](docs/guide.md#install) and [design](./docs/design/#overview)',
    '[ref-style]: docs/ref-style/',
    '<a href="docs/html/?tab=1">html</a>',
    '[encoded](docs/with%20space.md)',
    '[self](README.md) [external](https://example.com/docs/orphan.md)',
    '[other repo](https://github.com/someone/fork/blob/main/docs/orphan.md)',
    '[日本語](docs/ja-JP/README.md)',
    '[angled](<docs/angled name.md>) and [balanced](docs/guide(draft).md "title")',
    '[angled-ref]: <docs/angled ref.md>',
    '[escaped](docs/escaped\\(1.md)',
    '',
  ].join('\n'));
  write(root, 'CONTRIBUTING.md', 'Conventional file, never audited.\n');
  write(root, 'ROOT-GUIDE.md', 'See [design notes](/docs/design/notes.md).\n\n[after-blank]: docs/after-blank.md\n');
  write(root, 'docs/guide.md', '# Guide\n\nUp: [readme](../README.md). Back to [guide](guide.md).\n\nSee sibling.md for more.\n');
  write(root, 'docs/self-only.md', 'Only [myself](self-only.md).\n');
  write(root, 'docs/ja-JP/README.md', '[翻訳](guide.md)\n');
  write(root, 'docs/releases/1.0.0/notes.md', 'Out of scope, but its links count: [sibling](../../sibling.md).\n');
  write(root, 'skills/demo/SKILL.md', [
    'https://github.com/affaan-m/ECC/blob/main/docs/url-current.md',
    'https://github.com/affaan-m/everything-claude-code/tree/v1/docs/url-former.md',
    'https://raw.githubusercontent.com/affaan-m/ECC/abc123/docs/url-raw.md',
    '',
  ].join('\n'));
  write(root, 'assets/logo.bin', Buffer.from('\0PNG docs/orphan.md\0'));
  write(root, 'notes/large.txt', `${'x'.repeat(LARGE_TEXT_BYTES)}\ndocs/large-target.md\n`);
  write(root, 'tools/deleted.txt', 'docs/orphan.md\n');
  write(root, 'locked/note.txt', 'docs/guide.md\n');
  write(root, 'package.json', '{"files": ["docs/from-package.md"]}\n');
  write(root, 'scripts/build.js', "const doc = 'docs/from-script.md';\n");
}

const TARGETS = [
  'docs/sibling.md', 'docs/design/README.md', 'docs/design/notes.md', 'docs/ref-style/README.md',
  'docs/html/README.md', 'docs/with space.md', 'docs/url-current.md', 'docs/url-former.md',
  'docs/url-raw.md', 'docs/from-package.md', 'docs/from-script.md', 'docs/orphan.md',
  'docs/untracked-referrer.md', 'docs/angled name.md', 'docs/guide(draft).md', 'docs/angled ref.md',
  'docs/after-blank.md', 'docs/escaped(1.md', 'docs/large-target.md', 'docs/ja-JP/guide.md', 'docs/ja-JP/skills/demo/SKILL.md',
];

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-references-'));
  writeReferrers(root);
  for (const doc of TARGETS) write(root, doc, `Target ${doc}.\n`);
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  fs.rmSync(path.join(root, 'tools', 'deleted.txt'));
  write(root, 'scratch.md', 'Untracked: docs/untracked-referrer.md and docs/orphan.md\n');
  write(root, 'docs/untracked-doc.md', 'Untracked docs are not audited.\n');
  return root;
}

function checkScope(check, report) {
  check('audits tracked root and docs/ markdown, minus releases and conventional files', () => {
    assert.strictEqual(report.schema, 'ecc.doc-references/v1');
    assert.deepStrictEqual(report.exempt, ['CONTRIBUTING.md', 'README.md']);
    const paths = report.docs.map(entry => entry.path);
    assert.deepStrictEqual(paths, [...paths].sort());
    assert.ok(paths.includes('ROOT-GUIDE.md') && paths.includes('docs/ja-JP/skills/demo/SKILL.md'));
    for (const excluded of ['README.md', 'CONTRIBUTING.md', 'docs/releases/1.0.0/notes.md', 'skills/demo/SKILL.md', 'docs/untracked-doc.md', 'scratch.md']) {
      assert.ok(!paths.includes(excluded), excluded);
    }
    assert.strictEqual(report.total, paths.length);
  });
}

function checkLinks(check, referrers) {
  check('link targets resolve against the referrer, with anchors, queries and encoding removed', () => {
    assert.deepStrictEqual(referrers('docs/guide.md'), [{ file: 'README.md', line: 2 }, { file: 'locked/note.txt', line: 1 }]);
    assert.deepStrictEqual(referrers('docs/design/README.md'), [{ file: 'README.md', line: 2 }]);
    assert.deepStrictEqual(referrers('docs/design/notes.md'), [{ file: 'ROOT-GUIDE.md', line: 1 }]);
    assert.deepStrictEqual(referrers('docs/ref-style/README.md'), [{ file: 'README.md', line: 3 }]);
    assert.deepStrictEqual(referrers('docs/html/README.md'), [{ file: 'README.md', line: 4 }]);
    assert.deepStrictEqual(referrers('docs/with space.md'), [{ file: 'README.md', line: 5 }]);
    assert.deepStrictEqual(referrers('docs/ja-JP/guide.md'), [{ file: 'docs/ja-JP/README.md', line: 1 }]);
  });

  check('angle-bracket, balanced-parenthesis and escaped destinations keep the whole path', () => {
    assert.deepStrictEqual(referrers('docs/angled name.md'), [{ file: 'README.md', line: 9 }]);
    assert.deepStrictEqual(referrers('docs/guide(draft).md'), [{ file: 'README.md', line: 9 }]);
    assert.deepStrictEqual(referrers('docs/angled ref.md'), [{ file: 'README.md', line: 10 }]);
    assert.deepStrictEqual(referrers('docs/after-blank.md'), [{ file: 'ROOT-GUIDE.md', line: 3 }]);
    assert.deepStrictEqual(referrers('docs/escaped(1.md'), [{ file: 'README.md', line: 11 }]);
  });
}

function checkOtherReferences(check, referrers) {
  check('repository URLs under either name, path literals and out-of-scope referrers count', () => {
    assert.deepStrictEqual(referrers('docs/url-current.md'), [{ file: 'skills/demo/SKILL.md', line: 1 }]);
    assert.deepStrictEqual(referrers('docs/url-former.md'), [{ file: 'skills/demo/SKILL.md', line: 2 }]);
    assert.deepStrictEqual(referrers('docs/url-raw.md'), [{ file: 'skills/demo/SKILL.md', line: 3 }]);
    assert.deepStrictEqual(referrers('docs/from-package.md'), [{ file: 'package.json', line: 1 }]);
    assert.deepStrictEqual(referrers('docs/from-script.md'), [{ file: 'scripts/build.js', line: 1 }]);
    assert.deepStrictEqual(referrers('docs/sibling.md'), [
      { file: 'docs/guide.md', line: 5 },
      { file: 'docs/releases/1.0.0/notes.md', line: 1 },
    ]);
  });

  check('tracked text files above 2 MiB are scanned', () => {
    assert.deepStrictEqual(referrers('docs/large-target.md'), [{ file: 'notes/large.txt', line: 2 }]);
  });
}

function checkNonReferences(check, report) {
  check('self links, other hosts or repositories, binary, deleted and untracked referrers are not references', () => {
    assert.deepStrictEqual(report.unreferenced, [
      'ROOT-GUIDE.md',
      'docs/ja-JP/skills/demo/SKILL.md',
      'docs/orphan.md',
      'docs/self-only.md',
      'docs/untracked-referrer.md',
    ]);
  });

  check('locale trees are counted separately', () => {
    assert.strictEqual(report.docs.find(entry => entry.path === 'docs/guide.md').locale, null);
    assert.strictEqual(report.docs.find(entry => entry.path === 'docs/ja-JP/guide.md').locale, 'ja-JP');
    assert.deepStrictEqual(report.locales, { 'ja-JP': { total: 3, unreferenced: 1 } });
  });
}

function checkText(check, report) {
  check('text report lists non-locale docs in full and summarizes locale trees', () => {
    const text = audit.formatText(report);
    assert.match(text, /exempt by convention: CONTRIBUTING\.md, README\.md\)\n/);
    assert.match(text, /No reference from another tracked file: 5\n/);
    assert.match(text, /Non-locale docs: 4 of 22 unreferenced\n {2}ROOT-GUIDE\.md\n {2}docs\/orphan\.md\n/);
    assert.match(text, / {2}docs\/ja-JP\/: 1 of 3 unreferenced\n/);
    assert.ok(!text.includes('docs/ja-JP/skills/demo/SKILL.md'), 'locale paths stay in --json');
    assert.strictEqual(audit.formatDoc(report, 'docs/missing.md'), null);
    assert.match(audit.formatDoc(report, 'docs/design/notes.md'), /referrers: \n {4}ROOT-GUIDE\.md:1\n/);
  });
}

function cli(args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: 'utf8' });
}

function checkCli(check, root, report) {
  check('CLI reports with exit 0, and rejects bad arguments, unknown docs or a non-git root with exit 1', () => {
    const json = cli(['--root', root, '--json']);
    assert.strictEqual(json.status, 0, json.stderr);
    assert.deepStrictEqual(JSON.parse(json.stdout), report);
    const one = cli(['--root', root, '--doc', './docs/html/README.md', '--json']);
    assert.strictEqual(one.status, 0, one.stderr);
    assert.deepStrictEqual(JSON.parse(one.stdout).referrers, [{ file: 'README.md', line: 4 }]);
    assert.strictEqual(cli(['--root', root, '--doc', 'README.md']).status, 1, 'exempt files are not audited');
    assert.strictEqual(cli(['--bogus']).status, 1);
    assert.strictEqual(cli(['--doc']).status, 1);
    assert.strictEqual(cli(['--help']).status, 0);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-references-plain-'));
    try {
      const result = cli(['--root', plain]);
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /Cannot audit/);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
}

function snapshot(root, dir = root, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) snapshot(root, full, acc);
    else acc.push(`${path.relative(root, full)}:${fs.readFileSync(full, 'utf8')}`);
  }
  return acc.sort();
}

function checkReadOnly(check, root) {
  check('the report is read-only: the checkout is unchanged after a run', () => {
    const before = snapshot(root);
    audit.collectDocReferences(root);
    assert.deepStrictEqual(snapshot(root), before);
  });
}

function checkReadErrors(check, root) {
  check('an unreadable tracked referrer fails the audit instead of dropping its references', () => {
    // chmod does not block reads on Windows, and root reads through any mode.
    if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) return;
    const locked = path.join(root, 'locked');
    fs.chmodSync(locked, 0o000);
    try {
      assert.throws(() => audit.collectDocReferences(root), error => error.code === 'EACCES');
      const result = cli(['--root', root]);
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /Cannot audit .*EACCES/);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
  });
}

function checkRepository(check) {
  check('this repository: every reported location exists and repeat runs are identical', () => {
    const report = audit.collectDocReferences(REPO_ROOT);
    assert.ok(report.total > 0);
    for (const doc of report.docs) {
      assert.ok(!doc.path.startsWith('docs/releases/') && !audit.EXEMPT.includes(doc.path), doc.path);
      for (const hit of doc.referrers) {
        const lines = fs.readFileSync(path.join(REPO_ROOT, hit.file), 'utf8').split('\n');
        assert.ok(hit.line >= 1 && hit.line <= lines.length, `${doc.path} ${hit.file}:${hit.line}`);
      }
    }
    assert.deepStrictEqual(audit.collectDocReferences(REPO_ROOT), report, 'repeat runs are identical');
  });
}

function run() {
  console.log('\n=== Testing doc reference audit ===\n');
  let passed = 0;
  let failed = 0;
  const check = (name, fn) => (test(name, fn) ? passed++ : failed++);
  const root = buildFixture();
  try {
    const report = audit.collectDocReferences(root);
    const referrers = doc => report.docs.find(entry => entry.path === doc).referrers;
    checkScope(check, report);
    checkLinks(check, referrers);
    checkOtherReferences(check, referrers);
    checkNonReferences(check, report);
    checkText(check, report);
    checkCli(check, root, report);
    checkReadOnly(check, root);
    checkReadErrors(check, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  checkRepository(check);
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
