#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const canonical = require('./hooks/hookify-runtime');
const { normalizeInput } = require('./hooks/copilot-hook-adapter');
const { isHookEnabled } = require('./lib/hook-flags');
const { readBounded } = require('./lib/copilot-sessions');
const { readSessionEvents } = require('./lib/copilot-native-events');
const { workspacePath, flagArgs } = require('./lib/copilot-runtime-tools');
const { findPotentialSecrets } = require('./lib/memory-vault-format');
const RELATIVE = '.github/ecc/hookify';
function ruleName(name) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name)) throw new Error('Invalid rule name.');
  return name;
}
function parse(raw, source) {
  if (Buffer.byteLength(raw) > canonical.MAX_RULE_BYTES || findPotentialSecrets(raw).length) throw new Error('Rule exceeds limit or contains a suspected secret.');
  const document = canonical.extractFrontmatter(raw);
  if (!document) throw new Error('Rule requires frontmatter.');
  return canonical.normalizeRule(canonical.parseRuleFrontmatter(document.yaml), document.message, source);
}
function load(cwd) {
  const dir = workspacePath(cwd, RELATIVE, true);
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir).filter(name => /^hookify\.[a-z][a-z0-9-]*\.local\.md$/.test(name));
  if (names.length > canonical.MAX_RULES) throw new Error('Too many Hookify rules.');
  return names.sort().map(name => { const file = workspacePath(cwd, `${RELATIVE}/${name}`); return parse(readBounded(file, canonical.MAX_RULE_BYTES), file); });
}
function tracked(cwd) {
  const check = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8', timeout: 2000 });
  if (check.status !== 0) return new Set();
  const result = spawnSync('git', ['ls-files', '-z', '--', `${RELATIVE}/hookify.*.local.md`], { cwd, encoding: 'utf8', timeout: 2000, maxBuffer: 65536 });
  if (result.error || result.status !== 0) throw new Error('Cannot verify tracked local rules.');
  return new Set(result.stdout.split('\0').filter(Boolean).map(file => path.resolve(cwd, file)));
}
function evaluate(event, payload, cwd, env) {
  const cleanEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('CLAUDE_')));
  if (!isHookEnabled(`copilot:hookify:${event}`, { env: cleanEnv, profiles: ['standard', 'strict'] })) return {};
  const prompt = event === 'userPromptTransformed';
  const input = normalizeInput(prompt ? 'userPromptSubmitted' : event, payload);
  if (fs.realpathSync(input.cwd) !== cwd) throw new Error('Hook workspace mismatch.');
  if (input.tool_input) {
    for (const [native, target] of [['new_str', 'new_string'], ['old_str', 'old_string']]) {
      if (input.tool_input[native] !== undefined && input.tool_input[target] !== undefined && input.tool_input[native] !== input.tool_input[target]) throw new Error('Conflicting edit text aliases.');
      input.tool_input = { ...input.tool_input, ...(input.tool_input[native] !== undefined ? { [target]: input.tool_input[native] } : {}) };
    }
  }
  if (event === 'agentStop' && (payload.stop_hook_active || payload.stopHookActive)) return {};
  if (event === 'agentStop' && (payload.transcriptPath || payload.transcript_path)) {
    const source = readSessionEvents(input.session_id, cwd, env, payload.transcriptPath ?? payload.transcript_path);
    input.last_assistant_message = source.events.findLast(item => item.type === 'assistant.message' && !item.agentId)?.data?.content || '';
  }
  if (prompt) input.prompt = payload.transformedPrompt ?? payload.prompt;
  const excluded = /^(1|true)$/i.test(env.ECC_HOOKIFY_ALLOW_TRACKED || '') ? new Set() : tracked(cwd);
  const rules = load(cwd).filter(rule => rule.enabled && !excluded.has(rule.sourcePath) && (!prompt || rule.action !== 'block'));
  const budget = { remaining: canonical.MAX_RULE_EVALUATIONS, deadline: Date.now() + 1000, now: Date.now };
  const matches = [];
  for (const rule of rules) {
    try { if (canonical.ruleMatches(rule, input, canonical.eventAlias(input), budget, new Map())) matches.push(rule); }
    catch { if (rule.action === 'block') matches.push(rule); }
  }
  if (!matches.length) return {};
  const result = canonical.buildOutput(input, matches);
  if (prompt) {
    if (matches.some(rule => rule.action === 'block')) throw new Error('Copilot prompt hooks cannot block submissions.');
    return { modifiedTransformedPrompt: String(input.prompt || '') + '\n\n' + result.hookSpecificOutput.additionalContext };
  }
  if (event === 'agentStop') return result.decision ? result : {};
  const fields = result.hookSpecificOutput || {};
  return { ...(fields.permissionDecision === 'deny' ? { permissionDecision: 'deny', permissionDecisionReason: fields.permissionDecisionReason } : {}),
    ...(fields.additionalContext ? { additionalContext: fields.additionalContext } : {}) };
}
async function main() {
  const [action, ...args] = process.argv.slice(2);
  let bytes = 0; const chunks = [];
  if (action === 'hook' || args.includes('--stdin')) for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes <= 1024 * 1024) chunks.push(chunk); }
  if (bytes > 1024 * 1024) throw new Error('Hookify input exceeds limit.');
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  const cwd = fs.realpathSync(process.cwd());
  if (action === 'hook' && args.length === 1 && ['preToolUse', 'postToolUse', 'agentStop', 'userPromptTransformed'].includes(args[0])) return evaluate(args[0], JSON.parse(raw), cwd, process.env);
  if (action === 'list' && !args.length) return { rules: load(cwd).map(rule => ({ name: rule.name, enabled: rule.enabled, event: rule.event, action: rule.action, source: path.relative(cwd, rule.sourcePath) })) };
  const options = flagArgs(args, ['--name', '--enabled'], ['--stdin']);
  const name = ruleName(options['--name']);
  const file = workspacePath(cwd, `${RELATIVE}/hookify.${name}.local.md`, true);
  if (action === 'create' && options['--stdin']) {
    const rule = parse(raw, file);
    if (rule.name !== name || (rule.event === 'prompt' && rule.action === 'block')) throw new Error('Unsupported prompt blocking or conflicting rule name.');
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, raw, { flag: 'wx', mode: 0o600 });
    return { created: true, name };
  }
  if (action === 'configure' && ['true', 'false'].includes(options['--enabled'])) {
    const previous = readBounded(file, canonical.MAX_RULE_BYTES);
    const document = canonical.extractFrontmatter(previous); parse(previous, file);
    const yaml = /^enabled:\s*(?:true|false)\s*$/m.test(document.yaml) ? document.yaml.replace(/^enabled:\s*(?:true|false)\s*$/m, `enabled: ${options['--enabled']}`)
      : document.yaml + `\nenabled: ${options['--enabled']}`;
    const content = `---\n${yaml.trim()}\n---\n${document.message}`;
    parse(content, file); fs.writeFileSync(file, content); return { updated: true, name, enabled: options['--enabled'] === 'true' };
  }
  throw new Error('Invalid Hookify command.');
}
module.exports = { load, parse, evaluate, ruleName };
if (require.main === module) main().then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => {
  const deny = process.argv[2] === 'hook' && process.argv[3] === 'preToolUse';
  process.stdout.write(JSON.stringify(deny ? { permissionDecision: 'deny', permissionDecisionReason: 'ECC Hookify could not safely inspect local rules or hook input.' } : { error: 'Invalid, unavailable or unsafe Hookify data.' }) + '\n');
  process.exitCode = 1;
});
