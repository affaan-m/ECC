#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { normalizeAgentTools } = require('./lib/agent-tools');

// Qwen Code is a Gemini CLI descendant, so most tool ids match Gemini's. Three
// entries deliberately differ from gemini-adapt-agents.js:
//
//   Edit      -> edit            (Gemini uses `replace`)
//   WebSearch -> web_search      (Gemini uses `google_web_search`)
//   mcp__*    -> unchanged       (Gemini lowercases to mcp_server_tool; Qwen
//                                 keeps the double-underscore form)
const TOOL_NAME_MAP = new Map([
  ['Read', 'read_file'],
  ['ReadFile', 'read_file'],
  ['NotebookRead', 'read_file'],
  ['Write', 'write_file'],
  ['Edit', 'edit'],
  ['MultiEdit', 'edit'],
  ['Bash', 'run_shell_command'],
  ['Grep', 'grep_search'],
  ['Glob', 'glob'],
  ['WebFetch', 'web_fetch'],
  // `web_search` is a deferred tool and only resolves for providers that offer a
  // search agent, so it is not universally present. Mapping it is still the
  // better default than dropping it: where the provider supports it the agent
  // gains the capability, and where it does not Qwen Code ignores an unresolvable
  // entry in `tools:` without warning.
  ['WebSearch', 'web_search'],
  ['TodoWrite', 'todo_write'],
  ['Task', 'agent'],
]);

// Qwen Code supports `color:`, but only this palette. An unlisted value is
// dropped at load time with a SUBAGENT_MANAGER warning, so remap where the
// intent is clear and drop the rest rather than shipping a field that warns.
const VALID_COLORS = new Set([
  'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan', 'auto',
]);
const COLOR_MAP = new Map([['teal', 'cyan']]);

function usage() {
  return [
    'Adapt ECC agent frontmatter for Qwen Code.',
    '',
    'Usage:',
    '  node scripts/qwen-adapt-agents.js [agents-dir]',
    '',
    "Defaults to .qwen/agents under the current working directory.",
    'Rewrites tools: to Qwen Code tool ids and remaps color: values outside the',
    'Qwen Code palette.',
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith('-')) {
      // Reject rather than ignore. This script rewrites files in place, so
      // silently discarding an unrecognized flag would let `--dry-run` — or any
      // mistyped option — modify every installed agent and still exit 0.
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length > 1) {
    throw new Error('Expected at most one agents directory argument');
  }

  return {
    help: false,
    agentsDir: path.resolve(positional[0] || path.join(process.cwd(), '.qwen', 'agents')),
  };
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Agents directory not found: ${dirPath}`);
  }

  if (!fs.statSync(dirPath).isDirectory()) {
    throw new Error(`Expected a directory: ${dirPath}`);
  }
}

function adaptToolName(toolName) {
  const mapped = TOOL_NAME_MAP.get(toolName);
  if (mapped) {
    return mapped;
  }

  // Qwen Code keeps the mcp__server__tool shape, so MCP entries pass through.
  return toolName;
}

function formatToolLine(tools) {
  // Comma-separated scalar rather than the JSON flow sequence
  // gemini-adapt-agents.js emits: Qwen Code parses both, and the scalar form is
  // what its own agent examples use.
  return `tools: ${tools.join(', ')}`;
}

function stripUnquotedYamlComment(value) {
  let quote = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (character === "'" && value[index + 1] === "'") index += 1;
      else if (character === "'") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#' && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trim();
    }
  }

  return value.trim();
}

function unquoteYamlScalar(rawValue) {
  if (
    rawValue.length >= 2
    && ((rawValue.startsWith('"') && rawValue.endsWith('"'))
      || (rawValue.startsWith("'") && rawValue.endsWith("'")))
  ) {
    return rawValue.slice(1, -1);
  }
  return rawValue;
}

function adaptModel(line) {
  const match = line.match(/^model\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }
  const value = unquoteYamlScalar(stripUnquotedYamlComment(match[1]));
  if (value === 'haiku' || value === 'sonnet' || value === 'opus') {
    return { line: 'model: inherit', changed: true };
  }
  return null;
}

function adaptColor(line) {
  const trimmed = line.trimStart();
  const colon = trimmed.indexOf(':');
  if (colon < 0 || trimmed.slice(0, colon).trimEnd() !== 'color') {
    return null;
  }
  const rawValue = stripUnquotedYamlComment(trimmed.slice(colon + 1));
  if (!rawValue) return null;
  const indent = line.slice(0, line.length - trimmed.length);
  const value = unquoteYamlScalar(rawValue);
  if (VALID_COLORS.has(value)) {
    return { line, changed: false };
  }

  const remapped = COLOR_MAP.get(value);
  if (remapped) {
    return { line: `${indent}color: ${remapped}`, changed: true };
  }

  return { line: null, changed: true };
}

function advanceFlowBracketState(rawLine, state) {
  for (let index = 0; index < rawLine.length; index += 1) {
    const ch = rawLine[index];
    if (state.quote === '"') {
      if (state.escaped) state.escaped = false;
      else if (ch === '\\') state.escaped = true;
      else if (ch === '"') state.quote = null;
      continue;
    }
    if (state.quote === "'") {
      if (ch === "'" && rawLine[index + 1] === "'") index += 1;
      else if (ch === "'") state.quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") state.quote = ch;
    else if (ch === '#' && (index === 0 || /\s/.test(rawLine[index - 1]))) break;
    else if (ch === '[') state.depth += 1;
    else if (ch === ']') state.depth -= 1;
  }
}

function findToolsBlockEnd(lines, startIndex) {
  const line = lines[startIndex];
  const afterColon = stripUnquotedYamlComment(line.slice(line.indexOf(':') + 1));
  const valuePart = afterColon.replace(/^(?:(?:&|!)[^\s]+\s*)+/, '');

  if (valuePart.startsWith('[')) {
    const state = { depth: 0, quote: null, escaped: false };
    advanceFlowBracketState(valuePart, state);
    let end = startIndex;
    while ((state.depth > 0 || state.quote !== null) && end + 1 < lines.length) {
      end += 1;
      advanceFlowBracketState(lines[end], state);
    }
    return end;
  }

  const allowIndentlessSequence = valuePart === '';
  let lastToolLine = startIndex;
  let lookahead = startIndex;
  while (lookahead + 1 < lines.length) {
    const nextLine = lines[lookahead + 1];
    const isBlankOrComment = /^\s*(?:#|$)/.test(nextLine);
    const isIndentedContent = /^[ \t]+[^#\s]/.test(nextLine);
    const isSequenceItem = allowIndentlessSequence && /^-(?:\s|$)/.test(nextLine);
    if (!isBlankOrComment && !isIndentedContent && !isSequenceItem) {
      break;
    }
    lookahead += 1;
    if (isIndentedContent || isSequenceItem) {
      lastToolLine = lookahead;
    }
  }
  return lastToolLine;
}

function buildAdaptedToolsLine(sourceTools) {
  const adaptedTools = [];
  const seen = new Set();

  for (const tool of sourceTools.map(adaptToolName)) {
    if (!tool || seen.has(tool)) {
      continue;
    }
    seen.add(tool);
    adaptedTools.push(tool);
  }

  return formatToolLine(adaptedTools);
}

function parseSourceTools(rawFrontmatter) {
  const firstMappingLine = rawFrontmatter.split('\n').find(line => line.trim() && !line.trimStart().startsWith('#'));
  if (firstMappingLine && /^\s/.test(firstMappingLine)) {
    throw new Error('Unsupported indented Qwen agent frontmatter: use unindented root mapping keys');
  }

  const frontmatter = yaml.load(rawFrontmatter);
  const hasTools = Boolean(frontmatter && Object.hasOwn(frontmatter, 'tools'));
  const sourceTools = hasTools ? normalizeAgentTools(frontmatter.tools) : null;
  // Qwen 0.25.0 definition files interpret [] as inherit-all, unlike its
  // internal runtime ToolConfig. Reject rather than broaden source authority.
  // https://github.com/QwenLM/qwen-code/blob/v0.25.0/packages/core/src/subagents/subagent-manager.ts#L1661-L1685
  if (hasTools && sourceTools.length === 0) {
    throw new Error('Unsupported empty tools allowlist: Qwen Code inherits all tools for an empty agent list; omit tools only when inheritance is intended');
  }

  if (hasTools && !/^tools\s*:/m.test(rawFrontmatter)) {
    throw new Error('Unsupported Qwen tools key format: use an unquoted root tools key');
  }

  return { hasTools, sourceTools };
}

function rewriteFrontmatterLines(lines, hasTools, sourceTools) {
  let changed = false;
  const updatedLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const model = adaptModel(line);
    if (model) {
      updatedLines.push(model.line);
      changed = true;
      continue;
    }
    const color = line === line.trimStart() ? adaptColor(line) : null;
    if (color) {
      if (color.changed) changed = true;
      if (color.line !== null) updatedLines.push(color.line);
      continue;
    }
    if (/^tools\s*:/.test(line) && hasTools) {
      const endIndex = findToolsBlockEnd(lines, index);
      if (endIndex > index) {
        index = endIndex;
        changed = true;
      }
      const updatedLine = buildAdaptedToolsLine(sourceTools);
      if (updatedLine !== line) changed = true;
      updatedLines.push(updatedLine);
      continue;
    }
    updatedLines.push(line);
  }

  return { changed, updatedLines };
}

function adaptFrontmatter(text) {
  const match = text.match(/^---(\r?\n)([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) {
    return { text, changed: false };
  }

  const headerEol = match[1];
  const trailingFenceEol = match[3];
  const originalBody = text.slice(match[0].length);
  const rawFrontmatter = match[2].replace(/\r\n/g, '\n');
  const { hasTools, sourceTools } = parseSourceTools(rawFrontmatter);
  const { changed, updatedLines } = rewriteFrontmatterLines(rawFrontmatter.split('\n'), hasTools, sourceTools);

  if (!changed) {
    return { text, changed: false };
  }

  // Aliases or other unsupported forms must fail during preflight, never
  // leave an invalid definition in either a standalone or managed install.
  try {
    yaml.load(updatedLines.join('\n'));
  } catch (_error) {
    throw new Error('Unsupported Qwen frontmatter conversion: transformed YAML is invalid; use a plain tools list');
  }

  const adaptedHeader = `---${headerEol}${updatedLines.join(headerEol)}${headerEol}---${trailingFenceEol}`;

  return {
    text: `${adaptedHeader}${originalBody}`,
    changed: true,
  };
}

function adaptAgents(dirPath) {
  ensureDirectory(dirPath);

  let updated = 0;
  let unchanged = 0;

  const prepared = [];
  // Validate the entire batch before rewriting any installed agent.
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }

    const filePath = path.join(dirPath, entry.name);
    const original = fs.readFileSync(filePath, 'utf8');
    let adapted;
    try {
      adapted = adaptFrontmatter(original);
    } catch (error) {
      throw new Error(`${entry.name}: ${error.message}`);
    }
    prepared.push({ filePath, adapted });
  }

  for (const { filePath, adapted } of prepared) {
    if (adapted.changed) {
      fs.writeFileSync(filePath, adapted.text);
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  return { updated, unchanged };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = adaptAgents(options.agentsDir);
  console.log(`Updated ${result.updated} agent file(s); ${result.unchanged} already compatible`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { adaptFrontmatter };
