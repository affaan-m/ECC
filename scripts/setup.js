#!/usr/bin/env node
'use strict';

const path = require('path');
const readline = require('readline/promises');

const {
  ClaudeSetupError,
  VALID_HOOK_MODES,
  VALID_SCOPES,
  deriveHookMode,
  readSettings,
  setupClaudePlugin,
} = require('./lib/claude-plugin-setup');
const {
  migrateClaudePluginScope,
} = require('./lib/claude-scope-migration');
const { resolveClaudePaths } = require('./lib/install/inventory');
const { startTerminalSpinner } = require('./lib/terminal-spinner');
const { showTerminalWelcome } = require('./lib/terminal-welcome');

const MODE = 'claude-plugin';
const AUTO_MIGRATION_CODES = new Set([
  'MULTIPLE_PLUGIN_SCOPES',
  'SCOPE_MOVE_REQUIRED',
]);

function showHelp() {
  process.stdout.write(`
ECC guided setup

Usage:
  ecc setup
  ecc setup --mode claude-plugin --scope user|project|local [options]
  ecc setup --mode claude-plugin --scope project --move-scope [options]

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
  --move-scope            Explicitly request migration (normally auto-detected).
  --yes, -y               Skip the confirmation prompt.
  --dry-run               Inspect and report without changing anything.
  --json                  Emit machine-readable JSON.
  --help, -h              Show this help.

Re-running setup updates an existing ecc@ecc installation at its detected scope.
Choosing another scope automatically migrates the existing installation.
Migration installs and verifies the destination before removing the source scope.
`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    help: false,
    hooks: undefined,
    json: false,
    mode: undefined,
    moveScope: false,
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
    } else if (argument === '--move-scope') {
      options.moveScope = true;
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
  if (options.moveScope && options.scope === undefined) {
    throw new Error('--move-scope requires an explicit --scope destination.');
  }
  return options;
}

async function askChoice(terminal, prompt, choices, defaultIndex) {
  process.stdout.write(`\n${prompt}\n`);
  choices.forEach((choice, index) => {
    process.stdout.write(`  ${index + 1}. ${choice.label} — ${choice.description}\n`);
  });
  const choiceNumbers = choices.map((_, index) => String(index + 1));
  const validChoices = choiceNumbers.length === 1
    ? choiceNumbers[0]
    : `${choiceNumbers.slice(0, -1).join(', ')}, or ${choiceNumbers.at(-1)}`;

  while (true) {
    const hasDefault = Number.isInteger(defaultIndex);
    const answer = await terminal.question(
      hasDefault ? `Choose [${defaultIndex + 1}]: ` : 'Choose: '
    );
    const normalized = answer.trim().toLowerCase();
    if (normalized === '' && hasDefault) return choices[defaultIndex].value;

    const namedChoice = choices.find(choice => choice.value === normalized);
    if (namedChoice) return namedChoice.value;

    if (/^\d+$/.test(normalized)) {
      const index = Number(normalized) - 1;
      if (index >= 0 && index < choices.length) return choices[index].value;
    }
    process.stdout.write(`Please choose ${validChoices}.\n`);
  }
}

function resolveInteractiveDefaults() {
  try {
    const result = setupClaudePlugin({ dryRun: true });
    return {
      hooks: result.hooks,
      installed: result.action === 'would-update',
      scope: result.scope,
    };
  } catch (error) {
    if (!(error instanceof ClaudeSetupError)) throw error;
    if (error.code === 'SCOPE_REQUIRED') {
      return {
        hooks: 'standard',
        installed: false,
        scope: 'user',
      };
    }
    if (error.code === 'MULTIPLE_PLUGIN_SCOPES') {
      const paths = resolveClaudePaths();
      return {
        hooks: deriveHookMode(readSettings(path.join(paths.configDir, 'settings.json'))),
        installed: true,
        multipleScopes: true,
        scope: undefined,
      };
    }
    throw error;
  }
}

async function collectInteractiveOptions(options, defaults = {}, providedTerminal) {
  const terminal = providedTerminal || readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ownsTerminal = !providedTerminal;
  try {
    const scopeChoices = [
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
    ];
    const detectedScopeDefault = scopeChoices.findIndex(
      choice => choice.value === defaults.scope
    );
    const scopeDefaultIndex = detectedScopeDefault === -1
      ? undefined
      : detectedScopeDefault;
    const scope = options.scope || await askChoice(
      terminal,
      'Where should Claude enable ecc@ecc?',
      scopeChoices,
      scopeDefaultIndex
    );
    const hookChoices = [
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
    ];
    const detectedHookDefault = hookChoices.findIndex(
      choice => choice.value === defaults.hooks
    );
    const hookDefaultIndex = detectedHookDefault === -1 ? 2 : detectedHookDefault;
    const hooks = options.hooks || await askChoice(
      terminal,
      'How should ECC hooks run?',
      hookChoices,
      hookDefaultIndex
    );
    return {
      ...options,
      hooks,
      mode: MODE,
      scope,
    };
  } finally {
    if (ownsTerminal) terminal.close();
  }
}

async function confirm(options, providedTerminal) {
  const terminal = providedTerminal || readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ownsTerminal = !providedTerminal;
  try {
    const operation = options.moveScope
      ? 'Migrate'
      : (options.confirmationAction || 'Apply');
    const scopeLabel = options.scope || 'the detected';
    const answer = await terminal.question(
      `${operation} ${MODE} setup at ${scopeLabel} scope`
      + ` with hooks=${options.hooks || 'standard'}? [y/N] `
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    if (ownsTerminal) terminal.close();
  }
}

function printResult(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`\nECC ${result.action} ${result.pluginId} at ${result.scope} scope.\n`);
  if (result.sourceScope) {
    process.stdout.write(`Previous scope: ${result.sourceScope}\n`);
  }
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

function isInteractiveCancellation(error) {
  return Boolean(error && (
    error.code === 'ABORT_ERR'
    || /aborted with ctrl\+d|readline was closed/i.test(error.message || '')
  ));
}

function needsInteractiveChoices(options) {
  return (
    options.mode === undefined
    || options.scope === undefined
    || options.hooks === undefined
  );
}

function validateInteractiveJsonOptions(options, interactive) {
  if (!interactive || !options.json) return;
  if (needsInteractiveChoices(options)) {
    throw new Error(
      'Interactive --json requires explicit --mode, --scope, and --hooks values.'
    );
  }
  if (!options.yes && !options.dryRun) {
    throw new Error('Interactive --json mutations require --yes.');
  }
}

function reconcileClaudePlugin(options) {
  const setupOptions = {
    dryRun: options.dryRun,
    hooks: options.hooks,
    scope: options.scope,
  };
  if (options.moveScope) {
    return migrateClaudePluginScope(setupOptions);
  }

  try {
    return setupClaudePlugin(setupOptions);
  } catch (error) {
    const canAutoMigrate = (
      error instanceof ClaudeSetupError
      && AUTO_MIGRATION_CODES.has(error.code)
      && options.scope !== undefined
    );
    if (!canAutoMigrate) throw error;
    return migrateClaudePluginScope(setupOptions);
  }
}

function applyClaudePlugin(options, interactive) {
  const spinner = interactive && !options.dryRun && !options.json
    ? startTerminalSpinner('Applying ECC setup...')
    : undefined;
  try {
    return reconcileClaudePlugin(options);
  } finally {
    spinner?.stop();
  }
}

async function main(argv = process.argv.slice(2)) {
  let options;
  let terminal;
  try {
    options = parseArgs(argv);
    if (options.help) {
      showHelp();
      return;
    }

    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    validateInteractiveJsonOptions(options, interactive);
    const shouldCollectInteractiveChoices = needsInteractiveChoices(options);
    const needsConfirmation = !options.yes && !options.dryRun;
    const interactiveDefaults = interactive
      && (shouldCollectInteractiveChoices || needsConfirmation)
      ? resolveInteractiveDefaults()
      : undefined;
    if (interactive && shouldCollectInteractiveChoices) {
      terminal = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      options = await collectInteractiveOptions(
        options,
        interactiveDefaults,
        terminal
      );
    } else if (!options.mode) {
      if (!interactive) {
        throw new Error(
          'Interactive setup requires a terminal. Pass --mode claude-plugin and the required flags.'
        );
      }
    }

    if (interactiveDefaults) {
      const confirmationAction = interactiveDefaults.multipleScopes
        ? 'Resume migration'
        : (
          interactiveDefaults.installed && interactiveDefaults.scope !== options.scope
            ? 'Migrate'
            : 'Apply'
        );
      options = {
        ...options,
        confirmationAction,
      };
    }

    if (needsConfirmation) {
      if (!interactive) {
        throw new Error('Non-interactive setup requires --yes.');
      }
      if (!terminal) {
        terminal = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
      }
      if (!await confirm(options, terminal)) {
        printResult({
          action: 'cancelled',
          hooks: options.hooks || 'standard',
          pluginId: 'ecc@ecc',
          scope: options.scope || 'detected',
        }, options.json);
        return;
      }
    }

    const result = applyClaudePlugin(options, interactive);
    printResult(result, options.json);
    showTerminalWelcome({
      action: result.action,
      dryRun: options.dryRun,
      interactive,
      json: options.json,
    });
  } catch (error) {
    if (isInteractiveCancellation(error)) {
      process.stdout.write('\nECC setup cancelled. No changes were made.\n');
      return;
    }
    printError(error, options?.json);
    process.exitCode = 1;
  } finally {
    terminal?.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  collectInteractiveOptions,
  applyClaudePlugin,
  main,
  parseArgs,
  printError,
  printResult,
  reconcileClaudePlugin,
  resolveInteractiveDefaults,
  isInteractiveCancellation,
  validateInteractiveJsonOptions,
  showHelp,
};
