#!/usr/bin/env node
'use strict';

/**
 * Tests for scripts/hooks/instinct-enforce.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const runner = path.join(repoRoot, 'scripts', 'hooks', 'run-with-flags.js');
const hookScript = path.join(repoRoot, 'scripts', 'hooks', 'instinct-enforce.js');
const hooksJsonPath = path.join(repoRoot, 'hooks', 'hooks.json');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function loadHook() {
  delete require.cache[require.resolve(hookScript)];
  delete require.cache[require.resolve(path.join(repoRoot, 'scripts', 'lib', 'instinct-store.js'))];
  return require(hookScript);
}

function writeInstinct(filePath, instinct) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      '---',
      `id: ${instinct.id}`,
      `trigger: ${instinct.trigger || 'when naming new modules'}`,
      `confidence: ${instinct.confidence}`,
      `domain: ${instinct.domain || 'code-style'}`,
      '---',
      instinct.content,
      '',
    ].join('\n')
  );
}

async function withHomunculus(instinct, fn) {
  const homunculusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-instinct-enforce-'));
  const previous = {
    CLV2_HOMUNCULUS_DIR: process.env.CLV2_HOMUNCULUS_DIR,
    ECC_INSTINCT_ENFORCE: process.env.ECC_INSTINCT_ENFORCE,
    ECC_INSTINCT_ENFORCE_MODE: process.env.ECC_INSTINCT_ENFORCE_MODE,
  };
  process.env.CLV2_HOMUNCULUS_DIR = homunculusDir;
  delete process.env.ECC_INSTINCT_ENFORCE;
  delete process.env.ECC_INSTINCT_ENFORCE_MODE;

  if (instinct) {
    writeInstinct(
      path.join(homunculusDir, 'instincts', 'personal', `${instinct.id}.yaml`),
      instinct
    );
  } else {
    fs.mkdirSync(path.join(homunculusDir, 'instincts', 'personal'), { recursive: true });
  }

  try {
    return await fn(homunculusDir);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(homunculusDir, { recursive: true, force: true });
  }
}

function runViaFlags(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [
    runner,
    'pre:edit-write:instinct-enforce',
    'scripts/hooks/instinct-enforce.js',
    'standard,strict',
  ], {
    cwd: repoRoot,
    input: rawInput,
    encoding: 'utf8',
    env: {
      ...process.env,
      ECC_HOOK_PROFILE: 'standard',
      ...env,
    },
    timeout: 15000,
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

async function runTests() {
  console.log('\n=== Testing instinct-enforce ===\n');

  let passed = 0;
  let failed = 0;

  if (await test('hooks.json registers a Write|Edit|MultiEdit|Bash PreToolUse matcher through run-with-flags', () => {
    const hooks = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
    const entry = hooks.hooks.PreToolUse.find(item => item.id === 'pre:edit-write:instinct-enforce');
    assert.ok(entry, 'Should register pre:edit-write:instinct-enforce');
    assert.strictEqual(entry.matcher, 'Write|Edit|MultiEdit|Bash');
    assert.strictEqual(entry.hooks[0].timeout, 5);
    const command = entry.hooks[0].command;
    assert.ok(command.includes('run-with-flags.js pre:edit-write:instinct-enforce scripts/hooks/instinct-enforce.js standard,strict'));
    assert.ok(command.includes('plugin-hook-bootstrap.js'));
    assert.ok(!command.includes('async'));
  })) passed++; else failed++;

  if (await test('codex hooks stay SessionStart-only', () => {
    const codexHooks = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks', 'codex-hooks.json'), 'utf8'));
    assert.ok(!Object.prototype.hasOwnProperty.call(codexHooks.hooks || {}, 'PreToolUse'));
  })) passed++; else failed++;

  await withHomunculus({
    id: 'no-foo-prefix',
    confidence: 0.91,
    content: 'NEVER foo prefix on new modules',
  }, async () => {
    if (await test('disabled env returns exit 0 with empty stdout', async () => {
      process.env.ECC_INSTINCT_ENFORCE = '0';
      const hook = loadHook();
      const result = await hook.run(JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '/src/fooWidget.js', contents: 'export function fooWidget() {}' },
      }));
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, '');
      assert.ok(!result.additionalContext);
    })) passed++; else failed++;
  });

  if (await test('garbage stdin returns exit 0 with empty stdout and does not echo the payload', async () => {
    const hook = loadHook();
    const garbage = 'SENTINEL_STDIN_PAYLOAD_NOT_JSON {tool_name:"Write"}';
    const result = await hook.run(garbage);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout, '');
    assert.ok(!String(result.stderr || '').includes('SENTINEL_STDIN_PAYLOAD_NOT_JSON'));
  })) passed++; else failed++;

  await withHomunculus({
    id: 'no-foo-prefix',
    confidence: 0.91,
    content: 'NEVER foo prefix on new modules',
  }, async (homunculusDir) => {
    if (await test('Write of fooWidget against NEVER foo prefix at 0.91 blocks with instinct id', async () => {
      const hook = loadHook();
      const payload = {
        tool_name: 'Write',
        tool_input: {
          file_path: '/src/fooWidget.js',
          contents: 'export function fooWidget() { return 1; }',
        },
      };
      const result = await hook.run(JSON.stringify(payload));
      assert.strictEqual(result.exitCode, 2);
      const message = `${result.stderr || ''}\n${result.stdout || ''}`;
      assert.ok(message.includes('no-foo-prefix'), `block message should include instinct id, got: ${message}`);
      assert.ok(message.includes('[instinct-enforce]'));
      assert.ok(message.includes('rename to avoid the forbidden prefix'));
      assert.ok(message.includes('ECC_INSTINCT_ENFORCE=0'));
      assert.ok(!message.includes('"tool_name":"Write"') && !String(result.stdout || '').includes(JSON.stringify(payload)));

      const viaFlags = runViaFlags(payload, { CLV2_HOMUNCULUS_DIR: homunculusDir });
      assert.strictEqual(viaFlags.code, 2);
      assert.ok(viaFlags.stderr.includes('no-foo-prefix'));
      assert.ok(!viaFlags.stdout.includes('export function fooWidget'));
    })) passed++; else failed++;
  });

  await withHomunculus({
    id: 'no-foo-prefix',
    confidence: 0.72,
    content: 'NEVER foo prefix on new modules',
  }, async () => {
    if (await test('same instinct at 0.72 warns via additionalContext', async () => {
      const hook = loadHook();
      const result = await hook.run(JSON.stringify({
        tool_name: 'Write',
        tool_input: {
          file_path: '/src/fooWidget.js',
          contents: 'export function fooWidget() { return 1; }',
        },
      }));
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.additionalContext, 'should attach additionalContext');
      assert.ok(result.additionalContext.includes('no-foo-prefix'));
      assert.ok(result.additionalContext.includes('0.72'));
    })) passed++; else failed++;
  });

  await withHomunculus({
    id: 'no-foo-prefix',
    confidence: 0.91,
    content: 'NEVER foo prefix on new modules',
  }, async () => {
    if (await test('ECC_INSTINCT_ENFORCE_MODE=warn demotes a 0.91 block', async () => {
      process.env.ECC_INSTINCT_ENFORCE_MODE = 'warn';
      const hook = loadHook();
      const result = await hook.run(JSON.stringify({
        tool_name: 'Write',
        tool_input: {
          file_path: '/src/fooWidget.js',
          contents: 'export function fooWidget() { return 1; }',
        },
      }));
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.additionalContext.includes('no-foo-prefix'));
    })) passed++; else failed++;
  });

  await withHomunculus({
    id: 'no-rm-outside-temp',
    confidence: 0.91,
    trigger: 'when running destructive shell commands',
    content: 'NEVER rm outside temp',
  }, async () => {
    if (await test('blocked Bash uses a command recovery hint, not rename advice', async () => {
      const hook = loadHook();
      const result = await hook.run(JSON.stringify({
        tool_name: 'bash',
        tool_input: { command: 'rm -rf /var/app' },
      }));
      assert.strictEqual(result.exitCode, 2);
      const message = `${result.stderr || ''}\n${result.stdout || ''}`;
      assert.ok(message.includes('no-rm-outside-temp'), `block message should include instinct id, got: ${message}`);
      assert.ok(message.includes('change the command to avoid the matched instinct'));
      assert.ok(message.includes('ECC_INSTINCT_ENFORCE=0'));
      assert.ok(!message.includes('rename to avoid the forbidden prefix'));
    })) passed++; else failed++;
  });

  await withHomunculus({
    id: 'no-foo-prefix',
    confidence: 0.91,
    content: 'NEVER foo prefix on new modules',
  }, async () => {
    if (await test('Bash rm that does not match any instinct is a no-op', async () => {
      const hook = loadHook();
      const result = await hook.run(JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /tmp/scratch-dir' },
      }));
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, '');
      assert.ok(!result.additionalContext);
    })) passed++; else failed++;
  });

  await withHomunculus(null, async () => {
    if (await test('empty homunculus dir is a no-op', async () => {
      const hook = loadHook();
      const result = await hook.run(JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '/src/fooWidget.js', contents: 'export function fooWidget() {}' },
      }));
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, '');
    })) passed++; else failed++;
  });

  if (await test('--check dry-runs a JSON file of tool_name/tool_input', async () => {
    const homunculusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-instinct-check-'));
    const payloadPath = path.join(homunculusDir, 'payload.json');
    try {
      writeInstinct(path.join(homunculusDir, 'instincts', 'personal', 'no-foo-prefix.yaml'), {
        id: 'no-foo-prefix',
        confidence: 0.91,
        trigger: 'when naming new modules',
        content: 'NEVER foo prefix on new modules',
      });
      fs.writeFileSync(payloadPath, JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '/src/fooWidget.js', contents: 'fooWidget' },
      }));
      const result = spawnSync(process.execPath, [hookScript, '--check', payloadPath], {
        encoding: 'utf8',
        env: {
          ...process.env,
          CLV2_HOMUNCULUS_DIR: homunculusDir,
        },
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.ok(result.stdout.includes('no-foo-prefix'));
      assert.ok(/block/i.test(result.stdout));

      fs.writeFileSync(payloadPath, JSON.stringify({
        tool_name: 'Grep',
        tool_input: { file_path: '/src/fooWidget.js', contents: 'fooWidget' },
      }));
      const grepResult = spawnSync(process.execPath, [hookScript, '--check', payloadPath], {
        encoding: 'utf8',
        env: {
          ...process.env,
          CLV2_HOMUNCULUS_DIR: homunculusDir,
        },
      });
      assert.strictEqual(grepResult.status, 0, grepResult.stderr);
      assert.ok(grepResult.stdout.includes('verdict: none'));
      assert.ok(grepResult.stdout.includes('matches: none'));
      assert.ok(!grepResult.stdout.includes('no-foo-prefix'));
      assert.ok(!/verdict: (block|warn)/.test(grepResult.stdout));
    } finally {
      fs.rmSync(homunculusDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error(error);
  process.exit(1);
});
