/**
 * Tests for scripts/ecc.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'ecc.js');

function runCli(args, options = {}) {
  const envOverrides = {
    ...(options.env || {}),
  };

  if (typeof envOverrides.HOME === 'string' && !('USERPROFILE' in envOverrides)) {
    envOverrides.USERPROFILE = envOverrides.HOME;
  }

  if (typeof envOverrides.USERPROFILE === 'string' && !('HOME' in envOverrides)) {
    envOverrides.HOME = envOverrides.USERPROFILE;
  }

  return spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: options.cwd || process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      ...envOverrides,
    },
  });
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function parseJson(stdout) {
  return JSON.parse(stdout.trim());
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
  console.log('\n=== Testing ecc.js ===\n');

  let passed = 0;
  let failed = 0;

  const tests = [
    ['shows top-level help', () => {
      const result = runCli(['--help']);
      assert.strictEqual(result.status, 0);
      assert.match(result.stdout, /ECC selective-install CLI/);
      assert.match(result.stdout, /catalog/);
      assert.match(result.stdout, /list-installed/);
      assert.match(result.stdout, /doctor/);
      assert.match(result.stdout, /auto-update/);
      assert.match(result.stdout, /consult/);
      assert.match(result.stdout, /control-pane/);
      assert.match(result.stdout, /loop-status/);
      assert.match(result.stdout, /work-items/);
      assert.match(result.stdout, /platform-audit/);
      assert.match(result.stdout, /security-ioc-scan/);
    }],
    ['delegates explicit install command', () => {
      const result = runCli(['install', '--dry-run', '--json', 'typescript']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = parseJson(result.stdout);
      assert.strictEqual(payload.dryRun, true);
      assert.strictEqual(payload.plan.mode, 'legacy-compat');
      assert.deepStrictEqual(payload.plan.legacyLanguages, ['typescript']);
      assert.ok(payload.plan.selectedModuleIds.includes('framework-language'));
    }],
    ['routes implicit top-level args to install', () => {
      const result = runCli(['--dry-run', '--json', 'typescript']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = parseJson(result.stdout);
      assert.strictEqual(payload.dryRun, true);
      assert.strictEqual(payload.plan.mode, 'legacy-compat');
      assert.deepStrictEqual(payload.plan.legacyLanguages, ['typescript']);
      assert.ok(payload.plan.selectedModuleIds.includes('framework-language'));
    }],
    ['delegates plan command', () => {
      const result = runCli(['plan', '--list-profiles', '--json']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = parseJson(result.stdout);
      assert.ok(Array.isArray(payload.profiles));
      assert.ok(payload.profiles.length > 0);
    }],
    ['delegates catalog command', () => {
      const result = runCli(['catalog', 'show', 'framework:nextjs', '--json']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = parseJson(result.stdout);
      assert.strictEqual(payload.id, 'framework:nextjs');
      assert.deepStrictEqual(payload.moduleIds, ['framework-language']);
    }],
    ['delegates consult command', () => {
      const result = runCli(['consult', 'security', 'reviews', '--json']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = parseJson(result.stdout);
      assert.strictEqual(payload.schemaVersion, 'ecc.consult.v1');
      assert.strictEqual(payload.matches[0].componentId, 'capability:security');
    }],
    ['supports help for the control-pane subcommand', () => {
      const result = runCli(['help', 'control-pane']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /Usage:/);
      assert.match(result.stdout, /control-pane/);
    }],
    ['delegates lifecycle commands', () => {
      const homeDir = createTempDir('ecc-cli-home-');
      const projectRoot = createTempDir('ecc-cli-project-');
      const result = runCli(['list-installed', '--json'], {
        cwd: projectRoot,
        env: { HOME: homeDir },
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = parseJson(result.stdout);
      assert.deepStrictEqual(payload.records, []);
    }],
    ['delegates auto-update command', () => {
      const homeDir = createTempDir('ecc-cli-home-');
      const projectRoot = createTempDir('ecc-cli-project-');
      const result = runCli(['auto-update', '--dry-run', '--json'], {
        cwd: projectRoot,
        env: { HOME: homeDir },
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = parseJson(result.stdout);
      assert.deepStrictEqual(payload.results, []);
    }],
    ['delegates session-inspect command', () => {
      const homeDir = createTempDir('ecc-cli-home-');
      const sessionsDir = path.join(homeDir, '.claude', 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessionsDir, '2026-03-13-a1b2c3d4-session.tmp'),
        '# ECC Session\n\n**Branch:** feat/ecc-cli\n'
      );

      const result = runCli(['session-inspect', 'claude:latest'], {
        env: { HOME: homeDir },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      const payload = parseJson(result.stdout);
      assert.strictEqual(payload.adapterId, 'claude-history');
      assert.strictEqual(payload.workers[0].branch, 'feat/ecc-cli');
    }],
    ['delegates loop-status command', () => {
      const homeDir = createTempDir('ecc-cli-home-');
      const transcriptDir = path.join(homeDir, '.claude', 'projects', '-tmp-ecc');
      fs.mkdirSync(transcriptDir, { recursive: true });
      fs.writeFileSync(
        path.join(transcriptDir, 'session-loop.jsonl'),
        JSON.stringify({
          timestamp: '2026-04-30T09:00:00.000Z',
          sessionId: 'session-loop',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_loop',
                name: 'ScheduleWakeup',
                input: { delaySeconds: 300 },
              },
            ],
          },
        }) + '\n'
      );

      const result = runCli(['loop-status', '--home', homeDir, '--now', '2026-04-30T10:00:00.000Z', '--json']);

      assert.strictEqual(result.status, 0, result.stderr);
      const payload = parseJson(result.stdout);
      assert.strictEqual(payload.schemaVersion, 'ecc.loop-status.v1');
      assert.strictEqual(payload.sessions[0].sessionId, 'session-loop');
    }],
    ['supports help for a subcommand', () => {
      const result = runCli(['help', 'repair']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /Usage: node scripts\/repair\.js/);
    }],
    ['supports help for the auto-update subcommand', () => {
      const result = runCli(['help', 'auto-update']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /Usage: node scripts\/auto-update\.js/);
    }],
    ['supports help for the catalog subcommand', () => {
      const result = runCli(['help', 'catalog']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /node scripts\/catalog\.js show <component-id>/);
    }],
    ['supports help for the consult subcommand', () => {
      const result = runCli(['help', 'consult']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /node scripts\/consult\.js "security reviews"/);
    }],
    ['supports help for the work-items subcommand', () => {
      const result = runCli(['help', 'work-items']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /node scripts\/work-items\.js upsert/);
    }],
    ['supports help for the platform-audit subcommand', () => {
      const result = runCli(['help', 'platform-audit']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /Usage: node scripts\/platform-audit\.js/);
    }],
    ['supports help for the security-ioc-scan subcommand', () => {
      const result = runCli(['help', 'security-ioc-scan']);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.match(result.stdout, /Usage: node scripts\/ci\/scan-supply-chain-iocs\.js/);
    }],
    ['delegates security-ioc-scan command', () => {
      const projectRoot = createTempDir('ecc-cli-ioc-scan-');
      fs.writeFileSync(
        path.join(projectRoot, 'package.json'),
        JSON.stringify({ dependencies: { leftpad: '1.0.0' } }, null, 2)
      );

      const result = runCli(['security-ioc-scan', '--root', projectRoot, '--json']);
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = parseJson(result.stdout);
      assert.deepStrictEqual(payload.findings, []);
    }],
    ['fails on unknown commands instead of treating them as installs', () => {
      const result = runCli(['bogus']);
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /Unknown command: bogus/);
    }],
    ['fails on unknown help subcommands', () => {
      const result = runCli(['help', 'bogus']);
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /Unknown command: bogus/);
    }],
  ];

  for (const [name, fn] of tests) {
    if (runTest(name, fn)) {
      passed += 1;
    } else {
      failed += 1;
    }
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
