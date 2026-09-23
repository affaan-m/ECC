#!/usr/bin/env node
'use strict';

/**
 * Antigravity Lifecycle Hook Bridge
 *
 * Bridges Google Antigravity's protojson hook contract (stdin/stdout JSON with
 * camelCase keys and { decision, reason } responses) to ECC's internal hook
 * runtime (exit-code/stderr based).
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { runPreBash } = require('./bash-hook-dispatcher');
const { run: runGateGuard } = require('./gateguard-fact-force');
const { run: runDocFileWarning } = require('./doc-file-warning');
const { run: runStopFormatTypecheck } = require('./stop-format-typecheck');
const { readStdinRaw, resolveMaxStdin } = require('./hook-input');

function parseArgs(argv) {
  const options = {
    mode: 'pre-tool-use',
    hook: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--mode') {
      options.mode = argv[i + 1] || options.mode;
      i += 1;
    } else if (argv[i] === '--hook') {
      options.hook = argv[i + 1] || options.hook;
      i += 1;
    }
  }

  return options;
}

function adaptAntigravityInputToEcc(antigravityData) {
  if (!antigravityData || typeof antigravityData !== 'object') {
    return { tool_name: '', tool_input: {} };
  }

  const toolCall = antigravityData.toolCall || {};
  const toolName = toolCall.name || antigravityData.tool_name || '';
  const args = toolCall.args || antigravityData.tool_input || {};

  // Normalize Antigravity tools to ECC tool conventions
  const toolInput = {
    ...args,
    command: args.CommandLine || args.command || '',
    file_path: args.TargetFile || args.file_path || args.path || '',
  };

  return {
    tool_name: toolName,
    tool_input: toolInput,
    conversation_id: antigravityData.conversationId || '',
    workspace_paths: antigravityData.workspacePaths || [],
  };
}

async function main() {
  const options = parseArgs(process.argv);
  const maxStdin = resolveMaxStdin(process.env.ECC_HOOK_INPUT_MAX_BYTES);

  let raw = '';
  try {
    const inputResult = await readStdinRaw(process.stdin, { maxStdin });
    raw = inputResult.raw;
  } catch (_err) {
    // If stdin read fails, fail open safely
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return;
  }

  let antigravityPayload = {};
  try {
    antigravityPayload = raw.trim() ? JSON.parse(raw) : {};
  } catch (_parseErr) {
    // Malformed JSON on stdin
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return;
  }

  const eccPayload = adaptAntigravityInputToEcc(antigravityPayload);
  const eccJsonString = JSON.stringify(eccPayload);

  if (options.mode === 'pre-tool-use') {
    let result = { exitCode: 0, stderr: '' };

    if (options.hook === 'pre:bash:dispatcher') {
      result = runPreBash(eccJsonString);
    } else if (options.hook === 'pre:edit-write:gateguard-fact-force') {
      result = runGateGuard(eccJsonString);
    } else if (options.hook === 'pre:config-protection') {
      const child = spawnSync(process.execPath, [path.join(__dirname, 'config-protection.js')], {
        input: eccJsonString,
        encoding: 'utf8',
      });
      result = {
        exitCode: child.status || 0,
        stderr: child.stderr || '',
      };
    } else if (options.hook === 'pre:write:doc-file-warning') {
      result = runDocFileWarning(eccJsonString);
    }

    if (result && (result.exitCode === 2 || result.denied || result.blocked)) {
      const reason = result.stderr || result.reason || 'Blocked by ECC safety hook';
      process.stdout.write(JSON.stringify({
        decision: 'deny',
        reason: reason.replace(/\r?\n/g, ' ').trim(),
      }));
      return;
    }

    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return;
  }

  if (options.mode === 'stop') {
    let stopResult = { exitCode: 0, stderr: '' };

    if (options.hook === 'stop:format-typecheck') {
      stopResult = runStopFormatTypecheck(eccJsonString);
    } else if (options.hook === 'stop:check-console-log') {
      const child = spawnSync(process.execPath, [path.join(__dirname, 'check-console-log.js')], {
        input: eccJsonString,
        encoding: 'utf8',
      });
      stopResult = {
        exitCode: child.status || 0,
        stderr: child.stderr || '',
      };
    }

    if (stopResult && stopResult.exitCode !== 0 && stopResult.stderr) {
      process.stdout.write(JSON.stringify({
        decision: 'continue',
        reason: stopResult.stderr.replace(/\r?\n/g, ' ').trim(),
      }));
      return;
    }

    process.stdout.write(JSON.stringify({}));
    return;
  }

  // Default passthrough
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
}

if (require.main === module) {
  main().catch(() => {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  });
}

module.exports = {
  adaptAntigravityInputToEcc,
};
