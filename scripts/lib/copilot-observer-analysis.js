'use strict';

// Pure built-in backend: no imports, executable selection, filesystem, network,
// model calls or tool handles. Metadata cannot contain instructions or programs.
const TOOLS = new Set(['Bash', 'PowerShell', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'unknown']);
const KEYS = new Set(['schema', 'timestamp', 'event', 'tool', 'session', 'project_id', 'tool_use_id', 'outcome']);
function validate(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || Object.keys(record).some(key => !KEYS.has(key))
    || record.schema !== 'ecc.copilot.observation.v1' || !TOOLS.has(record.tool)
    || !['tool_start', 'tool_complete'].includes(record.event)
    || !['succeeded', 'failed', 'unknown', 'not-run'].includes(record.outcome)
    || !/^[a-f0-9]{64}$/.test(record.project_id) || !/^[a-f0-9]{64}$/.test(record.session)
    || (record.tool_use_id !== null && !/^[a-f0-9]{64}$/.test(record.tool_use_id))
    || typeof record.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.timestamp)
    || !Number.isFinite(Date.parse(record.timestamp))) {
    throw new Error('Observer analysis accepts validated metadata only.');
  }
  return record;
}
function candidate(before, after, sessions, occurrences) {
  return {
    id: `metadata-${before.toLowerCase()}-before-${after.toLowerCase()}`,
    trigger: `when preparing to ${after.toLowerCase()} files`,
    confidence: 0.5, domain: 'workflow', scope: 'project', source: 'copilot-metadata-sequence',
    content: `Consider using ${before} before ${after} when relevant. This candidate describes completed-tool delivery ordering, with incomplete deduplication when call IDs are absent; it does not establish correctness, causation or a user preference. Review the actual workflow before adopting it.`,
    status: 'pending-review', evidence: { before, after, sessions, occurrences, confidenceMeaning: 'fixed heuristic, not a calibrated probability' },
  };
}
function validCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 9 || !value.evidence || typeof value.evidence !== 'object'
    || Array.isArray(value.evidence) || Object.keys(value.evidence).length !== 5) return false;
  const evidence = value.evidence;
  if (!['Read', 'Grep', 'Glob'].includes(evidence.before) || !['Edit', 'Write'].includes(evidence.after)
    || !Number.isSafeInteger(evidence.sessions) || evidence.sessions < 3 || evidence.sessions > 2000
    || !Number.isSafeInteger(evidence.occurrences) || evidence.occurrences < evidence.sessions
    || evidence.occurrences > 2000) return false;
  const expected = candidate(evidence.before, evidence.after, evidence.sessions, evidence.occurrences);
  return Object.entries(expected).every(([key, field]) => key === 'evidence'
    ? Object.entries(field).every(([name, item]) => value.evidence[name] === item)
    : value[key] === field);
}
function analyze(records) {
  if (!Array.isArray(records) || records.length > 2000) throw new Error('Observer metadata quota exceeded.');
  const validated = records.map(validate);
  if (new Set(validated.map(record => record.project_id)).size > 1) throw new Error('Foreign project metadata.');
  const sessions = new Map();
  for (const record of validated.filter(row => row.event === 'tool_complete')) {
    const calls = sessions.get(record.session) || new Map();
    // Object identity is an ephemeral map key, not a fabricated/persisted call ID.
    // Without IDs we can count deliveries, but not prove distinct underlying calls.
    const key = record.tool_use_id ?? record;
    const previous = calls.get(key);
    calls.set(key, previous && (previous.tool !== record.tool || previous.outcome !== record.outcome)
      ? { ...previous, outcome: 'unknown' } : previous || record);
    sessions.set(record.session, calls);
  }
  const patterns = new Map();
  for (const [session, calls] of sessions) {
    const ordered = [...calls.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (let index = 1; index < ordered.length; index++) {
      const before = ordered[index - 1]; const after = ordered[index];
      if (before.timestamp === after.timestamp || before.outcome !== 'succeeded' || after.outcome !== 'succeeded'
        || !['Read', 'Grep', 'Glob'].includes(before.tool) || !['Edit', 'Write'].includes(after.tool)) continue;
      const key = `${before.tool}:${after.tool}`;
      const previous = patterns.get(key) || { before: before.tool, after: after.tool, sessions: new Set(), occurrences: 0 };
      patterns.set(key, { ...previous, sessions: new Set([...previous.sessions, session]), occurrences: previous.occurrences + 1 });
    }
  }
  return [...patterns.values()].filter(pattern => pattern.sessions.size >= 3)
    .sort((a, b) => `${a.before}:${a.after}`.localeCompare(`${b.before}:${b.after}`))
    .map(pattern => candidate(pattern.before, pattern.after, pattern.sessions.size, pattern.occurrences));
}
module.exports = { analyze, validCandidate };
