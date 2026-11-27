'use strict';

const { buildSkillHealthReport } = require('./health');

const AMENDMENT_SCHEMA_VERSION = 'ecc.skill-amendment-proposal.v1';

function createProposalId(skillId) {
  return `amend-${skillId}-${Date.now()}`;
}

function summarizePatchPreview(skillId, health) {
  const lines = [
    '## Failure-Driven Amendments',
    '',
    `- Focus skill routing for \`${skillId}\` when tasks match the proven success cases.`,
  ];

  if (health.recurringErrors[0]) {
    lines.push(`- Add explicit guardrails for recurring failure: ${health.recurringErrors[0].error}.`);
  }

  if (health.recurringTasks[0]) {
    lines.push(`- Add an example workflow for task pattern: ${health.recurringTasks[0].task}.`);
  }

  if (health.recurringFeedback[0]) {
    lines.push(`- Address repeated user feedback: ${health.recurringFeedback[0].feedback}.`);
  }

  lines.push('- Add a verification checklist before declaring the skill output complete.');
  return lines.join('\n');
}

function proposeSkillAmendment(skillId, records, options = {}) {
  const report = buildSkillHealthReport(records, {
    ...options,
    skillId,
    minFailureCount: options.minFailureCount || 1
  });
  const [health] = report.skills;

  if (!health || health.failures === 0) {
    return {
      schemaVersion: AMENDMENT_SCHEMA_VERSION,
      skill: {
        id: skillId,
        path: null
      },
      status: 'insufficient-evidence',
      rationale: ['No failed observations were available for this skill.'],
      patch: null
    };
  }

  const preview = summarizePatchPreview(skillId, health);

  return {
    schemaVersion: AMENDMENT_SCHEMA_VERSION,
    proposalId: createProposalId(skillId),
    generatedAt: new Date().toISOString(),
    status: 'proposed',
    skill: {
      id: skillId,
      path: health.skill.path || null
    },
    evidence: {
      totalRuns: health.totalRuns,
      failures: health.failures,
      successRate: health.successRate,
      recurringErrors: health.recurringErrors,
      recurringTasks: health.recurringTasks,
      recurringFeedback: health.recurringFeedback
    },
    rationale: [
      'Proposals are generated from repeated failed runs rather than a single anecdotal error.',
      'The suggested patch is additive so the original SKILL.md intent remains auditable.'
    ],
    patch: {
      format: 'markdown-fragment',
      targetPath: health.skill.path || `skills/${skillId}/SKILL.md`,
      preview
    }
  };
}

module.exports = {
  AMENDMENT_SCHEMA_VERSION,
  proposeSkillAmendment
};
