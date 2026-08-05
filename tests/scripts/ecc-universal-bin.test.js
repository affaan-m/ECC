/**
 * Published npm binary aliases for the primary ECC CLI.
 *
 * The CI matrix sets CLAUDE_CODE_PACKAGE_MANAGER. Each lane must execute the
 * packed artifact through its own package runner instead of silently falling
 * back to npx.
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
const activePackageManager = process.env.CLAUDE_CODE_PACKAGE_MANAGER || 'npm';
const supportedPackageManagers = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const commandTimeoutMs = 90_000;

let passed = 0;
let failed = 0;
let packedFixture;
let localPackedProject;

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

function platformCommand(command) {
  const windowsPackageCommands = new Set([
    'bun',
    'bunx',
    'npm',
    'npx',
    'pnpm',
    'yarn',
  ]);
  return process.platform === 'win32' && windowsPackageCommands.has(command)
    ? `${command}.cmd`
    : command;
}

function withPathPrefix(environment, prefix) {
  const nextEnvironment = { ...environment };
  const pathKey = Object.keys(nextEnvironment)
    .find(key => key.toLowerCase() === 'path') || 'PATH';
  nextEnvironment[pathKey] = [prefix, nextEnvironment[pathKey]]
    .filter(Boolean)
    .join(path.delimiter);
  return nextEnvironment;
}

function run(command, args, options = {}) {
  const result = spawnSync(platformCommand(command), args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: 10 * 1024 * 1024,
    timeout: commandTimeoutMs,
    windowsHide: true,
  });

  assert.ifError(result.error);
  assert.strictEqual(
    result.status,
    0,
    [
      `${command} ${args.join(' ')} exited with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n')
  );
  return result;
}

function getPackedFixture() {
  if (packedFixture) {
    return packedFixture;
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-universal-bin-'));
  const packResult = run(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', directory]
  );
  const packOutput = JSON.parse(packResult.stdout);
  const filename = packOutput[0]?.filename;
  assert.ok(filename, 'npm pack should report the archive filename');

  packedFixture = {
    archivePath: path.join(directory, filename),
    directory,
    publishedPaths: new Set(
      packOutput[0]?.files?.map(file => file.path) || []
    ),
  };
  return packedFixture;
}

function prepareLocalPackedProject(packageManager) {
  if (localPackedProject) {
    return localPackedProject;
  }

  const fixture = getPackedFixture();
  const projectDirectory = path.join(fixture.directory, 'local-project');
  const modulesDirectory = path.join(projectDirectory, 'node_modules');
  const extractedDirectory = path.join(modulesDirectory, 'package');
  const packageDirectory = path.join(modulesDirectory, 'ecc-universal');
  const binDirectory = path.join(modulesDirectory, '.bin');

  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(projectDirectory, 'package.json'),
    `${JSON.stringify({ name: 'ecc-packed-smoke', private: true }, null, 2)}\n`
  );
  if (packageManager === 'yarn') {
    // This empty fixture has no dependencies. Generate only its local lockfile
    // so `yarn exec` can run the manually unpacked package in PR hardened mode.
    run('yarn', ['install', '--mode=skip-build'], {
      cwd: projectDirectory,
      env: {
        ...process.env,
        YARN_ENABLE_HARDENED_MODE: '0',
        YARN_ENABLE_NETWORK: '0',
      },
    });
  }
  fs.mkdirSync(modulesDirectory, { recursive: true });
  run('tar', ['-xzf', fixture.archivePath, '-C', modulesDirectory], {
    cwd: projectDirectory,
  });
  fs.renameSync(extractedDirectory, packageDirectory);
  fs.mkdirSync(binDirectory, { recursive: true });

  for (const executable of ['ecc', 'ecc-universal']) {
    const scriptPath = path.join(packageDirectory, packageJson.bin[executable]);
    fs.chmodSync(scriptPath, 0o755);
    if (process.platform === 'win32') {
      const cmdPath = path.join(binDirectory, `${executable}.cmd`);
      const target = packageJson.bin[executable].replace(/\//g, '\\');
      fs.writeFileSync(
        cmdPath,
        `@ECHO off\r\nnode "%~dp0\\..\\ecc-universal\\${target}" %*\r\n`
      );
    } else {
      fs.symlinkSync(
        path.join('..', 'ecc-universal', packageJson.bin[executable]),
        path.join(binDirectory, executable)
      );
    }
  }

  localPackedProject = { binDirectory, projectDirectory };
  return localPackedProject;
}

function getRunnerInvocation(packageManager, executable, args) {
  const project = prepareLocalPackedProject(packageManager);
  const localEnvironment = withPathPrefix(process.env, project.binDirectory);
  switch (packageManager) {
    case 'npm':
      {
        // npx --offline --package=<local.tgz> still resolves uncached
        // transitive dependencies from the registry. Unpack the artifact and
        // invoke npm's local executable runner so CI proves the packaged bin
        // without depending on registry cache state.
        return {
          command: 'npm',
          args: ['exec', '--offline', '--', executable, ...args],
          cwd: project.projectDirectory,
          env: { ...localEnvironment, npm_config_offline: 'true' },
        };
      }
    case 'pnpm':
      return {
        command: 'pnpm',
        args: ['exec', executable, ...args],
        cwd: project.projectDirectory,
        env: { ...localEnvironment, npm_config_offline: 'true' },
      };
    case 'yarn':
      {
        // Yarn dlx resolves transitive package metadata from the registry even
        // when the package tarball and dependency archives are cached. For a
        // hermetic pre-publish gate, execute the exact unpacked artifact through
        // Yarn's runner with network disabled. A post-publish dlx smoke test is
        // still required to validate registry metadata.
        return {
          command: 'yarn',
          args: ['exec', executable, ...args],
          env: {
            ...localEnvironment,
            YARN_ENABLE_NETWORK: '0',
            YARN_ENABLE_HARDENED_MODE: '0',
          },
          cwd: project.projectDirectory,
        };
      }
    case 'bun':
      {
        // bunx has no strict offline install mode. Unpack the exact artifact
        // locally and use --no-install so the smoke cannot reach the registry.
        return {
          command: 'bunx',
          args: ['--no-install', executable, ...args],
          env: localEnvironment,
          cwd: project.projectDirectory,
        };
      }
    default:
      throw new Error(`Unsupported package manager: ${packageManager}`);
  }
}

function launchPackedBinary(executable, args) {
  const fixture = getPackedFixture();
  const invocation = getRunnerInvocation(
    activePackageManager,
    executable,
    args
  );
  return run(invocation.command, invocation.args, {
    cwd: invocation.cwd || fixture.directory,
    env: invocation.env,
  });
}

console.log(`\n=== ECC universal packed binary tests (${activePackageManager}) ===\n`);

test('CI selects a supported package runner', () => {
  assert.ok(
    supportedPackageManagers.has(activePackageManager),
    `CLAUDE_CODE_PACKAGE_MANAGER must be one of ${[...supportedPackageManagers].join(', ')}`
  );
});

test('published package exposes ecc and ecc-universal through scripts/ecc.js', () => {
  assert.strictEqual(packageJson.bin.ecc, 'scripts/ecc.js');
  assert.strictEqual(packageJson.bin['ecc-universal'], 'scripts/ecc.js');
  assert.deepStrictEqual(packageLock.packages[''].bin, packageJson.bin);

  const fixture = getPackedFixture();
  assert.ok(
    fixture.publishedPaths.has('scripts/ecc.js'),
    'npm package should publish the shared CLI target'
  );
});

test('packed ecc-universal launches the guided Claude setup help', () => {
  const result = launchPackedBinary('ecc-universal', ['setup', '--help']);
  assert.match(result.stdout, /ECC guided setup/);
});

test('packed ecc-universal launches the guided multi-harness help', () => {
  const result = launchPackedBinary(
    'ecc-universal',
    ['install', '--guided', '--help']
  );
  assert.match(result.stdout, /ECC guided multi-harness install/);
  assert.match(result.stdout, /Claude Code/);
  assert.match(result.stdout, /Codex/);
  assert.match(result.stdout, /Kimi/);
});

test('packed ecc alias launches the primary dispatcher', () => {
  const result = launchPackedBinary('ecc', ['--help']);
  assert.match(result.stdout, /ECC selective-install CLI/);
  assert.match(result.stdout, /ecc install --guided/);
});

if (packedFixture) {
  fs.rmSync(packedFixture.directory, { force: true, recursive: true });
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
