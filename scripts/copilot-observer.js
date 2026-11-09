#!/usr/bin/env node
'use strict';
const observer = require('./lib/copilot-observer');
function options(args) {
  const result = {};
  const flags = { '--backend': 'backend', '--interval-ms': 'intervalMs', '--duration-ms': 'durationMs', '--max-runs': 'maxRuns', '--token': 'token', '--candidate': 'candidate' };
  for (let index = 0; index < args.length; index += 2) {
    const name = flags[args[index]]; const value = args[index + 1];
    if (!name || !value || Object.hasOwn(result, name)) throw new Error('Invalid observer option.');
    result[name] = ['intervalMs', 'durationMs', 'maxRuns'].includes(name) ? Number(value) : value;
  }
  return result;
}
async function main(args = process.argv.slice(2), env = process.env) {
  const [action, ...rest] = args;
  const workspace = process.cwd();
  if (action === '__worker' && rest.length === 1) { await observer.worker(workspace, rest[0], env); return { status: 'stopped' }; }
  const selected = options(rest);
  if (action === 'once' && Object.keys(selected).every(key => key === 'backend')) return observer.runOnce(workspace, selected, env);
  if (action === 'start' && Object.keys(selected).every(key => ['backend', 'intervalMs', 'durationMs', 'maxRuns'].includes(key))) return observer.start(workspace, selected, env);
  if (action === 'status' && !rest.length) return observer.status(workspace, env);
  if (action === 'stop' && !rest.length) return observer.stop(workspace, env);
  if (action === 'recover' && Object.keys(selected).length === 1 && selected.token) return observer.recover(workspace, selected.token, env);
  if (action === 'candidates' && !rest.length) return { state: observer.readState(workspace, env), activated: false };
  if (action === 'export' && Object.keys(selected).length === 1 && selected.candidate) return observer.exportCandidate(workspace, selected.candidate, env);
  throw new Error('Usage: copilot-observer.js once|start --backend metadata-sequences [limits] | status | stop | candidates | export --candidate ID | recover --token TOKEN');
}
if (require.main === module) {
  main().then(value => process.stdout.write(typeof value === 'string' ? value : `${JSON.stringify(value)}\n`)).catch(() => {
    process.stderr.write('ECC observer unavailable: check explicit backend, project mapping, ownership, limits and private state. No observations or candidate bodies are echoed.\n');
    process.exitCode = 1;
  });
}
module.exports = { main };
