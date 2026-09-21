#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { preregister, runEvaluation } = require('../../scripts/lib/context-profile-eval');

function main(argv = process.argv.slice(2), injected = {}) {
  const flags = new Map();
  const switches = new Set(['--plan', '--allow-real-provider', '--help']);
  const values = new Set(['--registration', '--model', '--executable', '--repeats', '--max-calls', '--deadline-ms']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flags.has(flag) || (!switches.has(flag) && !values.has(flag))) throw new Error('Invalid evaluation arguments');
    if (values.has(flag) && (!argv[i + 1] || argv[i + 1].startsWith('--'))) throw new Error('Missing evaluation argument');
    flags.set(flag, switches.has(flag) ? true : argv[++i]);
  }
  if (flags.has('--help')) return { usage: 'ai-eval.js --plan [--repeats N] | --allow-real-provider --registration FILE --model MODEL --executable ABSOLUTE_PATH [--max-calls N] [--deadline-ms N]' };
  const repeats = flags.has('--repeats') ? Number(flags.get('--repeats')) : 1;
  if (flags.has('--plan')) {
    if (flags.has('--allow-real-provider')) throw new Error('Plan and provider execution are separate actions');
    return preregister({ repeats, model: flags.get('--model'), executable: flags.get('--executable') });
  }
  if (!flags.has('--allow-real-provider') && !injected.provider) throw new Error('Real evaluation requires explicit opt-in');
  if (!flags.has('--registration')) throw new Error('Evaluation requires a preregistration file');
  const registration = JSON.parse(fs.readFileSync(flags.get('--registration'), 'utf8'));
  return runEvaluation({ ...injected, registration, repeats, allowRealProvider: flags.has('--allow-real-provider'),
    executable: flags.get('--executable'), model: flags.get('--model'),
    ...(flags.has('--max-calls') ? { maxCalls: Number(flags.get('--max-calls')) } : {}),
    ...(flags.has('--deadline-ms') ? { deadlineMs: Number(flags.get('--deadline-ms')) } : {}) });
}
if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main())}\n`); }
  catch { process.stderr.write('Evaluation stopped: invalid arguments, registration, source, or provider configuration. Use --help.\n'); process.exitCode = 1; }
}
module.exports = { main };
