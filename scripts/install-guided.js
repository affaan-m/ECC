#!/usr/bin/env node
'use strict';

const readline = require('readline/promises');

const {
  getHarnessCapability,
  listGuidedHarnesses,
  normalizeHarnessSelection,
} = require('./lib/harness-capabilities');
const {
  VALID_CLAUDE_HOOKS,
  VALID_CLAUDE_SCOPES,
  VALID_PROFILES,
  applyMultiHarnessPlan,
  createMultiHarnessPlan,
  normalizeGuidedInstallRequest,
} = require('./lib/multi-harness-setup');
const { startTerminalSpinner } = require('./lib/terminal-spinner');
const { showTerminalWelcome } = require('./lib/terminal-welcome');
const { stripAnsi } = require('./lib/utils');

const ADVANCED_HARNESSES = 'Cursor, Antigravity, Gemini CLI, OpenCode, CodeBuddy, JoyCode, Qwen Code, Zed, Hermes, and OpenClaw';

function showHelp(output = process.stdout) {
  output.write(`
ECC guided multi-harness install

Usage:
  ecc install --guided
  ecc install --guided --harness claude --harness codex --harness kimi [options]

Guided harnesses:
  claude  Native Claude Code plugin; choose user, project, or local scope and an ECC hook profile.
  codex   Native Codex plugin and Codex-owned hook review/trust.
  kimi    Managed project install under ./.kimi-code; ECC hooks are not configured.

Options:
  --harness <id[,id...]>  Repeatable; accepts Claude, Codex, Kimi, or all
  --all-harnesses         Select all three guided harnesses
  --claude-scope <user|project|local>
  --claude-hooks <off|minimal|standard|strict>
  --profile <minimal|core|developer|security|research|full>
                          Kimi managed-project content profile
  --yes, -y               Apply without confirmation
  --dry-run               Preflight and preview without changing files
  --json                  Emit machine-readable output
  --help, -h              Show this help

Advanced managed adapters remain available through explicit ecc install --target commands:
  ${ADVANCED_HARNESSES}

This command configures ECC. It does not install or authenticate provider CLIs.
`);
}

function parseArgs(argv) {
  let options = {
    allHarnesses: false,
    claudeHooks: undefined,
    claudeScope: undefined,
    dryRun: false,
    harnesses: [],
    help: false,
    json: false,
    profile: undefined,
    yes: false,
  };
  const valueFlags = new Map([
    ['--harness', 'harnesses'],
    ['--claude-scope', 'claudeScope'],
    ['--claude-hooks', 'claudeHooks'],
    ['--profile', 'profile'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (valueFlags.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}`);
      }
      if (value.length > 256) {
        throw new Error(`Value for ${argument} is too long.`);
      }
      const key = valueFlags.get(argument);
      options = key === 'harnesses'
        ? { ...options, harnesses: [...options.harnesses, value] }
        : { ...options, [key]: value };
      index += 1;
    } else if (argument === '--all-harnesses') {
      options = { ...options, allHarnesses: true };
    } else if (argument === '--yes' || argument === '-y') {
      options = { ...options, yes: true };
    } else if (argument === '--dry-run') {
      options = { ...options, dryRun: true };
    } else if (argument === '--json') {
      options = { ...options, json: true };
    } else if (argument === '--help' || argument === '-h') {
      options = { ...options, help: true };
    } else {
      throw new Error('Unknown argument. Run guided install with --help to see valid options.');
    }
  }
  if (options.allHarnesses && options.harnesses.length > 0) {
    throw new Error('--all-harnesses and --harness are mutually exclusive.');
  }
  return options;
}

function choicesText(values) {
  return values.join('|');
}

/** True when the shell locale already renders UTF-8, so no prompt is needed. */
function shellLocaleIsUtf8(env = process.env) {
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  return /utf-?8/i.test(locale);
}

async function askChoice(terminal, output, prompt, values, defaultValue) {
  output.write(`\n${prompt}\n`);
  values.forEach((value, index) => output.write(`  ${index + 1}. ${value}\n`));
  while (true) {
    const question = defaultValue
      ? `Choose [Recommended: ${defaultValue}] (one option only): `
      : 'Choose one option: ';
    const answer = (await terminal.question(question)).trim().toLowerCase();
    if (!answer && defaultValue) return defaultValue;
    const numeric = /^\d+$/.test(answer) ? values[Number(answer) - 1] : undefined;
    const selected = numeric || values.find(value => value === answer);
    if (selected) return selected;
    output.write(`Please choose ${choicesText(values)}.\n`);
  }
}

async function askHarnesses(terminal, output) {
  const guided = listGuidedHarnesses();
  output.write('\nWhich coding agents should ECC configure?\n');
  guided.forEach((harness, index) => {
    output.write(`  ${index + 1}. ${harness.label} — ${harness.destination}\n`);
  });
  output.write('  all. All three guided harnesses\n');
  output.write(`\nAdvanced adapters (use ecc install --target): ${ADVANCED_HARNESSES}.\n\n`);
  while (true) {
    const answer = await terminal.question('Choose one or more (for example 1,3 or all): ');
    if (answer.length > 1024) {
      output.write('Please choose Claude, Codex, Kimi, or all.\n');
      continue;
    }
    try {
      return normalizeHarnessSelection(answer);
    } catch (_error) {
      output.write('Please choose Claude, Codex, Kimi, or all.\n');
    }
  }
}

async function collectInteractiveOptions(options, dependencies = {}) {
  const terminal = dependencies.terminal;
  const output = dependencies.output || process.stdout;
  let harnesses = options.allHarnesses ? ['all'] : options.harnesses;
  if (harnesses.length === 0) harnesses = await askHarnesses(terminal, output);
  const normalizedHarnesses = normalizeHarnessSelection(harnesses);
  const includesClaude = normalizedHarnesses.includes('claude');
  const includesKimi = normalizedHarnesses.includes('kimi');
  const claudeScope = includesClaude && !options.claudeScope
    ? await askChoice(terminal, output, 'Where should Claude enable ecc@ecc?', [...VALID_CLAUDE_SCOPES], 'user')
    : options.claudeScope;
  const claudeHooks = includesClaude && !options.claudeHooks
    ? await askChoice(terminal, output, 'How should ECC hooks run in Claude?', [...VALID_CLAUDE_HOOKS], 'standard')
    : options.claudeHooks;
  const profile = includesKimi && !options.profile
    ? await askChoice(terminal, output, 'Which ECC content profile should Kimi receive?', [...VALID_PROFILES], 'core')
    : options.profile;
  const includesCodex = normalizedHarnesses.includes('codex');
  const codexUtf8 = includesCodex && options.codexUtf8 === undefined && !shellLocaleIsUtf8()
    ? await askChoice(
      terminal,
      output,
      'Your shell locale is not UTF-8, so the Codex usage bar cannot draw its\n'
        + 'block characters. Set a UTF-8 locale in your shell config?',
      ['yes', 'no'],
      'yes'
    ) === 'yes'
    : options.codexUtf8;
  return {
    ...options,
    harnesses: normalizedHarnesses,
    claudeScope,
    claudeHooks,
    codexUtf8,
    profile,
  };
}

function selectedHarnessIds(options) {
  if (options.allHarnesses) return normalizeHarnessSelection(['all']);
  if (options.harnesses.length === 0) return [];
  return normalizeHarnessSelection(options.harnesses);
}

function validateExecutionMode(options, interactive) {
  const harnesses = selectedHarnessIds(options);
  if (!interactive && harnesses.length === 0) {
    throw new Error('Non-interactive guided install requires at least one --harness.');
  }
  const requiresExplicit = !interactive || options.json;
  if (requiresExplicit && harnesses.includes('claude') && (!options.claudeScope || !options.claudeHooks)) {
    throw new Error('Claude requires explicit --claude-scope and --claude-hooks choices in this mode.');
  }
  if (requiresExplicit && harnesses.includes('kimi') && !options.profile) {
    throw new Error('Kimi requires an explicit --profile choice in this mode.');
  }
  if ((!interactive || options.json) && !options.yes && !options.dryRun) {
    throw new Error('Non-interactive and JSON mutations require --yes.');
  }
}

function printPlan(plan, output) {
  output.write('\nECC guided install preview\n\n');
  output.write('Harness       Channel           Destination\n');
  for (const entry of plan.harnesses) {
    const harness = getHarnessCapability(entry.id);
    output.write(`${harness.label.padEnd(13)} ${entry.channel.padEnd(17)} ${harness.destination}\n`);
  }
  if (plan.request.harnesses.includes('kimi')) {
    output.write('\nKimi note: ECC hooks are not configured; model, provider, and authentication settings are unchanged.\n');
  }
}

async function confirmPlan(terminal, output) {
  output.write('\n');
  const answer = await terminal.question('Apply ECC to these harnesses? [y/N]: ');
  return /^y(es)?$/i.test(answer.trim());
}

function sanitizeTerminalText(value) {
  return stripAnsi(String(value || '')).replace(/[^\x20-\x7E]/g, '?');
}

function buildRetryArguments(plan, retryHarnesses) {
  const harnesses = [...retryHarnesses];
  const harnessArguments = harnesses.flatMap(id => ['--harness', id]);
  const claudeArguments = harnesses.includes('claude')
    ? ['--claude-scope', plan.request.claudeScope, '--claude-hooks', plan.request.claudeHooks]
    : [];
  const kimiArguments = harnesses.includes('kimi')
    ? ['--profile', plan.request.profile]
    : [];
  return [...harnessArguments, ...claudeArguments, ...kimiArguments].join(' ');
}

async function main(argv = process.argv.slice(2), injected = {}) {
  const output = injected.output || process.stdout;
  const errorOutput = injected.errorOutput || process.stderr;
  const interactive = injected.interactive !== undefined
    ? injected.interactive
    : Boolean(process.stdin.isTTY && output.isTTY);
  const createPlan = injected.createPlan || createMultiHarnessPlan;
  const applyPlan = injected.applyPlan || applyMultiHarnessPlan;
  const renderWelcome = injected.showWelcome || showTerminalWelcome;
  const makeSpinner = injected.startSpinner || startTerminalSpinner;
  let terminal = injected.terminal;
  let ownsTerminal = false;

  try {
    let options = parseArgs(argv);
    if (options.help) {
      showHelp(output);
      return 0;
    }
    validateExecutionMode(options, interactive);
    const needsChoices = selectedHarnessIds(options).length === 0
      || (selectedHarnessIds(options).includes('claude') && (!options.claudeScope || !options.claudeHooks))
      || (selectedHarnessIds(options).includes('kimi') && !options.profile);
    if (interactive && needsChoices) {
      if (!terminal) {
        terminal = readline.createInterface({ input: process.stdin, output });
        ownsTerminal = true;
      }
      options = await collectInteractiveOptions(options, { output, terminal });
    }
    const request = normalizeGuidedInstallRequest({
      ...options,
      harnesses: options.allHarnesses ? ['all'] : options.harnesses,
    });
    const plan = await createPlan(request);

    if (options.json && options.dryRun) {
      output.write(`${JSON.stringify({ dryRun: true, plan }, null, 2)}\n`);
      return 0;
    }
    if (!options.json) printPlan(plan, output);
    if (options.dryRun) {
      output.write('\nDry run complete. No changes were made.\n');
      return 0;
    }
    if (!options.yes) {
      if (!terminal) {
        terminal = readline.createInterface({ input: process.stdin, output });
        ownsTerminal = true;
      }
      if (!await confirmPlan(terminal, output)) {
        output.write('\nECC install cancelled. No changes were made.\n');
        return 0;
      }
    }

    const spinner = interactive && !options.json
      ? makeSpinner('Applying ECC to selected harnesses...')
      : undefined;
    let result;
    try {
      result = await applyPlan(plan);
    } finally {
      spinner?.stop();
    }
    if (options.json) {
      output.write(`${JSON.stringify({ dryRun: false, result }, null, 2)}\n`);
    } else if (result.status === 'complete') {
      output.write(`\nECC configured for ${result.completed.map(item => getHarnessCapability(item.id).label).join(', ')}.\n`);
      renderWelcome({ action: 'installed', interactive, json: false, output });
    } else {
      const retry = buildRetryArguments(plan, result.retryHarnesses);
      errorOutput.write(
        `ECC stopped at ${sanitizeTerminalText(result.failure.id)}: `
        + `${sanitizeTerminalText(result.failure.message)}\n`
        + `Retry with: ecc-universal install --guided ${retry}\n`
      );
    }
    return result.status === 'complete' ? 0 : 1;
  } catch (error) {
    const payload = { error: { code: 'GUIDED_INSTALL_FAILED', message: error.message } };
    if (argv.includes('--json')) errorOutput.write(`${JSON.stringify(payload, null, 2)}\n`);
    else errorOutput.write(`Error: ${sanitizeTerminalText(error.message)}\n`);
    return 1;
  } finally {
    if (ownsTerminal) terminal?.close();
  }
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  });
}

module.exports = {
  collectInteractiveOptions,
  main,
  parseArgs,
  printPlan,
  showHelp,
  validateExecutionMode,
};
