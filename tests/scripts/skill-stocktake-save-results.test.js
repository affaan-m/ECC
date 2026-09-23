#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const saveScript = path.join(repoRoot, 'skills', 'skill-stocktake', 'scripts', 'save-results.sh');
let passed = 0;
let failed = 0;

function test(description, fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-stocktake-save-'));
  try {
    fn(path.join(tempRoot, 'results.json'));
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${description}: ${error.message}`);
    failed++;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function save(resultsPath, input, args = []) {
  return spawnSync('bash', [saveScript, resultsPath, ...args], {
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input),
    env: process.env,
  });
}

function readResults(resultsPath) {
  const output = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  assert.match(output.evaluated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(Math.abs(Date.now() - Date.parse(output.evaluated_at)) < 60000);
  return output;
}

console.log('\nSkill stocktake save-results tests:');

if (process.platform === 'win32') {
  console.log('  ↷ Bash integration cases skipped on Windows');
} else {
  for (const mode of [undefined, 'quick']) {
    test(`default save merges ${mode || 'legacy'} results and retains unchanged skills`, resultsPath => {
      const unchanged = { verdict: 'Keep', reason: 'unchanged skill' };
      fs.writeFileSync(resultsPath, JSON.stringify({
        evaluated_at: '2000-01-01T00:00:00Z',
        mode: 'full',
        batch_progress: { completed: 1, total: 2 },
        skills: { unchanged, updated: { verdict: 'Improve' } },
      }));
      const input = { skills: { updated: { verdict: 'Keep' }, added: { verdict: 'Keep' } } };
      if (mode) input.mode = mode;
      const result = save(resultsPath, input);
      assert.strictEqual(result.status, 0, result.stderr);
      const output = readResults(resultsPath);
      assert.deepStrictEqual(output.skills, { unchanged, ...input.skills });
      assert.strictEqual(output.mode, mode || 'full');
      assert.deepStrictEqual(output.batch_progress, { completed: 1, total: 2 });
    });
  }

  test('full-mode intermediate saves still merge completed batches for resume', resultsPath => {
    const completed = { verdict: 'Keep' };
    fs.writeFileSync(resultsPath, JSON.stringify({
      mode: 'full', batch_progress: { completed: 1, total: 2 }, skills: { completed },
    }));
    const input = {
      mode: 'full', batch_progress: { completed: 2, total: 2 }, skills: { next: { verdict: 'Improve' } },
    };
    const result = save(resultsPath, input);
    assert.strictEqual(result.status, 0, result.stderr);
    const output = readResults(resultsPath);
    assert.deepStrictEqual(output.skills, { completed, ...input.skills });
    assert.deepStrictEqual(output.batch_progress, input.batch_progress);
  });

  test('explicit replacement saves only the live inventory and drops obsolete metadata', resultsPath => {
    fs.writeFileSync(resultsPath, JSON.stringify({
      evaluated_at: '2000-01-01T00:00:00Z',
      mode: 'quick',
      batch_progress: { completed: 1, total: 2 },
      obsolete_summary: 'old cache',
      skills: {
        '~/.claude/skills/.trash/deleted/SKILL.md': { verdict: 'Keep' },
        '~/.claude/skills/removed/SKILL.md': { verdict: 'Keep' },
      },
    }));
    const input = {
      mode: 'full',
      evaluated_at: '1999-01-01T00:00:00Z',
      skills: { '~/.claude/skills/live/SKILL.md': { verdict: 'Keep' } },
    };
    const result = save(resultsPath, input, ['--replace']);
    assert.strictEqual(result.status, 0, result.stderr);
    const output = readResults(resultsPath);
    assert.deepStrictEqual(output, { ...input, evaluated_at: output.evaluated_at });
  });

  test('explicit replacement with an empty inventory removes all cached skills', resultsPath => {
    fs.writeFileSync(resultsPath, JSON.stringify({
      skills: { stale: { verdict: 'Keep' } }, batch_progress: { completed: 1, total: 2 },
    }));
    const input = { mode: 'full', skills: {} };
    const result = save(resultsPath, input, ['--replace']);
    assert.strictEqual(result.status, 0, result.stderr);
    const output = readResults(resultsPath);
    assert.deepStrictEqual(output, { ...input, evaluated_at: output.evaluated_at });
  });

  test('invalid JSON during replacement preserves the existing results byte for byte', resultsPath => {
    const original = '{\n  "skills": {"keep": {"verdict": "Keep"}}\n}\n';
    fs.writeFileSync(resultsPath, original);
    const result = save(resultsPath, '{"skills":', ['--replace']);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /not valid JSON/);
    assert.strictEqual(fs.readFileSync(resultsPath, 'utf8'), original);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(resultsPath)), ['results.json']);
  });

  test('replacement rejects absent, non-object, or multiple inventories without altering the cache', resultsPath => {
    const original = '{\n  "skills": {"keep": {"verdict": "Keep"}}\n}\n';
    const invalidInputs = ['', 'null', '[]', '{}', '{"skills":[]}', '{"skills":null}',
      '{"skills":{}}\n{"skills":{}}'];
    for (const input of invalidInputs) {
      fs.writeFileSync(resultsPath, original);
      const result = save(resultsPath, input, ['--replace']);
      assert.notStrictEqual(result.status, 0, `accepted invalid replacement: ${JSON.stringify(input)}`);
      assert.strictEqual(fs.readFileSync(resultsPath, 'utf8'), original);
      assert.deepStrictEqual(fs.readdirSync(path.dirname(resultsPath)), ['results.json']);
    }
  });

  for (const args of [[], ['--replace']]) {
    test(`${args.length ? 'replacement' : 'default'} save bootstraps a new results file`, resultsPath => {
      const input = { mode: 'full', skills: { live: { verdict: 'Keep' } } };
      const result = save(resultsPath, input, args);
      assert.strictEqual(result.status, 0, result.stderr);
      const output = readResults(resultsPath);
      assert.deepStrictEqual(output, { ...input, evaluated_at: output.evaluated_at });
    });
  }
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
