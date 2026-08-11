#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  MAX_BODY_BYTES,
  decodeUtf8,
  doctorMemoryVault,
  initializeVault,
  readMemoryById,
  readRegularTextFile,
  resolveVaultRoots,
  saveMemory,
  searchMemories,
} = require('./lib/memory-vault');

const VALUE_OPTIONS = new Map([
  ['--body-file', 'bodyFile'],
  ['--from', 'from'],
  ['--limit', 'limit'],
  ['--source-harness', 'sourceHarness'],
  ['--target-harness', 'targetHarness'],
  ['--title', 'title'],
]);
const REPEAT_OPTIONS = new Map([
  ['--kind', 'kinds'],
  ['--link', 'links'],
  ['--scope', 'scopes'],
  ['--tag', 'tags'],
  ['--target', 'targets'],
]);
const BOOLEAN_OPTIONS = new Map([
  ['--help', 'help'],
  ['-h', 'help'],
  ['--json', 'json'],
  ['--stdin', 'stdin'],
]);
const DEFAULT_STDIN_RETRY_DELAY_MS = 10;
const MAX_STDIN_RETRY_WAIT_MS = 5_000;
const STDIN_RETRY_SIGNAL = new Int32Array(new SharedArrayBuffer(4));

function usage() {
  return `
ECC Memory Vault

Usage:
  ecc memory init [--scope project|team|user] [--json]
  ecc memory save --title <text> (--stdin | --body-file <path>) [options]
  ecc memory handoff --from <harness> --target <harness> --title <text> (--stdin | --body-file <path>) [options]
  ecc memory search [query] [--scope <scope>] [--target-harness <harness>] [--kind <kind>] [--limit <n>] [--json]
  ecc memory read <memory-id> [--scope <scope>] [--json]
  ecc memory doctor [--scope <scope>] [--json]

Recall:
  Default recall scopes: project and team; user scope must be requested explicitly
  with --scope user.

Write options:
  --scope <scope>            project (default), team, or user
  --source-harness <name>    Originating harness (default: ECC_MEMORY_HARNESS or unknown)
  --target <name>            Repeatable target harness; defaults to all
  --kind <kind>              context, decision, fact, handoff, lesson, note,
                             preference, or runbook
  --tag <tag>                Repeatable lowercase tag
  --link <memory-id>         Repeatable related memory ID
  --stdin                    Read the memory body from standard input
  --body-file <path>         Read the body from a regular, non-symlink file

MCP:
  ecc-memory-mcp             Start the opt-in local stdio MCP server

Safety:
  Tool-created memories are always unreviewed context, never executable policy.
  Writes are create-only and reject known credential shapes.
`.trimStart();
}

function appendOption(options, key, value) {
  return {
    ...options,
    [key]: [...(options[key] || []), value],
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  if (argv.length === 0) {
    return { command: 'help', options: {}, positionals: [] };
  }
  if (argv[0] === '--help' || argv[0] === '-h') {
    return { command: 'help', options: {}, positionals: [] };
  }
  const [command, ...args] = argv;
  const parsed = args.reduce((state, argument, index) => {
    if (state.skipNext) {
      return { ...state, skipNext: false };
    }
    if (BOOLEAN_OPTIONS.has(argument)) {
      return {
        ...state,
        options: { ...state.options, [BOOLEAN_OPTIONS.get(argument)]: true },
      };
    }
    const valueKey = VALUE_OPTIONS.get(argument);
    const repeatKey = REPEAT_OPTIONS.get(argument);
    if (valueKey || repeatKey) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      return {
        ...state,
        options: repeatKey
          ? appendOption(state.options, repeatKey, value)
          : { ...state.options, [valueKey]: value },
        skipNext: true,
      };
    }
    if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    }
    return { ...state, positionals: [...state.positionals, argument] };
  }, { options: {}, positionals: [], skipNext: false });

  return {
    command,
    options: parsed.options,
    positionals: parsed.positionals,
  };
}

function requireNoPositionals(positionals, command) {
  if (positionals.length > 0) {
    throw new Error(`${command} does not accept positional arguments.`);
  }
}

function oneValue(values, label, fallback = null) {
  if (!values || values.length === 0) return fallback;
  if (values.length > 1) {
    throw new Error(`${label} may be provided only once.`);
  }
  return values[0];
}

function waitForStdinRetry(milliseconds) {
  Atomics.wait(STDIN_RETRY_SIGNAL, 0, 0, milliseconds);
}

function readBoundedStdin(maxBytes, retryOptions = {}) {
  const retryDelayMs = Number.isInteger(retryOptions.retryDelayMs)
    && retryOptions.retryDelayMs > 0
    ? retryOptions.retryDelayMs
    : DEFAULT_STDIN_RETRY_DELAY_MS;
  const maxRetryWaitMs = Number.isInteger(retryOptions.maxRetryWaitMs)
    && retryOptions.maxRetryWaitMs >= 0
    ? retryOptions.maxRetryWaitMs
    : MAX_STDIN_RETRY_WAIT_MS;
  const wait = typeof retryOptions.wait === 'function'
    ? retryOptions.wait
    : waitForStdinRetry;
  const chunks = [];
  let total = 0;
  let remainingRetryWaitMs = maxRetryWaitMs;
  while (total <= maxBytes) {
    const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - total));
    let bytesRead;
    try {
      bytesRead = fs.readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      const retryable = ['EAGAIN', 'EWOULDBLOCK', 'EINTR'].includes(error?.code);
      if (!retryable) throw error;
      if (remainingRetryWaitMs < retryDelayMs) {
        throw new Error(
          `Standard input remained unavailable after ${maxRetryWaitMs}ms.`
        );
      }
      wait(retryDelayMs);
      remainingRetryWaitMs -= retryDelayMs;
      continue;
    }
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > maxBytes) {
    throw new Error(`memory body is too large (maximum ${maxBytes} bytes).`);
  }
  return decodeUtf8(Buffer.concat(chunks, total), 'memory body from standard input');
}

function readBody(options) {
  const sources = [Boolean(options.stdin), Boolean(options.bodyFile)]
    .filter(Boolean).length;
  if (sources !== 1) {
    throw new Error('Choose exactly one memory body source: --stdin or --body-file.');
  }
  if (options.stdin) {
    return readBoundedStdin(MAX_BODY_BYTES);
  }

  const bodyPath = path.resolve(options.bodyFile);
  return readRegularTextFile(bodyPath, {
    label: '--body-file',
    maxBytes: MAX_BODY_BYTES,
  });
}

function writeJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function skipTerminalString(value, offset) {
  let index = offset;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code === 0x07 || code === 0x9c) {
      return index + 1;
    }
    if (
      code === 0x1b
      && index + 1 < value.length
      && value.charCodeAt(index + 1) === 0x5c
    ) {
      return index + 2;
    }
    index += 1;
  }
  return index;
}

function skipControlSequence(value, offset) {
  let index = offset;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    index += 1;
    if (code >= 0x40 && code <= 0x7e) {
      return index;
    }
  }
  return index;
}

function skipEscapeSequence(value, offset) {
  let index = offset;
  while (index < value.length) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x2f) break;
    index += 1;
  }
  if (index < value.length) {
    const code = value.charCodeAt(index);
    if (code >= 0x30 && code <= 0x7e) {
      return index + 1;
    }
  }
  return index;
}

function isBidiControl(code) {
  return code === 0x061c
    || code === 0x200e
    || code === 0x200f
    || (code >= 0x202a && code <= 0x202e)
    || (code >= 0x2066 && code <= 0x2069);
}

function sanitizeTerminalText(value) {
  const source = String(value ?? '');
  let result = '';
  let index = 0;

  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 0x1b) {
      const next = source.charCodeAt(index + 1);
      if ([0x50, 0x58, 0x5d, 0x5e, 0x5f].includes(next)) {
        index = skipTerminalString(source, index + 2);
      } else if (next === 0x5b) {
        index = skipControlSequence(source, index + 2);
      } else {
        index = skipEscapeSequence(source, index + 1);
      }
      continue;
    }
    if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(code)) {
      index = skipTerminalString(source, index + 1);
      continue;
    }
    if (code === 0x9b) {
      index = skipControlSequence(source, index + 1);
      continue;
    }
    const unsafeC0 = code <= 0x1f && code !== 0x09 && code !== 0x0a;
    if (unsafeC0 || (code >= 0x7f && code <= 0x9f) || isBidiControl(code)) {
      index += 1;
      continue;
    }
    result += source[index];
    index += 1;
  }

  return result;
}

function printInit(result, json) {
  if (json) return writeJson({ schemaVersion: 'ecc.memory.init.v1', ...result });
  process.stdout.write([
    `Initialized ECC memory scopes: ${sanitizeTerminalText(result.scopes.join(', '))}`,
    ...result.scopes.map(scope => (
      `- ${sanitizeTerminalText(scope)}: ${sanitizeTerminalText(result.roots[scope])}`
    )),
    '',
  ].join('\n'));
}

function printWrite(result, json) {
  const memory = Object.fromEntries(
    Object.entries(result.memory).filter(([key]) => key !== 'body')
  );
  const payload = {
    schemaVersion: 'ecc.memory.write.v1',
    memory,
    path: `${memory.scope}:${memory.kind}s/${memory.id}.md`,
  };
  if (json) return writeJson(payload);
  process.stdout.write([
    `Saved unreviewed ${sanitizeTerminalText(result.memory.kind)}: ${sanitizeTerminalText(result.memory.title)}`,
    `ID: ${sanitizeTerminalText(result.memory.id)}`,
    `Path: ${sanitizeTerminalText(payload.path)}`,
    '',
  ].join('\n'));
}

function printSearch(query, result, json) {
  const payload = { schemaVersion: 'ecc.memory.search.v1', query, ...result };
  if (json) return writeJson(payload);
  if (result.results.length === 0) {
    process.stdout.write('No matching memories found.\n');
    return;
  }
  const lines = result.results.flatMap(item => [
    `[${sanitizeTerminalText(item.memory.trust)}] ${sanitizeTerminalText(item.memory.id)} — ${sanitizeTerminalText(item.memory.title)} (score ${sanitizeTerminalText(item.score)})`,
    `  ${sanitizeTerminalText(item.excerpt)}`,
  ]);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printRead(result, json) {
  const payload = { schemaVersion: 'ecc.memory.read.v1', ...result };
  if (json) return writeJson(payload);
  process.stdout.write([
    `[${sanitizeTerminalText(result.memory.trust)}] ${sanitizeTerminalText(result.memory.title)}`,
    `ID: ${sanitizeTerminalText(result.memory.id)}`,
    `Source: ${sanitizeTerminalText(result.memory.sourceHarness)}`,
    `Targets: ${sanitizeTerminalText(result.memory.targetHarnesses.join(', '))}`,
    '',
    sanitizeTerminalText(result.memory.body),
    '',
    `Backlinks: ${sanitizeTerminalText(result.backlinks.map(item => item.id).join(', ') || 'none')}`,
    '',
  ].join('\n'));
}

function printDoctor(report, json) {
  if (json) return writeJson(report);
  process.stdout.write([
    `ECC memory doctor: ${report.ok ? 'PASS' : 'ISSUES FOUND'}`,
    `Memories: ${report.memoryCount}`,
    `Invalid files: ${report.invalidFileCount}`,
    `Duplicate IDs: ${report.duplicateIdCount}`,
    `Broken links: ${report.brokenLinkCount}`,
    `Skipped symlinks: ${report.skippedSymlinkCount}`,
    '',
  ].join('\n'));
}

function saveInput(options, kindOverride = null) {
  const sourceHarness = options.from
    || options.sourceHarness
    || process.env.ECC_MEMORY_HARNESS
    || 'unknown';
  return {
    title: options.title,
    body: readBody(options),
    kind: kindOverride || oneValue(options.kinds, '--kind', 'note'),
    scope: oneValue(options.scopes, '--scope', 'project'),
    sourceHarness,
    targetHarnesses: options.targets || ['all'],
    tags: options.tags || [],
    links: options.links || [],
  };
}

function assertMutationAllowed(command) {
  if (process.env.ECC_DRY_RUN === '1') {
    throw new Error(
      `memory ${command} is disabled in dry-run mode; no files were written.`
    );
  }
}

function runInitCommand({ command, options, positionals, roots }) {
  requireNoPositionals(positionals, command);
  return printInit(
    initializeVault({ roots, scopes: options.scopes || undefined }),
    options.json
  );
}

function runWriteCommand({ command, options, positionals, roots }) {
  requireNoPositionals(positionals, command);
  if (!options.title) throw new Error('--title is required.');
  if (command === 'handoff' && !options.from) {
    throw new Error('--from is required for handoffs.');
  }
  if (command === 'handoff' && (!options.targets || options.targets.length === 0)) {
    throw new Error('At least one --target is required for handoffs.');
  }
  return printWrite(
    saveMemory(saveInput(options, command === 'handoff' ? 'handoff' : null), { roots }),
    options.json
  );
}

function runSearchCommand({ options, positionals, roots }) {
  const query = positionals.join(' ');
  return printSearch(query, searchMemories(query, {
    roots,
    scopes: options.scopes,
    kinds: options.kinds,
    targetHarness: options.targetHarness,
    limit: options.limit,
  }), options.json);
}

function runReadCommand({ options, positionals, roots }) {
  if (positionals.length !== 1) {
    throw new Error('read requires exactly one memory ID.');
  }
  return printRead(readMemoryById(positionals[0], {
    roots,
    scopes: options.scopes,
  }), options.json);
}

function runDoctorCommand({ command, options, positionals, roots }) {
  requireNoPositionals(positionals, command);
  return printDoctor(doctorMemoryVault({
    roots,
    scopes: options.scopes,
  }), options.json);
}

const COMMAND_HANDLERS = Object.freeze({
  doctor: runDoctorCommand,
  handoff: runWriteCommand,
  init: runInitCommand,
  read: runReadCommand,
  save: runWriteCommand,
  search: runSearchCommand,
});

function runCommand(parsed) {
  const { command, options, positionals } = parsed;
  if (options.help || command === 'help') {
    process.stdout.write(usage());
    return;
  }
  if (['init', 'save', 'handoff'].includes(command)) {
    assertMutationAllowed(command);
  }
  const roots = resolveVaultRoots();
  const handler = Object.hasOwn(COMMAND_HANDLERS, command)
    ? COMMAND_HANDLERS[command]
    : null;
  if (!handler) throw new Error(`Unknown memory command: ${command}`);
  return handler({ command, options, positionals, roots });
}

function main(argv = process.argv.slice(2)) {
  try {
    runCommand(parseArgs(argv));
  } catch (error) {
    process.stderr.write(`Error: ${sanitizeTerminalText(error.message)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  parseArgs,
  readBoundedStdin,
  readBody,
  runCommand,
  sanitizeTerminalText,
  usage,
  writeJson,
};
