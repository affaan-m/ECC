'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyMultiHarnessPlan,
  createMultiHarnessPlan,
  normalizeGuidedInstallRequest,
  preflightManagedPlan,
} = require('../../scripts/lib/multi-harness-setup');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function managedPlan(root, operations, owned = []) {
  const installStatePath = path.join(root, '.ecc', 'install-state.json');
  if (owned.length > 0) {
    writeFile(installStatePath, JSON.stringify({
      schemaVersion: 'ecc.install.v1',
      operations: owned.map(destinationPath => ({ destinationPath })),
    }));
  }
  return {
    adapter: { id: 'kimi-project', target: 'kimi' },
    installStatePath,
    operations,
    target: 'kimi',
    targetRoot: root,
  };
}

(async () => {
  console.log('\n=== Multi-harness guided setup tests ===\n');

  await test('normalizes provider-specific options without inventing shared semantics', () => {
    assert.deepStrictEqual(normalizeGuidedInstallRequest({
      harnesses: ['kimi', 'claude', 'kimi'],
      claudeHooks: 'minimal',
      claudeScope: 'local',
      profile: 'developer',
    }), {
      harnesses: ['claude', 'kimi'],
      claudeHooks: 'minimal',
      claudeScope: 'local',
      dryRun: false,
      json: false,
      profile: 'developer',
      yes: false,
    });

    assert.throws(
      () => normalizeGuidedInstallRequest({ harnesses: ['kimi'], claudeScope: 'user' }),
      /Claude.*selected/i
    );
    assert.throws(
      () => normalizeGuidedInstallRequest({ harnesses: ['codex'], profile: 'core' }),
      /Kimi.*selected/i
    );
  });

  await test('classifies missing, identical, managed, and JSON merge destinations', () => {
    const root = tempDir('ecc-guided-preflight-');
    try {
      const sourceSame = path.join(root, 'sources', 'same.md');
      const sourceManaged = path.join(root, 'sources', 'managed.md');
      const destinationSame = path.join(root, 'same.md');
      const destinationManaged = path.join(root, 'managed.md');
      const destinationJson = path.join(root, 'mcp.json');
      writeFile(sourceSame, 'same\n');
      writeFile(sourceManaged, 'new\n');
      writeFile(destinationSame, 'same\n');
      writeFile(destinationManaged, 'old\n');
      writeFile(destinationJson, '{"other":true}\n');
      const plan = managedPlan(root, [
        { kind: 'copy-file', sourcePath: sourceSame, destinationPath: destinationSame },
        { kind: 'copy-file', sourcePath: sourceManaged, destinationPath: destinationManaged },
        { kind: 'merge-json', destinationPath: destinationJson, mergePayload: { ecc: true } },
        { kind: 'copy-file', sourcePath: sourceSame, destinationPath: path.join(root, 'new.md') },
      ], [destinationManaged]);

      const result = preflightManagedPlan(plan, {
        readInstallState: () => ({ operations: [{ destinationPath: destinationManaged }] }),
      });
      assert.deepStrictEqual(result.operations.map(item => item.classification), [
        'identical',
        'managed-update',
        'json-merge',
        'create',
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('refuses an unowned differing managed-target file', () => {
    const root = tempDir('ecc-guided-collision-');
    try {
      const source = path.join(root, 'source.md');
      const destination = path.join(root, 'AGENTS.md');
      writeFile(source, 'ecc\n');
      writeFile(destination, 'user\n');
      assert.throws(
        () => preflightManagedPlan(managedPlan(root, [
          { kind: 'copy-file', sourcePath: source, destinationPath: destination },
        ])),
        /unowned.*AGENTS\.md/i
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('refuses a conflicting key in an unowned JSON merge destination', () => {
    const root = tempDir('ecc-guided-json-collision-');
    try {
      const destination = path.join(root, 'mcp.json');
      writeFile(destination, JSON.stringify({
        mcpServers: { github: { command: 'user-owned-server' } },
      }));
      assert.throws(
        () => preflightManagedPlan(managedPlan(root, [
          {
            kind: 'merge-json',
            destinationPath: destination,
            mergePayload: { mcpServers: { github: { command: 'ecc-server' } } },
          },
        ])),
        /unowned JSON.*mcpServers\.github\.command/i
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('rejects symlinked managed ancestors during batch preflight', () => {
    const root = tempDir('ecc-guided-symlink-root-');
    const outside = tempDir('ecc-guided-symlink-outside-');
    try {
      const source = path.join(root, 'source.md');
      const linkedDirectory = path.join(root, 'rules');
      writeFile(source, 'ecc\n');
      fs.symlinkSync(outside, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(
        () => preflightManagedPlan(managedPlan(root, [
          {
            kind: 'copy-file',
            sourcePath: source,
            destinationPath: path.join(linkedDirectory, 'security.md'),
          },
        ])),
        /outside the install root|symlinked path/i
      );
      assert.strictEqual(fs.existsSync(path.join(outside, 'security.md')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  await test('rejects an unwritable Kimi destination during preflight', () => {
    const root = tempDir('ecc-guided-unwritable-');
    try {
      const destination = path.join(root, '.kimi-code', 'rules', 'security.md');
      const accessChecks = [];
      const accessError = new Error('permission denied');
      accessError.code = 'EACCES';
      assert.throws(
        () => preflightManagedPlan(managedPlan(root, [
          { kind: 'copy-file', destinationPath: destination },
        ]), {
          accessSync(candidatePath, mode) {
            accessChecks.push({ candidatePath, mode });
            throw accessError;
          },
        }),
        error => (
          /Kimi destination is not writable by the current user/i.test(error.message)
          && error.message.includes(root)
        )
      );
      assert.deepStrictEqual(accessChecks, [{
        candidatePath: root,
        mode: fs.constants.W_OK | fs.constants.X_OK,
      }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('real filesystem preflight rejects an unwritable project root', () => {
    if (process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0)) {
      return;
    }
    const root = tempDir('ecc-guided-real-permissions-');
    const projectRoot = path.join(root, 'project');
    fs.mkdirSync(projectRoot, { mode: 0o755 });
    try {
      fs.chmodSync(projectRoot, 0o555);
      assert.throws(
        () => preflightManagedPlan(managedPlan(projectRoot, [
          {
            kind: 'copy-file',
            destinationPath: path.join(projectRoot, '.kimi-code', 'rules', 'security.md'),
          },
        ])),
        /Kimi destination is not writable by the current user/i
      );
      assert.strictEqual(fs.existsSync(path.join(projectRoot, '.kimi-code')), false);
    } finally {
      fs.chmodSync(projectRoot, 0o755);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('preflights every selected harness before applying any mutation', async () => {
    const events = [];
    const request = normalizeGuidedInstallRequest({
      harnesses: ['claude', 'codex', 'kimi'],
      claudeHooks: 'standard',
      claudeScope: 'user',
      profile: 'core',
    });
    await assert.rejects(
      () => createMultiHarnessPlan(request, {
        previewClaude: async () => events.push('preview:claude'),
        previewCodex: async () => events.push('preview:codex'),
        createManagedPlan: async () => ({ target: 'kimi' }),
        preflightManaged: async () => {
          events.push('preview:kimi');
          throw new Error('unowned collision');
        },
      }),
      /collision/
    );
    assert.deepStrictEqual(events, ['preview:claude', 'preview:codex', 'preview:kimi']);
  });

  await test('applies in catalog order and reports partial completion with an exact retry set', async () => {
    const plan = {
      harnesses: [
        { id: 'claude', preview: {} },
        { id: 'codex', preview: {} },
        { id: 'kimi', preview: {} },
      ],
      request: { harnesses: ['claude', 'codex', 'kimi'] },
    };
    const events = [];
    const result = await applyMultiHarnessPlan(plan, {
      applyClaude: async () => { events.push('claude'); return { action: 'installed' }; },
      applyCodex: async () => { events.push('codex'); throw new Error('verification failed'); },
      applyManaged: async () => { events.push('kimi'); return { applied: true }; },
    });
    assert.deepStrictEqual(events, ['claude', 'codex']);
    assert.strictEqual(result.status, 'partial');
    assert.deepStrictEqual(result.completed.map(item => item.id), ['claude']);
    assert.strictEqual(result.failure.id, 'codex');
    assert.deepStrictEqual(result.retryHarnesses, ['codex', 'kimi']);
  });

  await test('a late Kimi permission failure retries only Kimi', async () => {
    const plan = {
      harnesses: [
        { id: 'claude', preview: {} },
        { id: 'codex', preview: {} },
        { id: 'kimi', preview: {} },
      ],
      request: { harnesses: ['claude', 'codex', 'kimi'] },
    };
    const events = [];
    const result = await applyMultiHarnessPlan(plan, {
      applyClaude: async () => { events.push('claude'); return { action: 'installed' }; },
      applyCodex: async () => { events.push('codex'); return { action: 'installed' }; },
      applyManaged: async () => {
        events.push('kimi');
        const error = new Error('permission denied');
        error.code = 'EACCES';
        throw error;
      },
    });
    assert.deepStrictEqual(events, ['claude', 'codex', 'kimi']);
    assert.strictEqual(result.status, 'partial');
    assert.deepStrictEqual(result.completed.map(item => item.id), ['claude', 'codex']);
    assert.strictEqual(result.failure.id, 'kimi');
    assert.deepStrictEqual(result.retryHarnesses, ['kimi']);
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
