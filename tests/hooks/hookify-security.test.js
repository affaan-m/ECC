/**
 * Trust-boundary tests for the ECC-native Hookify runtime (#2561).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const runtime = require('../../scripts/hooks/hookify-runtime');

function test(name, fn) {
  try {
    fn();
    console.log('  \u2713 ' + name);
    return true;
  } catch (error) {
    console.log('  \u2717 ' + name);
    console.log('    Error: ' + error.message);
    return false;
  }
}

function createProject(prefix = 'ecc-hookify-security-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  return root;
}

function writeRule(root, slug, frontmatter, message = 'Hookify policy matched.') {
  const file = path.join(root, '.claude', 'hookify.' + slug + '.local.md');
  fs.writeFileSync(file, '---\n' + frontmatter.trim() + '\n---\n' + message + '\n');
  return file;
}

function runHook(root, input, env = {}) {
  const raw = JSON.stringify(input);
  return runtime.run(raw, {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...env },
  });
}

function removeProject(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('\nHookify security tests (#2561)');
console.log('\u2500'.repeat(50));

let passed = 0;
let failed = 0;

if (test('does not follow rule symlinks outside the project .claude directory', () => {
  if (process.platform === 'win32') return;
  const root = createProject();
  const outside = createProject('ecc-hookify-outside-');
  try {
    const externalRule = path.join(outside, 'external.md');
    fs.writeFileSync(externalRule, '---\nname: outside\nevent: bash\naction: block\npattern: .*\n---\nMust not load.\n');
    fs.symlinkSync(externalRule, path.join(root, '.claude', 'hookify.link.local.md'));
    const result = runHook(root, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pwd' } });
    assert.strictEqual(result.stdout, result.raw);
    assert.match(result.stderr, /symbolic link/);
  } finally {
    removeProject(root);
    removeProject(outside);
  }
})) passed++; else failed++;

if (test('rejects Git-tracked local rules unless explicitly approved', () => {
  const root = createProject();
  try {
    assert.strictEqual(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
    const rulePath = writeRule(root, 'tracked', 'name: tracked-rule\nevent: bash\naction: block\npattern: .*', 'Tracked instructions must not run by default.');
    assert.strictEqual(spawnSync('git', ['add', '-f', path.relative(root, rulePath)], { cwd: root }).status, 0);
    const input = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pwd' } };
    const rejected = runHook(root, input);
    assert.strictEqual(rejected.stdout, rejected.raw);
    assert.match(rejected.stderr, /tracked local rules require explicit approval/);
    const approved = JSON.parse(runHook(root, input, { ECC_HOOKIFY_ALLOW_TRACKED: '1' }).stdout);
    assert.strictEqual(approved.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(approved.hookSpecificOutput.permissionDecisionReason, /UNTRUSTED LOCAL RULE DATA/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('fails closed when Git tracking status cannot be established', () => {
  const root = createProject();
  try {
    assert.strictEqual(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
    writeRule(root, 'unknown-trust', 'name: unknown-trust\nevent: bash\naction: block\npattern: .*');
    const result = runHook(root, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pwd' } }, { PATH: '' });
    assert.strictEqual(result.stdout, result.raw);
    assert.match(result.stderr, /could not verify whether local rules are tracked/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('trusted CLAUDE_PROJECT_DIR takes precedence over payload cwd', () => {
  const trusted = createProject();
  const untrusted = createProject();
  try {
    writeRule(untrusted, 'outside', 'name: outside-rule\nevent: bash\naction: block\npattern: .*', 'Must not load.');
    const raw = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'pwd' }, cwd: untrusted });
    const result = runtime.run(raw, { cwd: trusted, env: { ...process.env, CLAUDE_PROJECT_DIR: trusted } });
    assert.strictEqual(result.stdout, result.raw);
  } finally {
    removeProject(trusted);
    removeProject(untrusted);
  }
})) passed++; else failed++;

console.log('\nPassed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed > 0 ? 1 : 0);
