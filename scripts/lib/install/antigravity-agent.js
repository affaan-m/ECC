'use strict';

const TOOL_NAMES = Object.freeze({
  Read: 'view_file',
  Write: 'write_to_file',
  Edit: 'replace_file_content',
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
  const match = String(source || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    throw new Error(`Cannot adapt Antigravity agent ${label}: missing YAML frontmatter`);
  }

  const frontmatter = require('js-yaml').load(match[1]);
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(`Cannot adapt Antigravity agent ${label}: frontmatter must be an object`);
  }

  return {
    frontmatter,
    body: source.slice(match[0].length),
  };
}

function normalizeToolNames(value) {
  const names = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(names
    .map(name => String(name).trim())
    .filter(name => Object.hasOwn(TOOL_NAMES, name))
    .map(name => TOOL_NAMES[name]))];
}

function adaptAntigravityAgent(source, label = '<unknown>') {
  const { frontmatter, body } = splitFrontmatter(source, label);
  const { color: _claudeColor, ...supportedFrontmatter } = frontmatter;
  const adapted = {
    ...supportedFrontmatter,
    tools: normalizeToolNames(frontmatter.tools),
    model: MODEL_NAMES[frontmatter.model] || frontmatter.model,
  };
  const serialized = require('js-yaml')
    .dump(adapted, { lineWidth: -1, noRefs: true })
    .trimEnd();
  return `---\n${serialized}\n---\n${body}`;
}

module.exports = {
  adaptAntigravityAgent,
};
