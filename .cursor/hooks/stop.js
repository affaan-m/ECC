#!/usr/bin/env node
const {
  createStopFormatTypecheckOptions,
  hookEnabled,
  readStdin,
  runExistingHook,
  transformToClaude,
} = require('./adapter');
readStdin().then(raw => {
  const input = JSON.parse(raw || '{}');
  const claudeInput = transformToClaude(input);
  const sharedOptions = {
    env: claudeInput.session_id
      ? { CLAUDE_SESSION_ID: claudeInput.session_id }
      : {},
  };

  if (hookEnabled('stop:session-end', ['minimal', 'standard', 'strict'])) {
    runExistingHook('session-end.js', claudeInput, sharedOptions);
  }
  if (hookEnabled('stop:evaluate-session', ['minimal', 'standard', 'strict'])) {
    runExistingHook('evaluate-session.js', claudeInput, sharedOptions);
  }
  if (hookEnabled('stop:cost-tracker', ['minimal', 'standard', 'strict'])) {
    runExistingHook('cost-tracker.js', claudeInput, sharedOptions);
  }
  if (hookEnabled('stop:format-typecheck', ['standard', 'strict'])) {
    runExistingHook(
      'stop-format-typecheck.js',
      claudeInput,
      createStopFormatTypecheckOptions(sharedOptions.env)
    );
  }
  if (hookEnabled('stop:check-console-log', ['standard', 'strict'])) {
    runExistingHook('check-console-log.js', claudeInput, {
      ...sharedOptions,
      forwardStderr: true,
    });
  }

  process.stdout.write(raw);
}).catch(() => process.exit(0));
