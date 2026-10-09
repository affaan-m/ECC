'use strict';

const health = require('./health');
const tracker = require('./tracker');
const versioning = require('./versioning');

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const SPARKLINE_CHARS = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';
const EMPTY_BLOCK = '\u2591';
const FILL_BLOCK = '\u2588';
const DEFAULT_PANEL_WIDTH = 64;
const VALID_PANELS = new Set(['success-rate', 'failures', 'amendments', 'versions']);

function sparkline(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return '';
  }

  return values.map(value => {
    if (value === null || value === undefined) {
      return EMPTY_BLOCK;
    }

    const clamped = Math.max(0, Math.min(1, value));
    const index = Math.min(Math.round(clamped * (SPARKLINE_CHARS.length - 1)), SPARKLINE_CHARS.length - 1);
    return SPARKLINE_CHARS[index];
  }).join('');
}

function horizontalBar(value, max, width) {
  if (max <= 0 || width <= 0) {
    return EMPTY_BLOCK.repeat(width || 0);
  }

  const filled = Math.round((Math.min(value, max) / max) * width);
  const empty = width - filled;
  return FILL_BLOCK.repeat(filled) + EMPTY_BLOCK.repeat(empty);
}

function panelBox(title, lines, width) {
  const innerWidth = width || DEFAULT_PANEL_WIDTH;
  const output = [];
  output.push('\u250C\u2500 ' + title + ' ' + '\u2500'.repeat(Math.max(0, innerWidth - title.length - 4)) + '\u2510');

  for (const line of lines) {
    const truncated = line.length > innerWidth - 2
      ? line.slice(0, innerWidth - 2)
      : line;
    output.push('\u2502 ' + truncated.padEnd(innerWidth - 2) + '\u2502');
  }

  output.push('\u2514' + '\u2500'.repeat(innerWidth - 1) + '\u2518');
  return output.join('\n');
}

function bucketByDay(records, nowMs, days) {
  const buckets = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dayEnd = nowMs - (i * DAY_IN_MS);
    const dayStart = dayEnd - DAY_IN_MS;
    const dateStr = new Date(dayEnd).toISOString().slice(0, 10);
    buckets.push({ date: dateStr, start: dayStart, end: dayEnd, records: [] });
  }

  for (const record of records) {
    const recordMs = Date.parse(record.recorded_at);
    if (Number.isNaN(recordMs)) {
      continue;
    }

    for (const bucket of buckets) {
      if (recordMs > bucket.start && recordMs <= bucket.end) {
        bucket.records.push(record);
        break;
      }
    }
  }

  return buckets.map(bucket => ({
    date: bucket.date,
    rate: bucket.records.length > 0
      ? health.calculateSuccessRate(bucket.records)
      : null,
    runs: bucket.records.length,
  }));
}

function getTrendArrow(successRate7d, successRate30d) {
  if (successRate7d === null || successRate30d === null) {
    return '\u2192';
  }

  const delta = successRate7d - successRate30d;
  if (delta >= 0.1) {
    return '\u2197';
  }

  if (delta <= -0.1) {
    return '\u2198';
  }

  return '\u2192';
}

function formatPercent(value) {
  if (value === null) {
    return 'n/a';
  }

  return `${Math.round(value * 100)}%`;
}

function groupRecordsBySkill(records) {
  return records.reduce((grouped, record) => {
    const skillId = record.skill_id;
    if (!grouped.has(skillId)) {
      grouped.set(skillId, []);
    }

    grouped.get(skillId).push(record);
    return grouped;
  }, new Map());
}

function renderSuccessRatePanel(records, skills, options = {}) {
  const nowMs = Date.parse(options.now || new Date().toISOString());
  const days = options.days || 30;
  const width = options.width || DEFAULT_PANEL_WIDTH;
  const recordsBySkill = groupRecordsBySkill(records);

  const skillData = [];
  const skillIds = Array.from(new Set([
    ...Array.from(recordsBySkill.keys()),
    ...skills.map(s => s.skill_id),
  ])).sort();

  for (const skillId of skillIds) {
    const skillRecords = recordsBySkill.get(skillId) || [];
    const dailyRates = bucketByDay(skillRecords, nowMs, days);
    const rateValues = dailyRates.map(b => b.rate);
    const records7d = health.filterRecordsWithinDays(skillRecords, nowMs, 7);
    const records30d = health.filterRecordsWithinDays(skillRecords, nowMs, 30);
    const current7d = health.calculateSuccessRate(records7d);
    const current30d = health.calculateSuccessRate(records30d);
    const trend = getTrendArrow(current7d, current30d);

    skillData.push({
      skill_id: skillId,
      daily_rates: dailyRates,
      sparkline: sparkline(rateValues),
      current_7d: current7d,
      trend,
    });
  }

  const lines = [];
  if (skillData.length === 0) {
    lines.push('No skill execution data available.');
  } else {
    for (const skill of skillData) {
      const nameCol = skill.skill_id.slice(0, 14).padEnd(14);
      const sparkCol = skill.sparkline.slice(0, 30);
      const rateCol = formatPercent(skill.current_7d).padStart(5);
      lines.push(`${nameCol}  ${sparkCol}  ${rateCol} ${skill.trend}`);
    }
  }

  return {
    text: panelBox('Success Rate (30d)', lines, width),
    data: { skills: skillData },
  };
}

function renderFailureClusterPanel(records, options = {}) {
  const width = options.width || DEFAULT_PANEL_WIDTH;
  const failures = records.filter(r => r.outcome === 'failure');

  const clusterMap = new Map();
  for (const record of failures) {
    const reason = (record.failure_reason || 'unknown').toLowerCase().trim();
    if (!clusterMap.has(reason)) {
      clusterMap.set(reason, { count: 0, skill_ids: new Set() });
    }

    const cluster = clusterMap.get(reason);
    cluster.count += 1;
    cluster.skill_ids.add(record.skill_id);
  }

  const clusters = Array.from(clusterMap.entries())
    .map(([pattern, data]) => ({
      pattern,
      count: data.count,
      skill_ids: Array.from(data.skill_ids).sort(),
      percentage: failures.length > 0
        ? Math.round((data.count / failures.length) * 100)
        : 0,
    }))
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));

  const maxCount = clusters.length > 0 ? clusters[0].count : 0;
  const lines = [];

  if (clusters.length === 0) {
    lines.push('No failure patterns detected.');
  } else {
    for (const cluster of clusters) {
      const label = cluster.pattern.slice(0, 20).padEnd(20);
      const bar = horizontalBar(cluster.count, maxCount, 16);
      const skillCount = cluster.skill_ids.length;
      const suffix = skillCount === 1 ? 'skill' : 'skills';
      lines.push(`${label} ${bar} ${String(cluster.count).padStart(3)} (${skillCount} ${suffix})`);
    }
  }

  return {
    text: panelBox('Failure Patterns', lines, width),
    data: { clusters, total_failures: failures.length },
  };
}

function renderAmendmentPanel(skillsById, options = {}) {
  const width = options.width || DEFAULT_PANEL_WIDTH;
  const amendments = [];

  for (const [skillId, skill] of skillsById) {
    if (!skill.skill_dir) {
      continue;
    }

    const log = versioning.getEvolutionLog(skill.skill_dir, 'amendments');
    for (const entry of log) {
      const status = typeof entry.status === 'string' ? entry.status : null;
      const isPending = status
        ? health.PENDING_AMENDMENT_STATUSES.has(status)
        : entry.event === 'proposal';

      if (isPending) {
        amendments.push({
          skill_id: skillId,
          event: entry.event || 'proposal',
          status: status || 'pending',
          created_at: entry.created_at || null,
        });
      }
    }
  }

  amendments.sort((a, b) => {
    const timeA = a.created_at ? Date.parse(a.created_at) : 0;
    const timeB = b.created_at ? Date.parse(b.created_at) : 0;
    return timeB - timeA;
  });

  const lines = [];
  if (amendments.length === 0) {
    lines.push('No pending amendments.');
  } else {
    for (const amendment of amendments) {
      const name = amendment.skill_id.slice(0, 14).padEnd(14);
      const event = amendment.event.padEnd(10);
      const status = amendment.status.padEnd(10);
      const time = amendment.created_at ? amendment.created_at.slice(0, 19) : '-';
      lines.push(`${name} ${event} ${status} ${time}`);
    }

    lines.push('');
    lines.push(`${amendments.length} amendment${amendments.length === 1 ? '' : 's'} pending review`);
  }

  return {
    text: panelBox('Pending Amendments', lines, width),
    data: { amendments, total: amendments.length },
  };
}

function renderVersionTimelinePanel(skillsById, options = {}) {
  const width = options.width || DEFAULT_PANEL_WIDTH;
  const skillVersions = [];

  for (const [skillId, skill] of skillsById) {
    if (!skill.skill_dir) {
      continue;
    }

    const versions = versioning.listVersions(skill.skill_dir);
    if (versions.length === 0) {
      continue;
    }

    const amendmentLog = versioning.getEvolutionLog(skill.skill_dir, 'amendments');
    const reasonByVersion = new Map();
    for (const entry of amendmentLog) {
      if (entry.version && entry.reason) {
        reasonByVersion.set(entry.version, entry.reason);
      }
    }

    skillVersions.push({
      skill_id: skillId,
      versions: versions.map(v => ({
        version: v.version,
        created_at: v.created_at,
        reason: reasonByVersion.get(v.version) || null,
      })),
    });
  }

  skillVersions.sort((a, b) => a.skill_id.localeCompare(b.skill_id));

  const lines = [];
  if (skillVersions.length === 0) {
    lines.push('No version history available.');
  } else {
    for (const skill of skillVersions) {
      lines.push(skill.skill_id);
      for (const version of skill.versions) {
        const date = version.created_at ? version.created_at.slice(0, 10) : '-';
        const reason = version.reason || '-';
        lines.push(`  v${version.version} \u2500\u2500 ${date} \u2500\u2500 ${reason}`);
      }
    }
  }

  return {
    text: panelBox('Version History', lines, width),
    data: { skills: skillVersions },
  };
}

/**
 * Render the full skill-health dashboard: header, coverage warning and panels.
 *
 * Coverage is stated explicitly because the 30-day window can empty out while
 * runs are still retained, so "unmeasured" must not be reported as "never
 * recorded" (#2463).
 *
 * @param {object} [options]
 * @param {string} [options.now] ISO timestamp used as the evaluation instant
 * @param {string} [options.panel] render only this panel
 * @returns {{text: string, data: object}}
 */
function renderDashboard(options = {}) {
  const now = options.now || new Date().toISOString();
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    throw new Error(`Invalid now timestamp: ${now}`);
  }

  const dashboardOptions = { ...options, now };
  const records = tracker.readSkillExecutionRecords(dashboardOptions);
  const skillsById = health.discoverSkills(dashboardOptions);
  const report = health.collectSkillHealth(dashboardOptions);
  const summary = health.summarizeHealthReport(report);

  const panelRenderers = {
    'success-rate': () => renderSuccessRatePanel(records, report.skills, dashboardOptions),
    'failures': () => renderFailureClusterPanel(records, dashboardOptions),
    'amendments': () => renderAmendmentPanel(skillsById, dashboardOptions),
    'versions': () => renderVersionTimelinePanel(skillsById, dashboardOptions),
  };

  const selectedPanel = options.panel || null;
  if (selectedPanel && !VALID_PANELS.has(selectedPanel)) {
    throw new Error(`Unknown panel: ${selectedPanel}. Valid panels: ${Array.from(VALID_PANELS).join(', ')}`);
  }

  const panels = {};
  const textParts = [];

  const header = [
    'ECC Skill Health Dashboard',
    `Generated: ${now}`,
    `Skills: ${summary.total_skills} total, ${summary.measured_skills} measured, ${summary.healthy_skills} healthy, ${summary.declining_skills} declining, ${summary.unmeasured_skills} unmeasured`,
    '',
  ];

  textParts.push(header.join('\n'));

  if (summary.unmeasured_skills > 0) {
    // The window can empty out while runs are still retained, so "unmeasured"
    // must not be reported as "never recorded" (#2463). Three distinct states,
    // because "no recent runs" alone does not say which one applies.
    const recentRuns = health.filterRecordsWithinDays(records, nowMs, 30).length;
    const coverageNote = records.length === 0
      ? 'Nothing has ever been recorded, so the panels below are not a signal about skill health.'
      : recentRuns === 0
        ? `All ${records.length} retained run${records.length === 1 ? '' : 's'} are older than the 30-day window: coverage aged out rather than never existing. The panels below still show that history.`
        : `Coverage is partial: ${recentRuns} recent run${recentRuns === 1 ? '' : 's'} inside the window, ${records.length - recentRuns} older one${records.length - recentRuns === 1 ? '' : 's'} retained outside it. Only the measured skills can be judged.`;

    textParts.push([
      `WARNING: ${summary.unmeasured_skills} of ${summary.total_skills} skills have no recorded run in the last 30 days.`,
      'This dashboard can say nothing about them: no telemetry is an absence of evidence,',
      'not a healthy result. Their success rate reads "n/a", which means unknown.',
      coverageNote,
    ].join('\n'));
  }

  if (selectedPanel) {
    const result = panelRenderers[selectedPanel]();
    panels[selectedPanel] = result.data;
    textParts.push(result.text);
  } else {
    for (const [panelName, renderer] of Object.entries(panelRenderers)) {
      const result = renderer();
      panels[panelName] = result.data;
      textParts.push(result.text);
    }
  }

  const text = textParts.join('\n\n') + '\n';
  const data = {
    generated_at: now,
    summary,
    panels,
  };

  return { text, data };
}

module.exports = {
  VALID_PANELS,
  bucketByDay,
  horizontalBar,
  panelBox,
  renderAmendmentPanel,
  renderDashboard,
  renderFailureClusterPanel,
  renderSuccessRatePanel,
  renderVersionTimelinePanel,
  sparkline,
};
