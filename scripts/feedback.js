#!/usr/bin/env node

const {
  FEEDBACK_ROUTES,
  getFeedbackPayload,
} = require('./lib/feedback-links');

function showHelp(exitCode = 0) {
  console.log(`
Usage: node scripts/feedback.js [--json]

Print ECC's low-friction public feedback routes. This command never uploads
diagnostics or reads project files.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const parsed = { json: false, help: false };

  for (const arg of argv.slice(2)) {
    if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHuman() {
  console.log('ECC feedback\n');
  console.log(`Install or runtime problem:\n${FEEDBACK_ROUTES.problem}\n`);
  console.log(`Quick feedback (public GitHub issue):\n${FEEDBACK_ROUTES.feedback}\n`);
  console.log(`Feature idea:\n${FEEDBACK_ROUTES.feature}\n`);
  console.log('ECC does not upload diagnostics or read project files. Redact sensitive information before posting publicly.');
}

function main() {
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      showHelp(0);
    }

    if (options.json) {
      console.log(JSON.stringify(getFeedbackPayload(), null, 2));
    } else {
      printHuman();
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
