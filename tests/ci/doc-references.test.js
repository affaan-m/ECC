#!/usr/bin/env node
/**
 * Tests for the doc reference audit (scripts/ci/doc-references.js).
 *
 * A synthetic git checkout exercises the scope (tracked docs at the root and
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

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-references-'));
  write(root, 'README.md', [
    '# Fixture',
    '[guide](docs/guide.md#install) and [design](./docs/design/#overview)',
    '[ref-style]: docs/ref-style/',
    '<a href="docs/html/?tab=1">html</a>',
    '[encoded](docs/with%20space.md)',
    '[self](README.md) [external](https://example.com/docs/orphan.md)',
    '[other repo](https://github.com/someone/fork/blob/main/docs/orphan.md)',
    '[日本語](docs/ja-JP/README.md)',
    '',
  ].join('\n'));
  write(root, 'CONTRIBUTING.md', 'Conventional file, never audited.\n');
  write(root, 'ROOT-GUIDE.md', 'See [design notes](/docs/design/notes.md).\n');
  write(root, 'docs/guide.md', '# Guide\n\nUp: [readme](../README.md). Back to [guide](guide.md).\n\nSee sibling.md for more.\n');
  write(root, 'docs/sibling.md', 'Mentioned by name from the guide.\n');
  write(root, 'docs/design/README.md', 'Reached through a directory link.\n');
  write(root, 'docs/design/notes.md', 'Reached through a root-absolute link.\n');
  write(root, 'docs/ref-style/README.md', 'Reference-style directory target.\n');
  write(root, 'docs/html/README.md', 'HTML href directory target.\n');
  write(root, 'docs/with space.md', 'Percent-encoded link target.\n');
  write(root, 'docs/url-current.md', 'Current repository URL.\n');
  write(root, 'docs/url-former.md', 'Former repository URL.\n');
  write(root, 'docs/url-raw.md', 'Raw content URL.\n');
  write(root, 'docs/from-package.md', 'Named by package.json.\n');
  write(root, 'docs/from-script.md', 'Named from a nested script by its repository path.\n');
  write(root, 'docs/self-only.md', 'Only [myself](self-only.md).\n');
  write(root, 'docs/orphan.md', 'Only other hosts and repositories name this path.\n');
  write(root, 'docs/untracked-referrer.md', 'Named only by an untracked file.\n');
  write(root, 'docs/ja-JP/README.md', '[翻訳](guide.md)\n');
  write(root, 'docs/ja-JP/guide.md', 'Translated guide.\n');
  write(root, 'docs/ja-JP/skills/demo/SKILL.md', 'Translated catalog copy.\n');
  write(root, 'docs/releases/1.0.0/notes.md', 'Out of scope, but its links count: [sibling](../../sibling.md).\n');
  write(root, 'skills/demo/SKILL.md', [
    'https://github.com/affaan-m/ECC/blob/main/docs/url-current.md',
    'https://github.com/affaan-m/everything-claude-code/tree/v1/docs/url-former.md',
    'https://raw.githubusercontent.com/affaan-m/ECC/abc123/docs/url-raw.md',
    '',
  ].join('\n'));
  write(root, 'assets/logo.bin', Buffer.from('\0PNG docs/orphan.md\0'));
  write(root, 'package.json', '{"files": ["docs/from-package.md"]}\n');
  write(root, 'scripts/build.js', "const doc = 'docs/from-script.md';\n");
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  write(root, 'scratch.md', 'Untracked: docs/untracked-referrer.md and docs/orphan.md\n');
  write(root, 'docs/untracked-doc.md', 'Untracked docs are not audited.\n');
  return root;
}

function run() {
  console.log('\n=== Testing doc reference audit ===\n');
  let passed = 0;
  let failed = 0;
  const check = (name, fn) => (test(name, fn) ? passed++ : failed++);
  const root = buildFixture();
  try {
    const report = audit.collectDocReferences(root);
    const row = doc => report.docs.find(entry => entry.path === doc);
    const referrers = doc => row(doc).referrers;

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

    check('link targets resolve against the referrer, with anchors, queries and encoding removed', () => {
      assert.deepStrictEqual(referrers('docs/guide.md'), [{ file: 'README.md', line: 2 }]);
      assert.deepStrictEqual(referrers('docs/design/README.md'), [{ file: 'README.md', line: 2 }]);
      assert.deepStrictEqual(referrers('docs/design/notes.md'), [{ file: 'ROOT-GUIDE.md', line: 1 }]);
      assert.deepStrictEqual(referrers('docs/ref-style/README.md'), [{ file: 'README.md', line: 3 }]);
      assert.deepStrictEqual(referrers('docs/html/README.md'), [{ file: 'README.md', line: 4 }]);
      assert.deepStrictEqual(referrers('docs/with space.md'), [{ file: 'README.md', line: 5 }]);
      assert.deepStrictEqual(referrers('docs/ja-JP/guide.md'), [{ file: 'docs/ja-JP/README.md', line: 1 }]);
    });

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

    check('self links, other hosts or repositories, binary files and untracked referrers are not references', () => {
      assert.deepStrictEqual(report.unreferenced, [
        'ROOT-GUIDE.md',
        'docs/ja-JP/skills/demo/SKILL.md',
        'docs/orphan.md',
        'docs/self-only.md',
        'docs/untracked-referrer.md',
      ]);
    });

    check('locale trees are counted separately', () => {
      assert.strictEqual(row('docs/guide.md').locale, null);
      assert.strictEqual(row('docs/ja-JP/guide.md').locale, 'ja-JP');
      assert.deepStrictEqual(report.locales, { 'ja-JP': { total: 3, unreferenced: 1 } });
    });

    check('text report lists non-locale docs in full and summarizes locale trees', () => {
      const text = audit.formatText(report);
      assert.match(text, /exempt by convention: CONTRIBUTING\.md, README\.md\)\n/);
      assert.match(text, /No reference from another tracked file: 5\n/);
      assert.match(text, /Non-locale docs: 4 of 16 unreferenced\n {2}ROOT-GUIDE\.md\n {2}docs\/orphan\.md\n/);
      assert.match(text, / {2}docs\/ja-JP\/: 1 of 3 unreferenced\n/);
      assert.ok(!text.includes('docs/ja-JP/skills/demo/SKILL.md'), 'locale paths stay in --json');
      assert.strictEqual(audit.formatDoc(report, 'docs/missing.md'), null);
      assert.match(audit.formatDoc(report, 'docs/guide.md'), /referrers: \n {4}README\.md:2\n/);
    });

    check('CLI reports with exit 0, and rejects bad arguments, unknown docs or a non-git root with exit 1', () => {
      const cli = args => spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: 'utf8' });
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
        assert.match(result.stderr, /Cannot list tracked files/);
      } finally {
        fs.rmSync(plain, { recursive: true, force: true });
      }
    });

    check('the report is read-only: the checkout is unchanged after a run', () => {
      const snapshot = (dir, acc = []) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === '.git') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) snapshot(full, acc);
          else acc.push(`${path.relative(root, full)}:${fs.readFileSync(full, 'utf8')}`);
        }
        return acc.sort();
      };
      const before = snapshot(root);
      audit.collectDocReferences(root);
      assert.deepStrictEqual(snapshot(root), before);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

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

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
