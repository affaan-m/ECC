#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { preregister, runEvaluation } = require('./ai-eval-lib');

function main(argv = process.argv.slice(2), injected = {}) {
  const flags = new Map();
  const switches = new Set(['--plan', '--allow-real-provider', '--help']);
  const values = new Set(['--registration', '--model', '--executable', '--provider', '--auth-home', '--effort', '--repeats', '--max-calls', '--deadline-ms', '--artifact-dir']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flags.has(flag) || (!switches.has(flag) && !values.has(flag))) throw new Error('Invalid evaluation arguments');
    if (values.has(flag) && (!argv[i + 1] || argv[i + 1].startsWith('--'))) throw new Error('Missing evaluation argument');
    flags.set(flag, switches.has(flag) ? true : argv[++i]);
  }
  if (flags.has('--help')) {
    return { usage: 'ai-eval.js --plan [--repeats N] [--model MODEL --executable ABSOLUTE_PATH [--provider claude|codex] [--effort LEVEL]] | --allow-real-provider --registration FILE --model MODEL --executable ABSOLUTE_PATH [--provider claude|codex] [--effort LEVEL (Codex only)] [--auth-home ABSOLUTE_DIR (Codex only)] [--repeats N] [--max-calls N] [--deadline-ms N]. Claude auth: CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY, or the macOS Keychain login.' };
  }
  if (flags.get('--provider') !== undefined && !['claude', 'codex'].includes(flags.get('--provider'))) throw new Error('Provider must be claude or codex');
  if (flags.get('--provider') === 'claude' && flags.has('--effort')) throw new Error('Reasoning effort applies only to the Codex provider');
  const repeats = flags.has('--repeats') ? Number(flags.get('--repeats')) : 1;
  if (flags.has('--plan')) {
    if (flags.has('--allow-real-provider')) throw new Error('Plan and provider execution are separate actions');
    return preregister({ repeats, model: flags.get('--model'), executable: flags.get('--executable'), effort: flags.get('--effort') });
  }
  if (!flags.has('--allow-real-provider') && !injected.provider) throw new Error('Real evaluation requires explicit opt-in');
  if (!flags.has('--registration')) throw new Error('Evaluation requires a preregistration file');
  const registration = JSON.parse(fs.readFileSync(flags.get('--registration'), 'utf8'));
  return runEvaluation({ ...injected, registration, repeats, allowRealProvider: flags.has('--allow-real-provider'),
    executable: flags.get('--executable'), model: flags.get('--model'), family: flags.get('--provider'), effort: flags.get('--effort'), authHome: flags.get('--auth-home'),
    artifactDir: flags.get('--artifact-dir'),
    ...(flags.has('--max-calls') ? { maxCalls: Number(flags.get('--max-calls')) } : {}),
    ...(flags.has('--deadline-ms') ? { deadlineMs: Number(flags.get('--deadline-ms')) } : {}) });
}
if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main())}\n`); }
  catch (error) {
    // Only fixed messages from this evaluator are shown; provider output and paths never reach stderr.
    const known = /^(Invalid|Missing|Real|Evaluation|Plan|Registration|Provider|Auth home|Native Codex version|Reasoning effort|Claude Keychain login|Claude)[^/\\]*$/.test(error?.message || '');
    process.stderr.write(`Evaluation stopped: ${known ? error.message : 'invalid arguments, registration, source, or provider configuration'}. Use --help.\n`);
    process.exitCode = 1;
  }
}
module.exports = { main };
