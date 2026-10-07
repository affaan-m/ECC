#!/usr/bin/env node
'use strict';

/**
 * Mistral Vibe hook bridge for ECC hook runners.
 *
 * Vibe plugin hooks receive a JSON payload on stdin that is close to, but not
 * identical with, the Claude Code hook protocol the ECC runners speak:
 *
 *   Vibe event        Claude Code event   Vibe tool name   Claude tool name
 *   pre_tool          PreToolUse          bash              Bash
 *   post_tool         PostToolUse         write_file        Write
 *   post_agent        Stop                edit              Edit
 *                                         read_file        Read
 *
 * The bridge:
 *   1. reads the Vibe payload and rebuilds it in Claude Code shape
 *      (event name, PascalCase tool name, file_path aliased from path);
 *   2. sets CLAUDE_PLUGIN_ROOT from Vibe's PLUGIN_ROOT so
 *      scripts/lib/resolve-ecc-root.js resolves the plugin root;
 *   3. runs the runner (a repo-relative path under the plugin root);
 *   4. translates the runner's Claude Code result back to Vibe semantics:
 *        - exit 2 (Claude block)  -> exit 0 + {"decision": "deny", ...}
 *        - exit 0 + hookSpecificOutput.permissionDecision "deny" -> deny
 *        - exit 0 + additionalContext -> allow + system_message
 *        - any other non-zero exit -> bridge fails (Vibe fail-open path)
 *
 * Vibe hook semantics differ from Claude Code in one important way: a Vibe
 * hook that exits non-zero is a *failure* that lets the tool call proceed
 * (fail open), not a block. Claude Code runners signal "block" with exit 2,
 * so the bridge must convert it to Vibe's structured deny response.
 *
 * Usage: node vibe-hook-bridge.js <runner-relative-to-plugin-root> [args...]
 */

const { spawnSync } = require('child_process');
const path = require('path');

const MAX_STDIN_BYTES = 1024 * 1024;
const RUNNER_TIMEOUT_MS = 30_000;

const VIBE_EVENT_TO_CLAUDE_EVENT = Object.freeze({
  pre_tool: 'PreToolUse',
  post_tool: 'PostToolUse',
  post_agent: 'Stop',
});

const VIBE_TOOL_TO_CLAUDE_TOOL = Object.freeze({
  bash: 'Bash',
  git_bash: 'Bash',
  powershell: 'PowerShell',
  write_file: 'Write',
  edit: 'Edit',
  read_file: 'Read',
  grep: 'Grep',
  task: 'Task',
});

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    process.stdin.on('data', chunk => {
      total += chunk.length;
      if (total > MAX_STDIN_BYTES) {
        reject(new Error(`stdin exceeded ${MAX_STDIN_BYTES} bytes`));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

function buildClaudePayload(vibePayload) {
  const claudeEvent = VIBE_EVENT_TO_CLAUDE_EVENT[vibePayload.hook_event_name];
  if (!claudeEvent) {
    throw new Error(`unsupported Vibe hook event: ${vibePayload.hook_event_name}`);
  }

  const claudeTool = vibePayload.tool_name
    && Object.prototype.hasOwnProperty.call(VIBE_TOOL_TO_CLAUDE_TOOL, vibePayload.tool_name)
    ? VIBE_TOOL_TO_CLAUDE_TOOL[vibePayload.tool_name]
    : vibePayload.tool_name;

  // Claude Code file tools address files through `file_path`; Vibe uses
  // `path`. Runners read tool_input.file_path, so alias it when present.
  const toolInput = vibePayload.tool_input && typeof vibePayload.tool_input === 'object'
    ? { ...vibePayload.tool_input }
    : {};
  if (toolInput.path !== undefined && toolInput.file_path === undefined) {
    toolInput.file_path = toolInput.path;
  }

  return {
    session_id: vibePayload.session_id ?? null,
    parent_session_id: vibePayload.parent_session_id ?? null,
    transcript_path: vibePayload.transcript_path ?? null,
    cwd: vibePayload.cwd ?? process.cwd(),
    hook_event_name: claudeEvent,
    tool_name: claudeTool,
    tool_input: toolInput,
  };
}

function emitVibeJson(value) {
  process.stdout.write(JSON.stringify(value));
  process.exitCode = 0;
}

function deny(reason) {
  emitVibeJson({
    decision: 'deny',
    reason: String(reason || 'blocked by ECC hook').trim(),
  });
}

function translateRunnerJson(claudeJson, hookEvent) {
  const specific = claudeJson.hookSpecificOutput || {};
  const permissionDecision = specific.permissionDecision || claudeJson.permissionDecision;

  if (permissionDecision === 'deny' || claudeJson.decision === 'block') {
    deny(
      specific.permissionDecisionReason
        || claudeJson.reason
        || claudeJson.permissionDecisionReason
        || 'denied by ECC hook'
    );
    return true;
  }

  if (permissionDecision === 'ask') {
    // Vibe pre_tool hooks cannot escalate to an interactive prompt; pass the
    // call through with a visible note so the reason is not silently lost.
    emitVibeJson({
      decision: 'allow',
      system_message: `ECC hook asked for confirmation: ${
        specific.permissionDecisionReason || 'review this tool call'
      }`,
    });
    return true;
  }

  const additionalContext = specific.additionalContext || claudeJson.additionalContext;
  if (additionalContext) {
    const vibeJson = {
      decision: 'allow',
      system_message: String(additionalContext),
    };
    if (hookEvent === 'post_tool') {
      vibeJson.hook_specific_output = { additional_context: String(additionalContext) };
    }
    emitVibeJson(vibeJson);
    return true;
  }

  return false;
}

function run() {
  const [, , runnerRelative, ...runnerArgs] = process.argv;
  if (!runnerRelative) {
    process.stderr.write('usage: vibe-hook-bridge.js <runner-relative-to-plugin-root> [args...]\n');
    process.exitCode = 1;
    return Promise.resolve();
  }

  return readStdin().then(raw => {
    let vibePayload;
    try {
      vibePayload = JSON.parse(raw);
    } catch (error) {
      process.stderr.write(`[vibe-hook-bridge] invalid Vibe hook JSON: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }

    const claudePayload = buildClaudePayload(vibePayload);

    const pluginRoot = process.env.PLUGIN_ROOT || path.resolve(__dirname, '..', '..');
    const runnerPath = path.resolve(pluginRoot, runnerRelative);

    const env = { ...process.env };
    if (!env.CLAUDE_PLUGIN_ROOT) {
      // scripts/lib/resolve-ecc-root.js treats CLAUDE_PLUGIN_ROOT as the
      // first-choice ECC root; Vibe injects PLUGIN_ROOT for hook processes.
      env.CLAUDE_PLUGIN_ROOT = pluginRoot;
    }

    const result = spawnSync(process.execPath, [runnerPath, ...runnerArgs], {
      input: JSON.stringify(claudePayload),
      env,
      timeout: RUNNER_TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: MAX_STDIN_BYTES,
    });

    if (result.error) {
      process.stderr.write(`[vibe-hook-bridge] runner failed: ${result.error.message}\n`);
      process.exitCode = 1;
      return;
    }

    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    // Claude Code: exit 2 means "block" with the reason on stderr.
    if (result.status === 2) {
      const reason = String(result.stderr || '').trim()
        || 'blocked by ECC hook';
      deny(reason);
      return;
    }

    // Any other non-zero exit is a Claude Code non-blocking error; surface it
    // through Vibe's failure path, which also fails open.
    if (result.status !== 0) {
      process.stderr.write(`[vibe-hook-bridge] runner exited with ${result.status}\n`);
      process.exitCode = 1;
      return;
    }

    const stdout = String(result.stdout || '').trim();
    if (!stdout) {
      return;
    }

    try {
      const claudeJson = JSON.parse(stdout);
      const handled = translateRunnerJson(claudeJson, vibePayload.hook_event_name);
      if (!handled) {
        process.stderr.write('[vibe-hook-bridge] runner JSON had no Vibe-relevant fields; allowing\n');
      }
    } catch (error) {
      // Free-form stdout with exit 0 is a Claude Code failure path; keep the
      // same semantics (allow, warning) rather than guessing.
      process.stderr.write(`[vibe-hook-bridge] runner stdout was not JSON: ${error.message}\n`);
    }
  });
}

if (require.main === module) {
  run().catch(error => {
    process.stderr.write(`[vibe-hook-bridge] failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  VIBE_EVENT_TO_CLAUDE_EVENT,
  VIBE_TOOL_TO_CLAUDE_TOOL,
  buildClaudePayload,
  translateRunnerJson,
};
