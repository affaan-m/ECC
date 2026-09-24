#!/usr/bin/env node
/**
 * Cursor wrapper for block-no-verify.
 *
 * Cursor hooks previously called `npx block-no-verify@1.1.2`, an external
 * package whose matcher over-matches: it blocks legitimate `git commit`
 * whenever the literal string `--no-verify` (or `no-verify`) appears
 * anywhere in the command string, including inside the commit message
 * body. See issue #2107.
 *
 * The Claude Code surface already routes through the local, in-repo hook
 * `scripts/hooks/block-no-verify.js`, which performs flag-position-aware
 * tokenisation (skipping the value of `-m`, `-F`, `-am "..."`, etc.) and
 * passes 25 regression tests covering every false-positive case.
 *
 * This wrapper gives Cursor the same matcher: read Cursor stdin, transform
 * to the Claude Code `tool_input.command` shape the local hook understands,
 * delegate to its exported `run()`, then forward the exit code and stderr.
 */

'use strict';

const { readStdin, hookEnabled } = require('./adapter');
const { run } = require('../../scripts/hooks/block-no-verify');

readStdin()
  .then(raw => {
    if (!hookEnabled('pre:bash:block-no-verify', ['minimal', 'standard', 'strict'])) {
      process.stdout.write(raw);
      return;
    }

    let command = '';
    try {
      const parsed = JSON.parse(raw || '{}');
      command = String(parsed.command || parsed.args?.command || '');
    } catch {
      command = String(raw || '');
    }

    // Local hook accepts either the raw command string or a Claude-Code
    // shaped `{ tool_input: { command } }` JSON. Pass the Claude shape so
    // the JSON branch in extractCommand() is exercised the same way the
    // Claude Code surface exercises it — keeps the two surfaces on the
    // same code path.
    const claudeInput = JSON.stringify({ tool_input: { command } });
    const result = run(claudeInput);

    if (result && result.exitCode === 2) {
      if (result.stderr) {
        process.stderr.write(String(result.stderr) + '\n');
      }
      process.exit(2);
    }

    process.stdout.write(raw);
  })
  .catch(() => {
    // Per repo rule: hooks must exit 0 on non-critical errors and never
    // unexpectedly block tool execution. A parse / transport error here
    // is non-critical — fall through.
    process.exit(0);
  });
