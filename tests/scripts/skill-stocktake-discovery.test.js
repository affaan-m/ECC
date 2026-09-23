#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scanScript = path.join(repoRoot, 'skills', 'skill-stocktake', 'scripts', 'scan.sh');
const quickDiffScript = path.join(repoRoot, 'skills', 'skill-stocktake', 'scripts', 'quick-diff.sh');

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${description}: ${error.message}`);
    failed++;
  }
}

function writeSkill(skillDir, name) {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test fixture\n---\n# ${name}\n`,
  );
}

function runBash(scriptPath, args, env) {
  return spawnSync('bash', [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

console.log('\nSkill stocktake discovery tests:');

test('both scanners use canonical, error-visible, NUL-delimited discovery', () => {
  for (const scriptPath of [scanScript, quickDiffScript]) {
    const source = fs.readFileSync(scriptPath, 'utf8');
    assert.match(source, /find -L "\$dir"/);
    assert.match(source, /-name "SKILL\.md" -type f -print0/);
    assert.match(source, /sort_nul_file "\$find_out"/);
    assert.match(source, /records\.sort\(Buffer\.compare\)/);
    assert.doesNotMatch(source, /sort -z/, `${path.basename(scriptPath)} still requires GNU sort`);
    assert.match(source, /read -r -d '' file/);
    assert.doesNotMatch(source, /find [^\n]*2>\/dev\/null/, `${path.basename(scriptPath)} still hides find errors`);
  }
});

if (process.platform === 'win32') {
  console.log('  ↷ POSIX symlink and newline-path integration cases skipped on Windows');
} else {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-stocktake-'));
  try {
    const projectSkills = path.join(tempRoot, 'project', '.claude', 'skills');
    const directSkill = path.join(projectSkills, 'direct skill');
    const linkedTarget = path.join(tempRoot, 'shared', 'linked-skill');
    const newlineSkill = path.join(projectSkills, 'newline\nskill');
    const resultsPath = path.join(tempRoot, 'results.json');
    const observationsPath = path.join(tempRoot, 'observations.jsonl');

    writeSkill(directSkill, 'direct-skill');
    writeSkill(linkedTarget, 'linked-skill');
    writeSkill(newlineSkill, 'newline-skill');
    fs.symlinkSync(linkedTarget, path.join(projectSkills, 'linked-skill'), 'dir');
    fs.mkdirSync(path.join(directSkill, 'references'), { recursive: true });
    fs.writeFileSync(path.join(directSkill, 'references', 'notes.md'), '# supporting notes\n');
    fs.writeFileSync(
      resultsPath,
      JSON.stringify({ evaluated_at: '2099-01-01T00:00:00Z', skills: [] }),
    );
    fs.writeFileSync(
      observationsPath,
      `${JSON.stringify({
        tool: 'Read',
        path: path.join(newlineSkill, 'SKILL.md'),
        timestamp: new Date().toISOString(),
      })}\n${JSON.stringify({
        tool: 'Read',
        path: path.join(directSkill, 'SKILL.md'),
        timestamp: new Date().toISOString(),
      })}\n`,
    );

    const env = {
      SKILL_STOCKTAKE_GLOBAL_DIR: path.join(tempRoot, 'missing-global'),
      SKILL_STOCKTAKE_PROJECT_DIR: projectSkills,
      SKILL_STOCKTAKE_OBSERVATIONS: observationsPath,
    };

    test('scan follows symlinked skills and ignores nested Markdown assets', () => {
      const result = runBash(scanScript, [], env);
      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.scan_summary.project.count, 3);
      assert.deepStrictEqual(
        output.skills.map(skill => skill.name).sort(),
        ['direct-skill', 'linked-skill', 'newline-skill'],
      );
      const newlineEntry = output.skills.find(skill => skill.name === 'newline-skill');
      assert.strictEqual(newlineEntry.use_7d, 1);
      assert.strictEqual(newlineEntry.use_30d, 1);
      const spaceEntry = output.skills.find(skill => skill.name === 'direct-skill');
      assert.strictEqual(spaceEntry.use_7d, 1);
      assert.strictEqual(spaceEntry.use_30d, 1);
    });

    test('quick diff keeps newline-containing skill paths as one record', () => {
      const result = runBash(quickDiffScript, [resultsPath], env);
      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.length, 3);
      assert.strictEqual(
        output.filter(entry => entry.path.includes('newline\nskill/SKILL.md')).length,
        1,
      );
      assert.ok(output.every(entry => entry.is_new === true));
    });

    test('quick diff recognizes a cached newline-containing path', () => {
      fs.writeFileSync(
        resultsPath,
        JSON.stringify({
          evaluated_at: '2099-01-01T00:00:00Z',
          skills: [{ path: path.join(newlineSkill, 'SKILL.md') }],
        }),
      );
      const result = runBash(quickDiffScript, [resultsPath], env);
      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.length, 2);
      assert.ok(output.every(entry => !entry.path.includes('newline\nskill/SKILL.md')));
    });
  } catch (error) {
    console.log(`  ✗ fixture setup: ${error.message}`);
    failed++;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}


if (process.platform !== 'win32') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-stocktake-inventory-'));
  try {
    const globalSkills = path.join(tempRoot, 'global', '.claude', 'skills');
    const projectSkills = path.join(tempRoot, 'project', '.claude', 'skills');
    const liveSkills = [
      [path.join(globalSkills, 'active'), 'global-active'],
      [path.join(globalSkills, '.trash-archive'), 'global-trash-archive'],
      [path.join(projectSkills, 'active'), 'project-active'],
      [path.join(projectSkills, '.trashcan'), 'project-trashcan'],
      [path.join(projectSkills, 'space skill'), 'space-skill'],
      [path.join(projectSkills, 'newline\nskill'), 'newline-skill'],
    ];
    for (const [skillDir, name] of liveSkills) writeSkill(skillDir, name);
    for (const [scope, skillsDir] of [['global', globalSkills], ['project', projectSkills]]) {
      writeSkill(path.join(skillsDir, '.trash', 'deleted'), `${scope}-deleted`);
      writeSkill(path.join(skillsDir, 'bundle', '.trash', 'nested'), `${scope}-nested-deleted`);
    }
    const linkedTarget = path.join(tempRoot, 'shared', 'linked');
    const linkedSkill = path.join(projectSkills, 'linked');
    writeSkill(linkedTarget, 'linked-skill');
    fs.symlinkSync(linkedTarget, linkedSkill, 'dir');
    const expectedPaths = [...liveSkills.map(([skillDir]) => path.join(skillDir, 'SKILL.md')),
      path.join(linkedSkill, 'SKILL.md')].sort();
    const resultsPath = path.join(tempRoot, 'results.json');
    fs.writeFileSync(resultsPath, JSON.stringify({ evaluated_at: '2099-01-01T00:00:00Z', skills: [] }));
    const emptyObservations = path.join(tempRoot, 'empty-observations.jsonl');
    fs.writeFileSync(emptyObservations, '');
    const env = {
      SKILL_STOCKTAKE_GLOBAL_DIR: globalSkills,
      SKILL_STOCKTAKE_PROJECT_DIR: projectSkills,
      SKILL_STOCKTAKE_OBSERVATIONS: path.join(tempRoot, 'missing-observations.jsonl'),
    };

    test('scan excludes root and nested .trash directories in both scopes, preserving live skills', () => {
      const result = runBash(scanScript, [], env);
      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.deepStrictEqual(output.skills.map(skill => skill.path).sort(), expectedPaths);
      assert.strictEqual(output.scan_summary.global.count, 2);
      assert.strictEqual(output.scan_summary.project.count, 5);
    });

    test('quick diff excludes .trash in both scopes while preserving similarly named and linked skills', () => {
      const result = runBash(quickDiffScript, [resultsPath], env);
      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.deepStrictEqual(output.map(skill => skill.path).sort(), expectedPaths);
      assert.ok(output.every(skill => skill.is_new === true));
    });

    for (const name of ['project-active', 'space-skill', 'newline-skill']) {
      test(`scan reports unknown usage for ${name} when observations are missing`, () => {
        const result = runBash(scanScript, [], env);
        assert.strictEqual(result.status, 0, result.stderr);
        const skill = JSON.parse(result.stdout).skills.find(entry => entry.name === name);
        assert.ok(skill, `missing live skill: ${name}`);
        assert.strictEqual(skill.use_7d, null);
        assert.strictEqual(skill.use_30d, null);
      });
    }

    test('scan reports numeric zero for unobserved skills when an empty observation file exists', () => {
      const result = runBash(scanScript, [], { ...env, SKILL_STOCKTAKE_OBSERVATIONS: emptyObservations });
      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.ok(output.skills.length > 0);
      for (const skill of output.skills) {
        assert.strictEqual(skill.use_7d, 0, skill.path);
        assert.strictEqual(skill.use_30d, 0, skill.path);
      }
    });

    test('scan preserves exact usage counts and date windows for normal and whitespace paths', () => {
      const observationsPath = path.join(tempRoot, 'matching-observations.jsonl');
      const observedPaths = [path.join(linkedSkill, 'SKILL.md'),
        ...liveSkills.filter(([, name]) => ['space-skill', 'newline-skill'].includes(name))
          .map(([skillDir]) => path.join(skillDir, 'SKILL.md'))];
      const timestamp = days => new Date(Date.now() - days * 86400000).toISOString();
      const observations = observedPaths.flatMap(skillPath => [
        { tool: 'Read', path: skillPath, timestamp: timestamp(0) },
        { tool: 'Read', path: skillPath, timestamp: timestamp(1) },
        { tool: 'Read', path: skillPath, timestamp: timestamp(10) },
        { tool: 'Read', path: skillPath, timestamp: timestamp(40) },
        { tool: 'Write', path: skillPath, timestamp: timestamp(0) },
        { tool: 'Read', path: `${skillPath}.backup`, timestamp: timestamp(0) },
      ]);
      fs.writeFileSync(observationsPath, `${observations.map(record => JSON.stringify(record)).join('\n')}\n`);
      const result = runBash(scanScript, [], { ...env, SKILL_STOCKTAKE_OBSERVATIONS: observationsPath });
      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      for (const skillPath of observedPaths) {
        const skill = output.skills.find(entry => entry.path === skillPath);
        assert.ok(skill, `missing observed skill: ${skillPath}`);
        assert.strictEqual(skill.use_7d, 2, skillPath);
        assert.strictEqual(skill.use_30d, 3, skillPath);
      }
      const unobserved = output.skills.find(entry => entry.name === 'global-active');
      assert.strictEqual(unobserved.use_7d, 0);
      assert.strictEqual(unobserved.use_30d, 0);
    });
  } catch (error) {
    console.log(`  ✗ inventory fixture setup: ${error.message}`);
    failed++;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
