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
    '  node scripts/session-inspect.js claude:a1b2c3d4 --write /tmp/session.json',
    '  Prefix new leading-dash filenames with ./ (for example ./--snapshot.json).'
  ].join('\n'));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let parsed = {
    target: null,
    adapterId: null,
    targetType: null,
    writePath: null,
    listAdapters: false,
    skillId: null,
    amendmentId: null,
    observationsPath: null
  };
  const valueOptions = new Map([
    ['--adapter', 'adapterId'],
    ['--target-type', 'targetType'],
    ['--skill', 'skillId'],
    ['--amendment-id', 'amendmentId'],
    ['--observations', 'observationsPath'],
    ['--write', 'writePath']
  ]);
  const knownOptions = new Set([...valueOptions.keys(), '--list-adapters']);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (valueOptions.has(arg)) {
      const value = args[index + 1];
      const existingPath = ['--write', '--observations'].includes(arg)
        && value && fs.existsSync(value);
      if (!value || knownOptions.has(value) || (value.startsWith('--') && !existingPath)) {
        throw new Error(`Missing value for ${arg}`);
      }
      parsed = { ...parsed, [valueOptions.get(arg)]: value };
      index += 1;
    } else if (arg === '--list-adapters') {
      parsed = { ...parsed, listAdapters: true };
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    } else if (parsed.target !== null) {
      throw new Error('Only one target may be provided');
    } else {
      parsed = { ...parsed, target: arg };
    }
  }

  return parsed;
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
