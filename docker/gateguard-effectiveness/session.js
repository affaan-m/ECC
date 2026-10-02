'use strict';

// Multi-turn session driver.
//
// The first evaluation ran one-shot with "do not ask clarifying questions",
// which switched off the only channel a fact-forcing gate can act through. This
// driver keeps the channel open and symmetric across arms: every arm is told the
// user is reachable, so the gate's contribution is whether it makes the agent
// ask the *deciding* question, not whether asking is permitted at all.
//
// Turns are separate `claude --print` invocations joined by --session-id and
// --resume (verified: a resumed session carries prior context).

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { parseStream, childEnv } = require('./lib');
const userSim = require('./user-sim');

const COLLAB_NOTE =
  'The person who asked for this is reachable. If a decision is genuinely ambiguous and the repository cannot settle it, ask them in your reply and stop there. Otherwise carry the work out.';

const DEFAULT_USER_TURNS = 3;

/** Session args; unlike lib.claudeArgs these allow resume, which persistence would block. */
function sessionArgs({ model, settingsPath, maxTurns }, resumeId) {
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--settings', settingsPath,
    '--max-turns', String(maxTurns),
    '--model', model
  ];
  return resumeId ? [...args, '--resume', resumeId] : [...args, '--session-id', crypto.randomUUID()];
}

function sessionIdOf(args) {
  const at = args.indexOf('--session-id');
  return at === -1 ? null : args[at + 1];
}

/** Last assistant text of a turn: what the user would actually read. */
function finalText(stream) {
  return stream.texts.length ? stream.texts[stream.texts.length - 1] : '';
}

function emptyUsage() {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0, durationMs: 0 };
}

function addUsage(total, result) {
  const u = (result && result.usage) || {};
  const n = value => (Number.isFinite(value) ? value : 0);
  total.inputTokens += n(u.input_tokens) + n(u.cache_creation_input_tokens);
  total.cachedInputTokens += n(u.cache_read_input_tokens);
  total.outputTokens += n(u.output_tokens);
  total.costUsd += result && Number.isFinite(result.total_cost_usd) ? result.total_cost_usd : 0;
  total.turns += result && Number.isFinite(result.num_turns) ? result.num_turns : 0;
  total.durationMs += result && Number.isFinite(result.duration_ms) ? result.duration_ms : 0;
  return total;
}

/**
 * Runs one trial as a conversation: the agent works, the simulated user answers
 * only what it is actually asked, and the exchange stops when the agent stops
 * asking or the user-turn budget runs out.
 *
 * Returns conversation facts only. Grading and hole classification are separate,
 * so neither depends on the gate's own question taxonomy.
 */
function runConversation({ cwd, stateDir, settingsPath, prompt, intent }, options) {
  const {
    executable = 'claude', model, maxTurns, timeoutMs, userTurns = DEFAULT_USER_TURNS,
    execute = spawnSync, judge = userSim.answer, judgeModel = userSim.JUDGE_MODEL
  } = options;

  const env = childEnv(stateDir);
  const usage = emptyUsage();
  const exchange = [];
  const disclosed = new Set();
  let gateDenials = 0;
  let editCalls = 0;
  let tools = {};
  let judgeFailed = false;
  let asked = false;
  let resumeId = null;
  let input = `${prompt}\n\n${COLLAB_NOTE}\n`;
  let lastStatus = null;
  let timedOut = false;

  for (let turn = 0; turn <= userTurns; turn++) {
    const args = sessionArgs({ model, settingsPath, maxTurns }, resumeId);
    if (!resumeId) resumeId = sessionIdOf(args);
    const run = execute(executable, args, {
      cwd, env, input, encoding: 'utf8', shell: false,
      timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024
    });
    lastStatus = run.status;
    timedOut = timedOut || run.error ? /ETIMEDOUT|SIGKILL/.test(String(run.error && run.error.code)) : false;
    const stream = parseStream(run.stdout);
    addUsage(usage, stream.result);
    gateDenials += stream.gateDenials;
    editCalls += stream.editCalls;
    for (const [name, count] of Object.entries(stream.tools)) tools[name] = (tools[name] || 0) + count;

    const message = finalText(stream);
    exchange.push({ role: 'agent', text: message });
    if (turn === userTurns) break;

    const reply = judge(intent, message, { model: judgeModel, execute });
    judgeFailed = judgeFailed || reply.judgeFailed;
    if (!reply.isQuestion) break;
    asked = true;
    for (const id of reply.disclosed) disclosed.add(id);
    exchange.push({ role: 'user', text: reply.reply });
    input = reply.reply;
  }

  const decisive = userSim.decisiveFacts(intent);
  return {
    exchange,
    userTurns: exchange.filter(entry => entry.role === 'user').length,
    asked,
    disclosed: [...disclosed],
    disclosedDecisive: decisive.length > 0 && decisive.every(id => disclosed.has(id)),
    gateDenials,
    editCalls,
    tools,
    judgeFailed,
    exitStatus: lastStatus,
    timedOut,
    ...usage
  };
}

module.exports = { runConversation, sessionArgs, sessionIdOf, finalText, COLLAB_NOTE, DEFAULT_USER_TURNS };
