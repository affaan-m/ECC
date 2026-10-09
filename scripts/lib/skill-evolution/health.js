'use strict';

const fs = require('fs');
const path = require('path');

const provenance = require('./provenance');
const tracker = require('./tracker');
const versioning = require('./versioning');

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const PENDING_AMENDMENT_STATUSES = Object.freeze(new Set(['pending', 'proposed', 'queued', 'open']));

function roundRate(value) {
  if (value === null) {
    return null;
  }

  return Math.round(value * 10000) / 10000;
}

function formatRate(value) {
  if (value === null) {
    return 'n/a';
  }

  return `${Math.round(value * 100)}%`;
}

/**
 * Summarise a health report into counting buckets.
 *
 * A skill with no runs in the window is not healthy, it is unmeasured: the
 * trend helpers return 'stable' when both rates are null, so deriving health
 * from "not declining" turned a missing telemetry writer into a green
 * dashboard across every skill (#2463). A declining skill always has runs, so
 * the buckets partition the total.
 *
 * @param {{skills: Array<{declining?: boolean, run_count_30d?: number}>}} report
 * @returns {{total_skills: number, measured_skills: number, healthy_skills: number, declining_skills: number, unmeasured_skills: number}}
 */
function summarizeHealthReport(report) {
  const totalSkills = report.skills.length;
  // A skill with no runs in the window is not healthy, it is unmeasured.
  // Folding it into "healthy" turned a missing telemetry writer into a green
  // dashboard across every skill (#2463) — false confidence that never triggers
  // an alert. A declining skill always has runs, so the buckets partition the
  // total.
  const unmeasuredSkills = report.skills.filter(skill => !skill.run_count_30d).length;
  const decliningSkills = report.skills.filter(skill => skill.declining).length;
  const measuredSkills = totalSkills - unmeasuredSkills;
  const healthySkills = measuredSkills - decliningSkills;

  return {
    total_skills: totalSkills,
    measured_skills: measuredSkills,
    healthy_skills: healthySkills,
    declining_skills: decliningSkills,
    unmeasured_skills: unmeasuredSkills,
  };
}

function listSkillsInRoot(rootPath) {
  if (!rootPath || !fs.existsSync(rootPath)) {
    return [];
  }

  return fs.readdirSync(rootPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      skill_id: entry.name,
      skill_dir: path.join(rootPath, entry.name),
    }))
    .filter(entry => fs.existsSync(path.join(entry.skill_dir, 'SKILL.md')));
}

function discoverSkills(options = {}) {
  const roots = provenance.getSkillRoots(options);
  const discoveredSkills = [
    ...listSkillsInRoot(options.skillsRoot || roots.curated).map(skill => ({
      ...skill,
      skill_type: provenance.SKILL_TYPES.CURATED,
    })),
    ...listSkillsInRoot(options.learnedRoot || roots.learned).map(skill => ({
      ...skill,
      skill_type: provenance.SKILL_TYPES.LEARNED,
    })),
    ...listSkillsInRoot(options.importedRoot || roots.imported).map(skill => ({
      ...skill,
      skill_type: provenance.SKILL_TYPES.IMPORTED,
    })),
  ];

  return discoveredSkills.reduce((skillsById, skill) => {
    if (!skillsById.has(skill.skill_id)) {
      skillsById.set(skill.skill_id, skill);
    }
    return skillsById;
  }, new Map());
}

function calculateSuccessRate(records) {
  if (records.length === 0) {
    return null;
  }

  const successfulRecords = records.filter(record => record.outcome === 'success').length;
  return roundRate(successfulRecords / records.length);
}

function filterRecordsWithinDays(records, nowMs, days) {
  const cutoff = nowMs - (days * DAY_IN_MS);
  return records.filter(record => {
    const recordedAtMs = Date.parse(record.recorded_at);
    return !Number.isNaN(recordedAtMs) && recordedAtMs >= cutoff && recordedAtMs <= nowMs;
  });
}

function getFailureTrend(successRate7d, successRate30d, warnThreshold) {
  if (successRate7d === null || successRate30d === null) {
    return 'stable';
  }

  const delta = roundRate(successRate7d - successRate30d);
  if (delta <= (-1 * warnThreshold)) {
    return 'worsening';
  }

  if (delta >= warnThreshold) {
    return 'improving';
  }

  return 'stable';
}

function countPendingAmendments(skillDir) {
  if (!skillDir) {
    return 0;
  }

  return versioning.getEvolutionLog(skillDir, 'amendments')
    .filter(entry => {
      if (typeof entry.status === 'string') {
        return PENDING_AMENDMENT_STATUSES.has(entry.status);
      }

      return entry.event === 'proposal';
    })
    .length;
}

function getLastRun(records) {
  if (records.length === 0) {
    return null;
  }

  return records
    .map(record => ({
      timestamp: record.recorded_at,
      timeMs: Date.parse(record.recorded_at),
    }))
    .filter(entry => !Number.isNaN(entry.timeMs))
    .sort((left, right) => left.timeMs - right.timeMs)
    .at(-1)?.timestamp || null;
}

function collectSkillHealth(options = {}) {
  const now = options.now || new Date().toISOString();
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    throw new Error(`Invalid now timestamp: ${now}`);
  }

  const warnThreshold = typeof options.warnThreshold === 'number'
    ? options.warnThreshold
    : Number(options.warnThreshold || 0.1);
  if (!Number.isFinite(warnThreshold) || warnThreshold < 0) {
    throw new Error(`Invalid warn threshold: ${options.warnThreshold}`);
  }

  const records = tracker.readSkillExecutionRecords(options);
  const skillsById = discoverSkills(options);
  const recordsBySkill = records.reduce((groupedRecords, record) => {
    if (!groupedRecords.has(record.skill_id)) {
      groupedRecords.set(record.skill_id, []);
    }

    groupedRecords.get(record.skill_id).push(record);
    return groupedRecords;
  }, new Map());

  for (const skillId of recordsBySkill.keys()) {
    if (!skillsById.has(skillId)) {
      skillsById.set(skillId, {
        skill_id: skillId,
        skill_dir: null,
        skill_type: provenance.SKILL_TYPES.UNKNOWN,
      });
    }
  }

  const skills = Array.from(skillsById.values())
    .sort((left, right) => left.skill_id.localeCompare(right.skill_id))
    .map(skill => {
      const skillRecords = recordsBySkill.get(skill.skill_id) || [];
      const records7d = filterRecordsWithinDays(skillRecords, nowMs, 7);
      const records30d = filterRecordsWithinDays(skillRecords, nowMs, 30);
      const successRate7d = calculateSuccessRate(records7d);
      const successRate30d = calculateSuccessRate(records30d);
      const currentVersionNumber = skill.skill_dir ? versioning.getCurrentVersion(skill.skill_dir) : 0;
      const failureTrend = getFailureTrend(successRate7d, successRate30d, warnThreshold);

      return {
        skill_id: skill.skill_id,
        skill_type: skill.skill_type,
        current_version: currentVersionNumber > 0 ? `v${currentVersionNumber}` : null,
        pending_amendments: countPendingAmendments(skill.skill_dir),
        success_rate_7d: successRate7d,
        success_rate_30d: successRate30d,
        failure_trend: failureTrend,
        declining: failureTrend === 'worsening',
        last_run: getLastRun(skillRecords),
        run_count_7d: records7d.length,
        run_count_30d: records30d.length,
      };
    });

  return {
    generated_at: now,
    warn_threshold: warnThreshold,
    skills,
  };
}

function formatHealthReport(report, options = {}) {
  if (options.json) {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  const summary = summarizeHealthReport(report);

  if (!report.skills.length) {
    return [
      'ECC skill health',
      `Generated: ${report.generated_at}`,
      '',
      'No skill execution records found.',
      '',
    ].join('\n');
  }

  const lines = [
    'ECC skill health',
    `Generated: ${report.generated_at}`,
    `Skills: ${summary.total_skills} total, ${summary.measured_skills} measured, ${summary.healthy_skills} healthy, ${summary.declining_skills} declining, ${summary.unmeasured_skills} unmeasured`,
    '',
    'skill            version   7d     30d    trend       pending   last run',
    '--------------------------------------------------------------------------',
  ];

  for (const skill of report.skills) {
    const statusLabel = skill.declining ? '!' : ' ';
    lines.push([
      `${statusLabel}${skill.skill_id}`.padEnd(16),
      String(skill.current_version || '-').padEnd(9),
      formatRate(skill.success_rate_7d).padEnd(6),
      formatRate(skill.success_rate_30d).padEnd(6),
      skill.failure_trend.padEnd(11),
      String(skill.pending_amendments).padEnd(9),
      skill.last_run || '-',
    ].join(' '));
  }

  return `${lines.join('\n')}\n`;
}

module.exports = {
  PENDING_AMENDMENT_STATUSES,
  calculateSuccessRate,
  collectSkillHealth,
  discoverSkills,
  filterRecordsWithinDays,
  formatHealthReport,
  summarizeHealthReport,
};
