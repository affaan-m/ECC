#!/usr/bin/env node
const {
  hookEnabled,
  mergeSessionStartOutputs,
  normalizeSessionStartOutput,
  readStdin,
  runExistingHook,
  transformToClaude,
} = require('./adapter');
readStdin().then(raw => {
  let input = {};
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      input = parsed;
    }
  } catch {
    // The Cursor env helper handles malformed input and supplies a safe default.
  }
  const transformedInput = transformToClaude(input);
  const claudeInput = {
    ...transformedInput,
    hook_event_name: 'SessionStart',
    source: 'startup',
  };
  const outputs = [];
  if (!hookEnabled('session:start', ['minimal', 'standard', 'strict'])) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const envResult = runExistingHook('cursor-session-env.js', raw, {
    forwardStderr: true,
  });
  if (envResult && envResult.status === 0 && envResult.stdout) {
    try {
      outputs.push(normalizeSessionStartOutput(envResult.stdout));
    } catch {
      // The shared session-start hook can still run without optional env output.
    }
  }

  const sessionEnv = outputs[0]?.env || {};
  const sessionResult = runExistingHook('session-start.js', claudeInput, {
    env: {
      ...sessionEnv,
      ...(transformedInput.session_id
        ? { CLAUDE_SESSION_ID: transformedInput.session_id }
        : {}),
    },
    forwardStderr: true,
  });
  if (sessionResult && sessionResult.status === 0 && sessionResult.stdout) {
    try {
      outputs.push(normalizeSessionStartOutput(sessionResult.stdout, { shared: true }));
    } catch {
      // Invalid optional context output must not block Cursor startup.
    }
  }
  process.stdout.write(JSON.stringify(mergeSessionStartOutputs(outputs)));
}).catch(() => process.exit(0));
