'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');

const repo = path.resolve(__dirname, '../..');
const fixture = fs.mkdtempSync(path.join(repo, 'tests', '.opencode-modular-runtime-'));
const home = path.join(fixture, 'home');
const project = path.join(fixture, 'project');
fs.mkdirSync(home);
fs.mkdirSync(project);
let failed = 0;
try {
  const build = spawnSync(process.execPath, [path.join(repo, 'scripts/build-opencode.js')], { encoding: 'utf8' });
  assert.strictEqual(build.status, 0, build.stderr || build.stdout);
  const plan = withHookConsent(createManifestInstallPlan({
    sourceRoot: repo, homeDir: home, projectRoot: project, env: {},
    target: 'opencode', moduleIds: ['platform-configs', 'hooks-runtime'],
  }), 'enabled');
  applyInstallPlan(plan);
  assert.ok(!fs.existsSync(path.join(plan.targetRoot, 'skills')), 'Optional skills must stay absent');
  const marker = path.join(plan.targetRoot, 'scripts/package.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(marker, 'utf8')).type, 'commonjs');
  assert.ok(plan.statePreview.operations.some(operation => operation.destinationPath === marker));
  const input = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';
    const root = process.argv[1];
    const logs = [];
    const context = { client: { app: { log: ({ body }) => { logs.push(body); return Promise.resolve(); } } },
      $: () => { throw new Error('Offline fixture must not execute shell commands'); },
      directory: process.cwd(), worktree: process.cwd() };
    const loaded = [];
    for (const name of fs.readdirSync(path.join(root, 'plugins')).filter(name => /\\.ts$/.test(name))) {
      const mod = await import(pathToFileURL(path.join(root, 'plugins', name)).href);
      for (const entry of new Set(Object.values(mod))) loaded.push(await entry(context));
    }
    const live = loaded.filter(hooks => typeof hooks['tool.execute.after'] === 'function');
    assert.equal(live.length, 1, 'Local discovery must register exactly one live ECC plugin');
    await live[0]['tool.execute.after']({ tool: 'skill', args: { name: 'code-review', arguments: 'private prompt sentinel' } }, {});
    assert.ok(!logs.some(entry => /telemetry disabled/.test(entry.message)));
    const runs = fs.readFileSync(path.join(process.env.ECC_AGENT_DATA_HOME, 'state/skill-runs.jsonl'), 'utf8');
    assert.equal(runs.trim().split('\\n').length, 1);
    assert.equal(JSON.parse(runs).skill_id, 'code-review');
    assert.ok(!runs.includes('private prompt sentinel'));
    const output = { env: {} };
    await live[0]['shell.env']({ cwd: process.cwd() }, output);
    assert.equal(output.env.CLAUDE_PLUGIN_ROOT, fs.realpathSync(root));
    console.log('PASS: one live installed plugin, one private skill record, canonical root export');
  `;
  const result = spawnSync(process.execPath, ['--loader',
    pathToFileURL(path.join(repo, 'tests/fixtures/opencode-ts-loader.mjs')).href,
    '--input-type=module', '-e', input, plan.targetRoot], {
    cwd: project, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, HOME: home, USERPROFILE: home,
      CLAUDE_CONFIG_DIR: path.join(home, '.claude'), ECC_AGENT_DATA_HOME: path.join(home, '.claude'),
      XDG_CONFIG_HOME: path.join(home, '.config'), OPENCODE_CONFIG_DIR: plan.targetRoot,
      CLAUDE_PLUGIN_ROOT: '', CLAUDE_CODE_PACKAGE_MANAGER: 'bun', ECC_HOOK_PROFILE: 'standard', ECC_DISABLED_HOOKS: '' },
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  console.log(result.stdout.trim());
  const standalone = spawnSync(process.execPath,
    [path.join(plan.targetRoot, 'scripts/hooks/post-bash-command-log.js'), 'audit'], {
      cwd: project, encoding: 'utf8', input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo standalone-offline' } }),
      env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude') },
    });
  assert.strictEqual(standalone.status, 0, standalone.stderr);
  assert.match(fs.readFileSync(path.join(home, '.claude/bash-commands.log'), 'utf8'), /standalone-offline/);
} catch (error) {
  failed = 1;
  console.error(error.stack);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log(`Passed: ${1 - failed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed;
