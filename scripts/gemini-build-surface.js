#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = __dirname.endsWith(`${path.sep}scripts`) ? path.resolve(__dirname, '..') : process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

const geminiRoot = path.join(repoRoot, '.gemini');
const extensionRoot = path.join(repoRoot, 'extensions', 'ecc-gemini');

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

const CLAUDE_MODEL_ALIASES = new Set(['opus', 'sonnet', 'haiku']);

function rmDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyDir(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source directory: ${path.relative(repoRoot, sourcePath)}`);
  }
  ensureDir(path.dirname(destinationPath));
  fs.cpSync(sourcePath, destinationPath, {
    recursive: true,
    dereference: true,
    force: true,
    errorOnExist: false,
  });
}

function listFiles(dirPath, extension) {
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(extension))
    .map(entry => entry.name)
    .sort();
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: '', body: text, hasFrontmatter: false };
  }
  return {
    frontmatter: match[1],
    body: text.slice(match[0].length),
    hasFrontmatter: true,
  };
}

function stripQuotes(value) {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function parseInlineToolList(line) {
  const match = line.match(/^(\s*tools\s*:\s*)\[(.*)\]\s*$/);
  if (!match) {
    return null;
  }

  const rawItems = match[2].trim();
  if (!rawItems) {
    return [];
  }

  return rawItems
    .split(',')
    .map(part => stripQuotes(part))
    .filter(Boolean);
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

function adaptAgentMarkdown(source) {
  const parsed = parseFrontmatter(source);
  if (!parsed.hasFrontmatter) {
    return source;
  }

  const lines = parsed.frontmatter.split(/\r?\n/);
  const updatedLines = [];
  let hasKind = false;
  let insertedKind = false;

  for (const line of lines) {
    if (/^\s*kind\s*:/.test(line)) {
      hasKind = true;
    }
  }

  for (const line of lines) {
    if (/^\s*color\s*:/.test(line)) {
      continue;
    }

    const modelMatch = line.match(/^\s*model\s*:\s*(.+?)\s*$/);
    if (modelMatch && CLAUDE_MODEL_ALIASES.has(stripQuotes(modelMatch[1]))) {
      continue;
    }

    const tools = parseInlineToolList(line);
    if (tools) {
      const seen = new Set();
      const adaptedTools = [];
      for (const tool of tools.map(adaptToolName)) {
        if (!seen.has(tool)) {
          seen.add(tool);
          adaptedTools.push(tool);
        }
      }
      updatedLines.push(formatToolLine(adaptedTools));
      continue;
    }

    updatedLines.push(line);

    if (!hasKind && !insertedKind && /^\s*description\s*:/.test(line)) {
      updatedLines.push('kind: local');
      insertedKind = true;
    }
  }

  return `---\n${updatedLines.join('\n')}\n---\n${parsed.body}`;
}

function readFrontmatterValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!match) {
    return '';
  }
  return stripQuotes(match[1]);
}

function tomlString(value) {
  return JSON.stringify(value);
}

function tomlLiteralMultiline(value) {
  if (value.includes("'''")) {
    throw new Error('Cannot write TOML literal string containing triple single quotes');
  }
  return `'''\n${value.trimEnd()}\n'''`;
}

function commandPromptFromMarkdown(source, commandName) {
  const parsed = parseFrontmatter(source);
  const description = parsed.hasFrontmatter
    ? readFrontmatterValue(parsed.frontmatter, 'description')
    : `Run the ECC ${commandName} workflow.`;
  const body = parsed.body.replace(/\$ARGUMENTS/g, '{{args}}').trim();
  const prompt = [
    `# ECC Command: /${commandName}`,
    '',
    'This Gemini custom command adapts the equivalent ECC command prompt.',
    'When arguments are supplied, Gemini CLI injects them through `{{args}}`.',
    '',
    body,
  ].join('\n');

  return [
    `description = ${tomlString(description || `Run the ECC ${commandName} workflow.`)}`,
    `prompt = ${tomlLiteralMultiline(prompt)}`,
    '',
  ].join('\n');
}

function writeGeminiContext(destinationPath, extensionMode = false) {
  const lines = [
    '# ECC for Gemini CLI',
    '',
    'ECC provides Gemini CLI with an instruction layer plus discoverable skills, subagents, and custom commands generated from the canonical ECC repository assets.',
    '',
    '## Operating Rules',
    '',
    '- Follow the repository `AGENTS.md` guidance when working inside an ECC checkout.',
    '- Use ECC skills from `skills/` for specialized workflows instead of loading all workflow detail into context.',
    '- Use ECC agents from `agents/` for isolated review, planning, research, and implementation support when Gemini CLI subagents are enabled.',
    '- Use ECC commands from `commands/` as reusable slash-command prompts.',
    '- Treat hooks from other harnesses as documented policy unless Gemini CLI native hooks are installed and trusted.',
    '',
    '## Surfaces',
    '',
    '- Skills: `skills/<name>/SKILL.md`',
    '- Agents: `agents/<name>.md`',
    '- Commands: `commands/<name>.toml`',
  ];

  if (!extensionMode) {
    lines.push('', '## Shared Project Instructions', '', '@../AGENTS.md');
  }

  fs.writeFileSync(destinationPath, `${lines.join('\n')}\n`);
}

function buildAgents(sourceAgentsDir, destinationAgentsDir) {
  rmDir(destinationAgentsDir);
  ensureDir(destinationAgentsDir);
  for (const fileName of listFiles(sourceAgentsDir, '.md')) {
    const source = fs.readFileSync(path.join(sourceAgentsDir, fileName), 'utf8');
    fs.writeFileSync(path.join(destinationAgentsDir, fileName), adaptAgentMarkdown(source));
  }
}

function buildCommands(sourceCommandsDir, destinationCommandsDir) {
  rmDir(destinationCommandsDir);
  ensureDir(destinationCommandsDir);
  for (const fileName of listFiles(sourceCommandsDir, '.md')) {
    const commandName = path.basename(fileName, '.md');
    const source = fs.readFileSync(path.join(sourceCommandsDir, fileName), 'utf8');
    fs.writeFileSync(
      path.join(destinationCommandsDir, `${commandName}.toml`),
      commandPromptFromMarkdown(source, commandName),
    );
  }
}

function buildProjectSurface() {
  ensureDir(geminiRoot);
  writeGeminiContext(path.join(geminiRoot, 'GEMINI.md'), false);
  buildAgents(path.join(repoRoot, 'agents'), path.join(geminiRoot, 'agents'));
  buildCommands(path.join(repoRoot, 'commands'), path.join(geminiRoot, 'commands'));
  rmDir(path.join(geminiRoot, 'skills'));
  copyDir(path.join(repoRoot, 'skills'), path.join(geminiRoot, 'skills'));
}

function buildExtensionSurface() {
  rmDir(extensionRoot);
  ensureDir(extensionRoot);
  writeGeminiContext(path.join(extensionRoot, 'GEMINI.md'), true);
  buildAgents(path.join(repoRoot, 'agents'), path.join(extensionRoot, 'agents'));
  buildCommands(path.join(repoRoot, 'commands'), path.join(extensionRoot, 'commands'));
  copyDir(path.join(repoRoot, 'skills'), path.join(extensionRoot, 'skills'));

  const manifest = {
    name: 'ecc-gemini',
    version: packageJson.version,
    description: 'ECC workflows for Gemini CLI: context, skills, subagents, and custom commands.',
    contextFileName: 'GEMINI.md',
  };

  fs.writeFileSync(
    path.join(extensionRoot, 'gemini-extension.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function main() {
  buildProjectSurface();
  buildExtensionSurface();
  console.log('[ecc-gemini] Built .gemini/ and extensions/ecc-gemini/');
}

try {
  main();
} catch (error) {
  console.error(`[ecc-gemini] ${error.message}`);
  process.exit(1);
}
