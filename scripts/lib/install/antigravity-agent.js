'use strict';

const { normalizeAgentTools } = require('../agent-tools');

const TOOL_NAMES = Object.freeze({
  Read: 'view_file',
  ReadFile: 'view_file',
  NotebookRead: 'view_file',
  Write: 'write_to_file',
  Edit: 'replace_file_content',
  MultiEdit: 'replace_file_content',
  Grep: 'grep_search',
  Glob: 'find_by_name',
  Bash: 'run_command',
  WebSearch: 'search_web',
  WebFetch: 'read_url_content',
});

const MODEL_NAMES = Object.freeze({
  haiku: 'flash',
  sonnet: 'pro',
  opus: 'pro',
});

function splitFrontmatter(source, label) {
  const raw = String(source || '');
  const match = raw.match(/^---(\r?\n)([\s\S]*?)\r?\n---(\r?\n)/);
  if (!match) {
    throw new Error(`Cannot adapt Antigravity agent ${label}: missing YAML frontmatter`);
  }

  // Keep YAML loading behind the transform boundary. Public help commands load
  // the installer graph without executing a transform, including in hermetic
  // packed-artifact checks where runtime dependencies are intentionally absent.
  const frontmatter = require('js-yaml').load(match[2]);
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(`Cannot adapt Antigravity agent ${label}: frontmatter must be an object`);
  }

  return {
    frontmatter,
    body: raw.slice(match[0].length),
    headerEol: match[1],
    trailingFenceEol: match[3],
  };
}

function normalizeToolNames(value) {
  return [...new Set(normalizeAgentTools(value)
    .filter(name => Object.hasOwn(TOOL_NAMES, name))
    .map(name => TOOL_NAMES[name]))];
}

function adaptAntigravityAgent(source, label = '<unknown>') {
  const { frontmatter, body, headerEol, trailingFenceEol } = splitFrontmatter(source, label);
  const { color: _claudeColor, ...supportedFrontmatter } = frontmatter;
  const adapted = { ...supportedFrontmatter };
  if (Object.hasOwn(frontmatter, 'tools')) {
    adapted.tools = normalizeToolNames(frontmatter.tools);
  }
  if (Object.hasOwn(frontmatter, 'model')) {
    adapted.model = Object.hasOwn(MODEL_NAMES, frontmatter.model)
      ? MODEL_NAMES[frontmatter.model]
      : frontmatter.model;
  }
  const serialized = require('js-yaml')
    .dump(adapted, { lineWidth: -1, noRefs: true })
    .trimEnd()
    .replace(/\n/g, headerEol);
  return `---${headerEol}${serialized}${headerEol}---${trailingFenceEol}${body}`;
}

module.exports = {
  adaptAntigravityAgent,
  MODEL_NAMES,
  TOOL_NAMES,
};
