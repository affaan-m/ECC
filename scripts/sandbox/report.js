'use strict';

const { validateReport } = require('./contracts');

const MAX_TAIL_LINES = 50;
const MAX_TAIL_CHARS = 65_536;

function tailOutput(value, maxLines = MAX_TAIL_LINES, maxChars = MAX_TAIL_CHARS) {
  const normalized = String(value || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const lines = normalized.split('\n');
  const lineTail = lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
  return lineTail.length > maxChars ? lineTail.slice(-maxChars) : lineTail;
}

function normalizeExit(value) {
  return Number.isInteger(value) ? value : -1;
}

function normalizeStep(command, execution) {
  const stderr = [execution.stderr, execution.error?.message]
    .filter(Boolean)
    .join('\n');
  return {
    cmd: command,
    exit: normalizeExit(execution.status),
    stdout_tail: tailOutput(execution.stdout),
    stderr_tail: tailOutput(stderr),
  };
}

function emptyInstallDiff() {
  return {
    method: 'none',
    complete: false,
    files_added: [],
    files_changed: [],
    files_deleted: [],
    path_changes: [],
    services_registered: [],
    dotfiles_touched: [],
  };
}

function inferResult(steps, assertions, executionError = false) {
  if (executionError) return 'error';
  if (steps.some(step => step.exit !== 0) || assertions.some(assertion => !assertion.pass)) {
    return 'fail';
  }
  return 'pass';
}

function buildSingleReport(options) {
  // DECISION: CONVENTIONS item 18 keeps adapter mocks machine-distinguishable
  // from real isolation evidence in every normalized report.
  const report = {
    manifest: options.manifest,
    backend: options.backend,
    tier: options.tier,
    os: options.os,
    arch: options.arch,
    execution_mode: options.executionMode || 'real',
    started: options.started,
    duration_ms: Math.max(0, Math.round(options.durationMs || 0)),
    escalations: options.escalations || [],
    steps: options.steps || [],
    assertions: options.assertions || [],
    install_diff: options.installDiff || emptyInstallDiff(),
    result: options.result || inferResult(
      options.steps || [],
      options.assertions || [],
      options.executionError
    ),
    notes: options.notes || [],
  };
  return validateReport(report);
}

function buildAggregateReport(options) {
  const children = [...options.children].sort((left, right) => (
    `${left.os}/${left.arch}/${left.backend}`.localeCompare(
      `${right.os}/${right.arch}/${right.backend}`
    )
  ));
  if (children.length === 0) throw new Error('aggregate reports require at least one child');
  const modes = new Set(children.map(child => child.execution_mode));
  const result = children.some(child => child.result === 'error')
    ? 'error'
    : (children.some(child => child.result === 'fail') ? 'fail' : 'pass');
  return validateReport({
    manifest: options.manifest,
    backend: 'aggregate',
    tier: null,
    os: 'multiple',
    arch: 'multiple',
    venue: options.venue,
    execution_mode: modes.size === 1 ? children[0].execution_mode : 'mixed',
    started: options.started,
    duration_ms: Math.max(0, Math.round(options.durationMs || 0)),
    escalations: options.escalations || [],
    children,
    result,
    notes: options.notes || [],
  });
}

module.exports = {
  MAX_TAIL_CHARS,
  MAX_TAIL_LINES,
  buildAggregateReport,
  buildSingleReport,
  emptyInstallDiff,
  inferResult,
  normalizeStep,
  tailOutput,
};
