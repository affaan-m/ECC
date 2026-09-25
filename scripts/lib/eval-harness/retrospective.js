'use strict';

/** Read-only retrospective preparation over explicit, quiescent local capsules.
 * Counts are declarations in the records, never scores or promotion evidence.
 * Inherits capsule.project's local-reader limits; not hostile-filesystem isolation.
 */
const capsule = require('./capsule');
const { LINEAGES, EFFECT_CLASSES } = require('./envelope');
const { hashValue } = require('./canonical');

const MAX_INPUTS = 100;
const SOURCE_FIELDS = ['entry_count', 'root_hash', 'journal_sha256', 'projection_hash'];

class RetrospectiveError extends Error {
  constructor(code, message, inputIndex) {
    super(message);
    this.name = 'RetrospectiveError';
    this.code = code;
    if (inputIndex !== undefined) this.input_index = inputIndex;
  }
}

function readProjection(dir, index) {
  try {
    return capsule.project(dir);
  } catch {
    // Reader errors can contain private paths or journal content. No partial
    // report or unchecked diagnostic content crosses the report boundary.
    throw new RetrospectiveError('retrospective.invalid_capsule', `capsule at input index ${index} failed verification`, index);
  }
}

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const identity = projection => JSON.stringify([projection.run_id, projection.capsule_id]);

function summarizeGroup(harnessVersion, projections) {
  const total = keys => Object.fromEntries(keys.map(key => [key, 0]));
  const byLineage = total(LINEAGES);
  const byEffect = total(EFFECT_CLASSES);
  for (const projection of projections) {
    for (const key of LINEAGES) byLineage[key] += projection.by_lineage[key];
    for (const key of EFFECT_CLASSES) byEffect[key] += projection.by_effect_class[key];
  }
  return {
    harness_version: harnessVersion,
    capsule_count: projections.length,
    entry_count: projections.reduce((sum, item) => sum + item.entry_count, 0),
    by_lineage: byLineage,
    by_effect_class: byEffect,
    sources: [...projections].sort((a, b) => compare(identity(a), identity(b)))
      .map(item => ({
        identity_hash: hashValue([item.run_id, item.capsule_id]),
        ...Object.fromEntries(SOURCE_FIELDS.map(key => [key, item[key]])),
      })),
  };
}

/**
 * Group up to 100 selected snapshots of one task family by harness_version.
 * Duplicate identities count once only if the verified projections match.
 * Different checkpoints of the same identity are ambiguous and refused.
 * Does not read saved projections, copy payloads, write files or invoke tools.
 */
function groupCapsules(dirs) {
  if (!Array.isArray(dirs) || dirs.length < 1 || dirs.length > MAX_INPUTS
      || !Array.from(dirs).every(dir => typeof dir === 'string' && dir.trim() && !dir.includes('\0'))) {
    throw new RetrospectiveError('retrospective.invalid_inputs', `supply 1 to ${MAX_INPUTS} capsule directory paths`);
  }
  const projections = dirs.map(readProjection);
  const family = projections[0].task_family;
  const unique = new Map();
  for (const [index, projection] of projections.entries()) {
    if (projection.task_family !== family) {
      throw new RetrospectiveError('retrospective.mixed_task_families', 'all capsules must have the same task family', index);
    }
    const key = identity(projection);
    const previous = unique.get(key);
    if (previous && previous.projection_hash !== projection.projection_hash) {
      throw new RetrospectiveError('retrospective.conflicting_identity', 'conflicting snapshots share a capsule identity', index);
    }
    unique.set(key, projection);
  }
  const byHarness = new Map();
  for (const projection of unique.values()) {
    const version = projection.harness_version;
    byHarness.set(version, [...(byHarness.get(version) || []), projection]);
  }
  const report = {
    schema: 'capsule-retrospective/v1',
    report_only: true,
    task_family: family,
    input_count: dirs.length,
    capsule_count: unique.size,
    duplicate_count: dirs.length - unique.size,
    groups: [...byHarness].sort(([a], [b]) => compare(a, b))
      .map(([version, items]) => summarizeGroup(version, items)),
  };
  return { ...report, report_hash: hashValue(report) };
}

module.exports = { groupCapsules, MAX_INPUTS, RetrospectiveError };
