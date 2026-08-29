/**
 * Cross-platform regressions for the rules-distill and skill-stocktake scans.
 *
 * Runs through the installed Bash executable, including macOS Bash 3.2, so
 * unsupported shell options and process-substitution assumptions are visible.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const RULE_SCAN = path.join(ROOT, 'skills', 'rules-distill', 'scripts', 'scan-rules.sh');
const SKILL_SCAN = path.join(ROOT, 'skills', 'rules-distill', 'scripts', 'scan-skills.sh');
const STOCKTAKE_SCAN = path.join(ROOT, 'skills', 'skill-stocktake', 'scripts', 'scan.sh');
const BASH = process.platform === 'win32' ? 'bash' : '/bin/bash';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeSkill(file, name) {
  write(file, `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\n# ${name}\n`);
}

function run(script, env) {
  const result = spawnSync(BASH, [script], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 15000
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  assert.strictEqual(result.stderr, '', `scanner should not warn: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function main() {
  console.log('\n=== Scanner portability tests ===\n');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-scan-portability-'));

  try {
    test('rule scan handles root and deeply nested files in deterministic order', () => {
      const rules = path.join(fixture, 'rules');
      write(path.join(rules, 'root.md'), '## Root\n');
      write(path.join(rules, 'nested', 'a.md'), '## A\n');
      write(path.join(rules, 'nested', 'deeper', 'b.md'), '## B\n');
      write(path.join(rules, '_archived', 'skip.md'), '## Skip\n');

      const output = run(RULE_SCAN, {
        HOME: fixture,
        RULES_DISTILL_DIR: rules
      });
      assert.strictEqual(output.total, 3);
      assert.deepStrictEqual(output.rules.map(rule => rule.file), ['a.md', 'b.md', 'root.md']);
    });

    test('skill scan preserves lexical order past nine files and nested roots', () => {
      const global = path.join(fixture, 'global-skills');
      const project = path.join(fixture, 'project', '.claude', 'skills');
      writeSkill(path.join(global, 'SKILL.md'), 'global-root');
      for (let index = 1; index <= 12; index += 1) {
        const label = `skill-${String(index).padStart(2, '0')}`;
        writeSkill(path.join(global, label, 'SKILL.md'), label);
      }
      writeSkill(path.join(global, 'team', 'deep', 'SKILL.md'), 'team-deep');
      writeSkill(path.join(project, 'project skill', 'SKILL.md'), 'project-space');

      const output = run(SKILL_SCAN, {
        HOME: fixture,
        RULES_DISTILL_GLOBAL_DIR: global,
        RULES_DISTILL_PROJECT_DIR: project
      });
      assert.strictEqual(output.scan_summary.global.count, 14);
      assert.strictEqual(output.scan_summary.project.count, 1);
      const globalPaths = output.skills.slice(0, 14).map(skill => skill.path);
      assert.deepStrictEqual(globalPaths, [...globalPaths].sort());
      assert.strictEqual(output.skills.at(-1).name, 'project-space');
    });

    test('rule and skill scans return empty inventories for empty directories', () => {
      const rules = path.join(fixture, 'empty-rules');
      const global = path.join(fixture, 'empty-global');
      const project = path.join(fixture, 'empty-project', '.claude', 'skills');
      fs.mkdirSync(rules, { recursive: true });
      fs.mkdirSync(global, { recursive: true });
      fs.mkdirSync(project, { recursive: true });

      const ruleOutput = run(RULE_SCAN, {
        HOME: fixture,
        RULES_DISTILL_DIR: rules
      });
      const output = run(SKILL_SCAN, {
        HOME: fixture,
        RULES_DISTILL_GLOBAL_DIR: global,
        RULES_DISTILL_PROJECT_DIR: project
      });
      assert.deepStrictEqual(ruleOutput.rules, []);
      assert.strictEqual(ruleOutput.total, 0);
      assert.deepStrictEqual(output.skills, []);
      assert.strictEqual(output.scan_summary.global.count, 0);
      assert.strictEqual(output.scan_summary.project.count, 0);
    });

    test('stocktake preserves observation counts for paths containing spaces', () => {
      const global = path.join(fixture, 'stocktake-global');
      const skillFile = path.join(global, 'space skill', 'SKILL.md');
      const observations = path.join(fixture, 'observations.jsonl');
      writeSkill(skillFile, 'space-skill');
      const timestamp = new Date().toISOString();
      write(
        observations,
        [
          JSON.stringify({ tool: 'Read', path: skillFile, timestamp }),
          JSON.stringify({ tool: 'Read', path: skillFile, timestamp })
        ].join('\n') + '\n'
      );

      const output = run(STOCKTAKE_SCAN, {
        HOME: fixture,
        SKILL_STOCKTAKE_GLOBAL_DIR: global,
        SKILL_STOCKTAKE_PROJECT_DIR: path.join(fixture, 'missing-project'),
        SKILL_STOCKTAKE_OBSERVATIONS: observations
      });
      assert.strictEqual(output.skills.length, 1);
      assert.strictEqual(output.skills[0].use_7d, 2);
      assert.strictEqual(output.skills[0].use_30d, 2);
    });

    test('scanner sources avoid unsupported globstar and argument-sized JSON merges', () => {
      for (const script of [RULE_SCAN, SKILL_SCAN, STOCKTAKE_SCAN]) {
        const source = fs.readFileSync(script, 'utf8');
        assert.doesNotMatch(source, /shopt\s+-s\s+globstar/);
        assert.doesNotMatch(source, /<\(/, `${path.basename(script)} should not use process substitution`);
        assert.doesNotMatch(source, /--argjson\s+[gp]\b/, `${path.basename(script)} should stream inventory arrays`);
      }
    });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
