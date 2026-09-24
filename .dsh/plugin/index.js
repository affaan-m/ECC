/**
 * cc-hooks — run an unmodified Claude Code `hooks.json` on every DeepSeek
 * Harness extension point, including the events the shipped
 * `dsh-hooks-claude-code` bridge does not cover, so a hook library such as
 * Everything Claude Code works in full.
 *
 * Four gaps are closed relative to the shipped bridge:
 *
 * 1. **Tool-name translation.** DSH tools are lowercase (`bash`, `edit`,
 *    `write`); Claude Code matchers are `Bash`, `Edit|Write|MultiEdit`. A group
 *    matches when the pattern selects either the DSH name or its Claude Code
 *    alias, and payloads carry the alias so hooks keep their own logic.
 * 2. **PreToolUse context is delivered.** DSH's `PreToolDecision` has no context
 *    field, so a PreToolUse hook's `additionalContext` is buffered per call and
 *    attached to that call's result at `tools/post-execute`, where
 *    `PostToolDecision.additionalContexts` exists.
 * 3. **The missing events.** `PostToolUseFailure` ← `result.isError` at
 *    post-execute; `PreCompact` ← `session/event` → `compaction/start`;
 *    `SessionEnd` ← `session/disposed`.
 * 4. **`transcript_path` is populated.** Each payload carries a best-effort
 *    Claude Code JSONL transcript rendered from `sessionQuery.readSurface`,
 *    written under `<dshHome>/cc-hooks/transcripts/<session-id>.jsonl` and
 *    refreshed on a throttle, so transcript-reading hooks see real content.
 *
 * Zero package dependencies: the Claude Code hook protocol helpers (matcher,
 * codec, merge, runner) are vendored below with the same semantics as
 * `@deepseek-ai/dsh-hook-protocol`, because an out-of-tree bundle cannot rely on
 * the harness's bundled module tree. Execution goes through `ctx.shell`, the
 * sanctioned seam, so sandbox policy and output limits still apply.
 *
 * Failure containment: every listener body is wrapped, a hook that cannot run
 * becomes a non-blocking outcome, and a listener that cannot do its job
 * delegates with `next()` rather than blocking a turn.
 *
 * @module dsh-cc-hooks
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const name = 'cc-hooks';
/** `shell` runs hook commands; `sessionQuery` is looked up lazily for transcripts. */
export const inject = ['shell'];

const CONTEXT_SOURCE = { kind: 'cc-hooks' };
const SUBAGENT_TYPE = 'general-purpose';
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_TRANSCRIPT_TTL_MS = 20_000;
const DEFAULT_TRANSCRIPT_MAX_BYTES = 8 * 1024 * 1024;
const MAX_HOOKS_PER_POINT = 16;
const LOG_MAX_BYTES = 512 * 1024;
/**
 * Longest a step will wait for an in-flight PreCompact hook. The harness offers
 * no awaited pre-compaction point, so a hook cannot delay the summary; it can
 * still be guaranteed to receive a pre-compaction transcript and to finish
 * before the next model step. Beyond this bound the step proceeds and the wait
 * is logged, so a hung hook cannot stall the session.
 */
const PRECOMPACT_WAIT_MS = 30_000;

const SUPPORTED_POINTS = new Set([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PreCompact',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'SessionEnd',
]);

/** Events that select hooks by a subject (a tool name, a session source). */
const MATCHED_POINTS = new Set(['SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop']);

/** DSH tool name → the Claude Code tool name a matcher or payload expects. */
const CC_TOOL_ALIAS = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  skill: 'Skill',
  web_fetch: 'WebFetch',
  web_search: 'WebSearch',
  todo_write: 'TodoWrite',
  present: 'Present',
  subagent: 'Task',
  subagent_fork: 'Task',
  workflow: 'Workflow',
  ask_user_question: 'AskUserQuestion',
  read_image: 'ReadImage',
  job_output: 'JobOutput',
  job_list: 'JobList',
  job_kill: 'JobKill',
  send_message: 'SendMessage',
  spawn_teammate: 'SpawnTeammate',
  wait_agent: 'WaitAgent',
  interrupt_agent: 'InterruptAgent',
  list_agents: 'ListAgents',
  team_task_create: 'TeamTaskCreate',
  team_task_list: 'TeamTaskList',
  team_task_get: 'TeamTaskGet',
  team_task_update: 'TeamTaskUpdate',
  create_goal: 'CreateGoal',
  get_goal: 'GetGoal',
  update_goal: 'UpdateGoal',
  exit_plan_mode: 'ExitPlanMode',
  plugin_manager: 'PluginManager',
  cordis_inspect_list: 'CordisInspectList',
  cordis_inspect_query: 'CordisInspectQuery',
};

/* ------------------------------------------------------------------ *
 * Claude Code hook protocol, vendored (semantics: dsh-hook-protocol)
 * ------------------------------------------------------------------ */

/** True for an absent / empty / `'*'` pattern — the match-all sentinels. */
function isMatchAll(matcher) {
  return matcher === undefined || matcher === '' || matcher === '*';
}

/** A Claude-literal pattern is purely word characters plus `|`. */
const CLAUDE_LITERAL = /^[A-Za-z0-9_|]+$/;

/** Patterns longer than this are treated as non-matches instead of compiled. */
const MAX_MATCHER_LENGTH = 200;

/**
 * Compile an unanchored matcher regex; invalid patterns return `undefined`.
 * Matchers come from the user's own hooks.json and keep upstream's regex
 * semantics, but a length cap contains the ReDoS surface a non-literal
 * `RegExp` would otherwise expose (CWE-1333).
 */
function compileRegex(pattern) {
  if (typeof pattern !== 'string' || pattern.length > MAX_MATCHER_LENGTH) return undefined;
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

/** Whether `matcher` selects `query` under Claude Code dialect rules. */
export function matchesMatcher(matcher, query) {
  if (isMatchAll(matcher)) return true;
  if (CLAUDE_LITERAL.test(matcher)) return matcher.split('|').includes(query);
  return compileRegex(matcher)?.test(query) ?? false;
}

/** A plain (non-null, non-array) object, or `undefined`. */
function plainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function stringField(object, key) {
  const value = object[key];
  return typeof value === 'string' ? value : undefined;
}

function booleanField(object, key) {
  const value = object[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** The legacy top-level `decision` is only `approve`/`block`. */
function topLevelDecisionOf(value) {
  return value === 'approve' || value === 'block' ? value : undefined;
}

/** `hookSpecificOutput.permissionDecision` is `allow`/`deny`/`ask` only. */
function permissionDecisionOf(value) {
  return value === 'allow' || value === 'deny' || value === 'ask' ? value : undefined;
}

/**
 * Decode one hook process outcome. Exit 0 may carry structured JSON or plain
 * stdout; exit 2 blocks with stderr as the reason; any other exit is a
 * non-blocking error. `expectedEventName` gates the per-event
 * `hookSpecificOutput` block, so a hook answering for another event cannot
 * claim a decision here.
 */
export function parseHookOutput(exitCode, stdout, stderr, expectedEventName) {
  const trimmedErr = (stderr ?? '').trim();
  const trimmedOut = (stdout ?? '').trim();
  const output = { exitCode, stderr: trimmedErr, stdout: trimmedOut };
  if (exitCode === 2) {
    output.decision = 'block';
    if (trimmedErr.length > 0) output.reason = trimmedErr;
  }
  if (exitCode === 0 && trimmedOut.startsWith('{')) {
    let parsed;
    try {
      parsed = plainObject(JSON.parse(trimmedOut));
    } catch {
      parsed = undefined;
    }
    if (parsed !== undefined) applyStructured(output, parsed, expectedEventName);
  }
  return output;
}

/** Fold a parsed structured-stdout object into `output` (mutates in place). */
function applyStructured(output, parsed, expectedEventName) {
  const cont = booleanField(parsed, 'continue');
  if (cont !== undefined) output.continue = cont;
  const stopReason = stringField(parsed, 'stopReason');
  if (stopReason !== undefined) output.stopReason = stopReason;
  const systemMessage = stringField(parsed, 'systemMessage');
  if (systemMessage !== undefined) output.systemMessage = systemMessage;
  const topDecision = topLevelDecisionOf(stringField(parsed, 'decision'));
  if (topDecision !== undefined) output.decision = topDecision;
  const topReason = stringField(parsed, 'reason');
  if (topReason !== undefined) output.reason = topReason;
  const hookSpecific = plainObject(parsed.hookSpecificOutput);
  if (hookSpecific === undefined) return;
  const eventName = stringField(hookSpecific, 'hookEventName');
  if (eventName !== undefined) output.hookEventName = eventName;
  if (expectedEventName !== undefined && eventName !== expectedEventName) return;
  const permission = permissionDecisionOf(stringField(hookSpecific, 'permissionDecision'));
  if (permission !== undefined) output.decision = permission;
  const permissionReason = stringField(hookSpecific, 'permissionDecisionReason');
  if (permissionReason !== undefined) output.reason = permissionReason;
  const additionalContext = stringField(hookSpecific, 'additionalContext');
  if (additionalContext !== undefined) output.additionalContext = additionalContext;
  const updatedInput = plainObject(hookSpecific.updatedInput);
  if (updatedInput !== undefined) output.updatedInput = updatedInput;
}

function rank(decision) {
  switch (decision) {
    case 'deny':
    case 'block':
      return 3;
    case 'ask':
      return 2;
    case 'approve':
    case 'allow':
      return 1;
    default:
      return 0;
  }
}

function decisionForRank(maxRank) {
  switch (maxRank) {
    case 3:
      return 'deny';
    case 2:
      return 'ask';
    case 1:
      return 'allow';
    default:
      return 'none';
  }
}

/** Fold decoded outputs into one most-restrictive outcome (`deny > ask > allow`). */
export function mergeHookOutputs(outputs) {
  let maxRank = 0;
  const reasonsByRank = new Map();
  let stop = false;
  let stopReason;
  const additionalContext = [];
  const systemMessages = [];
  for (const output of outputs) {
    const outputRank = rank(output.decision);
    if (outputRank > maxRank) maxRank = outputRank;
    if ((outputRank === 3 || outputRank === 2) && typeof output.reason === 'string' && output.reason.length > 0) {
      const list = reasonsByRank.get(outputRank) ?? [];
      list.push(output.reason);
      reasonsByRank.set(outputRank, list);
    }
    if (output.continue === false && !stop) {
      stop = true;
      if (output.stopReason !== undefined) stopReason = output.stopReason;
    }
    if (typeof output.additionalContext === 'string' && output.additionalContext.length > 0) additionalContext.push(output.additionalContext);
    if (typeof output.systemMessage === 'string' && output.systemMessage.length > 0) systemMessages.push(output.systemMessage);
  }
  const reasons = reasonsByRank.get(maxRank) ?? [];
  return {
    decision: decisionForRank(maxRank),
    ...(reasons.length > 0 ? { reason: reasons.join('\n\n') } : {}),
    stop,
    ...(stopReason !== undefined ? { stopReason } : {}),
    additionalContext,
    systemMessages,
  };
}

/**
 * Run one command hook through `ctx.shell` and decode its outcome. Never
 * throws: an infrastructure rejection becomes an outcome with no exit code.
 */
export async function runHookCommand(shell, hook, options) {
  const started = performance.now();
  const request = {
    command: hook.command,
    timeoutMs: hook.timeoutSec !== undefined ? hook.timeoutSec * 1000 : options.defaultTimeoutMs,
    stdin: `${JSON.stringify(options.payload)}${options.trailingNewline ? '\n' : ''}`,
    signal: options.signal,
    ...(options.cwd !== undefined ? { workdir: options.cwd } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
  };
  try {
    const result = await (await shell.execute(shell.resolve(request))).result();
    return {
      output: parseHookOutput(
        result.exitCode ?? undefined,
        result.stdout?.text ?? '',
        result.stderr?.text ?? '',
        options.expectedEventName,
      ),
      durationMs: performance.now() - started,
    };
  } catch (error) {
    return {
      output: parseHookOutput(undefined, '', error instanceof Error ? error.message : String(error), options.expectedEventName),
      durationMs: performance.now() - started,
    };
  }
}

/* --------------------------------- *
 * hooks.json parsing and translation
 * --------------------------------- */

/** Replace `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` in a command. */
export function substitute(command, vars) {
  let out = command;
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === 'string') out = out.split(`\${${key}}`).join(value);
  }
  return out;
}

/**
 * Parse a Claude Code hooks.json into the points this plugin serves. Command
 * hooks are kept and their `timeout` (seconds) normalized; every other handler
 * type and every event without a DSH hook point is reported to the caller.
 */
export function parseHooks(raw, vars = {}) {
  const parsed = {};
  const skippedEvents = [];
  const skippedHandlers = [];
  const events = raw?.hooks;
  if (events === null || typeof events !== 'object') throw new Error('config has no "hooks" object');
  for (const [event, groups] of Object.entries(events)) {
    if (!SUPPORTED_POINTS.has(event)) {
      skippedEvents.push(event);
      continue;
    }
    const kept = [];
    for (const group of Array.isArray(groups) ? groups : []) {
      const hooks = [];
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        if (hook?.type !== 'command' || typeof hook.command !== 'string') {
          skippedHandlers.push(`${event}:${hook?.type ?? 'unknown'}`);
          continue;
        }
        hooks.push({
          command: substitute(hook.command, vars),
          ...(typeof hook.timeout === 'number' ? { timeoutSec: hook.timeout } : {}),
        });
      }
      if (hooks.length > 0) {
        kept.push({ ...(typeof group?.matcher === 'string' ? { matcher: group.matcher } : {}), hooks });
      }
    }
    if (kept.length > 0) parsed[event] = kept;
  }
  return { parsed, skippedEvents, skippedHandlers };
}

/** A matcher selects a tool when it matches the DSH name or its Claude Code alias. */
export function matchesTool(matcher, dshName) {
  if (isMatchAll(matcher)) return true;
  if (matchesMatcher(matcher, dshName)) return true;
  const alias = CC_TOOL_ALIAS[dshName];
  return alias !== undefined && matchesMatcher(matcher, alias);
}

/** Claude Code-shaped `tool_input` for a DSH tool call. */
export function ccToolInput(dshName, args) {
  const input = args !== null && typeof args === 'object' ? args : {};
  switch (dshName) {
    case 'bash':
      return { command: input.command, ...(input.description !== undefined ? { description: input.description } : {}) };
    case 'skill':
      return { skill: input.name, args: '' };
    case 'web_search':
      return { query: Array.isArray(input.queries) ? input.queries.join(' ') : String(input.queries ?? '') };
    case 'grep':
      return {
        pattern: input.pattern,
        ...(input.path !== undefined ? { path: input.path } : {}),
        ...(input.include !== undefined ? { glob: input.include } : {}),
      };
    default:
      return input;
  }
}

/** Claude Code-shaped `tool_response`; Bash hooks read `{stdout, stderr}`. */
export function ccToolResponse(dshName, text) {
  if (dshName === 'bash') return { stdout: text, stderr: '', interrupted: false };
  return text;
}

/** Flatten content blocks to their text. */
export function blocksToText(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

/** Build one user message for injected context (shape of `createUserMessage`). */
function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: CONTEXT_SOURCE,
  };
}

/* --------------- *
 * Plugin entry
 * --------------- */

export function apply(ctx, config) {
  if (typeof config?.configPath !== 'string' || config.configPath === '') {
    ctx.logger?.warn?.('cc-hooks: configPath is required; no hooks registered');
    return;
  }
  const dshHome = typeof config.dshHome === 'string' && config.dshHome !== ''
    ? config.dshHome
    : (process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const logPath = typeof config.logPath === 'string' && config.logPath !== ''
    ? config.logPath
    : join(dshHome, 'cc-hooks', 'cc-hooks.log');
  const transcriptDir = typeof config.transcriptDir === 'string' && config.transcriptDir !== ''
    ? config.transcriptDir
    : join(dshHome, 'cc-hooks', 'transcripts');
  const transcriptEnabled = config.transcript !== 'off';
  const transcriptTtlMs = typeof config.transcriptTtlMs === 'number' ? config.transcriptTtlMs : DEFAULT_TRANSCRIPT_TTL_MS;
  const transcriptMaxBytes = typeof config.transcriptMaxBytes === 'number' ? config.transcriptMaxBytes : DEFAULT_TRANSCRIPT_MAX_BYTES;
  const defaultTimeoutMs = typeof config.defaultTimeoutMs === 'number' ? config.defaultTimeoutMs : DEFAULT_TIMEOUT_MS;
  const maxHooksPerPoint = typeof config.maxHooksPerPoint === 'number' ? config.maxHooksPerPoint : MAX_HOOKS_PER_POINT;
  const precompactWaitMs = typeof config.precompactWaitMs === 'number' ? config.precompactWaitMs : PRECOMPACT_WAIT_MS;
  const vars = {
    ...(typeof config.pluginRoot === 'string' ? { CLAUDE_PLUGIN_ROOT: config.pluginRoot } : {}),
    ...(typeof config.projectDir === 'string' ? { CLAUDE_PROJECT_DIR: config.projectDir } : {}),
  };
  const hookEnv = { ...(config.env ?? {}) };
  // Hooks that resolve their own plugin root at runtime (ECC's `node -e`
  // bootstrap) read this variable, so export it as well as substitute it.
  if (typeof config.pluginRoot === 'string') hookEnv.CLAUDE_PLUGIN_ROOT = config.pluginRoot;
  if (typeof config.projectDir === 'string') hookEnv.CLAUDE_PROJECT_DIR = config.projectDir;

  /** Append one diagnostic line, rotating the file first when it grows past the cap. */
  function log(entry) {
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      try {
        if (statSync(logPath).size > LOG_MAX_BYTES) renameSync(logPath, `${logPath}.1`);
      } catch {
        /* absent log: nothing to rotate */
      }
      writeFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { flag: 'a' });
    } catch {
      /* diagnostics never break a turn */
    }
  }

  let parsed = {};
  try {
    const result = parseHooks(JSON.parse(readFileSync(config.configPath, 'utf8')), vars);
    parsed = result.parsed;
    if (result.skippedEvents.length > 0) log({ event: 'unsupported-events', points: result.skippedEvents });
    if (result.skippedHandlers.length > 0) log({ event: 'unsupported-handlers', handlers: result.skippedHandlers });
  } catch (error) {
    ctx.logger?.warn?.(`cc-hooks: could not load "${config.configPath}": ${String(error)} — no hooks registered`);
    log({ event: 'config-error', message: String(error) });
    return;
  }
  const counts = Object.fromEntries(Object.entries(parsed).map(([point, groups]) => [point, groups.reduce((n, group) => n + group.hooks.length, 0)]));
  log({ event: 'mounted', configPath: config.configPath, points: counts });

  const detachedAbort = new AbortController();
  ctx.effect(() => () => detachedAbort.abort(), 'cc-hooks: abort detached hook runs');

  const transcripts = new Map();
  const preContext = new Map();
  const compactionSeen = new Set();
  /** Sessions whose Stop hook already forced another step this turn. */
  const stopReentry = new Set();
  /** In-flight PreCompact runs, awaited by the next step for that session. */
  const pendingPreCompact = new Map();
  let handlerCounter = 0;

  /** Run every matching hook for one point and fold the outcomes. */
  async function runPoint(point, matchQuery, payload, opts = {}) {
    const groups = parsed[point] ?? [];
    const outputs = [];
    let handlers = 0;
    // ECC hooks (observer leases, session cleanup) read the session id from the
    // environment, so every run carries it alongside the payload field.
    const runEnv = {
      ...hookEnv,
      ...(typeof payload?.session_id === 'string' && payload.session_id !== '' ? { CLAUDE_SESSION_ID: payload.session_id } : {}),
      ...(opts.env ?? {}),
    };
    for (const group of groups) {
      if (MATCHED_POINTS.has(point) && !matchesTool(group.matcher, matchQuery)) continue;
      for (const hook of group.hooks) {
        if (handlers >= maxHooksPerPoint) break;
        handlers += 1;
        const { output, durationMs } = await runHookCommand(ctx.shell, hook, {
          payload,
          defaultTimeoutMs,
          ...(Object.keys(runEnv).length > 0 ? { env: runEnv } : {}),
          ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
          signal: opts.signal ?? detachedAbort.signal,
          trailingNewline: true,
          expectedEventName: point,
        });
        outputs.push(output);
        if (output.updatedInput !== undefined) {
          // DSH's PreToolDecision cannot rewrite arguments; surface it instead of dropping it.
          log({ event: 'unsupported-updated-input', point });
        }
        log({
          event: 'hook',
          point,
          handler: `${point}:${++handlerCounter}`,
          exitCode: output.exitCode ?? null,
          decision: output.decision ?? null,
          context: (output.additionalContext ?? '').length,
          durationMs: Math.round(durationMs),
        });
      }
    }
    return mergeHookOutputs(outputs);
  }

  function contextFrom(merged) {
    if (merged.additionalContext.length === 0) return undefined;
    return userMessage(merged.additionalContext.join('\n\n'));
  }

  /**
   * Best-effort Claude Code transcript for one session, throttled per session.
   * `fresh` bypasses the throttle: lifecycle points (Stop, PreCompact, SessionEnd)
   * must see the tool results that just happened, not a 20-second-old file.
   */
  async function transcriptFor(sessionId, fresh = false) {
    if (!transcriptEnabled || typeof sessionId !== 'string' || sessionId === '') return '';
    const cached = transcripts.get(sessionId);
    const now = Date.now();
    if (!fresh && cached !== undefined && now - cached.at < transcriptTtlMs) return cached.path;
    let path = cached?.path ?? '';
    try {
      const query = ctx.get('sessionQuery');
      const snapshot = await query.readSurface(sessionId);
      const header = snapshot?.session;
      const lines = [];
      for (const event of snapshot?.events ?? []) {
        const entry = transcriptEntry(event, sessionId, header?.cwd);
        if (entry !== undefined) lines.push(JSON.stringify(entry));
      }
      if (lines.length > 0) {
        const text = `${lines.join('\n')}\n`;
        if (text.length <= transcriptMaxBytes) {
          mkdirSync(transcriptDir, { recursive: true });
          path = join(transcriptDir, `${sessionId}.jsonl`);
          writeFileSync(path, text);
        }
      }
    } catch (error) {
      log({ event: 'transcript-failed', message: String(error) });
    }
    transcripts.set(sessionId, { at: now, path });
    return path;
  }

  function transcriptEntry(event, sessionId, cwd) {
    const time = typeof event?.time === 'number' ? new Date(event.time).toISOString() : new Date().toISOString();
    const uuid = `${sessionId}:${event?.seq ?? 0}`;
    switch (event?.type) {
      case 'user/message':
        return { type: 'user', message: { role: 'user', content: event.data?.content ?? [] }, uuid, sessionId, cwd, timestamp: time };
      case 'assistant/message': {
        // Model and usage are what cost-tracking hooks read; dropping them makes
        // every session report an unknown model with zero tokens.
        const message = event.data?.message ?? {};
        // DSH keeps the model on the message's source (`message.source.model`,
        // verified against a live session log), with `request/header` carrying
        // the same value under `header.config.model`.
        const model = message.model ?? message.source?.model ?? event.data?.model;
        return {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: message.content ?? [],
            ...(model !== undefined ? { model } : {}),
            ...(event.data?.usage !== undefined ? { usage: event.data.usage } : message.usage !== undefined ? { usage: message.usage } : {}),
          },
          uuid,
          sessionId,
          cwd,
          timestamp: time,
        };
      }
      case 'tool/result':
        return { type: 'user', message: { role: 'user', content: event.data?.message?.content ?? [] }, uuid, sessionId, cwd, timestamp: time };
      default:
        return undefined;
    }
  }

  async function basePayload(event, agent, extra = {}) {
    const header = agent?.session?.header;
    const sessionId = header?.id ?? extra.sessionId ?? '';
    return {
      session_id: sessionId,
      transcript_path: await transcriptFor(sessionId, extra.fresh === true),
      cwd: header?.cwd ?? config.projectDir ?? process.cwd(),
      hook_event_name: event,
      ...(extra.fields ?? {}),
    };
  }

  ctx.on('agent/created', async ({ agent, source, signal }) => {
    try {
      const merged = await runPoint('SessionStart', source, await basePayload('SessionStart', agent, { fields: { source } }), { signal });
      const context = contextFrom(merged);
      if (context !== undefined) agent.inject(context);
    } catch (error) {
      ctx.logger?.warn?.(`cc-hooks: SessionStart failed: ${String(error)}`);
    }
  });

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    try {
      if (messages.length === 0) return next();
      const sessionId = agent?.session?.header?.id;
      // Compaction is not awaitable, but the state a PreCompact hook saves must
      // be on disk before work continues; wait for it, bounded.
      const pending = typeof sessionId === 'string' ? pendingPreCompact.get(sessionId) : undefined;
      if (pending !== undefined) {
        let bound;
        const settled = await Promise.race([
          pending.then(() => true, () => true),
          // Cleared as soon as the hook wins the race, so no bound timer lingers
          // for the whole window after the wait is over.
          new Promise((resolve) => { bound = setTimeout(() => resolve(false), precompactWaitMs); }),
        ]);
        clearTimeout(bound);
        if (!settled) log({ event: 'precompact-wait-timeout', sessionId, ms: precompactWaitMs });
      }
      if (typeof sessionId === 'string') stopReentry.delete(sessionId);
      const payload = await basePayload('UserPromptSubmit', agent, {
        fields: { prompt: blocksToText(messages.flatMap((message) => message.content)) },
      });
      const merged = await runPoint('UserPromptSubmit', '', payload, { signal });
      if (merged.decision === 'deny') return { kind: 'reject' };
      const downstream = await next();
      const context = contextFrom(merged);
      if (context === undefined || downstream.kind !== 'enter') return downstream;
      return { ...downstream, messages: [...downstream.messages, context] };
    } catch (error) {
      log({ event: 'listener-failed', point: 'UserPromptSubmit', message: String(error) });
      return next();
    }
  });

  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const payload = await basePayload('PreToolUse', exec.agent, {
        fields: {
          tool_name: CC_TOOL_ALIAS[exec.name] ?? exec.name,
          tool_input: ccToolInput(exec.name, exec.arguments),
          tool_use_id: exec.callId,
        },
      });
      const merged = await runPoint('PreToolUse', exec.name, payload, { signal: exec.signal, cwd: exec.agent?.session?.header?.cwd });
      if (merged.additionalContext.length > 0) {
        // DSH's PreToolDecision cannot carry context: hold it for this call's result.
        preContext.set(exec.callId, merged.additionalContext);
      }
      // Claude Code's `continue: false` stops the run; the closest DSH mapping is
      // a denial, so it must short-circuit before next().
      if (merged.stop) {
        return { kind: 'deny', reason: merged.stopReason ?? merged.reason ?? 'stopped by PreToolUse hook' };
      }
      if (merged.decision === 'deny') return { kind: 'deny', reason: merged.reason ?? 'blocked by PreToolUse hook' };
      if (merged.decision === 'ask') return { kind: 'ask', ...(merged.reason !== undefined ? { reason: merged.reason } : {}) };
      return next();
    } catch (error) {
      log({ event: 'listener-failed', point: 'PreToolUse', message: String(error) });
      return next();
    }
  });

  ctx.on('tools/post-execute', async (exec, result, next) => {
    try {
      const text = blocksToText(result?.content);
      const fields = {
        tool_name: CC_TOOL_ALIAS[exec.name] ?? exec.name,
        tool_input: ccToolInput(exec.name, exec.arguments),
        tool_use_id: exec.callId,
        tool_response: ccToolResponse(exec.name, text),
      };
      const cwd = exec.agent?.session?.header?.cwd;
      // Claude Code runs PostToolUse after a success and PostToolUseFailure in its
      // place on a failure; running both double-records the outcome.
      const failed = result?.isError === true;
      const point = failed ? 'PostToolUseFailure' : 'PostToolUse';
      const payload = await basePayload(point, exec.agent, {
        fields: failed ? { ...fields, error: result?.error?.message ?? text, is_interrupt: false } : fields,
      });
      const merged = await runPoint(point, exec.name, payload, { signal: exec.signal, cwd });
      const parts = [...merged.additionalContext];
      const held = preContext.get(exec.callId);
      if (held !== undefined) {
        preContext.delete(exec.callId);
        parts.unshift(...held);
      }
      const context = parts.length === 0 ? undefined : userMessage(parts.join('\n\n'));
      if (merged.decision === 'deny') {
        return {
          kind: 'block',
          feedback: [{ type: 'text', text: merged.reason ?? 'blocked by PostToolUse hook' }],
          ...(context !== undefined ? { additionalContexts: [context] } : {}),
        };
      }
      const downstream = await next();
      if (context === undefined) return downstream;
      return { ...downstream, additionalContexts: [context, ...(downstream.additionalContexts ?? [])] };
    } catch (error) {
      log({ event: 'listener-failed', point: 'PostToolUse', message: String(error) });
      return next();
    }
  });

  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    try {
      const sessionId = agent?.session?.header?.id;
      const reentry = typeof sessionId === 'string' && stopReentry.has(sessionId);
      const merged = await runPoint('Stop', '', await basePayload('Stop', agent, { fields: { stop_hook_active: reentry }, fresh: true }), { signal });
      if (merged.decision === 'deny') {
        // Claude Code stops re-firing an already-continued turn through this flag.
        if (typeof sessionId === 'string') stopReentry.add(sessionId);
        agent.steer(userMessage(merged.reason ?? 'continue: blocked by Stop hook'));
      } else if (typeof sessionId === 'string') {
        stopReentry.delete(sessionId);
      }
    } catch (error) {
      log({ event: 'listener-failed', point: 'Stop', message: String(error) });
    }
  });

  ctx.on('subagent/start', (info) => {
    void (async () => {
      try {
        const child = ctx.get('agents')?.get(info.id);
        const payload = await basePayload('SubagentStart', child, {
          fields: { agent_id: info.id, agent_type: SUBAGENT_TYPE },
          sessionId: info.id,
        });
        const merged = await runPoint('SubagentStart', SUBAGENT_TYPE, payload, { cwd: child?.session?.header?.cwd });
        const context = contextFrom(merged);
        if (context !== undefined && child !== undefined) child.inject(context);
      } catch (error) {
        log({ event: 'listener-failed', point: 'SubagentStart', message: String(error) });
      }
    })();
  });

  ctx.on('subagent/end', (info) => {
    void (async () => {
      try {
        const child = ctx.get('agents')?.get(info.id);
        const payload = await basePayload('SubagentStop', child, {
          fields: { agent_id: info.id, agent_type: SUBAGENT_TYPE, stop_hook_active: false },
          sessionId: info.id,
        });
        await runPoint('SubagentStop', SUBAGENT_TYPE, payload, { cwd: child?.session?.header?.cwd });
      } catch (error) {
        log({ event: 'listener-failed', point: 'SubagentStop', message: String(error) });
      }
    })();
  });

  ctx.on('session/event', (session, event) => {
    // DSH appends `compaction/start` when a compaction begins; Claude Code
    // fires PreCompact at the same moment, so that is the mapping.
    if (event?.type !== 'compaction/start') return;
    const id = String(event?.data?.compactionId ?? event?.seq ?? '');
    if (compactionSeen.has(id)) return;
    compactionSeen.add(id);
    const header = session?.header;
    const sessionId = header?.id ?? '';
    // Freeze the transcript here, synchronously: the summary replaces the
    // session surface moments later, so a read started after it would hand the
    // hook the compacted view instead of what it is about to summarize.
    const frozenTranscript = transcriptFor(sessionId, true);
    const run = (async () => {
      try {
        await runPoint('PreCompact', '', {
          session_id: sessionId,
          transcript_path: await frozenTranscript,
          cwd: header?.cwd ?? process.cwd(),
          hook_event_name: 'PreCompact',
          trigger: 'auto',
        }, { cwd: header?.cwd });
      } catch (error) {
        log({ event: 'listener-failed', point: 'PreCompact', message: String(error) });
      }
    })();
    if (sessionId !== '') {
      pendingPreCompact.set(sessionId, run);
      void run.finally(() => {
        if (pendingPreCompact.get(sessionId) === run) pendingPreCompact.delete(sessionId);
      });
    }
  });

  ctx.on('session/disposed', (session) => {
    void (async () => {
      try {
        const header = session?.header;
        await runPoint('SessionEnd', '', {
          session_id: header?.id ?? '',
          transcript_path: await transcriptFor(header?.id, true),
          cwd: header?.cwd ?? process.cwd(),
          hook_event_name: 'SessionEnd',
          reason: 'other',
        }, { cwd: header?.cwd });
      } catch (error) {
        log({ event: 'listener-failed', point: 'SessionEnd', message: String(error) });
      }
    })();
  });

  log({ event: 'ready', points: Object.keys(parsed) });
}
