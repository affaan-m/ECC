'use strict';

const { DEFAULT_POLICY, DEFAULT_SCHEMA_VERSION, DEFAULT_SECTION_MARKER } = require('./policy');

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeBodyForComparison(body) {
  return (body || '').replace(/"lastSyncAt"\s*:\s*[^,}\n]+/g, '"lastSyncAt": NORMALIZED');
}

function coordinationSection(body, policy) {
  const source = String(body || '');
  const marker = escapeRegExp(policy.sectionMarker || DEFAULT_SECTION_MARKER);
  const boundary = new RegExp(`<!--\\s*${marker}:(start|end)\\s*-->`, 'g');
  let boundaries = [];
  let fence = null;
  let fenceStart = 0;
  for (const match of source.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const line = match[0].replace(/\r?\n$/, '');
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence[0]
        && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = null;
      continue;
    }
    if (delimiter) { fence = delimiter[1]; fenceStart = match.index; continue; }
    const inlineCode = [...line.matchAll(/(`+)(.*?)\1/g)];
    for (const found of line.matchAll(boundary)) {
      if (inlineCode.some(code => found.index >= code.index && found.index < code.index + code[0].length)) continue;
      boundaries = [...boundaries, { kind: found[1], index: match.index + found.index,
        length: found[0].length }];
    }
  }
  if (fence && boundaries.length !== 2 && new RegExp(boundary.source).test(source.slice(fenceStart))) {
    throw new SyntaxError('Malformed coordination section inside an unclosed fence');
  }
  if (boundaries.length === 0) return null;
  if (boundaries.length !== 2 || boundaries[0].kind !== 'start' || boundaries[1].kind !== 'end') {
    throw new SyntaxError('Malformed coordination section boundaries or JSON fence');
  }
  const [start, end] = boundaries;
  const content = source.slice(start.index + start.length, end.index);
  const payload = content.match(/^\s*```json[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*\s*$/);
  if (!payload) throw new SyntaxError('Malformed coordination section boundaries or JSON fence');
  return { start: start.index, end: end.index + end.length, payload: payload[1] };
}

function extractCoordinationState(body, policy = DEFAULT_POLICY) {
  const section = coordinationSection(body, policy);
  if (!section) return null;

  let parsed;
  try {
    parsed = JSON.parse(section.payload);
  } catch {
    // Native JSON errors can quote source text; do not leak issue content.
    throw new SyntaxError('Malformed coordination JSON in body');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SyntaxError('Coordination JSON must be an object');
  }
  return parsed;
}

function extractIssueReferences(text) {
  const refs = new Set();
  const source = String(text || '');
  for (const match of source.matchAll(/(?:^|[^\d])#(\d+)\b/g)) {
    refs.add(Number.parseInt(match[1], 10));
  }
  return Array.from(refs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function extractTasks(body) {
  const lines = String(body || '').split(/\r?\n/);
  const tasks = [];
  let inTasks = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^#{2,3}\s+tasks\b/i.test(line) || /^#{2,3}\s+task list\b/i.test(line)) {
      inTasks = true;
      continue;
    }
    if (inTasks && /^#{2,3}\s+\S/.test(line)) {
      break;
    }
    if (inTasks) {
      const taskMatch = line.match(/^- \[( |x)\]\s+(.+)$/i);
      if (taskMatch) {
        tasks.push({
          title: taskMatch[2].trim(),
          done: taskMatch[1].toLowerCase() === 'x'
        });
      }
    }
  }

  return tasks;
}

function parseStringList(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function renderCoordinationState(state, policy = DEFAULT_POLICY) {
  const marker = policy.sectionMarker || DEFAULT_SECTION_MARKER;
  const payload = {
    schemaVersion: state.schemaVersion || policy.schemaVersion || DEFAULT_SCHEMA_VERSION,
    kind: state.kind || 'epic',
    status: state.status || 'available',
    owner: state.owner || null,
    branch: state.branch || null,
    validation: state.validation || 'pending',
    review: state.review || 'not-requested',
    project: state.project || { state: 'backlog', fields: {} },
    dependencies: Array.isArray(state.dependencies) ? state.dependencies : [],
    tasks: Array.isArray(state.tasks) ? state.tasks : [],
    labels: Array.isArray(state.labels) ? state.labels : [],
    lastAction: state.lastAction || 'sync',
    lastActionAt: state.lastActionAt || new Date().toISOString(),
    lastSyncAt: state.lastSyncAt || new Date().toISOString(),
    notes: state.notes || null
  };

  return [`<!-- ${marker}:start -->`, '```json', JSON.stringify(payload, null, 2), '```', `<!-- ${marker}:end -->`].join('\n');
}

function mergeIssueBody(issue, nextState, policy = DEFAULT_POLICY) {
  const body = String(issue.body || '');
  // Present but damaged metadata must not be replaced by inferred defaults.
  extractCoordinationState(body, policy);
  const section = coordinationSection(body, policy);
  const rendered = renderCoordinationState(nextState, policy);
  if (section) {
    return `${body.slice(0, section.start)}${rendered}\n${body.slice(section.end)}`.trim() + '\n';
  }

  const trimmed = body.trimEnd();
  if (!trimmed) {
    return `${rendered}\n`;
  }

  return `${trimmed}\n\n${rendered}\n`;
}

module.exports = {
  escapeRegExp,
  extractCoordinationState,
  extractIssueReferences,
  extractTasks,
  mergeIssueBody,
  normalizeBodyForComparison,
  parseStringList,
  renderCoordinationState
};
