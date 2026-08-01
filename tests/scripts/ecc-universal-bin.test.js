/**
 * Published npm binary aliases for the primary ECC CLI.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
);
const packageLock = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

console.log('\n=== ECC universal npm binary tests ===\n');

test('published package exposes ecc and ecc-universal through scripts/ecc.js', () => {
  assert.strictEqual(packageJson.bin.ecc, 'scripts/ecc.js');
  assert.strictEqual(packageJson.bin['ecc-universal'], 'scripts/ecc.js');
  assert.deepStrictEqual(packageLock.packages[''].bin, packageJson.bin);

  const packResult = spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }
  );
  assert.strictEqual(
    packResult.status,
    0,
    packResult.error?.message || packResult.stderr
  );
  const packOutput = JSON.parse(packResult.stdout);
  const publishedPaths = new Set(
    packOutput[0]?.files?.map(file => file.path) || []
  );
  assert.ok(
    publishedPaths.has('scripts/ecc.js'),
    'npm package should publish the shared CLI target'
  );
});

test('packed package launches setup through the package-name command', () => {
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-universal-bin-'));
  try {
    const packResult = spawnSync(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      }
    );
    assert.strictEqual(
      packResult.status,
      0,
      packResult.error?.message || packResult.stderr
    );
    const packOutput = JSON.parse(packResult.stdout);
    const archivePath = path.join(packDir, packOutput[0].filename);
    const launchResult = spawnSync(
      'npx',
      ['--yes', `--package=${archivePath}`, 'ecc-universal', 'setup', '--help'],
      {
        cwd: packDir,
        encoding: 'utf8',
        shell: process.platform === 'win32',
      }
    );

    assert.strictEqual(
      launchResult.status,
      0,
      launchResult.error?.message || launchResult.stderr
    );
    assert.match(launchResult.stdout, /ECC guided setup/);
  } finally {
    fs.rmSync(packDir, { force: true, recursive: true });
  }
});

test('public dispatcher launches the separate multi-harness wizard', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'ecc.js'), 'install', '--guided', '--help'],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  assert.strictEqual(result.status, 0, result.error?.message || result.stderr);
  assert.match(result.stdout, /ECC guided multi-harness install/);
  assert.match(result.stdout, /Claude Code/);
  assert.match(result.stdout, /Codex/);
  assert.match(result.stdout, /Kimi/);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
