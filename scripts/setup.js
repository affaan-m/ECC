#!/usr/bin/env node
'use strict';

const readline = require('readline/promises');

const {
  ClaudeSetupError,
  VALID_HOOK_MODES,
  VALID_SCOPES,
  setupClaudePlugin,
} = require('./lib/claude-plugin-setup');

const MODE = 'claude-plugin';

function showHelp() {
  process.stdout.write(`
ECC guided setup

Usage:
  ecc setup
  ecc setup --mode claude-plugin --scope user|project|local [options]

Install scopes:
  user      Global for this user; ECC is available in every project.
  project   Shared project configuration; the repository can enable ECC for collaborators.
  local     Private project configuration; ECC is enabled here without committing the choice.

Hook preferences:
  --hooks off|minimal|standard|strict
             Save a personal hook preference in Claude user settings.

Options:
  --mode claude-plugin
  --scope <scope>
  --hooks <preference>
  --yes, -y               Skip the confirmation prompt.
  --dry-run               Inspect and report without changing anything.
  --json                  Emit machine-readable JSON.
  --help, -h              Show this help.

Re-running setup updates an existing ecc@ecc installation at its detected scope.
Changing scope requires the separate scope-migration operation.
`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    help: false,
    hooks: undefined,
    json: false,
    mode: undefined,
    scope: undefined,
    yes: false,
  };
  const valueFlags = new Map([
    ['--mode', 'mode'],
    ['--scope', 'scope'],
    ['--hooks', 'hooks'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (valueFlags.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}`);
      }
      options[valueFlags.get(argument)] = value;
      index += 1;
    } else if (argument === '--yes' || argument === '-y') {
      options.yes = true;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.mode !== undefined && options.mode !== MODE) {
    throw new Error(`Invalid setup mode: ${options.mode}. This command currently supports ${MODE}.`);
  }
  if (options.scope !== undefined && !VALID_SCOPES.has(options.scope)) {
    throw new Error(`Invalid --scope value: ${options.scope}`);
  }
  if (options.hooks !== undefined && !VALID_HOOK_MODES.has(options.hooks)) {
    throw new Error(`Invalid --hooks value: ${options.hooks}`);
  }
  return options;
}

async function askChoice(terminal, prompt, choices, defaultIndex) {
  process.stdout.write(`\n${prompt}\n`);
  choices.forEach((choice, index) => {
    process.stdout.write(`  ${index + 1}. ${choice.label} — ${choice.description}\n`);
  });
  const answer = await terminal.question(`Choose [${defaultIndex + 1}]: `);
  const index = Number.parseInt(answer.trim() || String(defaultIndex + 1), 10) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= choices.length) {
    throw new Error('Invalid setup choice');
  }
  return choices[index].value;
}

async function collectInteractiveOptions(options) {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const scope = options.scope || await askChoice(
      terminal,
      'Where should Claude enable ecc@ecc?',
      [
        {
          value: 'user',
          label: 'Global user',
          description: 'Available in every project for this user.',
        },
        {
          value: 'project',
          label: 'Shared project',
          description: 'Stored in repository settings for collaborators.',
        },
        {
          value: 'local',
          label: 'Private project',
          description: 'Enabled only here without committing the choice.',
        },
      ],
      0
    );
    const hooks = options.hooks || await askChoice(
      terminal,
      'How should ECC hooks run?',
      [
        {
          value: 'off',
          label: 'Off',
          description: 'Keep skills and commands without local hook automation.',
        },
        {
          value: 'minimal',
          label: 'Minimal',
          description: 'Run only the lightest lifecycle and safety automation.',
        },
        {
          value: 'standard',
          label: 'Standard',
          description: 'Balanced quality and safety automation.',
        },
        {
          value: 'strict',
          label: 'Strict',
          description: 'Use the strongest checks and reminders.',
        },
      ],
      2
    );
    return {
      ...options,
      hooks,
      mode: MODE,
      scope,
    };
  } finally {
    terminal.close();
  }
}

async function confirm(options) {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await terminal.question(
      `Apply ${MODE} setup at ${options.scope || 'the detected'} scope`
      + ` with hooks=${options.hooks || 'standard'}? [y/N] `
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    terminal.close();
  }
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`\nECC ${result.action} ${result.pluginId} at ${result.scope} scope.\n`);
  process.stdout.write(`Hook preference: ${result.hooks}\n`);
  if (result.restartRequired) {
    process.stdout.write('Restart Claude Code or run /reload-plugins to load the updated plugin.\n');
  }
}

function printError(error, json) {
  if (json) {
    const payload = error instanceof ClaudeSetupError
      ? error.toJSON()
      : {
        error: {
          code: 'SETUP_FAILED',
          message: error.message,
          phase: 'cli',
          observedScopes: [],
          recovery: [],
        },
      };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stderr.write(`Error: ${error.message}\n`);
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      showHelp();
      return;
    }

    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    if (!options.mode) {
      if (!interactive) {
        throw new Error(
          'Interactive setup requires a terminal. Pass --mode claude-plugin and the required flags.'
        );
      }
      options = await collectInteractiveOptions(options);
    }

    if (!options.yes && !options.dryRun) {
      if (!interactive) {
        throw new Error('Non-interactive setup requires --yes.');
      }
      if (!await confirm(options)) {
        printResult({
          action: 'cancelled',
          hooks: options.hooks || 'standard',
          pluginId: 'ecc@ecc',
          scope: options.scope || 'detected',
        }, options.json);
        return;
      }
    }

    const result = setupClaudePlugin({
      dryRun: options.dryRun,
      hooks: options.hooks,
      scope: options.scope,
    });
    printResult(result, options.json);
  } catch (error) {
    printError(error, options?.json);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  collectInteractiveOptions,
  main,
  parseArgs,
  printError,
  printResult,
  showHelp,
};
