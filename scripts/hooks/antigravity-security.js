#!/usr/bin/env node
/**
 * Native Antigravity PreToolUse adapter for ECC security hooks.
 *
 * Antigravity sends camelCase hook payloads and expects a JSON decision on
 * stdout. This adapter translates supported tools to ECC's internal hook
 * contract, then maps an ECC block back to Antigravity's documented `deny`
 * decision. Unsupported tools defer to Antigravity's native confirmation.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const { classifyPowerShellDestructiveCommand } = require('../lib/powershell-destructive-command');

const RUNTIME_ROOT = path.resolve(__dirname, '..');
const { isHookEnabled } = require('../lib/hook-flags');

const MAX_STDIN_BYTES = 1024 * 1024;
const COMMAND_TOOL = 'run_command';
const WRITE_TOOL_MAP = Object.freeze({
  write_to_file: 'Write',
  replace_file_content: 'Edit',
  multi_replace_file_content: 'MultiEdit',
});

function readStdinBounded(stream = process.stdin, maxBytes = MAX_STDIN_BYTES) {
  return new Promise(resolve => {
    const decoder = new StringDecoder('utf8');
    let raw = '';
    let acceptedBytes = 0;
    let truncated = false;
    let incomplete = false;
    let settled = false;

    stream.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxBytes - acceptedBytes);
      const accepted = buffer.subarray(0, remaining);
      if (accepted.length > 0) {
        raw += decoder.write(accepted);
        acceptedBytes += accepted.length;
      }
      if (accepted.length < buffer.length) truncated = true;
    });

    const finish = () => {
      if (settled) return;
      settled = true;
      if (!truncated && !incomplete) raw += decoder.end();
      resolve({ raw, truncated, incomplete });
    };
    const finishIncomplete = () => {
      incomplete = true;
      finish();
    };

    stream.once('end', finish);
    stream.once('error', finishIncomplete);
    stream.once('close', finishIncomplete);
  });
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.length > 0) || '';
}

function buildFileToolInput(toolName, args) {
  const filePath = firstString(args.TargetFile);
  if (toolName === 'Write') {
    return { file_path: filePath, content: firstString(args.CodeContent) };
  }
  if (toolName === 'Edit') {
    return {
      file_path: filePath,
      old_string: firstString(args.TargetContent),
      new_string: firstString(args.ReplacementContent),
    };
  }
  if (toolName === 'MultiEdit') {
    const chunks = Array.isArray(args.ReplacementChunks) ? args.ReplacementChunks : [];
    return {
      file_path: filePath,
      edits: chunks.map(chunk => ({
        file_path: filePath,
        old_string: firstString(chunk && chunk.TargetContent),
        new_string: firstString(chunk && chunk.ReplacementContent),
      })),
    };
  }
  return { file_path: filePath };
}

function realDirectoryPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return '';
  try {
    const realPath = fs.realpathSync(value);
    return fs.statSync(realPath).isDirectory() ? realPath : '';
  } catch (_error) {
    return '';
  }
}

function isContainedPath(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function resolveTrustedCwd(input, suppliedCwd) {
  const workspaceRoots = Array.isArray(input && input.workspacePaths)
    ? input.workspacePaths.map(realDirectoryPath).filter(Boolean)
    : [];
  if (workspaceRoots.length === 0) return '';
  if (!suppliedCwd) return workspaceRoots[0];

  const realCwd = realDirectoryPath(suppliedCwd);
  return realCwd && workspaceRoots.some(root => isContainedPath(realCwd, root))
    ? realCwd
    : '';
}

function transformPreToolUse(input, options = {}) {
  const toolCall = input && typeof input.toolCall === 'object' && !Array.isArray(input.toolCall)
    ? input.toolCall
    : {};
  const args = toolCall.args && typeof toolCall.args === 'object' && !Array.isArray(toolCall.args)
    ? toolCall.args
    : {};
  const antigravityToolName = typeof toolCall.name === 'string' ? toolCall.name : '';
  const cwd = resolveTrustedCwd(input, firstString(args.Cwd));
  const common = {
    session_id: typeof input?.conversationId === 'string' ? input.conversationId : '',
    cwd,
    _antigravity: { tool_name: antigravityToolName },
  };

  if (antigravityToolName === COMMAND_TOOL) {
    const command = firstString(args.CommandLine);
    const shellTool = (options.platform || process.platform) === 'win32'
      || classifyPowerShellDestructiveCommand(command).length > 0
      ? 'PowerShell'
      : 'Bash';
    return {
      tool_name: shellTool,
      tool_input: { command },
      ...common,
    };
  }

  const toolName = WRITE_TOOL_MAP[antigravityToolName] || antigravityToolName;
  return { tool_name: toolName, tool_input: buildFileToolInput(toolName, args), ...common };
}

function parseDenyReason(result) {
  if (!result || typeof result !== 'object') return '';
  if (Number.isInteger(result.exitCode) && result.exitCode !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    return stderr || 'ECC security policy denied this tool call.';
  }
  if (typeof result.stdout !== 'string' || !result.stdout) {
    return typeof result.stderr === 'string' && result.stderr.trim()
      ? 'ECC security policy could not complete this tool check.'
      : '';
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const output = parsed && parsed.hookSpecificOutput;
    return output && output.permissionDecision === 'deny'
      ? firstString(output.permissionDecisionReason, 'ECC security policy denied this tool call.')
      : '';
  } catch (_error) {
    return 'ECC security policy could not complete this tool check.';
  }
}

function sanitizeReason(reason) {
  return String(reason || 'ECC security policy denied this tool call.')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, 2000);
}

function hasValidSupportedToolInput(input, translated) {
  const args = input.toolCall.args;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  if (translated.tool_name === 'Bash' || translated.tool_name === 'PowerShell') {
    return typeof args.CommandLine === 'string' && args.CommandLine.trim().length > 0;
  }
  if (typeof args.TargetFile !== 'string' || args.TargetFile.trim().length === 0) {
    return false;
  }
  if (translated.tool_name === 'Write') {
    return typeof args.CodeContent === 'string';
  }
  if (translated.tool_name === 'Edit') {
    return typeof args.TargetContent === 'string'
      && typeof args.ReplacementContent === 'string';
  }
  if (translated.tool_name === 'MultiEdit') {
    return Array.isArray(args.ReplacementChunks)
      && args.ReplacementChunks.length > 0
      && args.ReplacementChunks.every(chunk => (
        chunk
        && typeof chunk === 'object'
        && !Array.isArray(chunk)
        && typeof chunk.TargetContent === 'string'
        && typeof chunk.ReplacementContent === 'string'
      ));
  }
  return true;
}

function createHookEnvironment(options) {
  return Object.freeze({
    ...(options.env || process.env),
    ECC_PLUGIN_ROOT: options.env?.ECC_PLUGIN_ROOT
      || process.env.ECC_PLUGIN_ROOT
      || RUNTIME_ROOT,
  });
}

function selectSecurityChecks(toolName, hookEnvironment) {
  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const blockNoVerifyEnabled = isHookEnabled('pre:bash:block-no-verify', {
      env: hookEnvironment,
      profiles: 'minimal,standard,strict',
    });
    const gateGuardHookId = toolName === 'PowerShell'
      ? 'pre:powershell:gateguard-fact-force'
      : 'pre:bash:gateguard-fact-force';
    const gateGuardEnabled = isHookEnabled(gateGuardHookId, {
      env: hookEnvironment,
      profiles: 'standard,strict',
    });
    return [
      ...(blockNoVerifyEnabled ? [require('./block-no-verify').run] : []),
      ...(gateGuardEnabled ? [require('./gateguard-fact-force').run] : []),
    ];
  }
  if (['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
    const configProtectionEnabled = isHookEnabled('pre:config-protection', {
      env: hookEnvironment,
      profiles: 'standard,strict',
    });
    const gateGuardEnabled = isHookEnabled('pre:edit-write:gateguard-fact-force', {
      env: hookEnvironment,
      profiles: 'standard,strict',
    });
    return [
      ...(configProtectionEnabled ? [require('./config-protection').run] : []),
      ...(gateGuardEnabled ? [require('./gateguard-fact-force').run] : []),
    ];
  }
  return [];
}

function evaluateSecurityChecks(checks, raw) {
  for (const check of checks) {
    try {
      const reason = parseDenyReason(check(raw));
      if (reason) return { decision: 'deny', reason: sanitizeReason(reason) };
    } catch (_error) {
      return {
        decision: 'deny',
        reason: 'ECC security hook failed to inspect this tool call. Retry after reviewing the operation.',
      };
    }
  }
  return { decision: 'ask' };
}

function runPreToolUse(input, options = {}) {
  if (!input.toolCall || typeof input.toolCall !== 'object' || Array.isArray(input.toolCall)) {
    return { decision: 'deny', reason: 'ECC security hook received an invalid tool request.' };
  }
  const translated = transformPreToolUse(input, options);
  if (!translated._antigravity.tool_name) {
    return { decision: 'deny', reason: 'ECC security hook received an invalid tool request.' };
  }
  if (!['Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit'].includes(translated.tool_name)) {
    return { decision: 'ask' };
  }
  if (!translated.cwd) {
    return {
      decision: 'deny',
      reason: 'ECC security hook rejected a working directory outside the declared workspace.',
    };
  }
  if (!hasValidSupportedToolInput(input, translated) && ['Bash', 'PowerShell'].includes(translated.tool_name)) {
    return { decision: 'deny', reason: 'ECC security hook received an invalid command request.' };
  }
  if (!hasValidSupportedToolInput(input, translated)) {
    return { decision: 'deny', reason: 'ECC security hook received an invalid file-write request.' };
  }
  const raw = JSON.stringify(translated);
  const checks = selectSecurityChecks(translated.tool_name, createHookEnvironment(options));
  return evaluateSecurityChecks(checks, raw);
}

async function main() {
  const { raw, truncated, incomplete } = await readStdinBounded();
  if (truncated || incomplete) {
    return {
      decision: 'deny',
      reason: 'ECC security hook received incomplete input. Retry with a smaller tool request.',
    };
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch (_error) {
    return {
      decision: 'deny',
      reason: 'ECC security hook could not parse the Antigravity tool request.',
    };
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { decision: 'deny', reason: 'ECC security hook received an invalid tool request.' };
  }
  return runPreToolUse(input);
}

if (require.main === module) {
  main()
    .then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(() => {
      process.stdout.write(`${JSON.stringify({
        decision: 'deny',
        reason: 'ECC security hook failed closed while inspecting this tool call.',
      })}\n`);
    });
}

module.exports = {
  MAX_STDIN_BYTES,
  parseDenyReason,
  readStdinBounded,
  runPreToolUse,
  transformPreToolUse,
};
