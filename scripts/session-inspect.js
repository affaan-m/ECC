#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { createAdapterRegistry, inspectSessionTarget } = require('./lib/session-adapters/registry');
const { readSkillObservations } = require('./lib/skill-improvement/observations');
const { buildSkillHealthReport } = require('./lib/skill-improvement/health');
const { proposeSkillAmendment } = require('./lib/skill-improvement/amendify');
const { buildSkillEvaluationScaffold } = require('./lib/skill-improvement/evaluate');

function usage() {
  console.log([
    'Usage:',
    '  node scripts/session-inspect.js <target> [--adapter <id>] [--target-type <type>] [--write <output.json>]',
    '  node scripts/session-inspect.js --list-adapters',
    '',
    'Targets:',
    '  <plan.json>          Dmux/orchestration plan file',
    '  <session-name>       Dmux session name when the coordination directory exists',
    '  claude:latest        Most recent Claude session history entry',
    '  claude:<id|alias>    Specific Claude session or alias',
    '  <session.tmp>        Direct path to a Claude session file',
    '  skills:health        Inspect skill failure/success patterns from observations',
    '  skills:amendify      Propose a SKILL.md patch from failure evidence',
    '  skills:evaluate      Compare baseline vs amended skill outcomes',
    '',
    'Examples:',
    '  node scripts/session-inspect.js .claude/plan/workflow.json',
    '  node scripts/session-inspect.js workflow-visual-proof',
    '  node scripts/session-inspect.js claude:latest',
    '  node scripts/session-inspect.js latest --target-type claude-history',
    '  node scripts/session-inspect.js skills:health',
    '  node scripts/session-inspect.js skills:amendify --skill api-design',
    '  node scripts/session-inspect.js claude:a1b2c3d4 --write /tmp/session.json'
  ].join('\n'));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const valueOptions = ['--adapter', '--target-type', '--skill', '--amendment-id', '--observations', '--write'];
  for (const [index, argument] of args.entries()) {
    if (valueOptions.includes(argument) && (!args[index + 1] || args[index + 1].startsWith('--'))) {
      throw new Error(`Missing value for ${argument}`);
    }
  }
  const target = args.find((argument, index) => !argument.startsWith('--') && !valueOptions.includes(args[index - 1]));
  const listAdapters = args.includes('--list-adapters');

  const adapterIndex = args.indexOf('--adapter');
  const adapterId = adapterIndex >= 0 ? args[adapterIndex + 1] : null;

  const targetTypeIndex = args.indexOf('--target-type');
  const targetType = targetTypeIndex >= 0 ? args[targetTypeIndex + 1] : null;

  const skillIndex = args.indexOf('--skill');
  const skillId = skillIndex >= 0 ? args[skillIndex + 1] : null;

  const amendmentIndex = args.indexOf('--amendment-id');
  const amendmentId = amendmentIndex >= 0 ? args[amendmentIndex + 1] : null;

  const observationsIndex = args.indexOf('--observations');
  const observationsPath = observationsIndex >= 0 ? args[observationsIndex + 1] : null;

  const writeIndex = args.indexOf('--write');
  const writePath = writeIndex >= 0 ? args[writeIndex + 1] : null;

  return { target, adapterId, targetType, writePath, listAdapters, skillId, amendmentId, observationsPath };
}

function inspectSkillLoopTarget(target, options = {}) {
  const observations = readSkillObservations({
    cwd: options.cwd,
    projectRoot: options.cwd,
    observationsPath: options.observationsPath
  });

  if (target === 'skills:health') {
    return buildSkillHealthReport(observations, {
      skillId: options.skillId || null
    });
  }

  if (target === 'skills:amendify') {
    if (!options.skillId) {
      throw new Error('skills:amendify requires --skill <id>');
    }

    return proposeSkillAmendment(options.skillId, observations);
  }

  if (target === 'skills:evaluate') {
    if (!options.skillId) {
      throw new Error('skills:evaluate requires --skill <id>');
    }

    return buildSkillEvaluationScaffold(options.skillId, observations, {
      amendmentId: options.amendmentId || null
    });
  }

  return null;
}

function main() {
  const { target, adapterId, targetType, writePath, listAdapters, skillId, amendmentId, observationsPath } = parseArgs(process.argv);

  if (listAdapters) {
    const registry = createAdapterRegistry();
    console.log(JSON.stringify({ adapters: registry.listAdapters() }, null, 2));
    return;
  }

  if (!target) {
    usage();
    process.exit(1);
  }

  const skillLoopPayload = inspectSkillLoopTarget(target, {
    cwd: process.cwd(),
    skillId,
    amendmentId,
    observationsPath
  });
  const payloadObject = skillLoopPayload || inspectSessionTarget(
    targetType ? { type: targetType, value: target } : target,
    {
      cwd: process.cwd(),
      adapterId
    }
  );
  const payload = JSON.stringify(payloadObject, null, 2);

  if (writePath) {
    const absoluteWritePath = path.resolve(writePath);
    fs.mkdirSync(path.dirname(absoluteWritePath), { recursive: true });
    fs.writeFileSync(absoluteWritePath, payload + '\n', 'utf8');
  }

  console.log(payload);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[session-inspect] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  main,
  parseArgs
};
