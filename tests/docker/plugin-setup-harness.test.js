'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const harnessRoot = path.join(repoRoot, 'docker', 'plugin-setup');
const SUBPROCESS_TIMEOUT_MS = 30_000;
const files = {
  ci: path.join(repoRoot, '.github', 'workflows', 'ci.yml'),
  compose: path.join(harnessRoot, 'compose.yaml'),
  dockerfile: path.join(harnessRoot, 'Dockerfile'),
  fixtureProject: path.join(
    repoRoot,
    'tests',
    'fixtures',
    'docker-plugin-project',
    'package.json'
  ),
  fixtureRunner: path.join(harnessRoot, 'run-fixture-tests.sh'),
  interactivePlan: path.join(harnessRoot, 'interactive-plan.js'),
  packageJson: path.join(repoRoot, 'package.json'),
  packedCliPreparer: path.join(harnessRoot, 'prepare-packed-cli.js'),
  platformRunner: path.join(harnessRoot, 'run-platform-tests.js'),
  planValidator: path.join(harnessRoot, 'verify-install-plan.js'),
  projectDirResolver: path.join(harnessRoot, 'resolve-project-dir.js'),
  realRunner: path.join(harnessRoot, 'run-real-cli.sh'),
};

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

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function runNode(argv, options = {}) {
  const result = spawnSync(process.execPath, argv, {
    ...options,
    shell: false,
    timeout: SUBPROCESS_TIMEOUT_MS,
  });
  assert.ifError(result.error);
  return result;
}

console.log('\n=== Docker plugin setup harness tests ===\n');

test('ships the focused Docker harness and default fixture project', () => {
  for (const filePath of Object.values(files)) {
    assert.ok(
      fs.existsSync(filePath),
      `Missing ${path.relative(repoRoot, filePath)}`
    );
  }
});

test('builds pinned Debian and Ubuntu images as a non-root user', () => {
  const dockerfile = read(files.dockerfile);
  const compose = read(files.compose);
  assert.match(dockerfile, /node:22-bookworm-slim@sha256:[a-f0-9]{64}/);
  assert.match(dockerfile, /ARG OS_IMAGE=/);
  assert.match(dockerfile, /FROM \$\{NODE_IMAGE\} AS node-runtime/);
  assert.match(dockerfile, /FROM \$\{OS_IMAGE\}/);
  assert.match(dockerfile, /COPY --from=node-runtime \/usr\/local\/ \/usr\/local\//);
  assert.match(dockerfile, /ARG CLAUDE_CODE_VERSION=\d+\.\d+\.\d+/);
  assert.match(dockerfile, /@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}/);
  assert.match(dockerfile, /@iarna\/toml@2\.2\.5/);
  assert.match(dockerfile, /ajv@8\.20\.0/);
  assert.match(dockerfile, /sql\.js@1\.14\.1/);
  assert.match(dockerfile, /--ignore-scripts/);
  assert.match(
    dockerfile,
    /@anthropic-ai\/claude-code\/install\.cjs/
  );
  assert.match(dockerfile, /ENV DISABLE_AUTOUPDATER=1/);
  assert.match(dockerfile, /ENV HOME=\/tmp\/ecc-home/);
  assert.match(dockerfile, /ENV NODE_PATH=\/usr\/local\/lib\/node_modules/);
  assert.match(dockerfile, /chown 1000:1000 \/workspace/);
  assert.match(dockerfile, /USER 1000:1000/);
  assert.doesNotMatch(dockerfile, /:latest/);
  assert.match(compose, /image:\s*ecc-plugin-setup:debian/);
  assert.match(compose, /image:\s*ecc-plugin-setup:ubuntu/);
  assert.match(compose, /ubuntu:24\.04@sha256:[a-f0-9]{64}/);
  assert.match(compose, /real-cli-ubuntu:/);
  assert.match(
    compose,
    /fixture-tests:[\s\S]*?user:\s*["']1000:1000["']/
  );
  assert.strictEqual(
    (compose.match(/node:22-bookworm-slim@sha256:[a-f0-9]{64}/g) || []).length,
    1,
    'The pinned Node image must have one source of truth in Compose'
  );
  assert.match(compose, /x-node-image:\s*&node-image/);
  assert.match(compose, /image:\s*\*node-image/);
  assert.match(compose, /NODE_IMAGE:\s*\*node-image/);
  assert.match(compose, /OS_IMAGE:\s*\*node-image/);
});

test('keeps checkout and source project read-only with hardened defaults', () => {
  const compose = read(files.compose);
  assert.match(compose, /network_mode:\s*none/);
  assert.match(compose, /x-real-cli:[\s\S]*?network_mode:\s*none[\s\S]*?services:/);
  assert.match(
    compose,
    /real-cli-networked:[\s\S]*?profiles:[\s\S]*?-\s*networked[\s\S]*?network_mode:\s*default/
  );
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:\s*\n\s*-\s*ALL/);
  assert.match(compose, /pids_limit:\s*256/);
  assert.match(compose, /target:\s*\/ecc\s*\n\s*read_only:\s*true/);
  assert.match(compose, /target:\s*\/source-project\s*\n\s*read_only:\s*true/);
  assert.match(compose, /CLAUDE_CONFIG_DIR:\s*\/tmp\/ecc-claude-config/);
  assert.match(
    compose,
    /\/tmp:rw,nosuid,nodev,exec,size=\$\{ECC_TMPFS_SIZE:-2g\},uid=1000,gid=1000,mode=0700/
  );
  assert.match(
    compose,
    /\/workspace:rw,nosuid,nodev,noexec,size=\$\{ECC_WORKSPACE_SIZE:-1g\},uid=1000,gid=1000,mode=0700/
  );
  assert.match(compose, /NPM_CONFIG_CACHE:\s*\/tmp\/npm-cache/);
  assert.doesNotMatch(
    compose,
    /ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|env_file:/
  );
});

test('real runner copies into tmpfs and exposes only explicit safe modes', () => {
  const runner = read(files.realRunner);
  assert.match(runner, /ECC_PROJECT_DIR:-\/workspace\/project/);
  assert.match(runner, /mkdir -p "\$HOME" "\$CLAUDE_CONFIG_DIR" "\$NPM_CONFIG_CACHE"/);
  assert.match(runner, /dry-run\|install\|plugin\|shell/);
  assert.match(runner, /--target claude-project/);
  assert.match(runner, /--dry-run/);
  assert.match(runner, /verify-install-plan\.js.*--dry-run/);
  assert.match(runner, /resolve-project-dir\.js/);
  assert.match(
    runner,
    /project_dir="\$\([\s\S]*?resolve-project-dir\.js[\s\S]*?\)"\s*\nreadonly project_dir/
  );
  assert.doesNotMatch(runner, /readonly project_dir="\$\(/);
  assert.match(runner, /prepare-packed-cli\.js/);
  assert.match(runner, /run_ecc install/);
  assert.match(runner, /run_ecc list-installed --json/);
  assert.match(runner, /run_ecc doctor --target claude-project/);
  assert.match(runner, /\[\[ -e "\$project_dir\/\.claude" \]\]/);
  assert.doesNotMatch(
    runner,
    /scripts\/ecc\.js" setup|--move-scope|\bmigrate\b/
  );
  assert.doesNotMatch(runner, /scripts\/ecc\.js" install/);
  assert.doesNotMatch(runner, /\beval\b|rm\s+-rf/);
});

test('prepares a local npm artifact through the confined public bin contract', () => {
  const preparer = read(files.packedCliPreparer);
  assert.match(preparer, /spawnSync\(executable, argv/);
  assert.match(preparer, /run\(['"]npm['"]/);
  assert.match(preparer, /['"]pack['"]/);
  assert.match(preparer, /['"]--ignore-scripts['"]/);
  assert.match(preparer, /npm_config_offline:\s*['"]true['"]/);
  assert.match(preparer, /run\(['"]tar['"]/);
  assert.match(preparer, /shell:\s*false/g);
  assert.match(
    preparer,
    /const CHILD_PROCESS_TIMEOUT_MS\s*=\s*5 \* 60 \* 1000;/
  );
  assert.match(preparer, /timeout:\s*CHILD_PROCESS_TIMEOUT_MS/);
  assert.doesNotMatch(preparer, /execSync\(|\beval\b/);

  const { validatePackedPackage } = require(files.packedCliPreparer);
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-packed-cli-'));

  function createFixture(name, options = {}) {
    const packageRoot = path.join(fixtureRoot, name);
    fs.mkdirSync(path.join(packageRoot, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(packageRoot, 'manifests'), { recursive: true });
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        name: options.packageName || 'ecc-universal',
        version: '2.1.0',
        bin: options.bin === undefined ? { ecc: 'scripts/ecc.js' } : options.bin,
      })
    );
    fs.writeFileSync(path.join(packageRoot, 'scripts', 'ecc.js'), '#!/usr/bin/env node\n');
    fs.chmodSync(path.join(packageRoot, 'scripts', 'ecc.js'), 0o755);
    for (const manifest of [
      'install-components.json',
      'install-modules.json',
      'install-profiles.json',
    ]) {
      if (manifest !== options.omitManifest) {
        fs.writeFileSync(path.join(packageRoot, 'manifests', manifest), '{}\n');
      }
    }
    return packageRoot;
  }

  try {
    const validRoot = createFixture('valid');
    assert.strictEqual(
      validatePackedPackage(validRoot),
      path.join(validRoot, 'scripts', 'ecc.js')
    );

    for (const [name, options, pattern] of [
      ['wrong-name', { packageName: 'not-ecc' }, /package name/i],
      ['missing-bin', { bin: {} }, /bin\.ecc/i],
      ['escaping-bin', { bin: { ecc: '../escape.js' } }, /bin\.ecc/i],
      ['missing-manifest', { omitManifest: 'install-profiles.json' }, /missing/i],
    ]) {
      assert.throws(() => validatePackedPackage(createFixture(name, options)), pattern);
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('normalizes the isolated project path before enforcing workspace containment', () => {
  const valid = runNode([
    files.projectDirResolver,
    '/workspace/nested/../project',
  ], { encoding: 'utf8' });
  assert.strictEqual(valid.status, 0, valid.stderr);
  assert.strictEqual(valid.stdout.trim(), '/workspace/project');

  for (const candidate of [
    '/workspace',
    '/workspace/../tmp/project',
    '/tmp/project',
    'workspace/project',
  ]) {
    const invalid = runNode([
      files.projectDirResolver,
      candidate,
    ], { encoding: 'utf8' });
    assert.strictEqual(invalid.status, 2, `${candidate}: ${invalid.stderr}`);
    assert.match(invalid.stderr, /within \/workspace/i);
  }
});

test('fixture runner delegates to the cross-platform test entry point', () => {
  const runner = read(files.fixtureRunner);
  assert.match(runner, /id -u/);
  assert.match(runner, /id -g/);
  assert.match(runner, /must run as uid\/gid 1000:1000/i);
  assert.match(
    runner,
    /exec node docker\/plugin-setup\/run-platform-tests\.js/
  );
});

test('uses one shell-free focused runner across Linux, macOS, and Windows', () => {
  const ci = read(files.ci);
  const packageJson = read(files.packageJson);
  const platformRunner = read(files.platformRunner);

  assert.match(
    ci,
    /os:\s*\[ubuntu-latest,\s*windows-latest,\s*macos-latest\]/
  );
  assert.match(
    packageJson,
    /"test:plugin-setup-platform":\s*"node docker\/plugin-setup\/run-platform-tests\.js"/
  );
  assert.match(platformRunner, /spawnSync\(/);
  assert.match(platformRunner, /shell:\s*false/);
  assert.match(
    platformRunner,
    /const CHILD_PROCESS_TIMEOUT_MS\s*=\s*5 \* 60 \* 1000;/
  );
  assert.match(platformRunner, /timeout:\s*CHILD_PROCESS_TIMEOUT_MS/);
  assert.match(platformRunner, /Object\.fromEntries\(/);
  assert.match(platformRunner, /Object\.entries\(process\.env\)\.filter/);
  assert.doesNotMatch(platformRunner, /delete childEnv\[/);
  assert.match(platformRunner, /tests\/lib\/install-manifests\.test\.js/);
  assert.match(platformRunner, /tests\/lib\/install-targets\.test\.js/);
  assert.match(platformRunner, /tests\/lib\/install-executor\.test\.js/);
  assert.doesNotMatch(platformRunner, /\beval\b|execSync\(/);
});

test('emits docker exec as an executable plus argv integration contract', () => {
  const result = runNode([
    files.interactivePlan,
    '--container', 'ecc-plugin-shell',
    '--workdir', '/workspace/project',
    '--json',
    '--',
    'node',
    '-p',
    'process.stdin.isTTY',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), {
    contractVersion: 1,
    executable: 'docker',
    argv: [
      'exec',
      '-it',
      '-w',
      '/workspace/project',
      'ecc-plugin-shell',
      'node',
      '-p',
      'process.stdin.isTTY',
    ],
  });
});

test('keeps Docker session values as argv entries and validates boundaries', () => {
  const literalArgument = '$(touch should-not-run)';
  const result = runNode([
    files.interactivePlan,
    '--container', 'ecc.plugin-shell_1',
    '--workdir', '/workspace/project with spaces',
    '--json',
    '--',
    'printf',
    '%s',
    literalArgument,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout).argv.slice(-3), [
    'printf',
    '%s',
    literalArgument,
  ]);

  for (const args of [
    ['--container', '../escape', '--json'],
    ['--container', 'valid-name', '--workdir', 'relative/path', '--json'],
    ['--container', 'valid-name', '--workdir', '/workspace/../tmp', '--json'],
  ]) {
    const invalid = runNode([files.interactivePlan, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.strictEqual(invalid.status, 2);
    assert.match(invalid.stderr, /invalid/i);
  }
});

test('validates dry-run target confinement and nonempty operations', () => {
  const projectDir = path.join(repoRoot, 'workspace-project');
  const installRoot = path.join(projectDir, '.claude');
  const safePlan = {
    dryRun: true,
    plan: {
      target: 'claude-project',
      installRoot,
      operations: [
        { destinationPath: path.join(installRoot, 'rules', 'ecc', 'base.md') },
      ],
    },
  };
  const safe = runNode(
    [files.planValidator, projectDir, '--dry-run'],
    { encoding: 'utf8', input: JSON.stringify(safePlan) }
  );
  assert.strictEqual(safe.status, 0, safe.stderr);

  const unsafePlan = {
    ...safePlan,
    plan: {
      ...safePlan.plan,
      operations: [{ destinationPath: '/tmp/escape.md' }],
    },
  };
  const unsafe = runNode(
    [files.planValidator, projectDir, '--dry-run'],
    { encoding: 'utf8', input: JSON.stringify(unsafePlan) }
  );
  assert.strictEqual(unsafe.status, 1);
  assert.match(unsafe.stderr, /outside/i);

  for (const installRootValue of [undefined, 42, { path: installRoot }]) {
    const invalidRootPlan = {
      ...safePlan,
      plan: {
        ...safePlan.plan,
        installRoot: installRootValue,
      },
    };
    const invalidRoot = runNode(
      [files.planValidator, projectDir, '--dry-run'],
      { encoding: 'utf8', input: JSON.stringify(invalidRootPlan) }
    );
    assert.strictEqual(invalidRoot.status, 1);
    assert.match(invalidRoot.stderr, /install root is not confined/i);
    assert.doesNotMatch(invalidRoot.stderr, /ERR_INVALID_ARG_TYPE|TypeError/);
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
