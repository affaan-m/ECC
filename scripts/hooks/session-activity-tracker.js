#!/usr/bin/env node
/**
 * Session Activity Tracker Hook
 *
 * PostToolUse hook that records sanitized per-tool activity to
 * ~/.claude/metrics/tool-usage.jsonl for ECC2 metric sync.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  appendFile,
  getClaudeDir,
  stripAnsi,
} = require('../lib/utils');

const MAX_STDIN = 1024 * 1024;
const METRICS_FILE_NAME = 'tool-usage.jsonl';
const FILE_PATH_KEYS = new Set([
  'file_path',
  'file_paths',
  'source_path',
  'destination_path',
  'old_file_path',
  'new_file_path',
]);

function redactSecrets(value) {
  return String(value || '')
    .replace(/\n/g, ' ')
    .replace(/--token[= ][^ ]*/g, '--token=<REDACTED>')
    .replace(/Authorization:[: ]*[^ ]*[: ]*[^ ]*/gi, 'Authorization:<REDACTED>')
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, '<REDACTED>')
    .replace(/\bASIA[A-Z0-9]{16}\b/g, '<REDACTED>')
    .replace(/password[= ][^ ]*/gi, 'password=<REDACTED>')
    .replace(/\bghp_[A-Za-z0-9_]+\b/g, '<REDACTED>')
    .replace(/\bgho_[A-Za-z0-9_]+\b/g, '<REDACTED>')
    .replace(/\bghs_[A-Za-z0-9_]+\b/g, '<REDACTED>')
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, '<REDACTED>');
}

function truncateSummary(value, maxLength = 220) {
  const normalized = stripAnsi(redactSecrets(value)).trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function sanitizeParamValue(value, depth = 0) {
  if (depth >= 4) {
    return '[Truncated]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return truncateSummary(value, 160);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 8).map(entry => sanitizeParamValue(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const output = {};
    for (const [key, nested] of Object.entries(value).slice(0, 20)) {
      output[key] = sanitizeParamValue(nested, depth + 1);
    }
    return output;
  }

  return truncateSummary(String(value), 160);
}

function sanitizeInputParams(toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return '{}';
  }

  try {
    return JSON.stringify(sanitizeParamValue(toolInput));
  } catch {
    return '{}';
  }
}

function pushPathCandidate(paths, value) {
  const candidate = String(value || '').trim();
  if (!candidate) {
    return;
  }
  if (/^(https?:\/\/|app:\/\/|plugin:\/\/|mcp:\/\/)/i.test(candidate)) {
    return;
  }
  if (!paths.includes(candidate)) {
    paths.push(candidate);
  }
}

function pushFileEvent(events, value, action, diffPreview, patchPreview) {
  const candidate = String(value || '').trim();
  if (!candidate) {
    return;
  }
  if (/^(https?:\/\/|app:\/\/|plugin:\/\/|mcp:\/\/)/i.test(candidate)) {
    return;
  }
  const normalizedDiffPreview = typeof diffPreview === 'string' && diffPreview.trim()
    ? diffPreview.trim()
    : undefined;
  const normalizedPatchPreview = typeof patchPreview === 'string' && patchPreview.trim()
    ? patchPreview.trim()
    : undefined;
  if (!events.some(event =>
    event.path === candidate
      && event.action === action
      && (event.diff_preview || undefined) === normalizedDiffPreview
      && (event.patch_preview || undefined) === normalizedPatchPreview
  )) {
    const event = { path: candidate, action };
    if (normalizedDiffPreview) {
      event.diff_preview = normalizedDiffPreview;
    }
    if (normalizedPatchPreview) {
      event.patch_preview = normalizedPatchPreview;
    }
    events.push(event);
  }
}

function sanitizeDiffText(value, maxLength = 96) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  return truncateSummary(value, maxLength);
}

function sanitizePatchLines(value, maxLines = 4, maxLineLength = 120) {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  return stripAnsi(redactSecrets(value))
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map(line => line.length <= maxLineLength ? line : `${line.slice(0, maxLineLength - 3)}...`);
}

function buildReplacementPreview(oldValue, newValue) {
  const before = sanitizeDiffText(oldValue);
  const after = sanitizeDiffText(newValue);
  if (!before && !after) {
    return undefined;
  }
  if (!before) {
    return `-> ${after}`;
  }
  if (!after) {
    return `${before} ->`;
  }
  return `${before} -> ${after}`;
}

function buildCreationPreview(content) {
  const normalized = sanitizeDiffText(content);
  if (!normalized) {
    return undefined;
  }
  return `+ ${normalized}`;
}

function buildPatchPreviewFromReplacement(oldValue, newValue) {
  const beforeLines = sanitizePatchLines(oldValue);
  const afterLines = sanitizePatchLines(newValue);
  if (beforeLines.length === 0 && afterLines.length === 0) {
    return undefined;
  }

  const lines = ['@@'];
  for (const line of beforeLines) {
    lines.push(`- ${line}`);
  }
  for (const line of afterLines) {
    lines.push(`+ ${line}`);
  }
  return lines.join('\n');
}

function buildPatchPreviewFromContent(content, prefix) {
  const lines = sanitizePatchLines(content);
  if (lines.length === 0) {
    return undefined;
  }
  return lines.map(line => `${prefix} ${line}`).join('\n');
}

function buildDiffPreviewFromPatchPreview(patchPreview) {
  if (typeof patchPreview !== 'string' || !patchPreview.trim()) {
    return undefined;
  }

  const lines = patchPreview
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const removed = lines.find(line => line.startsWith('- ') || line.startsWith('-'));
  const added = lines.find(line => line.startsWith('+ ') || line.startsWith('+'));

  if (!removed && !added) {
    return undefined;
  }

  const before = removed ? removed.replace(/^- ?/, '') : '';
  const after = added ? added.replace(/^\+ ?/, '') : '';
  if (before && after) {
    return `${before} -> ${after}`;
  }
  if (before) {
    return `${before} ->`;
  }
  return `-> ${after}`;
}

function inferDefaultFileAction(toolName) {
  const normalized = String(toolName || '').trim().toLowerCase();
  if (normalized.includes('read')) {
    return 'read';
  }
  if (normalized.includes('write')) {
    return 'create';
  }
  if (normalized.includes('edit')) {
    return 'modify';
  }
  if (normalized.includes('delete') || normalized.includes('remove')) {
    return 'delete';
  }
  if (normalized.includes('move') || normalized.includes('rename')) {
    return 'move';
  }
  return 'touch';
}

function actionForFileKey(toolName, key) {
  if (key === 'source_path' || key === 'old_file_path') {
    return 'move';
  }
  if (key === 'destination_path' || key === 'new_file_path') {
    return 'move';
  }
  return inferDefaultFileAction(toolName);
}

function collectFilePaths(value, paths) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectFilePaths(entry, paths);
    }
    return;
  }

  if (typeof value === 'string') {
    pushPathCandidate(paths, value);
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FILE_PATH_KEYS.has(key)) {
      collectFilePaths(nested, paths);
      continue;
    }

    if (nested && (Array.isArray(nested) || typeof nested === 'object')) {
      collectFilePaths(nested, paths);
    }
  }
}

function extractFilePaths(toolInput) {
  const paths = [];
  if (!toolInput || typeof toolInput !== 'object') {
    return paths;
  }
  collectFilePaths(toolInput, paths);
  return paths;
}

function fileEventDiffPreview(toolName, value, action) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  if (typeof value.old_string === 'string' || typeof value.new_string === 'string') {
    return buildReplacementPreview(value.old_string, value.new_string);
  }

  if (action === 'create') {
    return buildCreationPreview(value.content || value.file_text || value.text);
  }

  return undefined;
}

function fileEventPatchPreview(value, action) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  if (typeof value.old_string === 'string' || typeof value.new_string === 'string') {
    return buildPatchPreviewFromReplacement(value.old_string, value.new_string);
  }

  if (action === 'create') {
    return buildPatchPreviewFromContent(value.content || value.file_text || value.text, '+');
  }

  if (action === 'delete') {
    return buildPatchPreviewFromContent(value.content || value.old_string || value.file_text, '-');
  }

  return undefined;
}

function runGit(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 2500,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return String(result.stdout || '').trim();
}

function gitRepoRoot(cwd) {
  return runGit(['rev-parse', '--show-toplevel'], cwd);
}

const MAX_RELEVANT_PATCH_LINES = 6;

function candidateGitPaths(repoRoot, filePath) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const candidates = [];
  const pushCandidate = value => {
    const candidate = String(value || '').trim();
    if (!candidate || candidates.includes(candidate)) {
      return;
    }
    candidates.push(candidate);
  };

  const absoluteCandidates = path.isAbsolute(filePath)
    ? [path.resolve(filePath)]
    : [
        path.resolve(resolvedRepoRoot, filePath),
        path.resolve(process.cwd(), filePath),
      ];

  for (const absolute of absoluteCandidates) {
    const relative = path.relative(resolvedRepoRoot, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      continue;
    }

    pushCandidate(relative);
    pushCandidate(relative.split(path.sep).join('/'));
    pushCandidate(absolute);
    pushCandidate(absolute.split(path.sep).join('/'));
  }

  return candidates;
}

function patchPreviewFromGitDiff(repoRoot, pathCandidates) {
  for (const candidate of pathCandidates) {
    const patch = runGit(
      ['diff', '--no-ext-diff', '--no-color', '--unified=1', '--', candidate],
      repoRoot
    );
    if (!patch) {
      continue;
    }

    const relevant = patch
      .split(/\r?\n/)
      .filter(line =>
        line.startsWith('@@')
          || (line.startsWith('+') && !line.startsWith('+++'))
          || (line.startsWith('-') && !line.startsWith('---'))
      )
      .slice(0, MAX_RELEVANT_PATCH_LINES);

    if (relevant.length > 0) {
      return relevant.join('\n');
    }
  }

  return undefined;
}

function trackedInGit(repoRoot, pathCandidates) {
  return pathCandidates.some(candidate =>
    runGit(['ls-files', '--error-unmatch', '--', candidate], repoRoot) !== null
  );
}

function enrichFileEventFromWorkingTree(toolName, event) {
  if (!event || typeof event !== 'object' || !event.path) {
    return event;
  }

  const repoRoot = gitRepoRoot(process.cwd());
  if (!repoRoot) {
    return event;
  }

  const pathCandidates = candidateGitPaths(repoRoot, event.path);
  if (pathCandidates.length === 0) {
    return event;
  }

  const tool = String(toolName || '').trim().toLowerCase();
  const tracked = trackedInGit(repoRoot, pathCandidates);
  const patchPreview = patchPreviewFromGitDiff(repoRoot, pathCandidates) || event.patch_preview;
  const diffPreview = buildDiffPreviewFromPatchPreview(patchPreview) || event.diff_preview;

  if (tool.includes('write')) {
    return {
      ...event,
      action: tracked ? 'modify' : event.action,
      diff_preview: diffPreview,
      patch_preview: patchPreview,
    };
  }

  if (tracked && patchPreview) {
    return {
      ...event,
      diff_preview: diffPreview,
      patch_preview: patchPreview,
    };
  }

  return event;
}

function collectFileEvents(toolName, value, events, key = null, parentValue = null) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectFileEvents(toolName, entry, events, key, parentValue);
    }
    return;
  }

  if (typeof value === 'string') {
    if (key && FILE_PATH_KEYS.has(key)) {
      const action = actionForFileKey(toolName, key);
      pushFileEvent(
        events,
        value,
        action,
        fileEventDiffPreview(toolName, parentValue, action),
        fileEventPatchPreview(parentValue, action)
      );
    }
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  for (const [nestedKey, nested] of Object.entries(value)) {
    if (FILE_PATH_KEYS.has(nestedKey)) {
      collectFileEvents(toolName, nested, events, nestedKey, value);
      continue;
    }

    if (nested && (Array.isArray(nested) || typeof nested === 'object')) {
      collectFileEvents(toolName, nested, events, null, nested);
    }
  }
}

function extractFileEvents(toolName, toolInput) {
  const events = [];
  if (!toolInput || typeof toolInput !== 'object') {
    return events;
  }
  collectFileEvents(toolName, toolInput, events);
  return events;
}

function summarizeInput(toolName, toolInput, filePaths) {
  if (toolName === 'Bash') {
    return truncateSummary(toolInput?.command || 'bash');
  }

  if (filePaths.length > 0) {
    return truncateSummary(`${toolName} ${filePaths.join(', ')}`);
  }

  if (toolInput && typeof toolInput === 'object') {
    const shallow = {};
    for (const [key, value] of Object.entries(toolInput)) {
      if (value === null || value === undefined) {
        continue;
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        shallow[key] = value;
      }
    }
    const serialized = Object.keys(shallow).length > 0 ? JSON.stringify(shallow) : toolName;
    return truncateSummary(serialized);
  }

  return truncateSummary(toolName);
}

function summarizeOutput(toolOutput) {
  if (toolOutput === null || toolOutput === undefined) {
    return '';
  }

  if (typeof toolOutput === 'string') {
    return truncateSummary(toolOutput);
  }

  if (typeof toolOutput === 'object' && typeof toolOutput.output === 'string') {
    return truncateSummary(toolOutput.output);
  }

  return truncateSummary(JSON.stringify(toolOutput));
}

function buildActivityRow(input, env = process.env) {
  const hookEvent = String(env.CLAUDE_HOOK_EVENT_NAME || '').trim();
  if (hookEvent && hookEvent !== 'PostToolUse') {
    return null;
  }

  const toolName = String(input?.tool_name || '').trim();
  const sessionId = String(env.ECC_SESSION_ID || env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || '').trim();
  if (!toolName || !sessionId) {
    return null;
  }

  const toolInput = input?.tool_input || {};
  const fileEvents = extractFileEvents(toolName, toolInput).map(event =>
    enrichFileEventFromWorkingTree(toolName, event)
  );
  const filePaths = fileEvents.length > 0
    ? [...new Set(fileEvents.map(event => event.path))]
    : extractFilePaths(toolInput);

  return {
    id: `tool-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    tool_name: toolName,
    input_summary: summarizeInput(toolName, toolInput, filePaths),
    input_params_json: sanitizeInputParams(toolInput),
    output_summary: summarizeOutput(input?.tool_output),
    duration_ms: 0,
    file_paths: filePaths,
    file_events: fileEvents,
  };
}

function run(rawInput) {
  try {
    const input = rawInput.trim() ? JSON.parse(rawInput) : {};
    const row = buildActivityRow(input);
    if (row) {
      appendFile(
        path.join(getClaudeDir(), 'metrics', METRICS_FILE_NAME),
        `${JSON.stringify(row)}\n`
      );
    }
  } catch {
    // Keep hook non-blocking.
  }

  return rawInput;
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) {
      const remaining = MAX_STDIN - raw.length;
      raw += chunk.substring(0, remaining);
    }
  });
  process.stdin.on('end', () => {
    process.stdout.write(run(raw));
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  buildActivityRow,
  extractFileEvents,
  extractFilePaths,
  summarizeInput,
  summarizeOutput,
  run,
};
