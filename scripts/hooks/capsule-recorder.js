#!/usr/bin/env node
/**
 * Capsule Recorder Hook (opt-in)
 *
 * Journals session boundaries and completed tool calls into one
 * capsule-envelope/v1 capsule per harness session, so a session can later be
 * verified, projected, receipted or grouped with `node scripts/eval-harness.js`.
 *
 * Off unless ECC_CAPSULE_RECORDING=1. The hook ids (session:start:capsule-recorder,
 * post:capsule-recorder, session:end:capsule-recorder) also obey ECC_DISABLED_HOOKS.
 * Recording never blocks the tool or the session: every refusal is reported on
 * stderr with a [CapsuleRecorder] prefix and the hook exits 0.
 *
 * Environment:
 * - ECC_CAPSULE_RECORDING     1|true|yes|on to record (default off)
 * - ECC_CAPSULE_DIR           parent of the per-session capsule directories
 *                             (default <agent data home>/capsules)
 * - ECC_CAPSULE_TASK_FAMILY   task_family written to capsule metadata (default session)
 * - ECC_CAPSULE_MAX_BYTES     stop appending once the journal reaches this size
 *                             (default 2 MiB, about 3,000 tool calls; each append
 *                             re-verifies the whole journal)
 */

'use strict';

const { isRecordingEnabled, recordEvent } = require('../lib/capsule-recording');

function describeError(error) {
  const code = error && typeof error.code === 'string' ? `${error.code}: ` : '';
  return `[CapsuleRecorder] not recorded: ${code}${error && error.message ? error.message : String(error)}`;
}

function run(rawInput, options = {}) {
  const env = options.env || process.env;
  if (!isRecordingEnabled(env)) return { stdout: '', stderr: '', exitCode: 0 };
  let stderr = '';
  try {
    const input = JSON.parse(String(rawInput || '{}'));
    const usable = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const cwd = typeof usable.cwd === 'string' && usable.cwd ? usable.cwd : (options.cwd || process.cwd());
    stderr = recordEvent(usable, env, cwd);
  } catch (error) {
    stderr = describeError(error);
  }
  return { stdout: '', stderr, exitCode: 0 };
}

module.exports = { run };
