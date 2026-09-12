#!/usr/bin/env node
'use strict';

const { runPreBash } = require('./bash-hook-dispatcher');
const { readStdinRaw, resolveMaxStdin } = require('./hook-input');
const { isHookEnabled } = require('../lib/hook-flags');

const maxStdin = resolveMaxStdin(process.env.ECC_HOOK_INPUT_MAX_BYTES, {
  writeDiagnostic: message => process.stderr.write(message)
});

readStdinRaw(process.stdin, {
  maxStdin,
  truncated: /^(1|true|yes)$/i.test(
    String(process.env.ECC_HOOK_INPUT_TRUNCATED_UPSTREAM || '')
  )
}).then(({ raw, truncated }) => {
  if (!isHookEnabled('pre:bash:dispatcher', {
    profiles: 'minimal,standard,strict'
  })) {
    process.exitCode = 0;
    return;
  }

  if (truncated) {
    process.stderr.write(
      `[Hook] stdin exceeded ${maxStdin} bytes for pre:bash:dispatcher; blocking because safety checks require the complete request\n`
    );
    process.exitCode = 2;
    return;
  }

  const result = runPreBash(raw);
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}).catch(error => {
  process.stderr.write(`[Hook] pre-bash dispatcher failed: ${error.message}\n`);
  process.exitCode = 2;
});
