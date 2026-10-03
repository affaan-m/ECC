'use strict';

const { decide, readEvents, appendDecision } = require('../lib/control-pane/tcas');

function emit(message) {
  if (message) process.stderr.write(`[TCAS] ${message}\n`);
}

async function main() {
  if (process.env.ECC_TCAS_HOOK !== '1') return 0;
  let input;
  try { input = JSON.parse(await readStdin()); } catch { emit('malformed input; allowing tool call'); return 0; }
  if (!['Edit', 'Write', 'MultiEdit'].includes(input.tool_name)) return 0;

  let events;
  try { events = await readEvents(); } catch { emit('advisory feed unavailable; allowing tool call'); return 0; }
  const decision = decide(events, input);
  appendDecision(decision, input);
  if (decision.maneuver === 'pause') {
    emit(`pause ${input.tool_input?.file_path || 'requested file'}: ${decision.reason}`);
    return 2;
  }
  if (decision.maneuver !== 'allow') emit(`${decision.maneuver}: ${decision.reason}`);
  return 0;
}

function readStdin() {
  return new Promise(resolve => {
    let body = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { body += chunk; });
    process.stdin.on('end', () => resolve(body));
  });
}

main().then(code => process.exit(code)).catch(error => {
  emit(`error (${error.message}); allowing tool call`);
  process.exit(0);
});
