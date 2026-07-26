/**
 * Contract tests for the consolidated PostToolUse dispatchers.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const hooksPath = path.join(repoRoot, 'hooks', 'hooks.json');
const dispatcherPath = path.join(repoRoot, 'scripts', 'hooks', 'posttooluse-dispatcher.js');

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

function runDispatcher(mode, toolName, env = {}) {
  const raw = JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    tool_input: toolName === 'Bash' ? { command: 'true' } : { file_path: path.join(os.tmpdir(), 'ecc-posttooluse-test.txt') },
    tool_response: {}
  });

  return spawnSync(process.execPath, [dispatcherPath, mode], {
    cwd: repoRoot,
    input: raw,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: repoRoot,
      ECC_PLUGIN_ROOT: repoRoot,
      ...env
    },
    timeout: 10000
  });
}

function previewedIds(stderr) {
  return [...String(stderr).matchAll(/Hook "([^"]+)"/g)].map(match => match[1]);
}

function runConfiguredCommand(entry, raw, env = {}) {
  return spawnSync(entry.hooks[0].command, {
    shell: true,
    cwd: repoRoot,
    input: raw,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: repoRoot,
      ECC_PLUGIN_ROOT: repoRoot,
      ...env
    },
    timeout: 10000
  });
}

function runTests() {
  console.log('\n=== PostToolUse dispatcher tests ===\n');

  let passed = 0;
  let failed = 0;

  if (
    test('hooks.json exposes one sync and one async PostToolUse entry', () => {
      const entries = JSON.parse(fs.readFileSync(hooksPath, 'utf8')).hooks.PostToolUse;
      assert.strictEqual(entries.length, 2, 'PostToolUse should launch at most two commands');
      assert.deepStrictEqual(
        entries.map(entry => entry.id),
        ['post:dispatcher:sync', 'post:dispatcher:async']
      );
      assert.ok(entries.every(entry => entry.matcher === '*'));
      assert.strictEqual(entries[0].hooks[0].async, undefined);
      assert.strictEqual(entries[1].hooks[0].async, true);
      assert.ok(entries[0].hooks[0].command.includes('posttooluse-dispatcher.js'));
      assert.ok(entries[0].hooks[0].command.endsWith('" sync'));
      assert.ok(entries[1].hooks[0].command.includes('posttooluse-dispatcher.js'));
      assert.ok(entries[1].hooks[0].command.endsWith('" async'));
      assert.ok(entries.every(entry => entry.hooks[0].command.includes('resolve-ecc-root')));
      assert.ok(
        entries.every(entry => !entry.hooks[0].command.includes('plugin-hook-bootstrap.js')),
        'PostToolUse dispatchers should not spawn a second Node bootstrap process'
      );
      assert.ok(entries[1].hooks[0].timeout >= 30);
    })
  )
    passed++;
  else failed++;

  if (
    test('dry-run selects the original IDs by tool and phase', () => {
      const cases = [
        {
          tool: 'Edit',
          sync: [
            'post:edit:design-quality-check',
            'post:edit:accumulator',
            'post:edit:console-warn',
            'post:governance-capture',
            'post:session-activity-tracker',
            'post:ecc-metrics-bridge',
            'post:ecc-context-monitor'
          ],
          async: ['post:quality-gate', 'post:observe:continuous-learning']
        },
        {
          tool: 'Write',
          sync: ['post:edit:design-quality-check', 'post:edit:accumulator', 'post:governance-capture', 'post:session-activity-tracker', 'post:ecc-metrics-bridge', 'post:ecc-context-monitor'],
          async: ['post:quality-gate', 'post:observe:continuous-learning']
        },
        {
          tool: 'Bash',
          sync: ['post:governance-capture', 'post:session-activity-tracker', 'post:ecc-metrics-bridge', 'post:ecc-context-monitor'],
          async: ['post:bash:dispatcher', 'post:observe:continuous-learning']
        },
        {
          tool: 'Read',
          sync: ['post:session-activity-tracker', 'post:ecc-metrics-bridge', 'post:ecc-context-monitor'],
          async: ['post:observe:continuous-learning']
        }
      ];

      for (const expected of cases) {
        const sync = runDispatcher('sync', expected.tool, { ECC_DRY_RUN: '1' });
        const asyncResult = runDispatcher('async', expected.tool, { ECC_DRY_RUN: '1' });
        assert.strictEqual(sync.status, 0, sync.stderr);
        assert.strictEqual(asyncResult.status, 0, asyncResult.stderr);
        assert.deepStrictEqual(previewedIds(sync.stderr), expected.sync, `${expected.tool} sync IDs`);
        assert.deepStrictEqual(previewedIds(asyncResult.stderr), expected.async, `${expected.tool} async IDs`);
        assert.strictEqual(sync.stdout, '');
        assert.strictEqual(asyncResult.stdout, '');
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('actual hooks.json commands preserve Edit dry-run output and IDs', () => {
      const entries = JSON.parse(fs.readFileSync(hooksPath, 'utf8')).hooks.PostToolUse;
      const raw = JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: path.join(os.tmpdir(), 'ecc-posttooluse-test.txt') },
        tool_response: {}
      });
      const results = entries.map(entry => runConfiguredCommand(entry, raw, { ECC_DRY_RUN: '1' }));

      for (const result of results) {
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(result.stdout, raw, 'configured command should preserve pass-through output');
      }
      const ids = results.flatMap(result => previewedIds(result.stderr));
      assert.deepStrictEqual(ids, [
        'post:edit:design-quality-check',
        'post:edit:accumulator',
        'post:edit:console-warn',
        'post:governance-capture',
        'post:session-activity-tracker',
        'post:ecc-metrics-bridge',
        'post:ecc-context-monitor',
        'post:quality-gate',
        'post:observe:continuous-learning'
      ]);
    })
  )
    passed++;
  else failed++;

  if (
    test('actual hooks.json commands never echo truncated oversized input', () => {
      const entries = JSON.parse(fs.readFileSync(hooksPath, 'utf8')).hooks.PostToolUse;
      const values = ['x'.repeat(1024 * 1024 + 1024), 'é'.repeat(600000), '\u{1F600}'.repeat(300000)];

      for (const value of values) {
        const raw = JSON.stringify({
          hook_event_name: 'PostToolUse',
          tool_name: 'Read',
          tool_input: { value },
          tool_response: {}
        });
        assert.ok(Buffer.byteLength(raw, 'utf8') > 1024 * 1024);

        for (const entry of entries) {
          const result = runConfiguredCommand(entry, raw, { ECC_DRY_RUN: '1' });
          assert.strictEqual(result.status, 0, result.stderr);
          assert.strictEqual(result.stdout, '', `${entry.id} should suppress truncated pass-through`);
          assert.ok(result.stderr.includes('stdin exceeded'), `${entry.id} should report truncation`);
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('profiles and disabled IDs remain scoped to each original hook', () => {
      const minimalSync = runDispatcher('sync', 'Edit', {
        ECC_DRY_RUN: '1',
        ECC_HOOK_PROFILE: 'minimal'
      });
      assert.strictEqual(minimalSync.status, 0, minimalSync.stderr);
      assert.deepStrictEqual(previewedIds(minimalSync.stderr), ['post:ecc-metrics-bridge']);

      const minimalAsync = runDispatcher('async', 'Bash', {
        ECC_DRY_RUN: '1',
        ECC_HOOK_PROFILE: 'minimal'
      });
      assert.strictEqual(minimalAsync.status, 0, minimalAsync.stderr);
      assert.deepStrictEqual(previewedIds(minimalAsync.stderr), ['post:bash:dispatcher'], 'bash dispatcher phase must stay reachable in minimal profile like main; its sub-hooks gate themselves');

      const disabled = runDispatcher('sync', 'Edit', {
        ECC_DRY_RUN: '1',
        ECC_DISABLED_HOOKS: 'post:edit:accumulator'
      });
      assert.strictEqual(disabled.status, 0, disabled.stderr);
      const ids = previewedIds(disabled.stderr);
      assert.ok(!ids.includes('post:edit:accumulator'));
      assert.ok(ids.includes('post:edit:design-quality-check'));
      assert.ok(ids.includes('post:ecc-context-monitor'));
    })
  )
    passed++;
  else failed++;

  if (
    test('public dispatcher IDs disable their complete phase', () => {
      const entries = JSON.parse(fs.readFileSync(hooksPath, 'utf8')).hooks.PostToolUse;
      const raw = JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: path.join(os.tmpdir(), 'ecc-posttooluse-test.txt') },
        tool_response: {}
      });

      for (const entry of entries) {
        const result = runConfiguredCommand(entry, raw, {
          ECC_DRY_RUN: '1',
          ECC_DISABLED_HOOKS: entry.id
        });
        assert.strictEqual(result.status, 0, result.stderr);
        assert.deepStrictEqual(previewedIds(result.stderr), [], `${entry.id} should disable all child hooks`);
        assert.strictEqual(result.stdout, raw);
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('dry-run has no PostToolUse side effects', () => {
      const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-posttooluse-dry-run-'));
      try {
        const result = runDispatcher('sync', 'Edit', {
          ECC_DRY_RUN: '1',
          HOME: homeDir,
          USERPROFILE: homeDir,
          CLAUDE_SESSION_ID: 'dry-run-session'
        });
        assert.strictEqual(result.status, 0, result.stderr);
        assert.deepStrictEqual(fs.readdirSync(homeDir), []);
      } finally {
        fs.rmSync(homeDir, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('dispatcher isolates failures and preserves explicit output and exit status', () => {
      assert.ok(fs.existsSync(dispatcherPath), 'dispatcher module should exist');
      const { resolveMainStdout, runHooks } = require(dispatcherPath);
      const calls = [];
      const raw = JSON.stringify({ tool_name: 'Read' });
      const explicitOutput = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: 'context warning'
        }
      });
      const hooks = [
        {
          id: 'post:test:first',
          matcher: '*',
          profiles: 'standard,strict',
          run: input => {
            calls.push(['first', input]);
            return input;
          }
        },
        {
          id: 'post:test:broken',
          matcher: '*',
          profiles: 'standard,strict',
          run: () => {
            throw new Error('boom');
          }
        },
        { id: 'post:test:nonzero', matcher: '*', profiles: 'standard,strict', run: () => ({ exitCode: 7 }) },
        {
          id: 'post:test:last',
          matcher: '*',
          profiles: 'standard,strict',
          run: input => {
            calls.push(['last', input]);
            return { stdout: explicitOutput, stderr: 'last warning' };
          }
        }
      ];

      const result = runHooks(raw, hooks, { toolName: 'Read', env: { ECC_HOOK_PROFILE: 'standard' } });
      assert.deepStrictEqual(
        calls,
        [
          ['first', raw],
          ['last', raw]
        ],
        'each hook should receive the original input'
      );
      assert.strictEqual(result.stdout, explicitOutput);
      assert.ok(result.stderr.includes('post:test:broken'));
      assert.ok(result.stderr.includes('boom'));
      assert.ok(result.stderr.includes('post:test:nonzero'));
      assert.ok(result.stderr.indexOf('post:test:broken') < result.stderr.indexOf('last warning'));
      assert.strictEqual(result.exitCode, 7, 'explicit child exit codes should be preserved');
      assert.strictEqual(resolveMainStdout(raw, { stdout: '', exitCode: 7 }, { passthrough: true, truncated: false }), '', 'nonzero results should not restore raw input');
    })
  )
    passed++;
  else failed++;

  if (
    test('failing hook exit code propagates to the real dispatcher process status', () => {
      const script = [
        `const dispatcher = require(${JSON.stringify(dispatcherPath)});`,
        'dispatcher.SYNC_HOOKS.length = 0;',
        "dispatcher.SYNC_HOOKS.push({ id: 'post:test:fail', matcher: '*', profiles: 'standard,strict', run: () => ({ exitCode: 7 }) });",
        "process.argv[2] = 'sync';",
        'dispatcher.cli();'
      ].join('');
      const result = spawnSync(process.execPath, ['-e', script], {
        cwd: repoRoot,
        input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {}, tool_response: {} }),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: repoRoot, ECC_POSTTOOLUSE_PASSTHROUGH: '1' },
        timeout: 10000
      });
      assert.strictEqual(result.status, 7, 'OS-level exit status should reflect the failing hook');
      assert.ok(result.stderr.includes('post:test:fail exited with code 7'), result.stderr);
      assert.strictEqual(result.stdout, '', 'failed runs must not restore pass-through output');
    })
  )
    passed++;
  else failed++;

  if (
    test('console warning hook is safe to require in-process', () => {
      const script = [`const hook = require(${JSON.stringify(path.join(repoRoot, 'scripts', 'hooks', 'post-edit-console-warn.js'))});`, "if (typeof hook.run !== 'function') process.exit(2);"].join(
        ''
      );
      const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 5000 });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, '');
    })
  )
    passed++;
  else failed++;

  if (
    test('empty and malformed input fail open', () => {
      for (const input of ['', '{not-json']) {
        const result = spawnSync(process.execPath, [dispatcherPath, 'sync'], {
          cwd: repoRoot,
          input,
          encoding: 'utf8',
          env: { ...process.env, CLAUDE_PLUGIN_ROOT: repoRoot },
          timeout: 10000
        });
        assert.strictEqual(result.status, 0, result.stderr);
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('multiple additionalContext outputs merge; raw stdout conflicts warn', () => {
      const { mergeHookStdout, runHooks } = require(dispatcherPath);
      const envelope = context =>
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context }
        });
      const contextHook = (id, context) => ({
        id,
        matcher: '*',
        profiles: 'standard,strict',
        run: () => ({ additionalContext: context })
      });

      const merged = runHooks(JSON.stringify({ tool_name: 'Read' }), [contextHook('post:test:one', 'first warning'), contextHook('post:test:two', 'second warning')], {
        toolName: 'Read',
        env: { ECC_HOOK_PROFILE: 'standard' }
      });
      assert.strictEqual(merged.stdout, envelope('first warning\nsecond warning'), 'context envelopes should merge into one');
      assert.ok(!merged.stderr.includes('dropped'), merged.stderr);

      const conflicting = mergeHookStdout([
        { id: 'post:test:raw', stdout: 'plain output' },
        { id: 'post:test:ctx', stdout: envelope('kept warning') }
      ]);
      assert.strictEqual(conflicting.stdout, envelope('kept warning'), 'last output should win when raw stdout cannot merge');
      assert.ok(conflicting.warning.includes('post:test:raw'), 'dropped hook IDs should be named');
      assert.ok(conflicting.warning.includes('post:test:ctx'));
    })
  )
    passed++;
  else failed++;

  if (
    test('requiring the dispatcher module never dispatches; hooks.json calls cli()', () => {
      const raw = JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_input: {},
        tool_response: {}
      });
      const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(dispatcherPath)})`], {
        cwd: repoRoot,
        input: raw,
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: repoRoot, ECC_POSTTOOLUSE_PASSTHROUGH: '1' },
        timeout: 10000
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, '', 'require() alone must not run main() or echo stdin');

      const entries = JSON.parse(fs.readFileSync(hooksPath, 'utf8')).hooks.PostToolUse;
      assert.ok(
        entries.every(entry => entry.hooks[0].command.includes('require(s).cli()')),
        'hooks.json must invoke the explicit cli() entrypoint'
      );
    })
  )
    passed++;
  else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
