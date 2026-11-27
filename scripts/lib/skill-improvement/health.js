'use strict';

const HEALTH_SCHEMA_VERSION = 'ecc.skill-health.v1';

function roundRate(value) {
  return Math.round(value * 1000) / 1000;
}

function rankCounts(values) {
  return Array.from(values.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function summarizeVariantRuns(records) {
  return records.reduce((accumulator, record) => {
    const key = record.run && record.run.variant ? record.run.variant : 'baseline';
    if (!accumulator[key]) {
      accumulator[key] = { runs: 0, successes: 0, failures: 0 };
    }

    accumulator[key].runs += 1;
    if (record.outcome && record.outcome.success) {
      accumulator[key].successes += 1;
    } else {
      accumulator[key].failures += 1;
    }

    return accumulator;
  }, {});
}

function deriveSkillStatus(skillSummary, options = {}) {
  const minFailureCount = options.minFailureCount || 2;
  if (skillSummary.failures >= minFailureCount) {
    return 'failing';
  }

  if (skillSummary.failures > 0) {
    return 'watch';
  }

  return 'healthy';
}

function buildSkillHealthReport(records, options = {}) {
  const filterSkillId = options.skillId || null;
  const filtered = filterSkillId
    ? records.filter(record => record.skill && record.skill.id === filterSkillId)
    : records.slice();

  const grouped = filtered.reduce((accumulator, record) => {
    const skillId = record.skill.id;
    if (!accumulator.has(skillId)) {
      accumulator.set(skillId, []);
    }
    accumulator.get(skillId).push(record);
    return accumulator;
  }, new Map());

  const skills = Array.from(grouped.entries())
    .map(([skillId, skillRecords]) => {
      const successes = skillRecords.filter(record => record.outcome && record.outcome.success).length;
      const failures = skillRecords.length - successes;
      const recurringErrors = new Map();
      const recurringTasks = new Map();
      const recurringFeedback = new Map();

      skillRecords.forEach(record => {
        if (!record.outcome || record.outcome.success) {
          return;
        }

        if (record.outcome.error) {
          recurringErrors.set(record.outcome.error, (recurringErrors.get(record.outcome.error) || 0) + 1);
        }
        if (record.task) {
          recurringTasks.set(record.task, (recurringTasks.get(record.task) || 0) + 1);
        }
        if (record.outcome.feedback) {
          recurringFeedback.set(record.outcome.feedback, (recurringFeedback.get(record.outcome.feedback) || 0) + 1);
        }
      });

      const summary = {
        skill: {
          id: skillId,
          path: skillRecords[0].skill.path || null
        },
        totalRuns: skillRecords.length,
        successes,
        failures,
        successRate: skillRecords.length > 0 ? roundRate(successes / skillRecords.length) : 0,
        status: 'healthy',
        recurringErrors: rankCounts(recurringErrors).map(entry => ({ error: entry.value, count: entry.count })),
        recurringTasks: rankCounts(recurringTasks).map(entry => ({ task: entry.value, count: entry.count })),
        recurringFeedback: rankCounts(recurringFeedback).map(entry => ({ feedback: entry.value, count: entry.count })),
        variants: summarizeVariantRuns(skillRecords)
      };

      summary.status = deriveSkillStatus(summary, options);
      return summary;
    })
    .sort((left, right) => right.failures - left.failures || left.skill.id.localeCompare(right.skill.id));

  return {
    schemaVersion: HEALTH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    totalObservations: filtered.length,
    skillCount: skills.length,
    skills
  };
}

module.exports = {
  HEALTH_SCHEMA_VERSION,
  buildSkillHealthReport
};
