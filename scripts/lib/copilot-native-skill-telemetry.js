'use strict';

// Interpret explicit native skill events only. A loaded file, citation or
// generic tool result never establishes that a skill ran or completed.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizePayload } = require('./copilot-sessions');
const { readSessionEvents } = require('./copilot-native-events');
const { recordSkillFact } = require('./copilot-telemetry');
const SOURCES = new Set(['project', 'inherited', 'personal-copilot', 'personal-agents', 'custom', 'plugin', 'builtin', 'remote', 'sdk']);
const TRIGGERS = new Set(['user-invoked', 'agent-invoked', 'context-load']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function qualifiedSkill(data, workspace) {
  if (!data || typeof data !== 'object' || !SOURCES.has(data.source) || !TRIGGERS.has(data.trigger)
    || typeof data.name !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(data.name)
    || typeof data.path !== 'string' || data.path.length > 4096 || !path.isAbsolute(data.path)
    || data.path.includes('\0') || data.path.includes('\n') || data.path.includes('\r')
    || path.basename(data.path) !== 'SKILL.md') return null;
  let absolute = path.resolve(data.path);
  if (data.source === 'project') {
    // A project skill must belong to the attested workspace. Resolve existing
    // paths so a project symlink cannot mislabel an external origin as local.
    let canonical;
    try { canonical = fs.realpathSync(absolute); } catch { return null; }
    if (!inside(workspace, canonical)) return null;
    absolute = canonical;
  }
  const digest = crypto.createHash('sha256').update(absolute).digest('hex').slice(0, 24);
  return `${data.source}/${data.name}@${digest}`;
}
function facts(events, workspace, sessionId) {
  let ignored = 0;
  const selected = [];
  for (const event of events) {
    if (event.type !== 'skill.invoked') continue;
    const skillId = qualifiedSkill(event.data, workspace);
    if (event.checkpoint === true || event.ephemeral === true || !UUID.test(event.id || '') || !skillId
      || typeof event.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(event.timestamp)
      || !Number.isFinite(Date.parse(event.timestamp))) { ignored++; continue; }
    selected.push({ workspace, sessionId, eventId: event.id, callId: event.id,
      skillId, kind: event.data.trigger === 'context-load' ? 'selected' : 'invoked', source: 'explicit-host-signal' });
  }
  return { selected, ignored };
}
function unavailable(reason, ignored = 0) {
  return { status: 'unavailable', reason, ignored, skillOutcomes: 'unavailable',
    contextUsage: 'unavailable', governance: 'unavailable' };
}
function importNativeSkillFacts(payload, env = process.env) {
  if (env.ECC_COPILOT_TELEMETRY !== '1') return { status: 'disabled' };
  const input = normalizePayload(payload);
  let events;
  try { ({ events } = readSessionEvents(input.id, input.workspace, env)); }
  catch (error) {
    if (error.code === 'ENOENT') return unavailable('Native session journal is absent; no usage inferred.');
    throw error;
  }
  const { selected, ignored } = facts(events, input.workspace, input.id);
  if (!selected.length) return unavailable('No supported persisted skill invocation signal; no usage inferred.', ignored);
  const results = selected.map(fact => recordSkillFact(fact, env));
  return { status: 'imported', recorded: results.filter(result => result.status === 'recorded').length,
    duplicates: results.filter(result => result.status === 'duplicate').length, ignored,
    skillOutcomes: 'unavailable', contextUsage: 'unavailable', governance: 'unavailable' };
}
module.exports = { importNativeSkillFacts };
