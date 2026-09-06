#!/usr/bin/env node
'use strict';

/**
 * session-start-bootstrap.js
 *
 * Bootstrap loader for the ECC SessionStart hook.
 *
 * Problem this solves: the previous approach embedded this logic as an inline
 * `node -e "..."` string inside hooks.json. Characters like `!` (used in
 * `!org.isDirectory()`) can trigger bash history expansion or other shell
 * interpretation issues depending on the environment, causing
 * "SessionStart:startup hook error" to appear in the Claude Code CLI header.
 *
 * By extracting to a standalone file, the shell never sees the JavaScript
 * source and the `!` characters are safe. Behaviour is otherwise identical.
 *
 * How it works:
 *   1. Reads the raw JSON event from stdin (passed by Claude Code).
 *   2. Resolves the ECC plugin root directory (via CLAUDE_PLUGIN_ROOT env var
 *      or a set of well-known fallback paths).
 *   3. Delegates to `scripts/hooks/run-with-flags.js` with the `session:start`
 *      event, which applies hook-profile gating and then runs session-start.js.
 *   4. Passes stdout/stderr through and forwards the child exit code.
 *   5. If the plugin root cannot be found, emits a warning and no stdout so
 *      Claude Code can continue normally without duplicating the event.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveEccRoot } = require('../lib/resolve-ecc-root');
const { readStdinRaw, resolveMaxStdin } = require('./hook-input');

async function main() {
  const maxStdin = resolveMaxStdin(process.env.ECC_HOOK_INPUT_MAX_BYTES, {
    writeDiagnostic: message => process.stderr.write(message)
  });
  const { raw, truncated } = await readStdinRaw(process.stdin, {
    maxStdin,
    truncated: /^(1|true|yes)$/i.test(
      String(process.env.ECC_HOOK_INPUT_TRUNCATED_UPSTREAM || '')
    )
  });
  if (truncated) {
    process.stderr.write(`[SessionStart] stdin exceeded ${maxStdin} bytes; forwarded a bounded prefix\n`);
  }

  // Path (relative to plugin root) to the hook runner
  const rel = path.join('scripts', 'hooks', 'run-with-flags.js');

// Resolve the ECC plugin root via the shared resolver, probing for the runner
// so a valid root is one that actually contains run-with-flags.js.
  const root = resolveEccRoot({ probe: rel });
  const script = path.join(root, rel);

  if (fs.existsSync(script)) {
    const result = spawnSync(
      process.execPath,
      [script, 'session:start', 'scripts/hooks/session-start.js', 'minimal,standard,strict'],
      {
        input: raw,
        encoding: 'utf8',
        env: {
          ...process.env,
          ECC_HOOK_INPUT_MAX_BYTES: String(maxStdin),
          ECC_HOOK_INPUT_TRUNCATED_UPSTREAM: truncated ? '1' : '0'
        },
        cwd: process.cwd(),
        timeout: 30000,
      }
    );

    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    if (stdout) process.stdout.write(stdout);

    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    if (result.error || result.status === null || result.signal) {
      const reason = result.error
        ? result.error.message
        : result.signal
          ? 'signal ' + result.signal
          : 'missing exit status';
      process.stderr.write('[SessionStart] ERROR: session-start hook failed: ' + reason + '\n');
      process.exit(1);
    }

    process.exit(Number.isInteger(result.status) ? result.status : 0);
  }

  process.stderr.write(
    '[SessionStart] WARNING: could not resolve ECC plugin root; skipping session-start hook\n'
  );
}

main().catch(error => {
  process.stderr.write(`[SessionStart] bootstrap failed: ${error.message}\n`);
  process.exitCode = 0;
});
