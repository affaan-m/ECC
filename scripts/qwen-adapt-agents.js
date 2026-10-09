#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
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

function parseToolList(line) {
  const match = line.match(/^\s*tools\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }

  return normalizeAgentTools(match[1]);
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
  const match = line.match(/^(\s*)color\s*:\s*(.+?)\s*$/);
  if (!match) {
    return null;
  }

  const value = match[2].replace(/^["']|["']$/g, '');
  if (VALID_COLORS.has(value)) {
    return { line, changed: false };
  }

  const remapped = COLOR_MAP.get(value);
  if (remapped) {
    return { line: `${match[1]}color: ${remapped}`, changed: true };
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

  let changed = false;
  const updatedLines = [];

  for (const line of match[1].split('\n')) {
    const color = adaptColor(line);
    if (color) {
      if (color.changed) {
        changed = true;
      }
      if (color.line !== null) {
        updatedLines.push(color.line);
      }
      continue;
    }

    const tools = parseToolList(line);
    if (tools) {
      const adaptedTools = [];
      const seen = new Set();

      for (const tool of tools.map(adaptToolName)) {
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

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }

    const filePath = path.join(dirPath, entry.name);
    const original = fs.readFileSync(filePath, 'utf8');
    const adapted = adaptFrontmatter(original);

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

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
