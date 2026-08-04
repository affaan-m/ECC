/**
 * Tests for scripts/observability-readiness.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'observability-readiness.js');
const { buildReport, parseArgs } = require(SCRIPT);

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeFile(rootDir, relativePath, content) {
  const targetPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

function run(args = [], options = {}) {
  return execFileSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || path.join(__dirname, '..', '..'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  });
}

function runProcess(args = [], options = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    cwd: options.cwd || path.join(__dirname, '..', '..'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  });
}

function seedMinimalRepo(rootDir, overrides = {}) {
  const files = {
    'package.json': JSON.stringify({
      name: 'everything-claude-code',
      files: ['scripts/observability-readiness.js'],
      scripts: {
        'harness:audit': 'node scripts/harness-audit.js',
        'observability:ready': 'node scripts/observability-readiness.js'
      }
    }, null, 2),
    'scripts/loop-status.js': '--json --watch --write-dir',
    'scripts/session-inspect.js': '--list-adapters --write inspectSessionTarget',
    'scripts/lib/session-adapters/registry.js': 'module.exports = {};',
    'scripts/harness-audit.js': 'Deterministic harness audit --format overall_score',
    'scripts/work-items.js': 'sync-github github-pr github-issue sourceClosedAt ecc-work-items-sync-github',
    'scripts/hooks/session-activity-tracker.js': 'tool-usage.jsonl session_id tool_name',
    'ecc2/src/observability/mod.rs': 'ToolCallEvent RiskAssessment ToolLogger',
    'ecc2/src/session/store.rs': 'insert_tool_log query_tool_logs',
    'ecc2/src/session/manager.rs': 'sync_tool_activity_metrics tool-usage.jsonl',
    'docs/architecture/observability-readiness.md': 'node scripts/observability-readiness.js --format json',
    'docs/architecture/progress-sync-contract.md': [
      'Linear GitHub handoff work-items issue capacity status update',
      'queue counts release gate flow lanes evidence'
    ].join('\n'),
    'docs/ECC-2.0-GA-ROADMAP.md': [
      'Execution Lanes And Tracking Contract',
      'docs/architecture/progress-sync-contract.md',
      'Linear progress',
      'Every significant merge batch'
    ].join('\n'),
    'docs/architecture/hud-status-session-control.md': [
      'context toolCalls activeAgents todos checks cost risk queueState',
      'create resume status stop diff pr mergeQueue conflictQueue',
      'Linear GitHub handoff'
    ].join('\n'),
    'examples/hud-status-contract.json': JSON.stringify({
      schema_version: 'ecc.hud-status.v1',
      context: {},
      toolCalls: {},
      activeAgents: [],
      todos: {},
      checks: {},
      cost: {},
      risk: {},
      queueState: {},
      sessionControls: {},
      sync: {}
    }, null, 2),
    'docs/releases/2.0.0-rc.1/quickstart.md': 'observability-readiness.md',
    'docs/releases/2.0.0-rc.1/release-notes.md': 'observability-readiness.md',
    'docs/releases/2.0.0-rc.1/publication-readiness.md': [
      'Publication Gates',
      'Required Command Evidence',
      'Do Not Publish If',
      'npm dist-tag',
      'GitGuardian',
      'Dependabot alerts',
      'npm audit signatures'
    ].join('\n'),
    'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-13-post-hardening.md': [
      'npm audit --json',
      'npm audit signatures',
      'cargo audit',
      'Dependabot alert API',
      'TanStack',
      'Mini Shai-Hulud',
      'GitGuardian Security Checks'
    ].join('\n'),
    'docs/security/supply-chain-incident-response.md': [
      'TanStack',
      'Mini Shai-Hulud',
      'scan-supply-chain-iocs.js',
      'gh-token-monitor',
      '.claude/settings.json',
      '.vscode/tasks.json',
      'npm audit signatures',
      'trusted publishing',
      'pull_request_target',
      'id-token: write'
    ].join('\n'),
    'scripts/ci/validate-workflow-security.js': [
      'persist-credentials: false',
      'npm audit signatures',
      'pull_request_target',
      'id-token: write',
      'shared cache'
    ].join('\n'),
    'scripts/ci/scan-supply-chain-iocs.js': 'TanStack Mini Shai-Hulud gh-token-monitor',
    'tests/ci/scan-supply-chain-iocs.test.js': 'scan-supply-chain-iocs',
    'tests/ci/validate-workflow-security.test.js': 'npm audit signatures persist-credentials: false',
    'tests/scripts/npm-publish-surface.test.js': 'npm pack --dry-run Python bytecode',
    'tests/docs/ecc2-release-surface.test.js': 'publication-readiness.md',
  };

  for (const [relativePath, content] of Object.entries({ ...files, ...overrides })) {
    if (content === null) {
      continue;
    }
    writeFile(rootDir, relativePath, content);
  }
}

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

function runTests() {
  console.log('\n=== Testing observability-readiness.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('parseArgs accepts supported forms and rejects invalid input', () => {
    const rootDir = createTempDir('observability-readiness-args-');

    try {
      assert.strictEqual(parseArgs(['node', 'script', '--help']).help, true);
      assert.strictEqual(parseArgs(['node', 'script', '-h']).help, true);

      const spaced = parseArgs(['node', 'script', '--format', 'json', '--root', rootDir]);
      assert.strictEqual(spaced.format, 'json');
      assert.strictEqual(spaced.root, path.resolve(rootDir));

      const equals = parseArgs(['node', 'script', '--format=json', `--root=${rootDir}`]);
      assert.strictEqual(equals.format, 'json');
      assert.strictEqual(equals.root, path.resolve(rootDir));

      assert.throws(() => parseArgs(['node', 'script', '--format', 'xml']), /Invalid format: xml/);
      assert.throws(() => parseArgs(['node', 'script', '--root']), /--root requires a value/);
      assert.throws(() => parseArgs(['node', 'script', '--unknown']), /Unknown argument: --unknown/);
    } finally {
      cleanup(rootDir);
    }
  })) passed++; else failed++;

  if (test('cli help exits cleanly and invalid cli args exit with stderr', () => {
    const help = runProcess(['--help']);
    assert.strictEqual(help.status, 0);
    assert.strictEqual(help.stderr, '');
    assert.ok(help.stdout.includes('Usage: node scripts/observability-readiness.js'));

    const invalid = runProcess(['--format', 'xml']);
    assert.strictEqual(invalid.status, 1);
    assert.strictEqual(invalid.stdout, '');
    assert.ok(invalid.stderr.includes('Error: Invalid format: xml. Use text or json.'));
  })) passed++; else failed++;

  if (test('current repo reports a complete readiness score', () => {
    const parsed = JSON.parse(run(['--format=json']));

    assert.strictEqual(parsed.schema_version, 'ecc.observability-readiness.v1');
    assert.strictEqual(parsed.deterministic, true);
    assert.strictEqual(parsed.ready, true);
    assert.strictEqual(parsed.overall_score, parsed.max_score);
    assert.strictEqual(parsed.top_actions.length, 0);
  })) passed++; else failed++;

  if (test('text output includes summary, categories, and checks', () => {
    const output = run();

    assert.ok(output.includes('Observability Readiness:'));
    assert.ok(output.includes('Categories:'));
    assert.ok(output.includes('Checks:'));
    assert.ok(output.includes('PASS loop-status-live-signal'));
  })) passed++; else failed++;

  if (test('minimal seeded repo passes all checks', () => {
    const projectRoot = createTempDir('observability-readiness-pass-');

    try {
      seedMinimalRepo(projectRoot);
      const report = buildReport(projectRoot);

      assert.strictEqual(report.ready, true);
      assert.strictEqual(report.overall_score, report.max_score);
      assert.deepStrictEqual(report.top_actions, []);
    } finally {
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('missing tool logger surfaces become prioritized top actions', () => {
    const projectRoot = createTempDir('observability-readiness-fail-');

    try {
      seedMinimalRepo(projectRoot, {
        'ecc2/src/observability/mod.rs': 'ToolCallEvent only'
      });
      const report = buildReport(projectRoot);

      assert.strictEqual(report.ready, false);
      assert.ok(report.top_actions.some(action => action.id === 'ecc2-tool-risk-ledger'));
      assert.ok(report.checks.some(check => check.id === 'ecc2-tool-risk-ledger' && !check.pass));
    } finally {
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('missing release onramp fails without disturbing core tool checks', () => {
    const projectRoot = createTempDir('observability-readiness-doc-fail-');

    try {
      seedMinimalRepo(projectRoot, {
        'docs/releases/2.0.0-rc.1/quickstart.md': 'quickstart without link'
      });
      const report = buildReport(projectRoot);

      assert.strictEqual(report.ready, false);
      assert.ok(report.checks.some(check => check.id === 'release-observability-onramp' && !check.pass));
      assert.ok(report.checks.some(check => check.id === 'loop-status-live-signal' && check.pass));
    } finally {
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('missing HUD status contract fails without disturbing core tool checks', () => {
    const projectRoot = createTempDir('observability-readiness-hud-fail-');

    try {
      seedMinimalRepo(projectRoot, {
        'examples/hud-status-contract.json': null
      });
      const report = buildReport(projectRoot);

      assert.strictEqual(report.ready, false);
      assert.ok(report.checks.some(check => check.id === 'hud-status-control-contract' && !check.pass));
      assert.ok(report.checks.some(check => check.id === 'loop-status-live-signal' && check.pass));
    } finally {
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('missing progress sync contract fails without disturbing core tool checks', () => {
    const projectRoot = createTempDir('observability-readiness-sync-fail-');

    try {
      seedMinimalRepo(projectRoot, {
        'docs/architecture/progress-sync-contract.md': null
      });
      const report = buildReport(projectRoot);

      assert.strictEqual(report.ready, false);
      assert.ok(report.checks.some(check => check.id === 'progress-sync-contract' && !check.pass));
      assert.ok(report.checks.some(check => check.id === 'loop-status-live-signal' && check.pass));
    } finally {
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('missing release safety evidence fails without disturbing live status checks', () => {
    const projectRoot = createTempDir('observability-readiness-release-safety-fail-');

    try {
      seedMinimalRepo(projectRoot, {
        'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-13-post-hardening.md': 'npm audit --json only'
      });
      const report = buildReport(projectRoot);

      assert.strictEqual(report.ready, false);
      assert.ok(report.checks.some(check => check.id === 'release-safety-evidence' && !check.pass));
      assert.ok(report.checks.some(check => check.id === 'loop-status-live-signal' && check.pass));
    } finally {
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  console.log('\nResults:');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}
