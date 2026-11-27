'use strict';

const EVALUATION_SCHEMA_VERSION = 'ecc.skill-evaluation.v1';

function roundRate(value) {
  return Math.round(value * 1000) / 1000;
}

function summarize(records) {
  const runs = records.length;
  const successes = records.filter(record => record.outcome && record.outcome.success).length;
  const failures = runs - successes;
  return {
    runs,
    successes,
    failures,
    successRate: runs > 0 ? roundRate(successes / runs) : 0
  };
}

function buildSkillEvaluationScaffold(skillId, records, options = {}) {
  const minimumRunsPerVariant = options.minimumRunsPerVariant || 2;
  const amendmentId = options.amendmentId || null;
  const filtered = records.filter(record => record.skill && record.skill.id === skillId);
  const baseline = filtered.filter(record => !record.run || record.run.variant !== 'amended');
  const amended = filtered.filter(record => record.run && record.run.variant === 'amended')
    .filter(record => !amendmentId || record.run.amendmentId === amendmentId);

  const baselineSummary = summarize(baseline);
  const amendedSummary = summarize(amended);
  const delta = {
    successRate: roundRate(amendedSummary.successRate - baselineSummary.successRate),
    failures: amendedSummary.failures - baselineSummary.failures
  };

  let recommendation = 'insufficient-data';
  if (baselineSummary.runs >= minimumRunsPerVariant && amendedSummary.runs >= minimumRunsPerVariant) {
    recommendation = delta.successRate > 0 ? 'promote-amendment' : 'keep-baseline';
  }

  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    skillId,
    amendmentId,
    gate: {
      minimumRunsPerVariant
    },
    baseline: baselineSummary,
    amended: amendedSummary,
    delta,
    recommendation
  };
}

module.exports = {
  EVALUATION_SCHEMA_VERSION,
  buildSkillEvaluationScaffold
};
