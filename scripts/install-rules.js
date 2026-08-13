#!/usr/bin/env node
/**
 * Thin CLI for the /install-ecc-rules skill.
 *
 * Detects the current project's tech stack (informational only - see
 * scripts/lib/install-rules-selection.js for why) and installs ECC's
 * rules-core module through the canonical scripts/install-apply.js
 * --modules flow. This script never copies files itself.
 */

'use strict';

const readline = require('readline');

const {
  planRulesInstall,
  applyRulesInstall,
  runInstallRulesFlow
} = require('./lib/install-rules-selection');
const { getSourceRoot } = require('./lib/install-executor');

function parseArgs(argv) {
  const options = { target: 'claude-project', dryRun: false, json: false, yes: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--target requires a value (claude or claude-project)');
      }
      options.target = value;
      i += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--yes' || arg === '-y') {
      options.yes = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp(output) {
  output.write(`
Usage: install-rules.js [--target claude|claude-project] [--dry-run] [--json] [--yes]

Detects this project's tech stack (informational only) and installs ECC's
rules-core module (all rule directories) via the canonical
scripts/install-apply.js --modules flow.

Options:
  --target <t>  claude-project (default, installs into ./.claude - this project only) or
                claude (installs into ~/.claude - global, affects every project)
  --dry-run     Show the plan without installing
  --json        Emit machine-readable JSON
  --yes, -y     Skip the interactive confirmation prompt
  --help        Show this help text
`);
}

function printHuman(output, planResult) {
  const { detected, languages, skipped, plan } = planResult;

  output.write('\nDetected project stack (informational only):\n');
  if (detected.length === 0) {
    output.write('  (no match against config/project-stack-mappings.json)\n');
  } else {
    for (const stack of detected) output.write(`  - ${stack.name}\n`);
  }

  output.write(
    '\nNote: the rules-core module is installed as a whole; it is not filtered to\n' +
      'just this stack (see docs/SELECTIVE-INSTALL-ARCHITECTURE.md "Open Questions").\n' +
      `Rule languages relevant to this project: ${languages.length ? languages.join(', ') : '(none detected)'}\n`
  );
  if (skipped.length > 0) {
    output.write(`Detected languages not available in this ECC source: ${skipped.join(', ')}\n`);
  }

  if (plan) {
    output.write(`\nPlan: ${plan.operations.length} file operation(s) into ${plan.installRoot || plan.targetRoot}\n`);
    if (plan.warnings.length > 0) {
      output.write('\nWarnings:\n');
      for (const warning of plan.warnings) output.write(`  - ${warning}\n`);
    }
  }
}

async function askYesNo(output) {
  const rl = readline.createInterface({ input: process.stdin, output });
  const answer = await new Promise(resolve => rl.question('\nInstall ECC rules-core now? [y/N]: ', resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main(argv = process.argv.slice(2), injected = {}) {
  const output = injected.output || process.stdout;
  const errorOutput = injected.errorOutput || process.stderr;
  const interactive = injected.interactive !== undefined
    ? injected.interactive
    : Boolean(process.stdin.isTTY && output.isTTY);
  const sourceRoot = injected.sourceRoot || getSourceRoot();
  const projectRoot = injected.projectRoot || process.cwd();

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    errorOutput.write(`Error: ${error.message}\n`);
    printHelp(errorOutput);
    return 1;
  }

  if (options.help) {
    printHelp(output);
    return 0;
  }

  if (options.dryRun) {
    const planResult = planRulesInstall({ projectRoot, sourceRoot, target: options.target });
    if (planResult.error) {
      errorOutput.write(`Error: ${planResult.error}\n`);
      return 1;
    }
    if (options.json) output.write(`${JSON.stringify(planResult, null, 2)}\n`);
    else printHuman(output, planResult);
    return 0;
  }

  if (options.yes) {
    const flowResult = runInstallRulesFlow({
      projectRoot,
      sourceRoot,
      target: options.target,
      confirm: planResult => {
        if (!options.json) printHuman(output, planResult);
        return true;
      }
    });
    if (flowResult.status === 'plan-failed' || flowResult.status === 'apply-failed') {
      errorOutput.write(`Error: ${flowResult.error}\n`);
      return 1;
    }
    if (options.json) output.write(`${JSON.stringify(flowResult, null, 2)}\n`);
    else output.write(`\nDone. Installed rules-core (${flowResult.result.operations.length} file operation(s)).\n`);
    return 0;
  }

  const planResult = planRulesInstall({ projectRoot, sourceRoot, target: options.target });
  if (planResult.error) {
    errorOutput.write(`Error: ${planResult.error}\n`);
    return 1;
  }
  if (!options.json) printHuman(output, planResult);

  if (!interactive) {
    errorOutput.write('\nNot running in an interactive terminal. Re-run with --yes to install without a prompt.\n');
    return 1;
  }

  const approved = injected.confirm ? await injected.confirm(planResult) : await askYesNo(output);
  if (!approved) {
    if (options.json) output.write(`${JSON.stringify({ status: 'cancelled', ...planResult }, null, 2)}\n`);
    else output.write('\nCancelled. No files were installed.\n');
    return 0;
  }

  const applyResult = applyRulesInstall({ sourceRoot, projectRoot, target: options.target });
  if (applyResult.error) {
    errorOutput.write(`Error: ${applyResult.error}\n`);
    return 1;
  }
  if (options.json) {
    output.write(`${JSON.stringify({ status: 'applied', ...planResult, result: applyResult.result }, null, 2)}\n`);
  } else {
    output.write(`\nDone. Installed rules-core (${applyResult.result.operations.length} file operation(s)).\n`);
  }
  return 0;
}

if (require.main === module) {
  main()
    .then(code => {
      process.exitCode = code;
    })
    .catch(error => {
      process.stderr.write(`Error: ${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { main, parseArgs };
