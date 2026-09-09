'use strict';

const { contractDigest } = require('../contracts');
const { normalizeArtifactRef } = require('./artifact-store');
const { HASH_PATTERN } = require('./trajectory');

const RUN_ID_PATTERN = /^run_[a-f0-9]{32}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;
const ACTION_TYPES = new Set(['click', 'keypress', 'text', 'wait', 'screenshot']);
const MAX_ACTIONS = 500;
const MAX_SCREENSHOTS = 100;
const MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024;

function containsControlCharacter(value) {
  return [...value].some(character => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127;
  });
}

function requireString(value, label, maxLength = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a string between 1 and ${maxLength} characters`);
  }
  if (containsControlCharacter(value)) throw new Error(`${label} contains control characters`);
  return value;
}

function requireInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function normalizeDisplay(display) {
  if (!display || typeof display !== 'object' || Array.isArray(display)) {
    throw new Error('display must be an object');
  }
  const scale = Number(display.scale);
  if (!Number.isFinite(scale) || scale <= 0 || scale > 8) {
    throw new Error('display.scale must be greater than 0 and no more than 8');
  }
  return {
    width: requireInteger(display.width, 'display.width', 1, 16384),
    height: requireInteger(display.height, 'display.height', 1, 16384),
    scale,
  };
}

function assertOnlyKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter(key => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(`${label} contains unsupported field ${unexpected[0]}`);
}

function normalizeAction(action, expectedSeq, display) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    throw new Error(`visual transcript action ${expectedSeq} must be an object`);
  }
  if (action.seq !== expectedSeq) {
    throw new Error(`visual transcript sequence must be contiguous starting at 1; expected ${expectedSeq}`);
  }
  if (!ACTION_TYPES.has(action.action)) {
    throw new Error(`Unsupported visual action: ${String(action.action || '')}`);
  }
  const common = { seq: expectedSeq, action: action.action };
  if (action.action === 'click') {
    assertOnlyKeys(action, new Set(['seq', 'action', 'target', 'x', 'y']), `click action ${expectedSeq}`);
    return {
      ...common,
      target: requireString(action.target, `click action ${expectedSeq} target`),
      x: requireInteger(action.x, `click action ${expectedSeq} x`, 0, display.width - 1),
      y: requireInteger(action.y, `click action ${expectedSeq} y`, 0, display.height - 1),
    };
  }
  if (action.action === 'keypress') {
    assertOnlyKeys(action, new Set(['seq', 'action', 'key', 'target']), `keypress action ${expectedSeq}`);
    return {
      ...common,
      key: requireString(action.key, `keypress action ${expectedSeq} key`, 80),
      ...(action.target ? { target: requireString(action.target, `keypress action ${expectedSeq} target`) } : {}),
    };
  }
  if (action.action === 'text') {
    if (Object.prototype.hasOwnProperty.call(action, 'text') || Object.prototype.hasOwnProperty.call(action, 'value')) {
      throw new Error('Visual transcript must not retain raw typed text; provide text_sha256');
    }
    assertOnlyKeys(action, new Set(['seq', 'action', 'target', 'text_sha256']), `text action ${expectedSeq}`);
    if (!HASH_PATTERN.test(String(action.text_sha256 || ''))) {
      throw new Error(`text action ${expectedSeq} text_sha256 must be 64 lowercase hex characters`);
    }
    return {
      ...common,
      target: requireString(action.target, `text action ${expectedSeq} target`),
      text_sha256: action.text_sha256,
    };
  }
  if (action.action === 'wait') {
    assertOnlyKeys(action, new Set(['seq', 'action', 'duration_ms']), `wait action ${expectedSeq}`);
    return {
      ...common,
      duration_ms: requireInteger(action.duration_ms, `wait action ${expectedSeq} duration_ms`, 1, 60_000),
    };
  }
  assertOnlyKeys(action, new Set(['seq', 'action', 'label']), `screenshot action ${expectedSeq}`);
  return { ...common, label: requireString(action.label, `screenshot action ${expectedSeq} label`, 120) };
}

function normalizeTranscript(transcript, display) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    throw new Error('visual transcript must contain at least one action');
  }
  if (transcript.length > MAX_ACTIONS) {
    throw new Error(`visual transcript exceeds ${MAX_ACTIONS} actions`);
  }
  return transcript.map((action, index) => normalizeAction(action, index + 1, display));
}

function normalizeEnvironment(environment) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new Error('visual environment must be an object');
  }
  assertOnlyKeys(
    environment,
    new Set(['os', 'arch', 'backend', 'tier', 'identity_sha256']),
    'visual environment'
  );
  if (!['linux', 'macos', 'windows'].includes(environment.os)) {
    throw new Error('visual environment os must be linux, macos, or windows');
  }
  if (!['arm64', 'x86_64'].includes(environment.arch)) {
    throw new Error('visual environment arch must be arm64 or x86_64');
  }
  if (!HASH_PATTERN.test(String(environment.identity_sha256 || ''))) {
    throw new Error('visual environment identity_sha256 must be 64 lowercase hex characters');
  }
  return {
    os: environment.os,
    arch: environment.arch,
    backend: requireString(environment.backend, 'visual environment backend', 80),
    tier: requireInteger(environment.tier, 'visual environment tier', 0, 3),
    identity_sha256: environment.identity_sha256,
  };
}

function normalizeScreenshots(screenshots, transcript, display) {
  if (!Array.isArray(screenshots) || screenshots.length === 0) {
    throw new Error('visual evidence requires at least one screenshot');
  }
  if (screenshots.length > MAX_SCREENSHOTS) {
    throw new Error(`visual evidence exceeds ${MAX_SCREENSHOTS} screenshots`);
  }
  const screenshotActions = new Set(
    transcript.filter(action => action.action === 'screenshot').map(action => action.seq)
  );
  const seenPaths = new Set();
  const seenActions = new Set();
  const normalized = screenshots.map((screenshot, index) => {
    if (!screenshot || typeof screenshot !== 'object' || Array.isArray(screenshot)) {
      throw new Error(`visual screenshot ${index + 1} must be an object`);
    }
    const ref = normalizeArtifactRef({
      kind: 'screenshot',
      path: screenshot.path,
      bytes: screenshot.bytes,
      sha256: screenshot.sha256,
      redacted: false,
    }, { maxBytes: MAX_SCREENSHOT_BYTES });
    if (!screenshotActions.has(screenshot.action_seq)) {
      throw new Error(`visual screenshot ${index + 1} must bind to a screenshot action`);
    }
    if (seenActions.has(screenshot.action_seq)) {
      throw new Error(`duplicate screenshot action ${screenshot.action_seq}`);
    }
    if (screenshot.width !== display.width || screenshot.height !== display.height) {
      throw new Error(`visual screenshot ${index + 1} must match the display resolution`);
    }
    if (seenPaths.has(ref.path)) throw new Error(`duplicate visual screenshot path: ${ref.path}`);
    seenPaths.add(ref.path);
    seenActions.add(screenshot.action_seq);
    return {
      action_seq: screenshot.action_seq,
      path: ref.path,
      bytes: ref.bytes,
      sha256: ref.sha256,
      width: display.width,
      height: display.height,
    };
  }).sort((left, right) => left.action_seq - right.action_seq || left.path.localeCompare(right.path));
  if (seenActions.size !== screenshotActions.size) {
    throw new Error('every screenshot action must have exactly one screenshot artifact');
  }
  return normalized;
}

function normalizeCleanup(cleanup) {
  if (!cleanup || typeof cleanup !== 'object' || Array.isArray(cleanup)) {
    throw new Error('visual cleanup must be an object');
  }
  if (typeof cleanup.pass !== 'boolean') throw new Error('visual cleanup.pass must be boolean');
  return {
    pass: cleanup.pass,
    resources_remaining: requireInteger(
      cleanup.resources_remaining,
      'visual cleanup.resources_remaining',
      0,
      1_000_000
    ),
  };
}

function normalizeVisualEvidence(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('visual evidence input must be an object');
  }
  if (input.exploration === true) {
    throw new Error('Exploration output cannot become verification evidence');
  }
  if (input.verification !== true) {
    throw new Error('Visual evidence must originate from the verification channel');
  }
  const runId = requireString(input.run_id, 'visual run_id', 64);
  if (!RUN_ID_PATTERN.test(runId)) throw new Error('visual run_id is invalid');
  const capturedAt = requireString(input.captured_at, 'visual captured_at', 40);
  if (!TIMESTAMP_PATTERN.test(capturedAt)) throw new Error('visual captured_at is invalid');
  const display = normalizeDisplay(input.display);
  const transcript = normalizeTranscript(input.transcript, display);
  const environment = normalizeEnvironment(input.environment);
  const screenshots = normalizeScreenshots(input.screenshots, transcript, display);
  const cleanup = normalizeCleanup(input.cleanup);
  const blockers = [];
  if (!cleanup.pass) blockers.push('visual verification cleanup did not pass');
  if (cleanup.resources_remaining > 0) {
    blockers.push(`visual verification left ${cleanup.resources_remaining} resources`);
  }
  const payload = {
    schema_version: 1,
    kind: 'ecc.sandbox.visual-evidence',
    run_id: runId,
    captured_at: capturedAt,
    source: 'verification',
    display,
    environment,
    transcript,
    transcript_sha256: contractDigest(transcript),
    screenshots,
    screenshots_sha256: contractDigest(screenshots),
    cleanup,
    verification_eligible: blockers.length === 0,
    blockers,
  };
  return { ...payload, sha256: contractDigest(payload) };
}

function verifyVisualEvidence(evidence) {
  try {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
    if (!HASH_PATTERN.test(String(evidence.sha256 || ''))) return false;
    const { sha256, ...payload } = evidence;
    if (payload.source !== 'verification') return false;
    if (contractDigest(payload.transcript || []) !== payload.transcript_sha256) return false;
    if (contractDigest(payload.screenshots || []) !== payload.screenshots_sha256) return false;
    if (contractDigest(payload) !== sha256) return false;
    const rebuilt = normalizeVisualEvidence({
      run_id: payload.run_id,
      verification: true,
      exploration: false,
      captured_at: payload.captured_at,
      transcript: payload.transcript,
      display: payload.display,
      environment: payload.environment,
      screenshots: payload.screenshots,
      cleanup: payload.cleanup,
    });
    return contractDigest(rebuilt) === contractDigest(evidence);
  } catch {
    return false;
  }
}

module.exports = {
  ACTION_TYPES,
  MAX_ACTIONS,
  MAX_SCREENSHOTS,
  normalizeVisualEvidence,
  verifyVisualEvidence,
};
