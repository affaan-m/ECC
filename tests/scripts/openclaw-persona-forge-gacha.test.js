const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(
  __dirname,
  '..',
  '..',
  'skills',
  'openclaw-persona-forge',
  'gacha.py'
);

function findPython() {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3']
    : ['python3', 'python'];

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function runGacha(pythonBin, arg, env = { ...process.env, PYTHONUTF8: '1' }) {
  return spawnSync(pythonBin, [SCRIPT, arg], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env,
  });
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

function assertSingleDrawOutput(result) {
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[身份\] 前世身份:/);
  assert.match(result.stdout, /\[概括\] 一句话概括:/);
}

function main() {
  console.log('\n=== Testing openclaw-persona-forge/gacha.py ===\n');

  const pythonBin = findPython();
  if (!pythonBin) {
    console.log('  PASS: skipped (python runtime unavailable)');
    return;
  }

  let passed = 0;
  let failed = 0;

  const tests = [
    ['clamps zero draws to one', () => {
      assertSingleDrawOutput(runGacha(pythonBin, '0'));
    }],
    ['clamps negative draws to one', () => {
      assertSingleDrawOutput(runGacha(pythonBin, '-3'));
    }],
    ['prints when piped stdout is not UTF-8 (Windows cp1252 default)', () => {
      const env = { ...process.env, PYTHONIOENCODING: 'cp1252' };
      delete env.PYTHONUTF8;
      assertSingleDrawOutput(runGacha(pythonBin, '1', env));
    }],
  ];

  for (const [name, fn] of tests) {
    if (runTest(name, fn)) {
      passed += 1;
    } else {
      failed += 1;
    }
  }

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main();
