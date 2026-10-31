#!/usr/bin/env node
'use strict';

// Test double for `claude --print --output-format stream-json`: it calls the configured
// PreToolUse hook once the way Claude Code does, reports the result, then applies the
// scenario's reference overlay. FAKE_CLAUDE_OVERLAY names the overlay directory.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
const emit = event => process.stdout.write(`${JSON.stringify(event)}\n`);

function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const name = entry.name.startsWith('dot-') ? `.${entry.name.slice(4)}` : entry.name;
    if (entry.isDirectory()) {
      fs.mkdirSync(path.join(to, name), { recursive: true });
      copyTree(path.join(from, entry.name), path.join(to, name));
    } else fs.copyFileSync(path.join(from, entry.name), path.join(to, name));
  }
}

const overlay = process.env.FAKE_CLAUDE_OVERLAY;
const firstFile = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile()) return entry.name;
    const inner = firstFile(path.join(dir, entry.name));
    if (inner) return path.join(entry.name, inner);
  }
  return null;
};
const first = firstFile(overlay);
const target = path.join(process.cwd(), first.split(path.sep).map(part => (part.startsWith('dot-') ? `.${part.slice(4)}` : part)).join(path.sep));
const input = fs.existsSync(target)
  ? { file_path: target, old_string: fs.readFileSync(target, 'utf8'), new_string: fs.readFileSync(path.join(overlay, first), 'utf8') }
  : { file_path: target, content: fs.readFileSync(path.join(overlay, first), 'utf8') };
const toolName = 'old_string' in input ? 'Edit' : 'Write';
emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Checking report.js, invoice.js and csv.js first.' }, { type: 'tool_use', id: 't1', name: toolName, input }] } });

// FAKE_CLAUDE_SKIP_HOOK=1 edits without running the hook (a broken hook setup);
// FAKE_CLAUDE_PROVIDER_ERROR=1 ends the session in a non-authentication provider error.
let denial = '';
const group = (settings.hooks && settings.hooks.PreToolUse || []).find(entry => new RegExp(`^(${entry.matcher})$`).test(toolName));
if (group && process.env.FAKE_CLAUDE_SKIP_HOOK !== '1') {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: process.cwd() };
  const payload = { session_id: 'fake', cwd: process.cwd(), hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: input, tool_use_id: 't1' };
  const result = spawnSync(group.hooks[0].command, { shell: true, input: JSON.stringify(payload), env, encoding: 'utf8' });
  const output = result.stdout ? JSON.parse(result.stdout) : {};
  if (output.hookSpecificOutput && output.hookSpecificOutput.permissionDecision === 'deny') denial = output.hookSpecificOutput.permissionDecisionReason;
}
emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: Boolean(denial), content: denial || 'ok' }] } });
copyTree(overlay, process.cwd());
if (process.env.FAKE_CLAUDE_PROVIDER_ERROR === '1') {
  emit({ type: 'result', is_error: true, result: 'API Error: 529 overloaded', num_turns: 1, duration_ms: 100, total_cost_usd: 0, usage: {}, modelUsage: {} });
  process.exit(0);
}
emit({ type: 'result', is_error: false, result: 'done', num_turns: 3, duration_ms: 1200, total_cost_usd: 0.01, usage: { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 400, output_tokens: 80 }, modelUsage: { 'fake-model': {} } });
