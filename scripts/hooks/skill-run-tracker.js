#!/usr/bin/env node
'use strict';

/**
 * PostToolUse hook: record Skill tool invocations for skill-health telemetry.
 *
 * Wires the write side of the already-shipped JSONL tracker
 * (scripts/lib/skill-evolution/tracker.js). Before this hook,
 * recordSkillExecution() had zero production callers, so
 * ~/.claude/state/skill-runs.jsonl was never written and
 * `scripts/skills-health.js --dashboard` always reported 0 runs (#2463).
 *
 * Privacy: the dashboard aggregates skill/version/outcome only, so this hook
 * never persists prompt text. `task_description` is synthesized from the skill
 * id, and every persisted string is charset-restricted and length-bounded — a
 * skill id is an identifier, not free text, so anything that does not look like
 * one is dropped rather than written through.
 *
 * Best-effort: never blocks tool execution. Runs under the PostToolUse
 * dispatcher, which owns stdin, pass-through, and exit codes.
 *
 * Cross-platform (Windows, macOS, Linux); CommonJS.
 */

const { recordSkillExecution } = require('../lib/skill-evolution/tracker');

// Bounds for persisted identifiers. Long enough for any real skill id or
// semver-ish version, short enough that a stray blob cannot ride in.
const MAX_SKILL_ID = 128;
const MAX_SKILL_VERSION = 64;

// Identifiers only: letters, digits, and the separators skill ids actually use.
// Anything else (whitespace, punctuation, newlines) means it is not an id.
const SKILL_ID_PATTERN = /^[A-Za-z0-9._:@/-]+$/;
const SKILL_VERSION_PATTERN = /^[A-Za-z0-9._+-]+$/;

// Return `value` only if it is a bounded, identifier-shaped string.
function boundedIdentifier(value, maxLength, pattern) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null;
  }
  return pattern.test(trimmed) ? trimmed : null;
}

function firstIdentifier(maxLength, pattern, ...values) {
  for (const value of values) {
    const identifier = boundedIdentifier(value, maxLength, pattern);
    if (identifier) {
      return identifier;
    }
  }
  return null;
}

// Extract the skill identifier from the Skill tool input across the field
// names Claude Code has used for it. The Skill tool is genuinely un-wired in
// this repo, so no single canonical field is guaranteed — probe the plausible
// ones and bail (record nothing) if none is present.
function extractSkillId(toolInput) {
  if (typeof toolInput === 'string') {
    return boundedIdentifier(toolInput, MAX_SKILL_ID, SKILL_ID_PATTERN);
  }
  if (!toolInput || typeof toolInput !== 'object') {
    return null;
  }
  return firstIdentifier(
    MAX_SKILL_ID,
    SKILL_ID_PATTERN,
    toolInput.skill_id,
    toolInput.skillId,
    toolInput.skill,
    toolInput.name,
    toolInput.command
  );
}

// Best-effort outcome: a failed tool call is recorded as "failure", everything
// else as "success". Both PostToolUseFailure routing and an error-bearing
// tool response are treated as failure.
function deriveOutcome(payload) {
  if (payload && payload.hook_event_name === 'PostToolUseFailure') {
    return 'failure';
  }

  const response = (payload && (payload.tool_response ?? payload.tool_output)) || null;
  if (response && typeof response === 'object') {
    if (response.is_error === true || response.isError === true) {
      return 'failure';
    }
    if (typeof response.status === 'string' && /error|fail/i.test(response.status)) {
      return 'failure';
    }
    if (typeof response.error === 'string' && response.error.trim().length > 0) {
      return 'failure';
    }
  }

  return 'success';
}

function buildRecord(payload) {
  const skillId = extractSkillId(payload.tool_input);
  if (!skillId) {
    return null; // cannot satisfy the tracker's required skill_id — skip
  }

  const input = payload.tool_input && typeof payload.tool_input === 'object'
    ? payload.tool_input
    : {};

  const skillVersion = firstIdentifier(
    MAX_SKILL_VERSION,
    SKILL_VERSION_PATTERN,
    input.skill_version,
    input.skillVersion,
    input.version
  ) || 'unknown';

  return {
    skill_id: skillId,
    skill_version: skillVersion,
    // Synthesized, not user content. The tracker requires a non-empty
    // task_description; the dashboard never displays it as prose.
    task_description: `Skill invocation: ${skillId}`,
    outcome: deriveOutcome(payload),
  };
}

function run(rawInput) {
  try {
    const payload = typeof rawInput === 'string'
      ? (rawInput.trim() ? JSON.parse(rawInput) : {})
      : rawInput;
    if (payload && typeof payload === 'object' && payload.tool_name === 'Skill') {
      const record = buildRecord(payload);
      if (record) {
        recordSkillExecution(record);
      }
    }
  } catch {
    // Telemetry is best-effort; never block tool execution on a failure here.
  }
}

module.exports = { buildRecord, deriveOutcome, extractSkillId, run };
