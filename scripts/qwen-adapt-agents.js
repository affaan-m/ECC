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

function adaptColor(line) {
  const trimmed = line.trimStart();
  const colon = trimmed.indexOf(':');
  if (colon < 0 || trimmed.slice(0, colon).trimEnd() !== 'color') {
    return null;
  }
  const rawValue = trimmed.slice(colon + 1).trim();
  if (!rawValue) return null;
  const indent = line.slice(0, line.length - trimmed.length);
  const value = rawValue.replace(/^["']|["']$/g, '');
  if (VALID_COLORS.has(value)) {
    return { line, changed: false };
  }

  const remapped = COLOR_MAP.get(value);
  if (remapped) {
    return { line: `${indent}color: ${remapped}`, changed: true };
  }

  return { line: null, changed: true };
}

function adaptFrontmatter(text) {
  // Normalize CRLF first. Matching only LF would silently skip a Windows-saved
  // agent and report it as already compatible while `tools: Read` and
  // `color: teal` stayed in place. The original ending style is restored below.
  const usesCrlf = text.includes('\r\n');
  const source = usesCrlf ? text.replace(/\r\n/g, '\n') : text;

  const match = source.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!match) {
    return { text, changed: false };
  }

  const firstMappingLine = match[1].split('\n').find(line => line.trim() && !line.trimStart().startsWith('#'));
  if (firstMappingLine && /^\s/.test(firstMappingLine)) {
    throw new Error('Unsupported indented Qwen agent frontmatter: use unindented root mapping keys');
  }

  const frontmatter = yaml.load(match[1]);
  const hasTools = frontmatter && Object.hasOwn(frontmatter, 'tools');
  const sourceTools = hasTools ? normalizeAgentTools(frontmatter.tools) : null;
  // Qwen 0.25.0 definition files interpret [] as inherit-all, unlike its
  // internal runtime ToolConfig. Reject rather than broaden source authority.
  // https://github.com/QwenLM/qwen-code/blob/v0.25.0/packages/core/src/subagents/subagent-manager.ts#L1661-L1685
  if (hasTools && sourceTools.length === 0) {
    throw new Error('Unsupported empty tools allowlist: Qwen Code inherits all tools for an empty agent list; omit tools only when inheritance is intended');
  }

  if (hasTools && !/^tools\s*:/m.test(match[1])) {
    throw new Error('Unsupported Qwen tools key format: use an unquoted root tools key');
  }

  let changed = false;
  const updatedLines = [];

  const lines = match[1].split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // Claude tiers are not Qwen provider IDs; inherit the configured session.
    if (/^model:\s*["']?(haiku|sonnet|opus)["']?\s*$/.test(line)) {
      updatedLines.push('model: inherit');
      changed = true;
      continue;
    }
    const color = line === line.trimStart() ? adaptColor(line) : null;
    if (color) {
      if (color.changed) {
        changed = true;
      }
      if (color.line !== null) {
        updatedLines.push(color.line);
      }
      continue;
    }

    if (/^tools\s*:/.test(line) && hasTools) {
      // YAML permits sequence items at the same indentation as their key.
      // Consume both list styles before publishing the native scalar.
      while (index + 1 < lines.length
        && /^(?:\s|#|$|-(?:\s|$))/.test(lines[index + 1])) {
        index += 1;
        changed = true;
      }
      const adaptedTools = [];
      const seen = new Set();

      for (const tool of sourceTools.map(adaptToolName)) {
        if (!tool || seen.has(tool)) {
          continue;
        }
        seen.add(tool);
        adaptedTools.push(tool);
      }

      const updatedLine = formatToolLine(adaptedTools);
      if (updatedLine !== line) {
        changed = true;
      }
      updatedLines.push(updatedLine);
      continue;
    }

    updatedLines.push(line);
  }

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

  const adapted = `---\n${updatedLines.join('\n')}\n---${match[2]}${source.slice(match[0].length)}`;

  return {
    text: usesCrlf ? adapted.replace(/\n/g, '\r\n') : adapted,
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
