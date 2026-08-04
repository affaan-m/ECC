#!/usr/bin/env node

const {
  FEEDBACK_ROUTES,
  getFeedbackPayload,
} = require('./lib/feedback-links');

function showHelp(exitCode = 0) {
  process.stdout.write(`
Usage: node scripts/feedback.js [--json]

Print ECC's low-friction public feedback routes. This command never uploads
diagnostics or reads project files.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  return argv.slice(2).reduce((parsed, arg) => {
    if (arg === '--json') {
      return { ...parsed, json: true };
    }

    if (arg === '--help' || arg === '-h') {
      return { ...parsed, help: true };
    }

    throw new Error(`Unknown argument: ${arg}`);
  }, { json: false, help: false });
}

function printHuman() {
  process.stdout.write([
    'ECC feedback',
    '',
    `Install or runtime problem:\n${FEEDBACK_ROUTES.problem}`,
    '',
    `Quick feedback (public GitHub issue):\n${FEEDBACK_ROUTES.feedback}`,
    '',
    `Feature idea:\n${FEEDBACK_ROUTES.feature}`,
    '',
    'ECC does not upload diagnostics or read project files. Redact sensitive information before posting publicly.',
    '',
  ].join('\n'));
}

function main() {
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      showHelp(0);
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify(getFeedbackPayload(), null, 2)}\n`);
    } else {
      printHuman();
    }
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
