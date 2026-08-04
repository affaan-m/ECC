#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  ADAPTER_RECORDS,
  renderMarkdownTable,
  validateAdapterRecords,
  validateDocumentation,
} = require('./lib/harness-adapter-compliance');

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    check: false,
    format: 'text',
    help: false,
    root: process.cwd(),
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--check') {
      parsed.check = true;
      continue;
    }

    if (arg === '--format') {
      parsed.format = String(args[index + 1] || '').toLowerCase();
      index += 1;
      continue;
    }

    if (arg.startsWith('--format=')) {
      parsed.format = arg.slice('--format='.length).toLowerCase();
      continue;
    }

    if (arg === '--root') {
      parsed.root = path.resolve(args[index + 1] || process.cwd());
      index += 1;
      continue;
    }

    if (arg.startsWith('--root=')) {
      parsed.root = path.resolve(arg.slice('--root='.length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['text', 'json', 'markdown'].includes(parsed.format)) {
    throw new Error(`Invalid format: ${parsed.format}. Use text, json, or markdown.`);
  }

  parsed.root = path.resolve(parsed.root);
  return parsed;
}

function printHelp() {
  console.log([
    'Usage: node scripts/harness-adapter-compliance.js [options]',
    '',
    'Validate or render the ECC harness adapter compliance scorecard.',
    '',
    'Options:',
    '  --check                 Fail if adapter records or docs are out of sync',
    '  --format <text|json|markdown>',
    '  --root <path>           Repository root, defaults to cwd',
    '  -h, --help              Show this help',
  ].join('\n'));
}

function buildPayload(root) {
  const recordErrors = validateAdapterRecords();
  const documentationErrors = validateDocumentation({ repoRoot: root });

  return {
    schema_version: 'ecc.harness-adapter-compliance.v1',
    generated_from: 'scripts/lib/harness-adapter-compliance.js',
    adapter_count: ADAPTER_RECORDS.length,
    valid: recordErrors.length === 0 && documentationErrors.length === 0,
    errors: [...recordErrors, ...documentationErrors],
    adapters: ADAPTER_RECORDS,
  };
}

function renderText(payload) {
  const lines = [
    `Harness Adapter Compliance: ${payload.valid ? 'PASS' : 'FAIL'}`,
    `Adapters: ${payload.adapter_count}`,
  ];

  if (payload.errors.length > 0) {
    lines.push('Errors:');
    for (const error of payload.errors) {
      lines.push(`- ${error}`);
    }
  }

  return lines.join('\n');
}

function main() {
  let parsed;

  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  if (parsed.help) {
    printHelp();
    return;
  }

  const payload = buildPayload(parsed.root);

  if (parsed.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else if (parsed.format === 'markdown') {
    console.log(renderMarkdownTable());
  } else {
    console.log(renderText(payload));
  }

  if (parsed.check && !payload.valid) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildPayload,
  parseArgs,
};

