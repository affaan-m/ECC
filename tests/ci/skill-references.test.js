#!/usr/bin/env node
/**
 * Tests for the skill reference audit (scripts/ci/skill-references.js).
 *
 * A synthetic checkout exercises each evidence rule and each exclusion:
 * whole-token mentions, test path/quoted/file-name evidence, fixtures,
 * prose in tests, non-test helpers and generated mirrors. A smoke run over
 * this repository checks that every reported location exists.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const audit = require('../../scripts/ci/skill-references.js');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'ci', 'skill-references.js');
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

const SKILLS = [
  'alpha', 'alpha-beta', 'api', 'cmd-only', 'agent-only', 'readme-only', 'path-test', 'win-path-test',
  'join-test', 'quoted-test', 'named-test', 'py-test', 'fixture-only', 'prose-test', 'mirror-only', 'orphan',
];

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-references-'));
  for (const name of SKILLS) write(root, `skills/${name}/SKILL.md`, `---\nname: ${name}\n---\n`);
  write(root, 'skills/not-a-skill/notes.md', 'no SKILL.md here\n');
  write(root, 'commands/do.md', '# Do\n\nUse the `cmd-only` skill.\nSee alpha-beta for more.\n');
  write(root, 'agents/reviewer.md', '---\nname: reviewer\n---\n\nLoad agent-only first.\n');
  write(root, 'README.md', '# Fixture\n\n- [api](skills/api/SKILL.md)\n- readme-only\n');
  write(root, 'tests/ci/path.test.js', "const a = read('skills/path-test/SKILL.md');\nconst b = 'skills\\\\win-path-test\\\\SKILL.md';\n");
  write(root, 'tests/skills/join.test.js', "\n\nconst p = path.join(root, 'skills', 'join-test', 'SKILL.md');\n");
  write(root, 'tests/ci/list.test.js', "// prose-test cases are described here\nfor (const skill of ['quoted-test']) check(skill);\n");
  write(root, 'tests/skills/named-test.test.js', 'assert.ok(true);\n');
  write(root, 'tests/test_py_test.py', 'def test_ok():\n    assert True\n');
  write(root, 'tests/fixtures/routing-prompts.json', '[{"skill": "fixture-only"}, {"skill": "orphan"}]\n');
  write(root, 'tests/helpers.js', "module.exports = ['orphan'];\n");
  write(root, '.agents/skills/mirror-only/SKILL.md', 'mirror-only\n');
  write(root, 'docs/de-DE/README.md', 'mirror-only\n');
  write(root, 'legacy-command-shims/commands/old.md', 'Use mirror-only.\n');
  return root;
}

function run() {
  console.log('\n=== Testing skill reference audit ===\n');
  let passed = 0;
  let failed = 0;
  const check = (name, fn) => (test(name, fn) ? passed++ : failed++);
  const root = buildFixture();
  try {
    const report = audit.collectSkillReferences(root);
    const evidence = name => report.skills.find(skill => skill.name === name).evidence;

    check('lists only skill directories that contain SKILL.md, sorted', () => {
      assert.strictEqual(report.schema, 'ecc.skill-references/v1');
      assert.deepStrictEqual(report.skills.map(skill => skill.name), [...SKILLS].sort());
      assert.strictEqual(report.total, SKILLS.length);
    });

    check('command, agent and README mentions count as whole tokens with file:line', () => {
      assert.deepStrictEqual(evidence('cmd-only').command, [{ file: 'commands/do.md', line: 3 }]);
      assert.deepStrictEqual(evidence('agent-only').agent, [{ file: 'agents/reviewer.md', line: 5 }]);
      assert.deepStrictEqual(evidence('readme-only').readme, [{ file: 'README.md', line: 4 }]);
      assert.deepStrictEqual(evidence('api').readme, [{ file: 'README.md', line: 3 }]);
      assert.deepStrictEqual(evidence('alpha-beta').command, [{ file: 'commands/do.md', line: 4 }]);
      assert.deepStrictEqual(evidence('alpha').command, [], 'alpha must not match inside alpha-beta');
    });

    check('tests count by skill path, path.join segments, quoted literals or file name', () => {
      assert.deepStrictEqual(evidence('path-test').test, [{ file: 'tests/ci/path.test.js', line: 1 }]);
      assert.deepStrictEqual(evidence('win-path-test').test, [{ file: 'tests/ci/path.test.js', line: 2 }]);
      assert.deepStrictEqual(evidence('join-test').test, [{ file: 'tests/skills/join.test.js', line: 3 }]);
      assert.deepStrictEqual(evidence('quoted-test').test, [{ file: 'tests/ci/list.test.js', line: 2 }]);
      assert.deepStrictEqual(evidence('named-test').test, [{ file: 'tests/skills/named-test.test.js', line: 1 }]);
      assert.deepStrictEqual(evidence('py-test').test, [{ file: 'tests/test_py_test.py', line: 1 }]);
    });

    check('fixtures, unquoted prose in tests, non-test helpers and mirrors are not evidence', () => {
      for (const name of ['fixture-only', 'prose-test', 'mirror-only', 'orphan']) {
        for (const kind of audit.KINDS) assert.deepStrictEqual(evidence(name)[kind], [], `${name} ${kind}`);
      }
      assert.deepStrictEqual(report.unreferenced, ['alpha', 'fixture-only', 'mirror-only', 'orphan', 'prose-test']);
    });

    check('counts are skills with at least one reference of each kind', () => {
      assert.deepStrictEqual(report.counts, { test: 6, command: 2, agent: 1, readme: 2 });
    });

    check('text report summarizes counts and lists unreferenced skills', () => {
      const text = audit.formatText(report);
      assert.match(text, /Curated skills: 16\n/);
      assert.match(text, /With evidence: test 6, command 2, agent 1, readme 2\n/);
      assert.match(text, /No test, command, agent, or README reference: 5\n {2}alpha\n {2}fixture-only\n/);
      assert.strictEqual(audit.formatSkill(report, 'missing'), null);
      assert.match(audit.formatSkill(report, 'join-test'), /test: \n {4}tests\/skills\/join\.test\.js:3\n {2}command: none/);
    });

    check('CLI reports with exit 0, and rejects bad arguments or unknown skills with exit 1', () => {
      const cli = args => spawnSync(process.execPath, [SCRIPT_PATH, ...args], { encoding: 'utf8' });
      const json = cli(['--root', root, '--json']);
      assert.strictEqual(json.status, 0, json.stderr);
      assert.deepStrictEqual(JSON.parse(json.stdout), report);
      const one = cli(['--root', root, '--skill', 'cmd-only', '--json']);
      assert.strictEqual(one.status, 0, one.stderr);
      assert.deepStrictEqual(JSON.parse(one.stdout).evidence.command, [{ file: 'commands/do.md', line: 3 }]);
      assert.strictEqual(cli(['--root', root, '--skill', 'missing']).status, 1);
      assert.strictEqual(cli(['--bogus']).status, 1);
      assert.strictEqual(cli(['--root']).status, 1);
      assert.strictEqual(cli(['--help']).status, 0);
    });

    check('the report is read-only: the checkout is unchanged after a run', () => {
      const snapshot = (dir, acc = []) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) snapshot(full, acc);
          else acc.push(`${path.relative(root, full)}:${fs.readFileSync(full, 'utf8')}`);
        }
        return acc.sort();
      };
      const before = snapshot(root);
      audit.collectSkillReferences(root);
      assert.deepStrictEqual(snapshot(root), before);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  check('this repository: every skill is reported and every location exists', () => {
    const report = audit.collectSkillReferences(REPO_ROOT);
    const skillDirs = fs.readdirSync(path.join(REPO_ROOT, 'skills'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(path.join(REPO_ROOT, 'skills', entry.name, 'SKILL.md')));
    assert.strictEqual(report.total, skillDirs.length);
    for (const skill of report.skills) {
      for (const kind of audit.KINDS) {
        for (const hit of skill.evidence[kind]) {
          const lines = fs.readFileSync(path.join(REPO_ROOT, hit.file), 'utf8').split('\n');
          assert.ok(hit.line >= 1 && hit.line <= lines.length, `${skill.name} ${hit.file}:${hit.line}`);
        }
      }
    }
    assert.deepStrictEqual(audit.collectSkillReferences(REPO_ROOT), report, 'repeat runs are identical');
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
