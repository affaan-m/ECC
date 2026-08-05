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
const { createInstallState } = require('../../scripts/lib/install-state');

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

function stateOperation(destinationPath, overrides = {}) {
  return {
    kind: 'copy-file',
    moduleId: 'core',
    sourceRelativePath: 'rules/security.md',
    destinationPath,
    strategy: 'preserve-relative-path',
    ownership: 'managed',
    scaffoldOnly: false,
    ...overrides,
  };
}

function stateOperationFrom(operation) {
  return stateOperation(operation.destinationPath, {
    kind: operation.kind,
    moduleId: operation.moduleId || 'core',
    sourceRelativePath: operation.sourceRelativePath || 'rules/security.md',
    strategy: operation.strategy || (operation.kind === 'merge-json' ? 'merge-json' : 'preserve-relative-path'),
    ownership: operation.ownership || 'managed',
    scaffoldOnly: Boolean(operation.scaffoldOnly),
  });
}

function managedPlan(root, operations, owned = []) {
  const installStatePath = path.join(root, '.kimi-code', 'ecc-install-state.json');
  const plan = {
    adapter: { id: 'kimi-project', target: 'kimi', kind: 'project' },
    installStatePath,
    operations,
    target: 'kimi',
    targetRoot: root,
  };
  plan.statePreview = createInstallState({
    adapter: plan.adapter,
    installStatePath,
    operations: operations.map(stateOperationFrom),
    request: {},
    resolution: {},
    source: { manifestVersion: 1 },
    targetRoot: root,
  });
  if (owned.length > 0) {
    writeManagedState(plan, { operations: owned.map(destinationPath => stateOperation(destinationPath)) });
  }
  return plan;
}

function writeManagedState(plan, overrides = {}) {
  const state = createInstallState({
    adapter: plan.adapter,
    installStatePath: plan.installStatePath,
    operations: [],
    request: {},
    resolution: {},
    source: { manifestVersion: 1 },
    targetRoot: plan.targetRoot,
  });
  const nextState = {
    ...state,
    ...overrides,
    target: { ...state.target, ...(overrides.target || {}) },
    operations: overrides.operations || state.operations,
  };
  writeFile(plan.installStatePath, `${JSON.stringify(nextState, null, 2)}\n`);
  return nextState;
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

      const result = preflightManagedPlan(plan);
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

  await test('rejects valid install-state from a different managed target identity', () => {
    const root = tempDir('ecc-guided-forged-target-');
    try {
      const source = path.join(root, 'source.md');
      const destination = path.join(root, 'AGENTS.md');
      writeFile(source, 'ecc\n');
      writeFile(destination, 'user\n');
      const plan = managedPlan(root, [
        stateOperation(destination, { sourcePath: source }),
      ]);
      writeManagedState(plan, {
        target: { id: 'cursor-project', target: 'cursor' },
        operations: [stateOperation(destination)],
      });

      assert.throws(
        () => preflightManagedPlan(plan),
        /install-state.*target identity|does not belong.*Kimi/i
      );
      assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'user\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('rejects install-state with mismatched canonical root or state path', () => {
    const root = tempDir('ecc-guided-forged-paths-');
    const otherRoot = tempDir('ecc-guided-forged-other-');
    try {
      const source = path.join(root, 'source.md');
      const destination = path.join(root, 'AGENTS.md');
      writeFile(source, 'ecc\n');
      writeFile(destination, 'user\n');
      const plan = managedPlan(root, [
        stateOperation(destination, { sourcePath: source }),
      ]);

      for (const target of [
        { root: otherRoot },
        { installStatePath: path.join(otherRoot, 'ecc-install-state.json') },
      ]) {
        writeManagedState(plan, {
          target,
          operations: [stateOperation(destination)],
        });
        assert.throws(
          () => preflightManagedPlan(plan),
          /install-state.*(root|path).*does not match/i
        );
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  await test('rejects install-state ownership claims outside the canonical target root', () => {
    const root = tempDir('ecc-guided-forged-containment-');
    const outside = tempDir('ecc-guided-forged-outside-');
    try {
      const source = path.join(root, 'source.md');
      const destination = path.join(root, 'AGENTS.md');
      writeFile(source, 'ecc\n');
      writeFile(destination, 'user\n');
      const plan = managedPlan(root, [
        stateOperation(destination, { sourcePath: source }),
      ]);
      writeManagedState(plan, {
        operations: [stateOperation(path.join(outside, 'AGENTS.md'))],
      });

      assert.throws(
        () => preflightManagedPlan(plan),
        /install-state.*outside|outside the install root/i
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
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

  await test('refuses a copy-file destination created after preview but before apply', async () => {
    const root = tempDir('ecc-guided-late-copy-collision-');
    try {
      const source = path.join(root, 'source.md');
      const destination = path.join(root, '.kimi-code', 'rules', 'security.md');
      writeFile(source, 'ecc\n');
      const plan = managedPlan(root, [stateOperation(destination, { sourcePath: source })]);
      const preview = preflightManagedPlan(plan);

      const result = await applyMultiHarnessPlan({
        harnesses: [{ id: 'kimi', preview }],
        request: { harnesses: ['kimi'] },
      }, {
        preflightManaged(candidatePlan) {
          const latestPreview = preflightManagedPlan(candidatePlan);
          writeFile(destination, 'user\n');
          return latestPreview;
        },
      });

      assert.strictEqual(result.status, 'failed');
      assert.match(result.failure.message, /unowned existing file/i);
      assert.deepStrictEqual(result.retryHarnesses, ['kimi']);
      assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'user\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('refuses a late unowned copy even when its bytes match the ECC source', async () => {
    const root = tempDir('ecc-guided-late-identical-copy-');
    try {
      const source = path.join(root, 'source.md');
      const destination = path.join(root, '.kimi-code', 'rules', 'security.md');
      writeFile(source, 'ecc\n');
      const plan = managedPlan(root, [stateOperation(destination, { sourcePath: source })]);
      const preview = preflightManagedPlan(plan);

      const result = await applyMultiHarnessPlan({
        harnesses: [{ id: 'kimi', preview }],
        request: { harnesses: ['kimi'] },
      }, {
        preflightManaged(candidatePlan) {
          const latestPreview = preflightManagedPlan(candidatePlan);
          writeFile(destination, 'ecc\n');
          return latestPreview;
        },
      });

      assert.strictEqual(result.status, 'failed');
      assert.match(result.failure.message, /destination changed after Kimi preflight/i);
      assert.deepStrictEqual(result.retryHarnesses, ['kimi']);
      assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'ecc\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('refuses conflicting JSON created after preview but before apply', async () => {
    const root = tempDir('ecc-guided-late-json-collision-');
    try {
      const destination = path.join(root, '.kimi-code', 'mcp.json');
      const operation = stateOperation(destination, {
        kind: 'merge-json',
        mergePayload: { mcpServers: { github: { command: 'ecc-server' } } },
        sourceRelativePath: '.mcp.json',
        strategy: 'merge-json',
      });
      const plan = managedPlan(root, [operation]);
      const preview = preflightManagedPlan(plan);

      const result = await applyMultiHarnessPlan({
        harnesses: [{ id: 'kimi', preview }],
        request: { harnesses: ['kimi'] },
      }, {
        preflightManaged(candidatePlan) {
          const latestPreview = preflightManagedPlan(candidatePlan);
          writeFile(destination, JSON.stringify({
            mcpServers: { github: { command: 'user-server' } },
          }));
          return latestPreview;
        },
      });

      assert.strictEqual(result.status, 'failed');
      assert.match(result.failure.message, /unowned JSON.*mcpServers\.github\.command/i);
      assert.deepStrictEqual(result.retryHarnesses, ['kimi']);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(destination, 'utf8')), {
        mcpServers: { github: { command: 'user-server' } },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('refuses an install-state file created after preview instead of overwriting it', async () => {
    const root = tempDir('ecc-guided-late-state-collision-');
    try {
      const source = path.join(root, 'source.md');
      const destination = path.join(root, '.kimi-code', 'rules', 'security.md');
      writeFile(source, 'ecc\n');
      const plan = managedPlan(root, [stateOperation(destination, { sourcePath: source })]);
      const preview = preflightManagedPlan(plan);
      const unexpectedState = '{"user":"owned"}\n';

      const result = await applyMultiHarnessPlan({
        harnesses: [{ id: 'kimi', preview }],
        request: { harnesses: ['kimi'] },
      }, {
        preflightManaged(candidatePlan) {
          const latestPreview = preflightManagedPlan(candidatePlan);
          writeFile(plan.installStatePath, unexpectedState);
          return latestPreview;
        },
      });

      assert.strictEqual(result.status, 'failed');
      assert.match(result.failure.message, /unowned or changed install-state/i);
      assert.deepStrictEqual(result.retryHarnesses, ['kimi']);
      assert.strictEqual(fs.existsSync(destination), false);
      assert.strictEqual(fs.readFileSync(plan.installStatePath, 'utf8'), unexpectedState);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
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
