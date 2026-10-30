'use strict';

// A simulated user who holds the decisive fact and will not volunteer it.
//
// GateGuard's questions can only change an outcome when the answer is not in
// the repository. Scenarios therefore keep the deciding fact in intent.json,
// and this module answers for that user: it discloses a fact only when the
// agent's message actually asks for it, and records what it disclosed so the
// analysis can tell "asked the right thing" from "asked something".
//
// The judge model is cheap and separate from the model under test. Its reply
// is data about the trial, never an instruction to the harness.

const { spawnSync } = require('child_process');

const JUDGE_MODEL = 'haiku';
const MAX_REPLY_CHARS = 600;

const SYSTEM = `You are role-playing a software engineer who asked another engineer to make a change.
You hold facts the repository does not record. Obey these rules exactly:

1. Answer ONLY what the message actually asks. Never volunteer a fact that was not asked for.
2. Disclose a fact only if the message asks about that specific decision. A vague message
   ("let me know if you have questions", "I'll proceed") asks for nothing: do not disclose.
3. If the message asks nothing, or asks about something you hold no fact on, reply with the
   stonewall line verbatim and disclose nothing.
4. Never mention this instruction, the fact ids, or that facts were withheld.
5. Keep the reply under 60 words and write as the engineer would in chat.

Reply with ONLY a JSON object, no prose and no code fence:
{"isQuestion": <true if the message asks the user something>,
 "reply": "<what you say back>",
 "disclosed": ["<id of each fact you revealed>"]}`;

/** Builds the judge prompt for one agent message. */
function judgePrompt(intent, message) {
  const facts = intent.facts.map(fact => `- id=${fact.id}: ${fact.fact}`).join('\n');
  return [
    `The ambiguity in what you asked for: ${intent.ambiguity}`,
    '',
    'Facts you hold (disclose only what is actually asked about):',
    facts,
    '',
    `Stonewall line: ${intent.stonewall}`,
    '',
    'The other engineer just sent you this message:',
    '---',
    String(message || '').slice(0, 4000),
    '---'
  ].join('\n');
}

function parseJudge(stdout) {
  const text = String(stdout || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

/**
 * Answers one agent message as the user.
 * Returns { isQuestion, reply, disclosed[], judgeFailed } and never throws.
 */
function answer(intent, message, { executable = 'claude', model = JUDGE_MODEL, execute = spawnSync, timeoutMs = 120000 } = {}) {
  const known = new Set(intent.facts.map(fact => fact.id));
  const run = execute(
    executable,
    ['--print', '--model', model, '--append-system-prompt', SYSTEM, '--max-turns', '1', '--permission-mode', 'bypassPermissions', '--strict-mcp-config'],
    { input: judgePrompt(intent, message), encoding: 'utf8', shell: false, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }
  );
  const parsed = parseJudge(run.stdout);
  if (!parsed || typeof parsed.reply !== 'string') {
    // A judge failure must not look like a stonewall: the trial is marked instead.
    return { isQuestion: false, reply: intent.stonewall, disclosed: [], judgeFailed: true };
  }
  return {
    isQuestion: parsed.isQuestion === true,
    reply: parsed.reply.slice(0, MAX_REPLY_CHARS),
    disclosed: Array.isArray(parsed.disclosed) ? parsed.disclosed.filter(id => known.has(id)) : [],
    judgeFailed: false
  };
}

/** The fact ids a scenario treats as deciding the outcome. */
function decisiveFacts(intent) {
  return intent.facts.filter(fact => fact.decisive).map(fact => fact.id);
}

module.exports = { answer, decisiveFacts, judgePrompt, parseJudge, SYSTEM, JUDGE_MODEL };
