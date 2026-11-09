#!/usr/bin/env node
'use strict';
const fs = require('fs');
const canvas = require('./lib/copilot-canvas');
const { flagArgs } = require('./lib/copilot-runtime-tools');
async function main(args = process.argv.slice(2), env = process.env) {
  const [action, ...rest] = args;
  const workspace = fs.realpathSync(process.cwd());
  if (action === 'bind') {
    const flags = flagArgs(rest, ['--session', '--file', '--state-dir'], []);
    const receipt = canvas.bind(workspace, { sessionId: flags['--session'], file: flags['--file'], stateDir: flags['--state-dir'] }, env);
    return { bound: true, schema: receipt.schema, key: receipt.key, sessionId: receipt.sessionId, nativeStatus: 'native-unverified' };
  }
  if (action === 'unbind') {
    const flags = flagArgs(rest, ['--session'], []);
    return canvas.unbind(workspace, flags['--session'], env);
  }
  if (action === 'feedback') {
    const flags = flagArgs(rest, ['--session'], []);
    return canvas.takeBoundFeedback(workspace, flags['--session'], env);
  }
  throw new Error('Usage: copilot-canvas.js bind --session ID --file FILE --state-dir ABSOLUTE_DIRECTORY | feedback --session ID | unbind --session ID');
}
if (require.main === module) {
  main().then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(() => {
    process.stderr.write('ECC Copilot canvas operation unavailable. Inspect the session, artifact, state directory and receipt ownership.\n');
    process.exitCode = 1;
  });
}
module.exports = { main };
