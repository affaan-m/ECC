#!/usr/bin/env node
/**
 * Validate workflow security guardrails for privileged GitHub Actions events.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'ci', 'validate-workflow-security.js');

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

function runValidator(files) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-workflow-security-'));
  try {
    for (const [name, contents] of Object.entries(files)) {
      fs.writeFileSync(path.join(tempDir, name), contents);
    }

    return spawnSync('node', [SCRIPT_PATH], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ECC_WORKFLOWS_DIR: tempDir,
      },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function run() {
  console.log('\n=== Testing workflow security validation ===\n');

  let passed = 0;
  let failed = 0;

  if (test('allows safe workflow_run workflow that only checks out the base repository', () => {
    const result = runValidator({
      'safe.yml': `name: Safe\non:\n  workflow_run:\n    workflows: ["CI"]\n    types: [completed]\njobs:\n  repair:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo safe\n`,
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  })) passed++; else failed++;

  if (test('rejects workflow_run checkout using github.event.workflow_run.head_branch', () => {
    const result = runValidator({
      'unsafe-workflow-run.yml': `name: Unsafe\non:\n  workflow_run:\n    workflows: ["CI"]\n    types: [completed]\njobs:\n  repair:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ github.event.workflow_run.head_branch }}\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail');
    assert.match(result.stderr, /workflow_run must not checkout an untrusted workflow_run head ref\/repository/);
    assert.match(result.stderr, /head_branch/);
  })) passed++; else failed++;

  if (test('rejects workflow_run checkout using github.event.workflow_run.head_repository.full_name', () => {
    const result = runValidator({
      'unsafe-repository.yml': `name: Unsafe\non:\n  workflow_run:\n    workflows: ["CI"]\n    types: [completed]\njobs:\n  repair:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          repository: \${{ github.event.workflow_run.head_repository.full_name }}\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail');
    assert.match(result.stderr, /head_repository\.full_name/);
  })) passed++; else failed++;

  if (test('rejects pull_request_target checkout using github.event.pull_request.head.sha', () => {
    const result = runValidator({
      'unsafe-pr-target.yml': `name: Unsafe\non:\n  pull_request_target:\n    branches: [main]\njobs:\n  inspect:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail');
    assert.match(result.stderr, /pull_request_target must not checkout an untrusted pull_request head ref\/repository/);
    assert.match(result.stderr, /pull_request\.head\.sha/);
  })) passed++; else failed++;

  // Quoted action names are valid YAML. The checkout-step filter must still
  // inspect their `with.ref` values in privileged workflows.
  if (test('rejects pull_request_target checkout when uses is double-quoted', () => {
    const result = runValidator({
      'unsafe-double-quoted.yml': `name: Unsafe\non:\n  pull_request_target:\n    branches: [main]\njobs:\n  inspect:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: "actions/checkout@v4"\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail on double-quoted uses:');
    assert.match(result.stderr, /pull_request\.head\.sha/);
  })) passed++; else failed++;

  if (test('rejects pull_request_target checkout when uses is single-quoted', () => {
    const result = runValidator({
      'unsafe-single-quoted.yml': `name: Unsafe\non:\n  pull_request_target:\n    branches: [main]\njobs:\n  inspect:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: 'actions/checkout@v4'\n        with:\n          ref: \${{ github.event.pull_request.head.sha }}\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail on single-quoted uses:');
    assert.match(result.stderr, /pull_request\.head\.sha/);
  })) passed++; else failed++;

  // `refs/pull/<N>/{head,merge}` under `pull_request_target` is the canonical
  // privilege-escalation pattern that the standard `github.event.pull_request.head.*`
  // expression check did not cover. Either form pulls attacker-controlled code
  // into a privileged workflow.

  if (test('rejects pull_request_target checkout fetching refs/pull/N/merge', () => {
    const result = runValidator({
      'unsafe-pr-target-merge-ref.yml': `name: Unsafe\non:\n  pull_request_target:\n    types: [opened]\njobs:\n  inspect:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: refs/pull/\${{ github.event.pull_request.number }}/merge\n          persist-credentials: false\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail on refs/pull/N/merge under pull_request_target');
    assert.match(result.stderr, /pull_request_target must not checkout an untrusted pull_request head ref/);
  })) passed++; else failed++;

  if (test('rejects pull_request_target checkout fetching hardcoded refs/pull/N/head', () => {
    const result = runValidator({
      'unsafe-pr-target-head-ref.yml': `name: Unsafe\non:\n  pull_request_target:\njobs:\n  inspect:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          ref: refs/pull/123/head\n          persist-credentials: false\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail on hardcoded refs/pull/N/head');
    assert.match(result.stderr, /pull_request_target must not checkout an untrusted pull_request head ref/);
  })) passed++; else failed++;

  if (test('allows pull_request_target checkout of the base ref (no with.ref)', () => {
    const result = runValidator({
      'safe-pr-target-base.yml': `name: Safe\non:\n  pull_request_target:\njobs:\n  inspect:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n      - run: echo inspecting base\n`,
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  })) passed++; else failed++;

  if (test('rejects shared cache use in pull_request_target workflows', () => {
    const result = runValidator({
      'unsafe-pr-target-cache.yml': `name: Unsafe\non:\n  pull_request_target:\n    branches: [main]\njobs:\n  inspect:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/cache@v5\n        with:\n          path: ~/.npm\n          key: cache\n      - run: echo inspect\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail on pull_request_target cache use');
    assert.match(result.stderr, /pull_request_target workflows must not restore or save shared dependency caches/);
  })) passed++; else failed++;

  if (test('rejects dependency cache use in ordinary workflows', () => {
    const result = runValidator({
      'unsafe-cache.yml': `name: Unsafe\non:\n  pull_request:\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/cache@v5\n        with:\n          path: ~/.npm\n          key: cache\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail on actions/cache use');
    assert.match(result.stderr, /dependency caches are disabled during active supply-chain hardening/);
  })) passed++; else failed++;

  if (test('rejects npm ci without ignore-scripts in any workflow', () => {
    const result = runValidator({
      'unsafe-install.yml': `name: Unsafe\non:\n  pull_request:\njobs:\n  audit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail on npm ci without --ignore-scripts');
    assert.match(result.stderr, /npm ci must include --ignore-scripts/);
  })) passed++; else failed++;

  if (test('allows package-manager installs with lifecycle scripts disabled', () => {
    const result = runValidator({
      'safe-install.yml': `name: Safe\non:\n  pull_request:\njobs:\n  audit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          npm ci --ignore-scripts\n          pnpm install --ignore-scripts --no-frozen-lockfile\n          yarn install --mode=skip-build\n          bun install --ignore-scripts\n`,
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  })) passed++; else failed++;

  if (test('rejects pnpm, yarn, and bun installs that run lifecycle scripts', () => {
    const result = runValidator({
      'unsafe-matrix-install.yml': `name: Unsafe\non:\n  pull_request:\njobs:\n  audit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          pnpm install --no-frozen-lockfile\n          yarn install\n          bun install\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail on script-running installs');
    assert.match(result.stderr, /pnpm install must include --ignore-scripts/);
    assert.match(result.stderr, /yarn install must use --mode=skip-build/);
    assert.match(result.stderr, /bun install must include --ignore-scripts/);
  })) passed++; else failed++;

  if (test('rejects checkout credential persistence in workflows with write permissions', () => {
    const result = runValidator({
      'unsafe-write-checkout.yml': `name: Unsafe\non:\n  workflow_dispatch:\npermissions:\n  contents: write\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci --ignore-scripts\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail on credential-persisting checkout');
    assert.match(result.stderr, /write permissions must disable checkout credential persistence/);
  })) passed++; else failed++;

  if (test('allows checkout with disabled credential persistence in workflows with write permissions', () => {
    const result = runValidator({
      'safe-write-checkout.yml': `name: Safe\non:\n  workflow_dispatch:\npermissions:\n  contents: write\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n      - run: npm ci --ignore-scripts\n`,
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  })) passed++; else failed++;

  // `permissions: write-all` is GitHub Actions' shorthand for granting every
  // scope write access. The named-scope pattern only catches `contents: write`,
  // `issues: write`, etc., so workflows that opt into write-all were silently
  // exempted from the persist-credentials and --ignore-scripts gates.

  if (test('rejects checkout credential persistence in workflows with permissions: write-all', () => {
    const result = runValidator({
      'unsafe-write-all-checkout.yml': `name: Unsafe\non:\n  workflow_dispatch:\npermissions: write-all\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci --ignore-scripts\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail on write-all + credential-persisting checkout');
    assert.match(result.stderr, /write permissions must disable checkout credential persistence/);
  })) passed++; else failed++;

  if (test('rejects npm ci without ignore-scripts in workflows with permissions: write-all', () => {
    const result = runValidator({
      'unsafe-write-all-install.yml': `name: Unsafe\non:\n  workflow_dispatch:\npermissions: write-all\njobs:\n  audit:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n      - run: npm ci\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail on write-all + npm ci without --ignore-scripts');
    assert.match(result.stderr, /npm ci must include --ignore-scripts/);
  })) passed++; else failed++;

  if (test('allows compliant workflow with permissions: write-all', () => {
    const result = runValidator({
      'safe-write-all.yml': `name: Safe\non:\n  workflow_dispatch:\npermissions: write-all\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n      - run: npm ci --ignore-scripts\n`,
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  })) passed++; else failed++;

  if (test('rejects actions/cache in workflows with id-token write', () => {
    const result = runValidator({
      'unsafe-oidc-cache.yml': `name: Unsafe\non:\n  push:\npermissions:\n  contents: read\n  id-token: write\njobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/cache@v5\n        with:\n          path: ~/.npm\n          key: cache\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail on id-token workflow cache use');
    assert.match(result.stderr, /id-token: write must not restore or save shared dependency caches/);
  })) passed++; else failed++;

  if (test('rejects npm audit without registry signature verification', () => {
    const result = runValidator({
      'unsafe-audit.yml': `name: Unsafe\non:\n  push:\njobs:\n  audit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm audit --audit-level=high\n`,
    });
    assert.notStrictEqual(result.status, 0, 'Expected validator to fail when npm audit signatures is missing');
    assert.match(result.stderr, /npm audit must also verify registry signatures/);
  })) passed++; else failed++;

  if (test('allows npm audit when registry signatures are verified', () => {
    const result = runValidator({
      'safe-audit.yml': `name: Safe\non:\n  push:\njobs:\n  audit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          npm audit signatures\n          npm audit --audit-level=high\n`,
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

run();
