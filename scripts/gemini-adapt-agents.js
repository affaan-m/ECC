#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeAgentTools } = require('./lib/agent-tools');

const TOOL_NAME_MAP = new Map([
  ['Read', 'read_file'],
  ['Write', 'write_file'],
  ['Edit', 'replace'],
  ['Bash', 'run_shell_command'],
  ['Grep', 'grep_search'],
  ['Glob', 'glob'],
  ['WebSearch', 'google_web_search'],
  ['WebFetch', 'web_fetch'],
]);

function usage() {
  return [
    'Adapt ECC agent frontmatter for Gemini CLI.',
    '',
    'Usage:',
    '  node scripts/gemini-adapt-agents.js [agents-dir]',
    '',
    'Defaults to .gemini/agents under the current working directory.',
    'Rewrites tools: to Gemini-compatible tool names and removes unsupported color: metadata.'
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  const positional = argv.filter(arg => !arg.startsWith('-'));
  if (positional.length > 1) {
    throw new Error('Expected at most one agents directory argument');
  }

  return {
    help: false,
    agentsDir: path.resolve(positional[0] || path.join(process.cwd(), '.gemini', 'agents')),
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

  if (toolName.startsWith('mcp__')) {
    return toolName
      .replace(/^mcp__/, 'mcp_')
      .replace(/__/g, '_')
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toLowerCase();
  }

  return toolName;
}

function formatToolLine(tools) {
  return `tools: [${tools.map(tool => JSON.stringify(tool)).join(', ')}]`;
}

function adaptFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!match) {
    return { text, changed: false };
  }

  let changed = false;
  const updatedLines = [];

  for (const line of match[1].split('\n')) {
    if (/^\s*color\s*:/.test(line)) {
      changed = true;
      continue;
    }

    const tools = parseToolList(line);
    if (tools) {
      const adaptedTools = [];
      const seen = new Set();

      for (const tool of tools.map(adaptToolName)) {
        if (seen.has(tool)) {
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

  return {
    text: `---\n${updatedLines.join('\n')}\n---${match[2]}${text.slice(match[0].length)}`,
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
