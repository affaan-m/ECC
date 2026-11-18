#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const tools = require('./lib/copilot-runtime-tools');
const { resolveCheckout } = require('./lib/copilot-runtime-root');
const { generate } = require('./lib/copilot-pm2');
const { findPotentialSecrets, hasUnsafeControlCharacters } = require('./lib/memory-vault-format');

function checkoutCommand(action, args, cwd) {
  const root = resolveCheckout();
  if (action === 'skill-health') {
    if (args.some(arg => !['--json', '--help'].includes(arg))) throw new Error('skill-health accepts only --json or --help.');
    return tools.execute(process.execPath, [path.join(root, 'scripts/skills-health.js'), ...args], cwd);
  }
  const options = tools.flagArgs(args, ['--profile'], ['--apply', '--fetch-only', '--enable-hooks', '--no-hooks']);
  if (options['--enable-hooks'] && options['--no-hooks']) throw new Error('Choose one hook consent option.');
  if (options['--profile'] && !/^[a-z][a-z0-9-]{0,63}$/.test(options['--profile'])) throw new Error('Invalid install profile.');
  if (action === 'auto-update' && options['--fetch-only']) {
    const fetch = tools.execute('git', ['-C', root, 'fetch', '--no-recurse-submodules', 'origin'], root);
    if (fetch.exitCode !== 0) return fetch;
    return { exitCode: 0, stdout: JSON.stringify({ fetched: true, installed: false,
      next: 'Review the fetched revision, update the trusted checkout, and repin ECC_COPILOT_CHECKOUT_COMMIT before reinstalling.' }), stderr: '' };
  }
  const enableHooks = options['--enable-hooks'];
  let request = ['--profile', options['--profile'] || 'developer'];
  if (action === 'auto-update') {
    const state = tools.readJson(path.join(cwd, '.github/ecc-install-state.json'));
    const selection = state.request || state.installRequest || state.selection;
    if (options['--apply'] && selection?.hookConsent === 'enabled' && !options['--enable-hooks'] && !options['--no-hooks']) throw new Error('Explicitly choose whether to preserve hook activation during update.');
    // Reconstruct supported selection fields only, never executable or path fields.
    request = [];
    if (selection?.profile != null) {
      if (typeof selection.profile !== 'string' || !/^[a-z][a-z0-9-]+$/.test(selection.profile)) {
        throw new Error('Invalid recorded profile.');
      }
      request.push('--profile', selection.profile);
    }
    if (selection?.modules != null) {
      if (!Array.isArray(selection.modules)
        || selection.modules.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]+$/.test(id))) {
        throw new Error('Invalid recorded module selection.');
      }
      const modules = enableHooks ? selection.modules : selection.modules.filter(id => id !== 'hooks-runtime');
      if (modules.length) request.push('--modules', modules.join(','));
    }
    const hasProfileOrModules = request.length > 0;
    for (const [field, flag] of [['includeComponents', '--with'], ['excludeComponents', '--without']]) {
      const components = selection?.[field];
      if (components !== undefined && (!Array.isArray(components) || components.length > 100
        || components.some(component => typeof component !== 'string' || !/^[a-z][a-z0-9:-]{0,127}$/.test(component)))) throw new Error('Invalid recorded component selection.');
      request.push(...(components || []).flatMap(component => [flag, component]));
    }
    if (!hasProfileOrModules && !selection?.includeComponents?.length) throw new Error('Cannot reconstruct a managed reinstall request; use project-init with an explicit profile.');
  }
  return tools.execute(process.execPath, [path.join(root, 'scripts/install-apply.js'), '--target', 'copilot', ...request,
    ...(options['--apply'] ? [] : ['--dry-run']), enableHooks ? '--enable-hooks' : '--no-hooks', '--json'], cwd);
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  let raw = ''; let bytes = 0;
  if (args.includes('--stdin')) for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes <= 1024 * 1024) raw += chunk.toString('utf8'); }
  if (bytes > 1024 * 1024) throw new Error('Input exceeds 1 MiB.');
  const cwd = fs.realpathSync(process.cwd());
  if (action === 'harness-audit') return tools.audit(cwd, args);
  if (action === 'quality-gate') return tools.qualityGate(cwd, args);
  if (action === 'pm2') return generate(cwd, args, raw);
  if (['auto-update', 'project-init', 'skill-health'].includes(action)) {
    const result = checkoutCommand(action, args, cwd);
    if (findPotentialSecrets(result.stdout).length || hasUnsafeControlCharacters(result.stdout, true)) throw new Error('Unsafe backend output.');
    let output;
    try { output = JSON.parse(result.stdout); } catch { output = { stdout: result.stdout.slice(0, 8192) }; }
    return { exitCode: result.exitCode, output };
  }
  throw new Error('Unknown runtime command.');
}

main().then(result => { process.stdout.write(JSON.stringify(result.output) + '\n'); process.exitCode = result.exitCode; }).catch(() => {
  process.stdout.write('{"status":"error","reason":"Invalid input, missing prerequisite or unsafe runtime boundary."}\n');
  process.exitCode = 2;
});
