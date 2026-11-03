'use strict';
const fs = require('fs');
const path = require('path');
const { configRoot, readBounded, sessionId, MAX_TRANSCRIPT_BYTES } = require('./copilot-sessions');
function readSessionEvents(id, cwd, env = process.env, suppliedPath) {
  sessionId(id);
  let directory = fs.realpathSync(configRoot(env));
  for (const segment of ['session-state', id]) {
    directory = path.join(directory, segment);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe native session directory.');
  }
  const file = path.join(directory, 'events.jsonl');
  if (suppliedPath !== undefined && (typeof suppliedPath !== 'string' || path.resolve(suppliedPath) !== file)) throw new Error('Foreign transcript path.');
  const raw = readBounded(file, MAX_TRANSCRIPT_BYTES);
  const events = raw.split('\n').filter(line => line.trim()).map(line => {
    if (Buffer.byteLength(line) > 128 * 1024) throw new Error('Native event record exceeds its limit.');
    const event = JSON.parse(line);
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Invalid native event.');
    return event;
  });
  const starts = events.filter(event => event.type === 'session.start');
  if (!starts.length || starts.some(event => event.data?.sessionId !== id || typeof event.data?.context?.cwd !== 'string')) throw new Error('Native session does not attest a workspace.');
  if (starts.some(event => fs.realpathSync(event.data.context.cwd) !== cwd)) {
    const error = new Error('Foreign workspace native session.'); error.code = 'ECC_COPILOT_FOREIGN_SESSION'; throw error;
  }
  if (events.some(event => event.type === 'session.context_changed'
    && (typeof event.data?.cwd !== 'string' || fs.realpathSync(event.data.cwd) !== cwd))) throw new Error('Mixed-workspace native session.');
  return { events, bytes: Buffer.byteLength(raw) };
}
module.exports = { readSessionEvents };
