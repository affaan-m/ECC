'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ENTRIES = new Set(['scripts/hooks/copilot-hook-adapter.js', 'scripts/hooks/copilot-lifecycle.js',
  'scripts/hooks/copilot-quality.js', 'scripts/hooks/copilot-observe.js', 'scripts/copilot-hookify.js']);
const MAX_BYTES = 1024 * 1024;
const isPluginEntrypoint = entry => ENTRIES.has(entry);
function rejected(event, message) {
  return { exitCode: event === 'preToolUse' ? 1 : 0,
    output: event === 'preToolUse' ? { permissionDecision: 'deny', permissionDecisionReason: message } : {},
    diagnostic: message };
}
function runPluginHook({ pluginRoot, entry, args, raw, env = process.env, runner = spawnSync }) {
  const event = args?.[0] === 'hook' ? args[1] : args?.[0];
  try {
    if (!isPluginEntrypoint(entry) || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')
      || typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Invalid plugin runtime invocation.');
    const root = fs.realpathSync(pluginRoot);
    const payload = JSON.parse(raw);
    if (!payload || typeof payload.cwd !== 'string' || !path.isAbsolute(payload.cwd)) throw new Error('Invalid plugin workspace.');
    const workspace = fs.realpathSync(payload.cwd);
    for (const relative of ['.github/ecc-install-state.json', '.github/hooks/ecc.json']) {
      try { fs.lstatSync(path.join(workspace, relative)); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      return rejected(event, 'ECC plugin/project installer coexistence requires explicit migration; no plugin policy was executed.');
    }
    const target = path.join(root, entry);
    if (fs.realpathSync(target) !== target) throw new Error('Linked plugin runtime entrypoint.');
    const result = runner(process.execPath, [target, ...args], { cwd: workspace, env,
      input: raw, encoding: 'utf8', shell: false, timeout: 12000, maxBuffer: MAX_BYTES });
    if (result.error || result.signal || !Number.isInteger(result.status)) throw new Error('Plugin hook unavailable.');
    let output;
    try { output = JSON.parse(result.stdout); } catch { throw new Error('Invalid plugin hook output.'); }
    if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('Invalid plugin hook output.');
    return { exitCode: result.status, output, diagnostic: result.stderr || '' };
  } catch { return rejected(event, 'ECC plugin hook failed; inspect the artifact and workspace configuration.'); }
}
module.exports = { runPluginHook, isPluginEntrypoint, MAX_BYTES };
