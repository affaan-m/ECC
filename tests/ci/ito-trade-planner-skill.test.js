/**
 * Contract tests for the installable Itô trade-planner skill.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

function main() {
  console.log('\n=== Testing Itô trade-planner skill surface ===\n');

  const skill = read('skills/ito-trade-planner/SKILL.md');
  const tests = [
    ['has portable discovery metadata and representative triggers', () => {
      assert.match(skill, /^---\nname: ito-trade-planner\ndescription: [^\n]+\nmetadata:\n {2}origin: ECC\n---/);
      for (const trigger of ['trade plan', 'planning worksheet', 'venue comparison', 'basket adjustment']) {
        assert.match(skill, new RegExp(trigger, 'i'), `missing trigger phrase: ${trigger}`);
      }
    }],
    ['installs with the complete risk-review dependency pack', () => {
      const modules = readJson('manifests/install-modules.json').modules;
      const module = modules.find(candidate => candidate.id === 'prediction-market-skills');
      assert.ok(module, 'prediction-market-skills module is missing');
      for (const requiredPath of [
        'skills/ito-trade-planner',
        'skills/prediction-market-risk-review',
      ]) {
        assert.ok(module.paths.includes(requiredPath), `${requiredPath} is not installed`);
      }
      assert.strictEqual(module.defaultInstall, false);
      assert.ok(readJson('package.json').files.includes('skills/ito-trade-planner/'));
    }],
    ['keeps indicative planning separate from executable behavior', () => {
      assert.match(skill, /indicative/i);
      assert.match(skill, /not executable|non-executable/i);
      assert.match(skill, /Trading is not part of this API/i);
      assert.match(skill, /do not (?:place|cancel|route|sign|submit)/i);
      assert.match(skill, /separate[^.]*explicit (?:user )?(?:approval|confirmation)/i);
      assert.match(skill, /stop[^.]*without (?:invoking|calling|opening)/i);
      assert.doesNotMatch(skill, /(?:run|invoke|call) `?ecc ito (?:find|status)/i);
    }],
    ['documents the real API-key first run and rejects invented device login', () => {
      assert.match(skill, /https:\/\/itomarkets\.com\/api\/v1/);
      assert.match(skill, /Authorization: Bearer/);
      assert.match(skill, /baskets:read/);
      assert.match(skill, /markets:read/);
      assert.match(skill, /bkt_\*/);
      assert.match(skill, /broader `ito_\*` automation key/);
      assert.match(skill, /Do not create or rotate that broader/);
      assert.match(skill, /ito-markets/);
      assert.match(skill, /Settings/i);
      assert.match(skill, /originating agent/i);
      assert.match(skill, /does not use device (?:authorization|login)/i);
      assert.match(skill, /do not use\s+`ecc ito login`/i);
      assert.match(skill, /never (?:print|log|persist)[^.]*ITO_API_KEY/i);
    }],
    ['defines structured output, provenance, and recovery states', () => {
      for (const field of [
        'plan_status', 'mode', 'hypothesis', 'markets', 'constraints',
        'data_freshness', 'risk_review', 'blocked_actions', 'next_safe_step',
      ]) {
        assert.match(skill, new RegExp(`\\b${field}\\b`), `missing output field: ${field}`);
      }
      assert.match(skill, /source URL/i);
      assert.match(skill, /retrieved_at/i);
      assert.match(skill, /timeout/i);
      assert.match(skill, /revok/i);
      assert.match(skill, /401/);
      assert.match(skill, /403/);
      assert.match(skill, /429/);
      assert.match(skill, /Retry-After/);
      assert.match(skill, /redact/i);
      assert.match(skill, /unknown/i);
    }],
    ['preserves the non-advisory disclaimer exactly', () => {
      assert.match(skill, /This is a planning worksheet, not investment or trading advice\. Review venue\n+rules and make any trading decisions yourself\./);
    }],
  ];

  let passed = 0;
  let failed = 0;
  for (const [name, fn] of tests) {
    if (runTest(name, fn)) passed += 1;
    else failed += 1;
  }
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
