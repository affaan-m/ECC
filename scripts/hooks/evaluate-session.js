#!/usr/bin/env node
/**
 * Continuous Learning - Session Evaluator
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs on Stop hook to extract reusable patterns from Claude Code sessions.
 * Reads transcript_path from stdin JSON (Claude Code hook input).
 *
 * Why Stop hook instead of UserPromptSubmit:
 * - Stop runs once at session end (lightweight)
 * - UserPromptSubmit runs every message (heavy, adds latency)
 */

const path = require('path');
const fs = require('fs');
const {
  getLearnedSkillsDir,
  ensureDir,
  readFile,
  countInFile,
  getTempDir,
  log,
  output
} = require('../lib/utils');
const { resolveHookSessionId } = require('../lib/hook-session');
const {
  resolveProjectContext,
  getAliasContexts,
  listSessionLeases,
  resolveSessionId
} = require('../lib/observer-sessions');

// Marker that records a delivered Stop nudge, one per session, in the OS
// temp dir (same per-session temp-file pattern as suggest-compact's
// counters). A marker is what makes delivery once-per-session: a later
// user stop in the same session must not block again.
const DELIVERY_MARKER_PREFIX = 'claude-continuous-learning-delivered-';

// Read hook input from stdin (Claude Code provides transcript_path via stdin JSON)
const MAX_STDIN = 1024 * 1024;
let stdinData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  if (stdinData.length < MAX_STDIN) {
    const remaining = MAX_STDIN - stdinData.length;
    stdinData += chunk.substring(0, remaining);
  }
});

process.stdin.on('end', () => {
  main().catch(err => {
    console.error('[ContinuousLearning] Error:', err.message);
    process.exit(0);
  });
});

async function main() {
  // Parse stdin JSON once; the parsed payload is reused by the delivery
  // gates below (event name, stop_hook_active, cwd).
  let input = null;
  let transcriptPath = null;
  try {
    input = JSON.parse(stdinData);
    transcriptPath = input.transcript_path;
  } catch {
    // Fallback: try env var for backwards compatibility
    transcriptPath = process.env.CLAUDE_TRANSCRIPT_PATH;
  }

  // Get script directory to find config
  const scriptDir = __dirname;
  const configFile = path.join(scriptDir, '..', '..', 'skills', 'continuous-learning', 'config.json');

  // Default configuration
  let minSessionLength = 10;
  let learnedSkillsPath = getLearnedSkillsDir();
  // Delivery to the model is explicitly opt-in and off by default: a Stop
  // hook that blocks the stop is user-visible behavior, so it must never
  // turn on silently.
  let stopNudgeOptIn = false;

  // Load config if exists
  const configContent = readFile(configFile);
  if (configContent) {
    try {
      const config = JSON.parse(configContent);
      minSessionLength = config.min_session_length ?? 10;
      stopNudgeOptIn = config.stop_nudge_opt_in === true;

      if (config.learned_skills_path) {
        // Handle ~ in path
        learnedSkillsPath = config.learned_skills_path.replace(/^~/, require('os').homedir());
      }
    } catch (err) {
      log(`[ContinuousLearning] Failed to parse config: ${err.message}, using defaults`);
    }
  }

  // Ensure learned skills directory exists
  ensureDir(learnedSkillsPath);

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    process.exit(0);
  }

  // Count user messages in session (allow optional whitespace around colon)
  const messageCount = countInFile(transcriptPath, /"type"\s*:\s*"user"/g);

  // Skip short sessions
  if (messageCount < minSessionLength) {
    log(`[ContinuousLearning] Session too short (${messageCount} messages), skipping`);
    process.exit(0);
  }

  // Signal to Claude that session should be evaluated for extractable patterns.
  // The log lines below go to stderr (the debug log) only. Whether the
  // model ever sees the signal is decided by deliverStopNudge, which fails
  // closed: any gate miss means stderr only, exit 0, no stdout.
  log(`[ContinuousLearning] Session has ${messageCount} messages - evaluate for extractable patterns`);
  log(`[ContinuousLearning] Save learned skills to: ${learnedSkillsPath}`);

  deliverStopNudge({ input, stdinData, messageCount, learnedSkillsPath, stopNudgeOptIn });

  process.exit(0);
}

/**
 * Deliver the evaluation signal to the model, or deliver nothing.
 *
 * A Stop hook reaches the model only through the native Stop contract:
 * decision "block" + reason, which continues the turn with the reason as
 * context. Plain stdout text is not a delivery channel on Stop, so nothing
 * else is ever written to stdout here. Every gate fails closed.
 */
function deliverStopNudge({ input, stdinData, messageCount, learnedSkillsPath, stopNudgeOptIn }) {
  if (!stopNudgeOptIn) {
    log('[ContinuousLearning] Stop nudge opt-in is off, skipping delivery');
    return;
  }
  // A payload that names a different event means this script is running
  // under the wrong registration; an absent field is tolerated (older
  // harnesses omit it), a mismatched one is not.
  if (input && input.hook_event_name && input.hook_event_name !== 'Stop') {
    log(`[ContinuousLearning] Skipping delivery: hook event is ${input.hook_event_name}, not Stop`);
    return;
  }
  // Stop-loop protection: when a previous Stop already continued this stop,
  // the hook is re-firing and must pass through, never block again.
  if (input && input.stop_hook_active === true) {
    log('[ContinuousLearning] Skipping delivery: Stop hook already fired for this stop');
    return;
  }
  // The payload session id identifies the harness conversation; env ids are
  // only fallbacks, never preferred over it.
  const sessionId = resolveSessionId(resolveHookSessionId(stdinData));
  if (!sessionId) {
    log('[ContinuousLearning] Skipping delivery: no session id available');
    return;
  }
  if (!hasRegisteredSessionLease(input, sessionId)) {
    log('[ContinuousLearning] Skipping delivery: no SessionStart lease for this session');
    return;
  }
  // The session id is sanitized upstream by resolveSessionId, so the
  // marker filename cannot traverse out of the temp dir.
  const markerFile = path.join(getTempDir(), `${DELIVERY_MARKER_PREFIX}${sessionId}`);
  // Claim the marker atomically: 'wx' fails when a nudge was already
  // delivered (EEXIST) and closes the check-then-create gap. Any other
  // write failure fails closed: without a marker, a later Stop would stay
  // eligible, so skipping delivery is the only shape that keeps the
  // once-per-session promise. stop_hook_active bounds only the re-fired
  // Stop for one turn, not later turns, so it cannot stand in for the
  // marker.
  try {
    fs.writeFileSync(markerFile, `${new Date().toISOString()}\n`, { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      log('[ContinuousLearning] Stop nudge already delivered for this session, skipping');
    } else {
      log(`[ContinuousLearning] Warning: could not record delivery marker, skipping delivery: ${err.message}`);
    }
    return;
  }
  output({
    decision: 'block',
    reason: `[ContinuousLearning] Session has ${messageCount} messages - evaluate for extractable patterns. Save learned skills to: ${learnedSkillsPath}`
  });
}

/**
 * The registered-native-lifecycle check: the session must hold a lease
 * written by SessionStart under the ECC project context (including alias
 * contexts for roots that moved mid-session). A Stop payload for a session
 * that never went through SessionStart is not a registered ECC session,
 * and its nudge must not reach the model.
 */
function hasRegisteredSessionLease(input, sessionId) {
  try {
    const cwd = (input && typeof input.cwd === 'string' && input.cwd) || process.cwd();
    const context = resolveProjectContext(cwd);
    const contexts = [context, ...getAliasContexts(context)];
    return contexts.some(ctx =>
      listSessionLeases(ctx).some(file => path.basename(file) === `${sessionId}.json`)
    );
  } catch (err) {
    log(`[ContinuousLearning] Session lease check failed: ${err.message}`);
    return false;
  }
}
