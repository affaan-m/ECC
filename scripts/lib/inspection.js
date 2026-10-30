'use strict';

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_WINDOW_SIZE = 50;

const FAILURE_OUTCOMES = new Set(['failure', 'failed', 'error']);

/**
 * Normalize a failure reason string for grouping.
 * Strips timestamps, UUIDs, file paths, and numeric suffixes.
 */
function normalizeFailureReason(reason) {
  if (!reason || typeof reason !== 'string') {
    return 'unknown';
  }

  return reason
    .trim()
    .toLowerCase()
    // Strip ISO timestamps (note: already lowercased, so t/z not T/Z)
    .replace(/\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}[.\dz]*/g, '<timestamp>')
    // Strip UUIDs (already lowercased)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    // Quoted Windows paths preserve spaces and apostrophes inside path components.
    // A closing quote must be followed by a delimiter, not another name character.
    .replace(/(["'])(?:[a-z]:[\\/]|\\\\)[^\r\n]*?\1(?=[:\s),;.!?]|$)/gu, '$1<path>$1')
    // Directories may contain spaces, but trailing whitespace separates diagnostic prose.
    // Unquoted spaced leaves allow one final dotted token; longer prose stays diagnostic.
    // Quote paths with multiple spaces in the final filename to remove ambiguity.
    .replace(/(?:\b[a-z]:|\\)[\\/](?:[^\\/:*?"<>|\r\n]*[^\s\\/:*?"<>|][\\/])*[^\s\\/:*?"<>|(),;]+(?: [^\s\\/:*?"<>|]+\.[^\s\\/:*?"<>|]+(?=:))?[\\/]*/gu, '<path>')
    // Strip remaining file paths
    .replace(/(?:\b[a-z]:)?[\\/][\w./\\-]+/g, '<path>')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Group skill runs by skill ID and normalized failure reason.
 *
 * @param {Array} skillRuns - Array of skill run objects
 * @returns {Map<string, { skillId: string, normalizedReason: string, runs: Array }>}
 */
function groupFailures(skillRuns) {
  const groups = new Map();

  for (const run of skillRuns) {
    const outcome = String(run.outcome || '').toLowerCase();
    if (!FAILURE_OUTCOMES.has(outcome)) {
      continue;
    }

    const normalizedReason = normalizeFailureReason(run.failureReason);
    const key = `${run.skillId}::${normalizedReason}`;

    if (!groups.has(key)) {
      groups.set(key, {
        skillId: run.skillId,
        normalizedReason,
        runs: [],
      });
    }

    groups.get(key).runs.push(run);
  }

  return groups;
}

function compareTimestampsDescending(a, b) {
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);
  if (Number.isNaN(timeA)) return Number.isNaN(timeB) ? 0 : 1;
  if (Number.isNaN(timeB)) return -1;
  return timeB - timeA;
}

/**
 * Detect recurring failure patterns from skill runs.
 *
 * @param {Array} skillRuns - Array of skill run objects (newest first)
 * @param {Object} [options]
 * @param {number} [options.threshold=3] - Minimum failure count to trigger pattern detection
 * @returns {Array<Object>} Array of detected patterns sorted by count descending
 */
function detectPatterns(skillRuns, options = {}) {
  const threshold = options.threshold ?? DEFAULT_FAILURE_THRESHOLD;
  const groups = groupFailures(skillRuns);
  const patterns = [];

  for (const [, group] of groups) {
    if (group.runs.length < threshold) {
      continue;
    }

    const sortedRuns = [...group.runs].sort(
      (a, b) => compareTimestampsDescending(a.createdAt, b.createdAt)
    );

    const firstSeen = sortedRuns[sortedRuns.length - 1].createdAt || null;
    const lastSeen = sortedRuns[0].createdAt || null;
    const sessionIds = [...new Set(sortedRuns.map(r => r.sessionId).filter(Boolean))];
    const versions = [...new Set(sortedRuns.map(r => r.skillVersion).filter(Boolean))];

    // Collect unique raw failure reasons for this normalized group
    const rawReasons = [...new Set(sortedRuns.map(r => r.failureReason).filter(Boolean))];

    patterns.push({
      skillId: group.skillId,
      normalizedReason: group.normalizedReason,
      count: group.runs.length,
      firstSeen,
      lastSeen,
      sessionIds,
      versions,
      rawReasons,
      runIds: sortedRuns.map(r => r.id),
    });
  }

  // Sort by count descending, then by lastSeen descending
  return patterns.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return compareTimestampsDescending(a.lastSeen, b.lastSeen);
  });
}

/**
 * Generate an inspection report from detected patterns.
 *
 * @param {Array} patterns - Output from detectPatterns()
 * @param {Object} [options]
 * @param {string} [options.generatedAt] - ISO timestamp for the report
 * @returns {Object} Inspection report
 */
function generateReport(patterns, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();

  if (patterns.length === 0) {
    return {
      generatedAt,
      status: 'clean',
      patternCount: 0,
      patterns: [],
      summary: 'No recurring failure patterns detected.',
    };
  }

  const totalFailures = patterns.reduce((sum, p) => sum + p.count, 0);
  const affectedSkills = [...new Set(patterns.map(p => p.skillId))];

  return {
    generatedAt,
    status: 'attention_needed',
    patternCount: patterns.length,
    totalFailures,
    affectedSkills,
    patterns: patterns.map(p => ({
      skillId: p.skillId,
      normalizedReason: p.normalizedReason,
      count: p.count,
      firstSeen: p.firstSeen,
      lastSeen: p.lastSeen,
      sessionIds: p.sessionIds,
      versions: p.versions,
      rawReasons: p.rawReasons.slice(0, 5),
      suggestedAction: suggestAction(p),
    })),
    summary: `Found ${patterns.length} recurring failure pattern(s) across ${affectedSkills.length} skill(s) (${totalFailures} total failures).`,
  };
}

/**
 * Suggest a remediation action based on pattern characteristics.
 */
function suggestAction(pattern) {
  const reason = pattern.normalizedReason;

  if (reason.includes('timeout')) {
    return 'Increase timeout or optimize skill execution time.';
  }
  if (reason.includes('permission') || reason.includes('denied') || reason.includes('auth')) {
    return 'Check tool permissions and authentication configuration.';
  }
  if (reason.includes('not found') || reason.includes('missing')) {
    return 'Verify required files/dependencies exist before skill execution.';
  }
  if (reason.includes('parse') || reason.includes('syntax') || reason.includes('json')) {
    return 'Review input/output format expectations and add validation.';
  }
  if (pattern.versions.length > 1) {
    return 'Failure spans multiple versions. Consider rollback to last stable version.';
  }

  return 'Investigate root cause and consider adding error handling.';
}

/**
 * Run full inspection pipeline: query skill runs, detect patterns, generate report.
 *
 * @param {Object} store - State store instance with listRecentSessions, getSessionDetail
 * @param {Object} [options]
 * @param {number} [options.threshold] - Minimum failure count
 * @param {number} [options.windowSize] - Number of recent skill runs to analyze
 * @returns {Object} Inspection report
 */
function inspect(store, options = {}) {
  const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
  const threshold = options.threshold ?? DEFAULT_FAILURE_THRESHOLD;

  const status = store.getStatus({ recentSkillRunLimit: windowSize });
  const skillRuns = status.skillRuns.recent || [];

  const patterns = detectPatterns(skillRuns, { threshold });
  return generateReport(patterns, { generatedAt: status.generatedAt });
}

module.exports = {
  DEFAULT_FAILURE_THRESHOLD,
  DEFAULT_WINDOW_SIZE,
  detectPatterns,
  generateReport,
  groupFailures,
  inspect,
  normalizeFailureReason,
  suggestAction,
};
