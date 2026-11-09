'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { isHookEnabled } = require('./hook-flags');
const { normalizePayload } = require('./copilot-sessions');
const { readSessionEvents } = require('./copilot-native-events');
const ID = 'stop:desktop-notify';
const COMPACT_ID = 'pre:edit-write:suggest-compact';
const COMPLETED = 'Response completed';
const COMPACT_SUGGESTION = 'Response completed. After many tool calls, consider /compact at a task boundary.';
const TITLE = 'ECC Copilot';
const TIMEOUT_MS = 750;

function provider(platform, env) {
  if (platform === 'darwin') return { command: '/usr/bin/osascript',
    args: body => ['-e', `display notification "${body}" with title "${TITLE}"`] };
  if (platform === 'win32') {
    const root = typeof env.SystemRoot === 'string' && /^[A-Za-z]:\\[^\r\n\0]+$/.test(env.SystemRoot)
      ? env.SystemRoot : 'C:\\Windows';
    return { command: path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: body => ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; Import-Module BurntToast -ErrorAction Stop; New-BurntToastNotification -Text '${TITLE}', '${body}' -ErrorAction Stop`] };
  }
  if (platform === 'linux' && (env.DISPLAY || env.WAYLAND_DISPLAY)) {
    return { command: '/usr/bin/notify-send', args: body => ['--app-name', TITLE, '--expire-time', '3000', TITLE, body] };
  }
  return null;
}
function processEnvironment(env) {
  const keys = ['SystemRoot', 'WINDIR', 'USERPROFILE', 'HOME', 'TEMP', 'TMP', 'DISPLAY',
    'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'];
  return Object.fromEntries(keys.filter(key => typeof env[key] === 'string').map(key => [key, env[key]]));
}
function eventTime(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value
    : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      ? Date.parse(value) : NaN;
}

function supportedRecord(event, stopTime) {
  if (event.ephemeral || event.agentId || event.data?.parentToolCallId) return false;
  const timestamp = eventTime(event.timestamp);
  return Number.isFinite(timestamp) && timestamp <= stopTime;
}

function countBucket(count) {
  return count < 50 ? -1 : Math.floor((count - 50) / 25);
}

function completedCall(data) {
  return typeof data?.success === 'boolean' && typeof data.toolCallId === 'string'
    && data.toolCallId.length > 0 && data.toolCallId.length <= 256;
}

function crossedCompactThreshold(events, stopTime) {
  const calls = new Set();
  let compacting = false;
  let beforeTurn = null;
  let atCompaction = 0;
  for (const event of events) {
    if (!supportedRecord(event, stopTime)) continue;
    const data = event.data;
    switch (event.type) {
      case 'assistant.turn_start':
        beforeTurn = typeof data?.turnId === 'string' && data.turnId ? calls.size - atCompaction : null;
        break;
      case 'session.compaction_start': compacting = true; break;
      case 'session.compaction_complete':
        compacting = typeof data?.success !== 'boolean';
        if (data?.success === true) {
          atCompaction = calls.size;
          if (beforeTurn !== null) beforeTurn = 0;
        }
        break;
      case 'tool.execution_complete':
        if (completedCall(data)) calls.add(data.toolCallId);
        break;
      default: break;
    }
  }
  return !compacting && beforeTurn !== null && countBucket(calls.size - atCompaction) > countBucket(beforeTurn);
}

function compactSuggestion(payload, env) {
  if (env.ECC_COPILOT_COMPACT_SUGGESTIONS !== '1' || (payload?.stop_hook_active !== undefined && payload.stop_hook_active !== false)
    || !isHookEnabled(COMPACT_ID, { env, profiles: ['standard', 'strict'] })) return false;
  try {
    const { id, workspace, transcriptPath } = normalizePayload(payload);
    const timestamp = eventTime(payload.timestamp);
    if (!Number.isFinite(timestamp) || !path.isAbsolute(transcriptPath ?? '')) return false;
    const { events } = readSessionEvents(id, workspace, env, transcriptPath);
    return crossedCompactThreshold(events, timestamp);
  } catch { return false; }
}

// This API accepts no caller-provided toast body. The lifecycle variant uses
// bounded journal metadata to choose between two fixed messages.
function notifyLifecycle(event, payload, env = process.env, options = {}) {
  if (event !== 'agentStop') return { status: 'not-applicable', exitCode: 0 };
  const cleanEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('CLAUDE_')));
  if (cleanEnv.ECC_COPILOT_NOTIFICATIONS !== '1' ||
      !isHookEnabled(ID, { env: cleanEnv, profiles: ['standard', 'strict'] })) return { status: 'disabled', exitCode: 0 };
  const platform = options.platform || process.platform;
  const selected = provider(platform, cleanEnv);
  if (!selected) return { status: 'unavailable', exitCode: 0 };
  const body = compactSuggestion(payload, cleanEnv) ? COMPACT_SUGGESTION : COMPLETED;
  try {
    const result = (options.runner || spawnSync)(selected.command, selected.args(body), {
      shell: false, windowsHide: true, stdio: 'ignore', timeout: TIMEOUT_MS,
      killSignal: 'SIGKILL', env: processEnvironment(cleanEnv),
    });
    if (result.error?.code === 'ENOENT') return { status: 'unavailable', exitCode: 0 };
    if (result.error?.code === 'ETIMEDOUT') return { status: 'timeout', exitCode: 0 };
    return { status: !result.error && result.status === 0 ? 'sent' : 'failed', exitCode: 0 };
  } catch { return { status: 'failed', exitCode: 0 }; }
}
function notify(event, env = process.env, options = {}) {
  return notifyLifecycle(event, null, env, options);
}

module.exports = { notify, notifyLifecycle };
