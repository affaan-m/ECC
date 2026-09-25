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
const { run: runPostEditAccumulator } = require('./post-edit-accumulator');
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
    tool_name: ({ run_command: 'Bash', write_to_file: 'Write', replace_file_content: 'Edit', multi_replace_file_content: 'Edit' })[toolName] || toolName,
    tool_input: toolInput,
    session_id: antigravityData.conversationId || antigravityData.session_id || '',
    cwd: args.Cwd || antigravityData.cwd || antigravityData.workspacePaths?.[0] || '',
    conversation_id: antigravityData.conversationId || '',
    workspace_paths: antigravityData.workspacePaths || [],
  };
}

function writeFailure(mode, reason) {
  process.stdout.write(JSON.stringify({
    decision: mode === 'pre-tool-use' ? 'deny' : 'allow',
    ...(mode === 'pre-tool-use' ? { reason } : {}),
  }));
}

async function main() {
  const options = parseArgs(process.argv);
  const maxStdin = resolveMaxStdin(process.env.ECC_HOOK_INPUT_MAX_BYTES);

  let raw = '';
  try {
    const inputResult = await readStdinRaw(process.stdin, { maxStdin });
    if (inputResult.truncated) throw new Error('Incomplete hook input');
    raw = inputResult.raw;
  } catch (_err) {
    writeFailure(options.mode, 'ECC hook input could not be read completely');
    return;
  }

  let antigravityPayload = {};
  try {
    antigravityPayload = JSON.parse(raw);
    if (!antigravityPayload || typeof antigravityPayload !== 'object' || Array.isArray(antigravityPayload)) {
      throw new Error('Invalid hook input');
    }
  } catch (_parseErr) {
    writeFailure(options.mode, 'ECC hook input must be a valid JSON object');
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
        timeout: 4000,
      });
      result = {
        exitCode: child.error || child.status === null ? 2 : child.status,
        stderr: child.stderr || '',
        stdout: typeof child.stdout === 'string' ? child.stdout : '',
      };
    } else if (options.hook === 'pre:write:doc-file-warning') {
      result = runDocFileWarning(eccJsonString);
    }

    const output = typeof result?.stdout === 'string'
      ? result.stdout
      : (typeof result?.output === 'string' ? result.output : null);
    let hookOutput = null;
    if (output) {
      try {
        const parsed = JSON.parse(output);
        hookOutput = parsed && typeof parsed === 'object' ? parsed.hookSpecificOutput : null;
      } catch {
        hookOutput = null;
      }
    }
    const denied = Boolean(
      (result && ((result.exitCode !== undefined && result.exitCode !== 0) || result.denied || result.blocked))
      || hookOutput?.permissionDecision === 'deny'
    );
    const context = result?.additionalContext || hookOutput?.additionalContext;
    const reason = denied
      ? hookOutput?.permissionDecisionReason || result?.stderr || result?.reason || 'Blocked by ECC safety hook'
      : (Array.isArray(context) ? context.join(' ') : context);
    process.stdout.write(JSON.stringify({
      decision: denied ? 'deny' : 'allow',
      ...(reason ? { reason: String(reason).replace(/\r?\n/g, ' ').trim() } : {}),
    }));
    return;
  }

  // Both accumulator and batch formatter use the same session-scoped temp file.
  if (eccPayload.session_id) process.env.CLAUDE_SESSION_ID = String(eccPayload.session_id);

  if (options.mode === 'post-tool-use') {
    if (options.hook === 'post:edit:accumulator' && !antigravityPayload.error) {
      runPostEditAccumulator(eccJsonString);
    }
    process.stdout.write(JSON.stringify({}));
    return;
  }

  if (options.mode === 'stop') {
    if (antigravityPayload.fullyIdle === false) {
      process.stdout.write(JSON.stringify({ decision: 'allow' }));
      return;
    }
    let stopResult = { exitCode: 0, stderr: '' };

    const stopScript = {
      'stop:format-typecheck': 'stop-format-typecheck.js',
      'stop:check-console-log': 'check-console-log.js',
    }[options.hook];
    if (stopScript) {
      const child = spawnSync(process.execPath, [path.join(__dirname, stopScript)], {
        input: eccJsonString,
        encoding: 'utf8',
        timeout: options.hook === 'stop:format-typecheck' ? 280000 : 25000,
      });
      stopResult = {
        stderr: child.stderr || (child.error ? 'ECC stop hook failed: ' + child.error.message : ''),
      };
    }

    if (stopResult && stopResult.stderr) {
      process.stdout.write(JSON.stringify({
        decision: 'continue',
        reason: stopResult.stderr.replace(/\r?\n/g, ' ').trim(),
      }));
      return;
    }

    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    return;
  }

  // Default passthrough
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
}

if (require.main === module) {
  main().catch(() => {
    writeFailure(parseArgs(process.argv).mode, 'ECC safety hook failed unexpectedly');
  });
}

module.exports = {
  adaptAntigravityInputToEcc,
};
