#!/usr/bin/env node
/**
 * Tests for ck (Context Keeper) path handling: skill-relative script paths,
 * heredoc JSON input, and Claude Code project directory encoding.
 *
 * Run with: node tests/skills/ck-paths.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const SKILL_DIR = path.join(__dirname, '..', '..', 'skills', 'ck');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
const SESSION_START = path.join(SKILL_DIR, 'hooks', 'session-start.mjs');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function tempEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-paths-'));
  const home = path.join(root, 'home');
  const project = path.join(root, "Bob's App v2");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, PWD: project };
  return { root, home, project, env };
}

// Return the body of the first ```bash fence that contains `marker`.
function bashBlock(marker) {
  const md = fs.readFileSync(SKILL_MD, 'utf8');
  const block = [...md.matchAll(/```bash\n([\s\S]*?)```/g)].map(m => m[1]).find(b => b.includes(marker));
  assert.ok(block, `no bash block containing ${marker}`);
  return block;
}

function runDocumentedSave(marker, placeholder, payload, ctx) {
  const script = bashBlock(marker)
    .replaceAll('${CLAUDE_SKILL_DIR}', SKILL_DIR)
    .replace(placeholder, () => JSON.stringify(payload));
  return spawnSync('bash', ['-c', script], { cwd: ctx.project, env: ctx.env, encoding: 'utf8' });
}

async function runTests() {
  console.log('\n=== Testing ck path handling ===\n');

  let passed = 0;
  let failed = 0;

  if (await test('encodeProjectPath maps every non-alphanumeric character to "-"', async () => {
    const { encodeProjectPath } = await import(pathToFileURL(path.join(SKILL_DIR, 'commands', 'shared.mjs')).href);
    assert.strictEqual(encodeProjectPath('/home/u/My Project_v1.2'), '-home-u-My-Project-v1-2');
    assert.strictEqual(encodeProjectPath('C:\\Users\\u\\app'), 'C--Users-u-app');
  })) passed++; else failed++;

  if (await test('SessionStart hook injects the SKILL.md next to it, with the skill dir filled in', async () => {
    const ctx = tempEnv();
    try {
      const result = spawnSync(process.execPath, [SESSION_START], {
        cwd: ctx.project, env: ctx.env, input: '{}', encoding: 'utf8',
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const { additionalContext } = JSON.parse(result.stdout);
      assert.ok(additionalContext.includes('# ck — Context Keeper'), 'SKILL.md was not injected');
      assert.ok(!additionalContext.includes('${CLAUDE_SKILL_DIR}'), 'skill dir placeholder left unexpanded');
      // Escaped for double-quoted bash (Windows backslashes are doubled).
      const shellCommandsDir = `${SKILL_DIR.replace(/[\\$`"]/g, '\\$&')}/commands`;
      assert.ok(additionalContext.includes(shellCommandsDir), 'skill dir not substituted');
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (process.platform === 'win32') {
    console.log('  - skipped shell-special skill dir test on Windows');
  } else if (await test('hook-injected commands run from a skill dir with shell-special characters', async () => {
    const ctx = tempEnv();
    try {
      const skillDir = path.join(ctx.root, 'skills $USER $& `x` "q"', 'ck');
      fs.cpSync(SKILL_DIR, skillDir, { recursive: true });
      const result = spawnSync(process.execPath, [path.join(skillDir, 'hooks', 'session-start.mjs')], {
        cwd: ctx.project, env: ctx.env, input: '{}', encoding: 'utf8',
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const { additionalContext } = JSON.parse(result.stdout);
      const listCommand = additionalContext.split('\n').find(line => line.includes('commands/list.mjs'));
      assert.ok(listCommand, 'no list.mjs command injected');
      const list = spawnSync('bash', ['-c', listCommand], { cwd: ctx.project, env: ctx.env, encoding: 'utf8' });
      // No projects are registered, so list.mjs reaching its own message proves the path resolved.
      assert.ok(list.stdout.includes('No projects registered'), `${listCommand}\n${list.stdout}${list.stderr}`);
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (process.platform === 'win32') {
    console.log('  - skipped documented bash heredoc test on Windows');
  } else if (await test('documented heredoc commands save JSON with apostrophes into the native memory dir', async () => {
    const ctx = tempEnv();
    try {
      const init = runDocumentedSave('save.mjs" --init', '<confirmed-json>', {
        name: 'bobs-app', path: ctx.project, description: "Bob's app, don't break it",
        stack: ['node'], goal: "Ship Bob's release", constraints: [],
      }, ctx);
      assert.strictEqual(init.status, 0, init.stdout + init.stderr);

      const save = runDocumentedSave('save.mjs" <<', '<json>', {
        summary: "Fixed the user's login", leftOff: "didn't finish tests", nextSteps: ["write O'Brien's test"],
        decisions: [{ what: "use Bob's parser", why: "it's faster" }], blockers: [],
      }, ctx);
      assert.strictEqual(save.status, 0, save.stdout + save.stderr);

      const encoded = ctx.project.replace(/[^A-Za-z0-9]/g, '-');
      const memDir = path.join(ctx.home, '.claude', 'projects', encoded, 'memory');
      const files = fs.existsSync(memDir) ? fs.readdirSync(memDir) : [];
      assert.strictEqual(files.length, 1, `expected one memory entry in ${memDir}`);
      assert.ok(fs.readFileSync(path.join(memDir, files[0]), 'utf8').includes("Fixed the user's login"));
    } finally {
      fs.rmSync(ctx.root, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

runTests();
