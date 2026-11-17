'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { buildAntigravityHooksConfig } = require('../../scripts/lib/antigravity-hooks');

const bridge = path.resolve(__dirname, '../../scripts/hooks/antigravity-hook-bridge.js');
const controls = [
  { ECC_HOOKS_ENABLED: 'false' },
  { ECC_HOOK_PROFILE: 'minimal' },
  { ECC_DISABLED_HOOKS: 'stop:format-typecheck' },
  { ECC_DRY_RUN: '1' },
];

test('minimal installs retain warning handlers for explicit runtime profile overrides', () => {
  const config = buildAntigravityHooksConfig({ profile: 'minimal', bridgeScript: bridge });
  assert.ok(config['ecc-guard'].PreToolUse.some(entry =>
    entry.hooks.some(hook => hook.command.includes('pre:write:doc-file-warning'))));
});

function invoke(mode, hook, payload, env = {}) {
  const child = spawnSync(process.execPath, [bridge, '--mode', mode, '--hook', hook], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 15000,
    env: {
      ...process.env, ECC_HOOKS_ENABLED: 'true', ECC_HOOK_PROFILE: 'standard',
      ECC_DISABLED_HOOKS: '', ECC_DRY_RUN: '0', ECC_HOOK_CONFIG: '', ...env,
    },
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

test('Stop formatting writes only when enabled; disabled, minimal and dry-run preserve edits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agy-policy-'));
  const conversationId = path.basename(root);
  const accumulator = path.join(os.tmpdir(), `ecc-edited-${conversationId}.txt`);
  try {
    const target = path.join(root, 'component.js');
    const marker = path.join(root, 'formatter-args.json');
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ prettier: {} }));
    fs.writeFileSync(target, 'const value = 1;\n');
    const script = path.join(root, 'formatter.cjs');
    fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2)));`);
    const bin = path.join(binDir, process.platform === 'win32' ? 'prettier.cmd' : 'prettier');
    fs.writeFileSync(bin, process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' '${script.replace(/'/g, "'\\''")}' "$@"\n`, { mode: 0o755 });
    const payload = { conversationId, workspacePaths: [root], fullyIdle: true };
    for (const env of controls) {
      fs.writeFileSync(accumulator, `${target}\n`);
      assert.equal(invoke('stop', 'stop:format-typecheck', payload, env).decision, 'allow');
      assert.equal(fs.existsSync(marker), false, JSON.stringify(env));
      assert.equal(fs.readFileSync(accumulator, 'utf8'), `${target}\n`, JSON.stringify(env));
    }
    // The upstream Windows formatter deliberately skips shell-unsafe paths.
    if (process.platform !== 'win32' || !/[&|<>^%!\s()]/.test(target)) {
      invoke('stop', 'stop:format-typecheck', payload);
      assert.ok(JSON.parse(fs.readFileSync(marker, 'utf8')).includes('--write'));
      assert.ok(!fs.existsSync(accumulator));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(accumulator, { force: true });
  }
});

test('PostToolUse and warnings honor the same execution controls', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agy-flags-'));
  const conversationId = path.basename(root);
  const accumulator = path.join(os.tmpdir(), `ecc-edited-${conversationId}.txt`);
  try {
    const edit = { conversationId, toolCall: { name: 'write_to_file', args: { TargetFile: path.join(root, 'app.js') } } };
    for (const env of [...controls.slice(0, 2), { ECC_DISABLED_HOOKS: 'post:edit:accumulator' }, controls[3]]) {
      assert.deepEqual(invoke('post-tool-use', 'post:edit:accumulator', edit, env), {});
      assert.equal(fs.existsSync(accumulator), false, JSON.stringify(env));
    }
    const doc = { toolCall: { name: 'write_to_file', args: { TargetFile: path.join(root, 'NOTES.md') } } };
    for (const env of [...controls.slice(0, 2), { ECC_DISABLED_HOOKS: 'pre:write:doc-file-warning' }, controls[3]]) {
      assert.deepEqual(invoke('pre-tool-use', 'pre:write:doc-file-warning', doc, env), { decision: 'allow' });
    }
    assert.match(invoke('pre-tool-use', 'pre:write:doc-file-warning', doc).reason, /Ad-hoc documentation/);
    invoke('post-tool-use', 'post:edit:accumulator', edit);
    assert.equal(fs.readFileSync(accumulator, 'utf8').trim(), edit.toolCall.args.TargetFile);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(accumulator, { force: true });
  }
});

test('managed profile is used unless an explicit environment choice overrides it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agy-config-'));
  try {
    const config = path.join(root, 'setup.json');
    fs.writeFileSync(config, JSON.stringify({ hooks: { enabled: true, profile: 'minimal' } }));
    const payload = { toolCall: { name: 'write_to_file', args: { TargetFile: path.join(root, 'NOTES.md') } } };
    assert.deepEqual(invoke('pre-tool-use', 'pre:write:doc-file-warning', payload, {
      ECC_HOOK_PROFILE: undefined, ECC_HOOK_CONFIG: config,
    }), { decision: 'allow' });
    assert.match(invoke('pre-tool-use', 'pre:write:doc-file-warning', payload, {
      ECC_HOOK_PROFILE: 'strict', ECC_HOOK_CONFIG: config,
    }).reason, /Ad-hoc documentation/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Stop diagnostics inspect the payload workspace rather than the launch directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agy-stop-cwd-'));
  try {
    const workspace = path.join(root, 'workspace');
    const unrelated = path.join(root, 'unrelated');
    const env = {
      ...process.env, ECC_HOOK_PROFILE: 'standard', ECC_HOOKS_ENABLED: 'true',
      ECC_DISABLED_HOOKS: '', ECC_DRY_RUN: '0', ECC_HOOK_CONFIG: '',
      GIT_CONFIG_GLOBAL: path.join(root, 'no-global-config'), GIT_CONFIG_NOSYSTEM: '1',
    };
    for (const [dir, name] of [[workspace, 'intended.js'], [unrelated, 'unrelated.js']]) {
      fs.mkdirSync(dir);
      execFileSync('git', ['init', '--quiet', dir], { env });
      fs.writeFileSync(path.join(dir, name), 'const value = 1;\n');
      execFileSync('git', ['-C', dir, 'add', name], { env });
      execFileSync('git', ['-C', dir, '-c', 'user.name=ECC fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgSign=false', 'commit', '--quiet', '-m', 'fixture'], { env });
      fs.appendFileSync(path.join(dir, name), 'console.log(value);\n');
    }
    for (const cwd of [root, unrelated]) {
      const child = spawnSync(process.execPath, [bridge, '--mode', 'stop', '--hook', 'stop:check-console-log'], {
        cwd, env, encoding: 'utf8', timeout: 15000,
        input: JSON.stringify({ workspacePaths: [workspace], fullyIdle: true }),
      });
      assert.equal(child.status, 0, child.stderr);
      const response = JSON.parse(child.stdout);
      assert.equal(response.decision, 'continue');
      assert.match(response.reason, /intended\.js/);
      assert.doesNotMatch(response.reason, /unrelated\.js/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
