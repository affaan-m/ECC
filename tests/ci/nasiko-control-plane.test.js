/**
 * Contract and lifecycle tests for the opt-in Nasiko CLI lifecycle bridge.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

async function runTest(name, testFunction) {
  try {
    await testFunction();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

function sha256Digest(value) {
  const crypto = require('crypto');
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function tarGzipFixture({
  name = 'nasiko',
  payload = Buffer.from('x'),
  sizeField = null,
  padding = true,
  terminatorBlocks = 2,
  trailing = Buffer.alloc(0),
} = {}) {
  const zlib = require('zlib');
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(sizeField || `${payload.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header[156] = '0'.charCodeAt(0);
  const paddingBytes = padding ? Buffer.alloc((512 - (payload.length % 512)) % 512) : Buffer.alloc(0);
  return zlib.gzipSync(Buffer.concat([
    header,
    payload,
    paddingBytes,
    Buffer.alloc(terminatorBlocks * 512),
    trailing,
  ]));
}

async function main() {
  console.log('\n=== Testing Nasiko CLI lifecycle bridge ===\n');

  const tests = [
    ['qualifies only pinned platform releases and rejects latest', () => {
      const {
        getQualifiedRelease,
        normalizePlatform,
      } = require('../../scripts/lib/nasiko-release');

      assert.deepStrictEqual(normalizePlatform('darwin', 'arm64'), {
        os: 'darwin',
        arch: 'arm64',
        binaryName: 'nasiko',
      });
      assert.deepStrictEqual(normalizePlatform('win32', 'x64'), {
        os: 'windows',
        arch: 'amd64',
        binaryName: 'nasiko.exe',
      });
      assert.match(getQualifiedRelease('v0.1.0', 'linux', 'x64').manifestDigest, /^sha256:[a-f0-9]{64}$/);
      assert.match(getQualifiedRelease('v0.1.0', 'linux', 'x64').binaryDigest, /^sha256:[a-f0-9]{64}$/);
      assert.strictEqual(getQualifiedRelease('v0.1.0', 'linux', 'x64').license, 'Apache-2.0');
      assert.throws(() => getQualifiedRelease('latest', 'darwin', 'arm64'), /pinned version/i);
      assert.throws(() => getQualifiedRelease('v1.0.0', 'darwin', 'arm64'), /not qualified/i);
      assert.throws(() => normalizePlatform('freebsd', 'x64'), /unsupported platform/i);
      assert.throws(() => normalizePlatform('darwin', 'ia32'), /unsupported architecture/i);
    }],
    ['requires explicit consent while dry-run remains offline and read-only', async () => {
      const { installNasiko } = require('../../scripts/lib/nasiko-release');
      let fetchCount = 0;
      const dependencies = {
        fetchBytes: async () => {
          fetchCount += 1;
          throw new Error('dry-run fetched the network');
        },
        platform: 'darwin',
        arch: 'arm64',
      };

      await assert.rejects(
        installNasiko({ version: 'v0.1.0', yes: false }, dependencies),
        /explicit --yes/i
      );
      const plan = await installNasiko({ version: 'v0.1.0', dryRun: true }, dependencies);
      assert.strictEqual(plan.dryRun, true);
      assert.strictEqual(plan.version, 'v0.1.0');
      assert.strictEqual(plan.registryOrigin, 'https://registry.nasiko.dev');
      assert.strictEqual(fetchCount, 0);
    }],
    ['cleans an exclusively created lifecycle lock when initialization fails', () => {
      const { acquireLifecycleLock } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-lock-'));
      const lockPath = path.join(installRoot, '.ecc-nasiko-lifecycle.lock');
      try {
        const failingFileSystem = {
          ...fs,
          writeFileSync: () => { throw new Error('lock metadata unavailable'); },
        };
        assert.throws(() => acquireLifecycleLock(installRoot, failingFileSystem), /metadata unavailable/i);
        assert.strictEqual(fs.existsSync(lockPath), false);
        const releaseLock = acquireLifecycleLock(installRoot);
        assert.strictEqual(fs.existsSync(lockPath), true);
        releaseLock();
        assert.strictEqual(fs.existsSync(lockPath), false);
      } finally { fs.rmSync(installRoot, { recursive: true, force: true }); }
    }],
    ['recovers only locks whose recorded owner is confirmed dead', () => {
      const { acquireLifecycleLock } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-stale-lock-'));
      const lockPath = path.join(installRoot, '.ecc-nasiko-lifecycle.lock');
      try {
        fs.writeFileSync(lockPath, `${JSON.stringify({
          pid: 424242,
          startedAt: '2026-08-25T00:00:00.000Z',
          token: 'stale-owner',
        })}\n`, { mode: 0o600 });
        assert.throws(
          () => acquireLifecycleLock(installRoot, fs, { isProcessAlive: () => true }),
          /already in progress/i
        );
        const releaseLock = acquireLifecycleLock(installRoot, fs, { isProcessAlive: () => false });
        assert.strictEqual(fs.existsSync(lockPath), true);
        releaseLock();
        assert.strictEqual(fs.existsSync(lockPath), false);
      } finally { fs.rmSync(installRoot, { recursive: true, force: true }); }
    }],
    ['refuses to recover malformed lifecycle-lock ownership', () => {
      const { acquireLifecycleLock } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-malformed-lock-'));
      const lockPath = path.join(installRoot, '.ecc-nasiko-lifecycle.lock');
      try {
        fs.writeFileSync(lockPath, '{"pid":"unknown"}\n', { mode: 0o600 });
        assert.throws(
          () => acquireLifecycleLock(installRoot, fs, { isProcessAlive: () => false }),
          /already in progress/i
        );
      } finally { fs.rmSync(installRoot, { recursive: true, force: true }); }
    }],
    ['recovers a lock abandoned by a finished process', () => {
      const { acquireLifecycleLock } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-dead-process-lock-'));
      const lockPath = path.join(installRoot, '.ecc-nasiko-lifecycle.lock');
      const modulePath = path.join(REPO_ROOT, 'scripts', 'lib', 'nasiko-release.js');
      try {
        const child = spawnSync(process.execPath, ['-e',
          `require(${JSON.stringify(modulePath)}).acquireLifecycleLock(${JSON.stringify(installRoot)});`
        ], { encoding: 'utf8' });
        assert.strictEqual(child.status, 0, child.stderr);
        assert.strictEqual(fs.existsSync(lockPath), true);
        const releaseLock = acquireLifecycleLock(installRoot);
        releaseLock();
        assert.strictEqual(fs.existsSync(lockPath), false);
      } finally { fs.rmSync(installRoot, { recursive: true, force: true }); }
    }],
    ['a prior release callback never removes a replacement lifecycle lock', () => {
      const { acquireLifecycleLock } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-replaced-lock-'));
      const lockPath = path.join(installRoot, '.ecc-nasiko-lifecycle.lock');
      const displacedPath = `${lockPath}.displaced`;
      try {
        const releaseLock = acquireLifecycleLock(installRoot);
        fs.renameSync(lockPath, displacedPath);
        fs.writeFileSync(lockPath, '{"pid":1,"startedAt":"2026-08-25T00:00:00.000Z","token":"replacement"}\n');
        releaseLock();
        assert.strictEqual(fs.existsSync(lockPath), true);
      } finally { fs.rmSync(installRoot, { recursive: true, force: true }); }
    }],
    ['uses descriptor identity when Windows path stats disagree', () => {
      const { acquireLifecycleLock } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-windows-identity-'));
      const lockPath = path.join(installRoot, '.ecc-nasiko-lifecycle.lock');
      const windowsLikeFileSystem = {
        ...fs,
        lstatSync: target => {
          const stats = fs.lstatSync(target);
          return {
            ...stats,
            dev: Number(stats.dev) + 1,
            isDirectory: () => stats.isDirectory(),
            isFile: () => stats.isFile(),
            isSymbolicLink: () => stats.isSymbolicLink(),
          };
        },
      };
      try {
        const releaseLock = acquireLifecycleLock(installRoot, windowsLikeFileSystem);
        releaseLock();
        assert.strictEqual(fs.existsSync(lockPath), false);
      } finally { fs.rmSync(installRoot, { recursive: true, force: true }); }
    }],
    ['verifies manifest and blob digests before an atomic install', async () => {
      const { installNasiko } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-green-'));
      const binary = Buffer.from('#!/bin/sh\necho nasiko 0.1.0\n');
      const manifest = Buffer.from(JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        layers: [{
          mediaType: 'application/gzip',
          digest: sha256Digest(Buffer.from('verified archive')),
          size: 16,
        }],
      }));
      const archive = Buffer.from('verified archive');

      try {
        const result = await installNasiko({
          version: 'v0.1.0',
          yes: true,
          installDir: installRoot,
        }, {
          platform: 'darwin',
          arch: 'arm64',
          releaseOverride: {
            manifestDigest: sha256Digest(manifest),
            binaryDigest: sha256Digest(binary),
          },
          fetchBytes: async (url) => url.includes('/manifests/') ? manifest : archive,
          extractBinary: () => binary,
        });
        assert.strictEqual(result.installed, true);
        assert.strictEqual(result.version, 'v0.1.0');
        assert.strictEqual(fs.existsSync(path.join(installRoot, 'nasiko')), true);
        assert.strictEqual(fs.existsSync(path.join(installRoot, '.ecc-nasiko-install.json')), true);
        const { getQualifiedRelease, inspectInstalledNasiko, uninstallNasiko } = require('../../scripts/lib/nasiko-release');
        const fakeRelease = {
          ...getQualifiedRelease('v0.1.0', 'darwin', 'arm64'),
          manifestDigest: sha256Digest(manifest),
          binaryDigest: sha256Digest(binary),
        };
        const preview = await uninstallNasiko({ installDir: installRoot, dryRun: true }, {
          platform: 'darwin', arch: 'arm64',
        });
        assert.strictEqual(preview.dryRun, true);
        assert.strictEqual(preview.version, 'v0.1.0');
        assert.strictEqual(preview.destination, path.join(fs.realpathSync(installRoot), 'nasiko'));
        let renameCount = 0;
        await assert.rejects(async () => uninstallNasiko({ installDir: installRoot, yes: true }, {
          platform: 'darwin', arch: 'arm64',
          inspectInstalled: destination => inspectInstalledNasiko(destination, () => fakeRelease),
          rename: (source, destination) => {
            renameCount += 1;
            if (renameCount === 2) throw new Error('metadata staging unavailable');
            fs.renameSync(source, destination);
          },
        }), /metadata staging unavailable/i);
        assert.strictEqual(fs.existsSync(path.join(installRoot, 'nasiko')), true);
        assert.strictEqual(fs.existsSync(path.join(installRoot, '.ecc-nasiko-install.json')), true);
        await uninstallNasiko({ installDir: installRoot, yes: true }, {
          platform: 'darwin', arch: 'arm64',
          inspectInstalled: destination => inspectInstalledNasiko(destination, () => fakeRelease),
        });
        assert.strictEqual(fs.existsSync(path.join(installRoot, 'nasiko')), false);
        assert.strictEqual(fs.existsSync(path.join(installRoot, '.ecc-nasiko-install.json')), false);
      } finally {
        fs.rmSync(installRoot, { recursive: true, force: true });
      }
    }],
    ['rejects digest mismatch and unsafe archive entries without installing', async () => {
      const { extractQualifiedTarGzip, installNasiko } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-reject-'));
      const manifest = Buffer.from('{"schemaVersion":2,"layers":[]}');
      try {
        await assert.rejects(
          installNasiko({ version: 'v0.1.0', yes: true, installDir: installRoot }, {
            platform: 'darwin',
            arch: 'arm64',
            releaseOverride: { manifestDigest: `sha256:${'0'.repeat(64)}` },
            fetchBytes: async () => manifest,
          }),
          /manifest digest mismatch/i
        );
        assert.strictEqual(fs.existsSync(path.join(installRoot, 'nasiko')), false);
        assert.throws(() => extractQualifiedTarGzip(Buffer.from('not gzip'), 'nasiko'), /invalid|size limit/i);
      } finally {
        fs.rmSync(installRoot, { recursive: true, force: true });
      }
    }],
    ['accepts one complete tar entry and rejects malformed tar boundaries', () => {
      const { extractQualifiedTarGzip } = require('../../scripts/lib/nasiko-release');
      assert.deepStrictEqual(
        extractQualifiedTarGzip(tarGzipFixture(), 'nasiko'),
        Buffer.from('x')
      );
      assert.throws(
        () => extractQualifiedTarGzip(tarGzipFixture({ padding: false }), 'nasiko'),
        /unsafe|truncated|terminator/i
      );
      assert.throws(
        () => extractQualifiedTarGzip(tarGzipFixture({ trailing: Buffer.from([1]) }), 'nasiko'),
        /unsafe|trailing/i
      );
      assert.throws(
        () => extractQualifiedTarGzip(tarGzipFixture({ sizeField: '00000000001x' }), 'nasiko'),
        /size|octal|unsafe/i
      );
      assert.throws(
        () => extractQualifiedTarGzip(tarGzipFixture({ terminatorBlocks: 1 }), 'nasiko'),
        /terminator|truncated|unsafe/i
      );
    }],
    ['read-only status never executes an unqualified explicit executable', () => {
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-status-'));
      const executable = path.join(fixtureRoot, 'nasiko');
      const marker = path.join(fixtureRoot, 'executed');
      fs.writeFileSync(executable, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nprintf "nasiko 0.1.0\\n"\n`, { mode: 0o755 });
      try {
        const result = spawnSync(process.execPath, [
          path.join(REPO_ROOT, 'scripts', 'ecc.js'),
          'nasiko',
          'status',
          '--json',
        ], {
          encoding: 'utf8',
          env: { ...process.env, ECC_NASIKO_CLI_EXECUTABLE: executable },
        });
        assert.strictEqual(result.status, 0, result.stderr);
        const status = JSON.parse(result.stdout);
        assert.strictEqual(status.installed, true);
        assert.strictEqual(status.qualified, false);
        assert.strictEqual(status.version, null);
        assert.strictEqual(status.executable, executable);
        assert.strictEqual(fs.existsSync(marker), false);
      } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }],
    ['read-only status has a stable absent result shape', () => {
      const { readStatus } = require('../../scripts/nasiko');
      const { normalizePlatform } = require('../../scripts/lib/nasiko-release');
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-absent-'));
      try {
        assert.deepStrictEqual(readStatus({ installDir: fixtureRoot }), {
          installed: false,
          qualified: false,
          version: null,
          executable: path.join(fs.realpathSync(fixtureRoot), normalizePlatform().binaryName),
        });
      } finally { fs.rmSync(fixtureRoot, { recursive: true, force: true }); }
    }],
    ['rejects and never executes an unqualified pre-existing binary', async () => {
      const { installNasiko } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-existing-'));
      const executable = path.join(installRoot, 'nasiko');
      const marker = path.join(installRoot, 'executed');
      fs.writeFileSync(executable, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\necho nasiko 0.1.0\n`, { mode: 0o755 });
      try {
        await assert.rejects(
          installNasiko({ version: 'v0.1.0', yes: true, installDir: installRoot }, {
            platform: 'darwin', arch: 'arm64',
          }),
          /unqualified|digest|metadata/i
        );
        assert.strictEqual(fs.existsSync(marker), false);
      } finally {
        fs.rmSync(installRoot, { recursive: true, force: true });
      }
    }],
    ['rolls back a published binary when metadata persistence fails', async () => {
      const { installNasiko } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-rollback-'));
      const binary = Buffer.from('qualified binary');
      const archive = Buffer.from('verified archive');
      const manifest = Buffer.from(JSON.stringify({
        schemaVersion: 2,
        mediaType: 'application/vnd.oci.image.manifest.v1+json',
        layers: [{ mediaType: 'application/gzip', digest: sha256Digest(archive), size: archive.length }],
      }));
      try {
        await assert.rejects(
          installNasiko({ version: 'v0.1.0', yes: true, installDir: installRoot }, {
            platform: 'darwin',
            arch: 'arm64',
            releaseOverride: {
              manifestDigest: sha256Digest(manifest),
              binaryDigest: sha256Digest(binary),
            },
            fetchBytes: async url => url.includes('/manifests/') ? manifest : archive,
            extractBinary: () => binary,
            writeMetadata: () => { throw new Error('metadata unavailable'); },
          }),
          /metadata unavailable/i
        );
        assert.strictEqual(fs.existsSync(path.join(installRoot, 'nasiko')), false);
      } finally {
        fs.rmSync(installRoot, { recursive: true, force: true });
      }
    }],
    ['never overwrites or deletes a destination created during publication', async () => {
      const { installNasiko } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-race-'));
      const binary = Buffer.from('qualified binary');
      const intruder = Buffer.from('concurrent owner');
      const archive = Buffer.from('verified archive');
      const manifest = Buffer.from(JSON.stringify({ schemaVersion: 2, layers: [{ mediaType: 'application/gzip', digest: sha256Digest(archive), size: archive.length }] }));
      try {
        await assert.rejects(installNasiko({ version: 'v0.1.0', yes: true, installDir: installRoot }, {
          platform: 'darwin', arch: 'arm64',
          releaseOverride: { manifestDigest: sha256Digest(manifest), binaryDigest: sha256Digest(binary) },
          fetchBytes: async url => url.includes('/manifests/') ? manifest : archive,
          extractBinary: () => binary,
          beforePublish: destination => fs.writeFileSync(destination, intruder, { flag: 'wx' }),
        }), /exist/i);
        assert.deepStrictEqual(fs.readFileSync(path.join(installRoot, 'nasiko')), intruder);
      } finally { fs.rmSync(installRoot, { recursive: true, force: true }); }
    }],
    ['fails uninstall when staged tombstones cannot be removed', () => {
      const { uninstallNasiko } = require('../../scripts/lib/nasiko-release');
      const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nasiko-cleanup-failure-'));
      const executable = path.join(installRoot, 'nasiko');
      const metadataPath = path.join(installRoot, '.ecc-nasiko-install.json');
      fs.writeFileSync(executable, 'qualified binary', { mode: 0o700 });
      fs.writeFileSync(metadataPath, '{}', { mode: 0o600 });
      try {
        assert.throws(() => uninstallNasiko({ installDir: installRoot, yes: true }, {
          platform: 'darwin',
          arch: 'arm64',
          inspectInstalled: () => ({ installed: true, qualified: true, version: 'v0.1.0' }),
          remove: target => { throw new Error(`retained ${target}`); },
        }), /incomplete|retained|cleanup/i);
        assert.ok(fs.readdirSync(installRoot).some(name => name.includes('.remove-')));
      } finally { fs.rmSync(installRoot, { recursive: true, force: true }); }
    }],
    ['ships a canonical opt-in skill without silently bundling Nasiko', () => {
      const skill = read('skills/nasiko-control-plane/SKILL.md');
      assert.match(skill, /^name: nasiko-control-plane$/m);
      assert.match(skill, /ecc nasiko status/i);
      assert.match(skill, /explicit.*consent|explicit.*--yes/i);
      assert.match(skill, /pinned.*v0\.1\.0/i);
      assert.match(skill, /telemetry.*opt-in/i);
      assert.match(skill, /never.*secrets|never.*credentials/i);
      assert.match(skill, /install.*does not prove/i);
      assert.match(skill, /ecc nasiko uninstall/i);
      assert.doesNotMatch(skill, /curl[^\n]*\|[^\n]*bash|irm[^\n]*\|[^\n]*iex/i);

      const modules = readJson('manifests/install-modules.json').modules;
      const module = modules.find(candidate => candidate.id === 'nasiko-control-plane');
      assert.ok(module, 'nasiko-control-plane module is missing');
      assert.deepStrictEqual(module.paths, ['skills/nasiko-control-plane']);
      assert.deepStrictEqual(module.dependencies, ['platform-configs']);
      assert.strictEqual(module.defaultInstall, false);
      assert.strictEqual(module.stability, 'experimental');

      const components = readJson('manifests/install-components.json').components;
      assert.deepStrictEqual(
        components.find(candidate => candidate.id === 'capability:nasiko-control-plane'),
        {
          id: 'capability:nasiko-control-plane',
          family: 'capability',
          description: 'Experimental Nasiko CLI lifecycle bridge guidance for pinned installation, read-only status, qualified uninstall, and opt-in telemetry boundaries.',
          modules: ['nasiko-control-plane'],
        }
      );

      const profiles = readJson('manifests/install-profiles.json').profiles;
      assert.ok(profiles.full.modules.includes('nasiko-control-plane'));
      for (const [profileId, profile] of Object.entries(profiles)) {
        if (profileId !== 'full') assert.ok(!profile.modules.includes('nasiko-control-plane'));
      }

      const packageJson = readJson('package.json');
      assert.ok(packageJson.files.includes('skills/nasiko-control-plane/'));
      assert.ok(packageJson.files.includes('scripts/nasiko.js'));
      assert.ok(packageJson.files.includes('scripts/lib/'));
      assert.ok(!packageJson.dependencies?.nasiko);
      assert.ok(!packageJson.optionalDependencies?.nasiko);
    }],
  ];

  let passed = 0;
  let failed = 0;
  for (const [name, testFunction] of tests) {
    if (await runTest(name, testFunction)) passed += 1;
    else failed += 1;
  }

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
