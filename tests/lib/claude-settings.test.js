/**
 * Focused coverage for safely managing ECC hook entries in Claude settings.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  runWithSettingsLock,
  materializeManagedHooks,
  inspectManagedHooks,
  mergeManagedHooks,
  parseSettings,
  readSettings,
  repairManagedHooks,
  replacePluginRootPlaceholders,
  uninstallManagedHooks,
  updateSettingsAtomic,
  validateManagedHooks,
} = require('../../scripts/lib/install/claude-settings');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    return false;
  }
}

function entry(id, command, extra = {}) {
  return {
    matcher: '.*',
    hooks: [{ type: 'command', command }],
    id,
    ...extra,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertAtomicParentReplacementRejected(stage) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-settings-parent-race-'));
  const targetRoot = path.join(tempDir, 'target');
  const parkedRoot = path.join(tempDir, 'parked');
  const victimRoot = path.join(tempDir, 'victim');
  const settingsPath = path.join(targetRoot, 'settings.json');
  const victimPath = path.join(victimRoot, 'settings.json');
  const originalFsync = fs.fsyncSync;
  const originalClose = fs.closeSync;
  const targetContent = '{"target":true}\n';
  const victimContent = '{"victim":"preserve"}\n';
  let tempDescriptor;
  let tempBasename;
  let replacementAttempted = false;
  let replacementBlocked = false;
  let replaced = false;
  const replaceParent = () => {
    replacementAttempted = true;
    try {
      fs.renameSync(targetRoot, parkedRoot);
    } catch (error) {
      replacementBlocked = process.platform === 'win32'
        && ['EPERM', 'EACCES'].includes(error.code);
      throw error;
    }
    fs.symlinkSync(victimRoot, targetRoot, process.platform === 'win32' ? 'junction' : 'dir');
    replaced = true;
    // A colliding path in the replacement directory must survive error cleanup.
    fs.writeFileSync(path.join(victimRoot, tempBasename), 'unrelated replacement file');
  };
  try {
    fs.mkdirSync(targetRoot);
    fs.mkdirSync(victimRoot);
    fs.writeFileSync(settingsPath, targetContent);
    fs.writeFileSync(victimPath, victimContent);
    fs.fsyncSync = function(descriptor) {
      const result = originalFsync.call(fs, descriptor);
      const stagedName = fs.readdirSync(targetRoot).find(name => (
        name.startsWith('.settings.json.') && name.endsWith('.tmp')
      ));
      if (stagedName) {
        tempBasename = stagedName;
        tempDescriptor = descriptor;
        // Exercise replacement while the staging handle is still open. The
        // production writer owns the descriptor and closes it on rejection.
        // Intercept fsync rather than forwarding arbitrary file-creation flags.
        if (!replacementAttempted && stage === 'open') replaceParent();
      }
      return result;
    };
    fs.closeSync = function(descriptor) {
      const result = originalClose.call(fs, descriptor);
      // At the rename boundary the staging handle has been closed. Windows
      // can now replace the parent, exercising ECC's identity check too.
      if (!replacementAttempted && stage === 'rename' && descriptor === tempDescriptor) replaceParent();
      return result;
    };
    assert.throws(
      () => updateSettingsAtomic(settingsPath, settings => ({ settings: { ...settings, managed: true } })),
      error => /parent.*changed|changed.*parent/i.test(error.message)
        || (replacementBlocked && ['EPERM', 'EACCES'].includes(error.code))
    );
    assert.ok(replacementAttempted, 'must attempt replacement inside the atomic writer');
    assert.throws(() => fs.fstatSync(tempDescriptor), error => error.code === 'EBADF',
      'every staging descriptor must be closed after rejection');
    assert.strictEqual(fs.readFileSync(victimPath, 'utf8'), victimContent);
    if (replacementBlocked) {
      assert.strictEqual(stage, 'open', 'rename-stage replacement happens after closing the staging handle');
      assert.strictEqual(replaced, false);
      assert.strictEqual(fs.readFileSync(settingsPath, 'utf8'), targetContent);
      assert.deepStrictEqual(fs.readdirSync(targetRoot), ['settings.json']);
      assert.deepStrictEqual(fs.readdirSync(victimRoot), ['settings.json']);
    } else {
      assert.ok(replaced, 'a permitted replacement must reach the parent identity check');
      assert.strictEqual(fs.readFileSync(path.join(parkedRoot, 'settings.json'), 'utf8'), targetContent);
      assert.strictEqual(fs.readFileSync(path.join(victimRoot, tempBasename), 'utf8'), 'unrelated replacement file');
    }
  } finally {
    fs.fsyncSync = originalFsync;
    fs.closeSync = originalClose;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function runTests() {
  console.log('\n=== Testing install/claude-settings.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('validates and clones a managed hook map without mutating it', () => {
    const managed = {
      SessionStart: [entry('session:start', 'node start.js')],
      Stop: [entry('session:stop', 'node stop.js')],
    };
    const validated = validateManagedHooks(managed);

    assert.deepStrictEqual(validated, managed);
    assert.notStrictEqual(validated, managed);
    assert.notStrictEqual(validated.SessionStart[0], managed.SessionStart[0]);
  })) passed++; else failed++;

  if (test('strictly rejects invalid managed hook maps and globally duplicate ids', () => {
    const invalidValues = [
      null,
      [],
      {},
      { SessionStart: [] },
      { SessionStart: {} },
      { SessionStart: [null] },
      { SessionStart: [[]] },
      { SessionStart: [{}] },
      { SessionStart: [{ id: '   ' }] },
      { BogusEvent: [entry('bad:event', 'bad')] },
      { SessionStart: [{ id: 'missing:hooks', matcher: '.*' }] },
      { SessionStart: [{ id: 'bad:command', matcher: '.*', hooks: [{ type: 'command' }] }] },
    ];

    for (const invalid of invalidValues) {
      assert.throws(() => validateManagedHooks(invalid), /managed hooks|hook entry|unique id/i);
    }
    assert.throws(
      () => validateManagedHooks({
        Stop: [entry('shared', 'a')],
        SubagentStop: [entry('shared', 'b')],
      }),
      /expected globally unique id "shared"/
    );
  })) passed++; else failed++;

  if (test('materializes hook roots and rejects unresolved environment references', () => {
    const source = {
      hooks: {
        Stop: [entry(
          'ecc:stop',
          'var e=process.env.CLAUDE_PLUGIN_ROOT; '
            + 'process.env.CLAUDE_PLUGIN_ROOT=r; ${CLAUDE_PLUGIN_ROOT}'
        )],
      },
    };
    const before = clone(source);
    const materialized = materializeManagedHooks(source, '/opt/ecc');
    const command = materialized.Stop[0].hooks[0].command;
    const encodedRoot = command.match(/Buffer\.from\('([^']+)','base64'\)/)[1];

    assert.deepStrictEqual(source, before);
    assert.ok(!command.includes('var e=process.env.CLAUDE_PLUGIN_ROOT;'));
    assert.ok(!command.includes('${CLAUDE_PLUGIN_ROOT}'));
    assert.strictEqual(Buffer.from(encodedRoot, 'base64').toString('utf8'), '/opt/ecc');
    assert.throws(() => materializeManagedHooks({}, '/opt/ecc'), /hooks object/);
    assert.throws(() => materializeManagedHooks(source, ''), /target root/);
    assert.throws(
      () => materializeManagedHooks({
        hooks: {
          Stop: [entry('ecc:stop', 'node -e "const e=process.env.CLAUDE_PLUGIN_ROOT"')],
        },
      }, '/opt/ecc'),
      /Unable to resolve CLAUDE_PLUGIN_ROOT/
    );
  })) passed++; else failed++;

  if (test('replaces every plugin-root placeholder recursively and immutably', () => {
    const source = {
      SessionStart: [{
        id: 'session:start',
        command: '${CLAUDE_PLUGIN_ROOT}/start.js:${CLAUDE_PLUGIN_ROOT}',
        nested: ['${CLAUDE_PLUGIN_ROOT}/nested.js', 3, null],
      }],
    };
    const before = clone(source);

    const resolved = replacePluginRootPlaceholders(source, '/opt/ecc');

    assert.deepStrictEqual(source, before);
    assert.deepStrictEqual(resolved, {
      SessionStart: [{
        id: 'session:start',
        command: '/opt/ecc/start.js:/opt/ecc',
        nested: ['/opt/ecc/nested.js', 3, null],
      }],
    });
  })) passed++; else failed++;

  if (test('parseSettings accepts an object and validates every hooks event array', () => {
    assert.deepStrictEqual(
      parseSettings('{"theme":"dark","hooks":{"Stop":[]}}', 'memory settings'),
      { theme: 'dark', hooks: { Stop: [] } }
    );
    assert.throws(() => parseSettings('{', 'memory settings'), /Failed to parse memory settings/);
    assert.throws(() => parseSettings('null', 'memory settings'), /expected a JSON object/);
    assert.throws(() => parseSettings('[]', 'memory settings'), /expected a JSON object/);
    assert.throws(
      () => parseSettings('{"hooks":{"Stop":{}}}', 'memory settings'),
      /hooks\.Stop.*array/
    );
    assert.throws(
      () => parseSettings('{"hooks":[]}', 'memory settings'),
      /"hooks".*object/
    );
  })) passed++; else failed++;

  if (test('readSettings returns an empty object for ENOENT and rejects bad files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-settings-'));
    try {
      assert.deepStrictEqual(readSettings(path.join(tempDir, 'missing.json')), {});

      const malformedPath = path.join(tempDir, 'malformed.json');
      fs.writeFileSync(malformedPath, '{', 'utf8');
      assert.throws(() => readSettings(malformedPath), /Failed to parse Claude settings/);

      const invalidPath = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(invalidPath, '{"hooks":{"Stop":false}}', 'utf8');
      assert.throws(() => readSettings(invalidPath), /hooks\.Stop.*array/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('readSettings propagates non-ENOENT read errors without converting them to empty settings', () => {
    const denied = new Error('denied');
    denied.code = 'EACCES';
    assert.throws(
      () => readSettings('/private/settings.json', {
        readFileSync() {
          throw denied;
        },
      }),
      error => error === denied
    );
  })) passed++; else failed++;

  if (test('atomic settings updates retry after a concurrent change and preserve secure mode', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-settings-atomic-'));
    const settingsPath = path.join(tempDir, 'settings.json');
    let commitAttempts = 0;
    try {
      const result = updateSettingsAtomic(
        settingsPath,
        settings => ({ settings: { ...settings, managed: true } }),
        {
          beforeCommit() {
            commitAttempts += 1;
            if (commitAttempts === 1) {
              fs.writeFileSync(settingsPath, '{"theme":"concurrent"}\n', { mode: 0o600 });
            }
          },
        }
      );

      assert.deepStrictEqual(result.settings, { theme: 'concurrent', managed: true });
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), result.settings);
      assert.strictEqual(commitAttempts, 2);
      if (process.platform !== 'win32') {
        assert.strictEqual(fs.statSync(settingsPath).mode & 0o777, 0o600);
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  for (const stage of ['open', 'rename']) {
    if (test(`atomic settings updates reject parent replacement at ${stage} without touching its files`, () => {
      assertAtomicParentReplacementRejected(stage);
    })) passed++; else failed++;
  }

  if (test('atomic settings updates preserve edits made while the replacement file is staged', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-settings-late-edit-'));
    const settingsPath = path.join(tempDir, 'settings.json');
    const originalFsync = fs.fsyncSync;
    let changed = false;
    let fsyncCalls = 0;
    try {
      fs.writeFileSync(settingsPath, '{"theme":"initial"}\n');
      fs.fsyncSync = function(descriptor) {
        const result = originalFsync.call(fs, descriptor);
        // Lock creation is the first fsync; only change settings after the
        // atomic writer has staged its first replacement payload.
        fsyncCalls += 1;
        if (!changed && fsyncCalls === 2) {
          changed = true;
          fs.writeFileSync(settingsPath, '{"theme":"late-edit"}\n');
        }
        return result;
      };
      updateSettingsAtomic(settingsPath, settings => ({ settings: { ...settings, managed: true } }));
      assert.ok(changed);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), { theme: 'late-edit', managed: true });
    } finally {
      fs.fsyncSync = originalFsync;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('atomic settings updates recover a stale invalid lock after its lease', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-settings-stale-lock-'));
    const settingsPath = path.join(tempDir, 'settings.json');
    const lockPath = `${settingsPath}.ecc.lock`;
    try {
      fs.writeFileSync(lockPath, '', { mode: 0o600 });
      const stale = new Date(Date.now() - (10 * 60 * 1000));
      fs.utimesSync(lockPath, stale, stale);
      updateSettingsAtomic(
        settingsPath,
        settings => ({ settings: { ...settings, recovered: true } })
      );
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), {
        recovered: true,
      });
      assert.ok(!fs.existsSync(lockPath));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('atomic settings updates serialize nested ECC writers and release the lock', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-settings-lock-'));
    const settingsPath = path.join(tempDir, 'settings.json');
    const lockPath = `${settingsPath}.ecc.lock`;
    try {
      updateSettingsAtomic(settingsPath, settings => {
        assert.throws(
          () => updateSettingsAtomic(
            settingsPath,
            nested => ({ settings: { ...nested, nested: true } })
          ),
          /Another ECC process is updating Claude settings/
        );
        return { settings: { ...settings, outer: true } };
      });

      assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), {
        outer: true,
      });
      assert.ok(!fs.existsSync(lockPath));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('atomic settings updates honor an already-held lock', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-settings-lock-held-'));
    const settingsPath = path.join(tempDir, 'settings.json');
    const lockPath = `${settingsPath}.ecc.lock`;
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
      updateSettingsAtomic(
        settingsPath,
        settings => ({ settings: { ...settings, held: true } }),
        { lockHeld: true }
      );
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), { held: true });
      assert.ok(fs.existsSync(lockPath));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('settings lock release failures do not replace the primary update error', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-settings-release-error-'));
    const settingsPath = path.join(tempDir, 'settings.json');
    const lockPath = `${settingsPath}.ecc.lock`;
    try {
      let caught;
      try {
        runWithSettingsLock(settingsPath, () => {
          fs.rmSync(lockPath, { force: true });
          throw new Error('primary settings failure');
        });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught);
      assert.strictEqual(caught.message, 'primary settings failure');
      assert.ok(caught.releaseError);
      assert.strictEqual(caught.releaseError.code, 'ENOENT');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('atomic settings updates refuse a symlinked destination', () => {
    if (process.platform === 'win32') {
      console.log('    (file symlink support is environment-dependent on Windows; skipping)');
      return;
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-settings-symlink-'));
    const realPath = path.join(tempDir, 'real.json');
    const settingsPath = path.join(tempDir, 'settings.json');
    try {
      fs.writeFileSync(realPath, '{"theme":"dark"}\n', { mode: 0o600 });
      fs.symlinkSync(realPath, settingsPath);
      assert.throws(
        () => updateSettingsAtomic(
          settingsPath,
          settings => ({ settings: { ...settings, managed: true } })
        ),
        error => error.code === 'ELOOP' || error.code === 'ECC_SETTINGS_CHANGED'
      );
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(realPath, 'utf8')), { theme: 'dark' });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('fresh merge appends managed entries while preserving unrelated settings and hooks', () => {
    const userEntry = { matcher: 'Bash', hooks: [{ type: 'command', command: 'user-hook' }] };
    const settings = {
      theme: 'dark',
      hooks: {
        SessionStart: [userEntry],
        Notification: [{ id: 'user:notification', command: 'notify' }],
      },
    };
    const managed = {
      SessionStart: [entry('ecc:start', 'node /opt/ecc/start.js')],
      Stop: [entry('ecc:stop', 'node /opt/ecc/stop.js')],
    };
    const settingsBefore = clone(settings);
    const managedBefore = clone(managed);

    const result = mergeManagedHooks(settings, managed);

    assert.deepStrictEqual(settings, settingsBefore);
    assert.deepStrictEqual(managed, managedBefore);
    assert.deepStrictEqual(result.settings, {
      theme: 'dark',
      hooks: {
        SessionStart: [userEntry, managed.SessionStart[0]],
        Notification: settings.hooks.Notification,
        Stop: managed.Stop,
      },
    });
    assert.deepStrictEqual(result.added, [
      { event: 'SessionStart', id: 'ecc:start' },
      { event: 'Stop', id: 'ecc:stop' },
    ]);
    assert.deepStrictEqual(result.updated, []);
  })) passed++; else failed++;

  if (test('fresh merge treats a different entry with the same event and id as a conflict', () => {
    const settings = {
      hooks: {
        Stop: [entry('ecc:stop', 'user-modified')],
      },
    };
    const managed = {
      Stop: [entry('ecc:stop', 'managed')],
    };

    assert.throws(
      () => mergeManagedHooks(settings, managed),
      /Refusing to overwrite.*Stop.*ecc:stop/
    );
    assert.deepStrictEqual(settings.hooks.Stop[0], entry('ecc:stop', 'user-modified'));
  })) passed++; else failed++;

  if (test('fresh merge adopts an identical existing event and id without duplicating it', () => {
    const managed = { Stop: [entry('ecc:stop', 'managed')] };
    const result = mergeManagedHooks({ hooks: clone(managed) }, managed);

    assert.deepStrictEqual(result.settings.hooks.Stop, managed.Stop);
    assert.deepStrictEqual(result.unchanged, [{ event: 'Stop', id: 'ecc:stop' }]);
  })) passed++; else failed++;

  if (test('upgrade replaces an entry only while it still equals previous managed content', () => {
    const previousManagedHooks = { Stop: [entry('ecc:stop', 'version-1')] };
    const managedHooks = { Stop: [entry('ecc:stop', 'version-2')] };
    const result = mergeManagedHooks(
      { hooks: { Stop: [entry('ecc:stop', 'version-1')] } },
      managedHooks,
      { previousManagedHooks }
    );

    assert.deepStrictEqual(result.settings.hooks.Stop, managedHooks.Stop);
    assert.deepStrictEqual(result.updated, [{ event: 'Stop', id: 'ecc:stop' }]);
  })) passed++; else failed++;

  if (test('upgrade fails closed when previous managed content has drifted', () => {
    const settings = { hooks: { Stop: [entry('ecc:stop', 'customer-edit')] } };
    const before = clone(settings);

    assert.throws(
      () => mergeManagedHooks(
        settings,
        { Stop: [entry('ecc:stop', 'version-2')] },
        { previousManagedHooks: { Stop: [entry('ecc:stop', 'version-1')] } }
      ),
      /drifted|Refusing to overwrite/
    );
    assert.deepStrictEqual(settings, before);
  })) passed++; else failed++;

  if (test('upgrade is idempotent when the desired entry is already installed', () => {
    const desired = { Stop: [entry('ecc:stop', 'version-2')] };
    const result = mergeManagedHooks(
      { hooks: clone(desired) },
      desired,
      { previousManagedHooks: { Stop: [entry('ecc:stop', 'version-1')] } }
    );

    assert.deepStrictEqual(result.settings.hooks, desired);
    assert.deepStrictEqual(result.unchanged, [{ event: 'Stop', id: 'ecc:stop' }]);
  })) passed++; else failed++;

  if (test('upgrade removes unchanged entries that are no longer managed', () => {
    const previousManagedHooks = {
      Stop: [
        entry('ecc:keep', 'version-1'),
        entry('ecc:removed', 'old-command'),
      ],
    };
    const desired = { Stop: [entry('ecc:keep', 'version-2')] };
    const userEntry = entry('user:stop', 'keep-user');
    const result = mergeManagedHooks({
      hooks: { Stop: [userEntry, ...previousManagedHooks.Stop] },
    }, desired, { previousManagedHooks });

    assert.deepStrictEqual(result.settings.hooks.Stop, [userEntry, desired.Stop[0]]);
    assert.deepStrictEqual(result.removed, [{ event: 'Stop', id: 'ecc:removed' }]);
  })) passed++; else failed++;

  if (test('upgrade removes multiple retired hooks without deleting their neighbor', () => {
    const previousManagedHooks = {
      Stop: [entry('ecc:a', 'a'), entry('ecc:b', 'b')],
    };
    const userEntry = entry('user:c', 'keep-user');
    const result = mergeManagedHooks({
      hooks: { Stop: [...previousManagedHooks.Stop, userEntry] },
    }, { SessionStart: [entry('ecc:start', 'start')] }, { previousManagedHooks });

    assert.deepStrictEqual(result.settings.hooks.Stop, [userEntry]);
    assert.deepStrictEqual(result.removed, [
      { event: 'Stop', id: 'ecc:a' },
      { event: 'Stop', id: 'ecc:b' },
    ]);
  })) passed++; else failed++;

  if (test('upgrade refuses to remove a retired entry after user drift', () => {
    const previousManagedHooks = { Stop: [entry('ecc:removed', 'old-command')] };
    const settings = { hooks: { Stop: [entry('ecc:removed', 'user-edited')] } };

    assert.throws(
      () => mergeManagedHooks(settings, { SessionStart: [entry('ecc:start', 'start')] }, {
        previousManagedHooks,
      }),
      /Refusing to remove.*ecc:removed.*drifted/
    );
  })) passed++; else failed++;

  if (test('merge fails closed when settings contains ambiguous duplicate event ids', () => {
    assert.throws(
      () => mergeManagedHooks(
        {
          hooks: {
            Stop: [
              entry('ecc:stop', 'version-1'),
              entry('ecc:stop', 'another-copy'),
            ],
          },
        },
        { Stop: [entry('ecc:stop', 'version-2')] },
        { previousManagedHooks: { Stop: [entry('ecc:stop', 'version-1')] } }
      ),
      /multiple.*ecc:stop/i
    );
  })) passed++; else failed++;

  if (test('merge treats the same id under another event as a separate user entry', () => {
    const result = mergeManagedHooks(
      { hooks: { SessionStart: [entry('shared:id', 'existing')] } },
      { Stop: [entry('shared:id', 'desired')] }
    );
    assert.deepStrictEqual(result.settings.hooks, {
      SessionStart: [entry('shared:id', 'existing')],
      Stop: [entry('shared:id', 'desired')],
    });
  })) passed++; else failed++;

  if (test('repair mode overwrites a drifted same-event managed id and preserves neighbors', () => {
    const userEntry = { id: 'user:hook', command: 'keep-me' };
    const result = repairManagedHooks(
      { hooks: { Stop: [userEntry, entry('ecc:stop', 'drifted')] } },
      { Stop: [entry('ecc:stop', 'repaired')] }
    );

    assert.deepStrictEqual(result.settings.hooks.Stop, [
      userEntry,
      entry('ecc:stop', 'repaired'),
    ]);
    assert.deepStrictEqual(result.updated, [{ event: 'Stop', id: 'ecc:stop' }]);
  })) passed++; else failed++;

  if (test('inspect reports exact, missing, and drifted managed entries plus the actual subset', () => {
    const expected = {
      SessionStart: [entry('ecc:start', 'start')],
      Stop: [
        entry('ecc:stop', 'expected'),
        entry('ecc:missing', 'missing'),
      ],
    };
    const actualStart = entry('ecc:start', 'start');
    const actualDrift = entry('ecc:stop', 'changed');
    const result = inspectManagedHooks({
      hooks: {
        SessionStart: [actualStart, { id: 'user:start', command: 'user' }],
        Stop: [actualDrift],
      },
    }, expected);

    assert.strictEqual(result.status, 'missing');
    assert.deepStrictEqual(result.matched, [{ event: 'SessionStart', id: 'ecc:start' }]);
    assert.deepStrictEqual(result.missing, [{ event: 'Stop', id: 'ecc:missing' }]);
    assert.deepStrictEqual(result.drifted, [{
      event: 'Stop',
      id: 'ecc:stop',
      expected: expected.Stop[0],
      actual: actualDrift,
    }]);
    assert.deepStrictEqual(result.managedHooks, {
      SessionStart: [actualStart],
      Stop: [actualDrift],
    });
  })) passed++; else failed++;

  if (test('inspect fails closed on duplicate matching ids in one settings event', () => {
    assert.throws(
      () => inspectManagedHooks(
        { hooks: { Stop: [entry('ecc:stop', 'a'), entry('ecc:stop', 'b')] } },
        { Stop: [entry('ecc:stop', 'expected')] }
      ),
      /multiple.*ecc:stop/i
    );
  })) passed++; else failed++;

  if (test('inspect and uninstall key ownership by event plus id', () => {
    const recorded = { Stop: [entry('ecc:stop', 'managed')] };
    const moved = { hooks: { SessionStart: [entry('ecc:stop', 'managed')] } };

    const inspection = inspectManagedHooks(moved, recorded);
    assert.strictEqual(inspection.status, 'missing');
    assert.deepStrictEqual(inspection.missing, [{ event: 'Stop', id: 'ecc:stop' }]);

    const uninstall = uninstallManagedHooks(moved, recorded);
    assert.deepStrictEqual(uninstall.settings, moved);
    assert.deepStrictEqual(uninstall.missing, [{ event: 'Stop', id: 'ecc:stop' }]);
  })) passed++; else failed++;

  if (test('uninstall removes exact recorded entries, retains drift, and cleans empty events', () => {
    const recorded = {
      SessionStart: [entry('ecc:start', 'start')],
      Stop: [entry('ecc:stop', 'recorded')],
      Notification: [entry('ecc:notify', 'notify')],
    };
    const userEntry = { matcher: 'Bash', hooks: [{ type: 'command', command: 'user' }] };
    const driftedStop = entry('ecc:stop', 'customer-edit');
    const settings = {
      theme: 'dark',
      hooks: {
        SessionStart: [recorded.SessionStart[0]],
        Stop: [userEntry, driftedStop],
        Notification: [recorded.Notification[0]],
      },
    };
    const before = clone(settings);

    const result = uninstallManagedHooks(settings, recorded);

    assert.deepStrictEqual(settings, before);
    assert.deepStrictEqual(result.settings, {
      theme: 'dark',
      hooks: {
        Stop: [userEntry, driftedStop],
      },
    });
    assert.deepStrictEqual(result.removed, [
      { event: 'SessionStart', id: 'ecc:start' },
      { event: 'Notification', id: 'ecc:notify' },
    ]);
    assert.deepStrictEqual(result.retained, [{
      event: 'Stop',
      id: 'ecc:stop',
      expected: recorded.Stop[0],
      actual: driftedStop,
      reason: 'modified',
    }]);
  })) passed++; else failed++;

  if (test('uninstall removes consecutive managed hooks without deleting a user neighbor', () => {
    const recorded = { Stop: [entry('ecc:a', 'a'), entry('ecc:b', 'b')] };
    const userEntry = entry('user:c', 'keep-user');
    const result = uninstallManagedHooks({
      hooks: { Stop: [...recorded.Stop, userEntry] },
    }, recorded);

    assert.deepStrictEqual(result.settings.hooks.Stop, [userEntry]);
    assert.deepStrictEqual(result.removed, [
      { event: 'Stop', id: 'ecc:a' },
      { event: 'Stop', id: 'ecc:b' },
    ]);
  })) passed++; else failed++;

  if (test('uninstall removes hooks entirely after the final managed event is emptied', () => {
    const recorded = { Stop: [entry('ecc:stop', 'recorded')] };
    const result = uninstallManagedHooks({ theme: 'dark', hooks: clone(recorded) }, recorded);

    assert.deepStrictEqual(result.settings, { theme: 'dark' });
    assert.deepStrictEqual(result.removed, [{ event: 'Stop', id: 'ecc:stop' }]);
    assert.deepStrictEqual(result.retained, []);
  })) passed++; else failed++;

  if (test('uninstall accepts structurally valid hooks from an older runtime contract', () => {
    const recorded = {
      LegacyEvent: [{
        id: 'ecc:legacy',
        hooks: [{ type: 'legacy-handler', payload: { version: 1 } }],
      }],
    };
    const result = uninstallManagedHooks({ hooks: clone(recorded) }, recorded);

    assert.deepStrictEqual(result.settings, {});
    assert.deepStrictEqual(result.removed, [{ event: 'LegacyEvent', id: 'ecc:legacy' }]);
  })) passed++; else failed++;

  if (test('all settings transforms reject non-array hook events before changing data', () => {
    const settings = { hooks: { Stop: 'invalid' } };
    const managed = { Stop: [entry('ecc:stop', 'expected')] };

    assert.throws(() => mergeManagedHooks(settings, managed), /hooks\.Stop.*array/);
    assert.throws(() => repairManagedHooks(settings, managed), /hooks\.Stop.*array/);
    assert.throws(() => inspectManagedHooks(settings, managed), /hooks\.Stop.*array/);
    assert.throws(() => uninstallManagedHooks(settings, managed), /hooks\.Stop.*array/);
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
