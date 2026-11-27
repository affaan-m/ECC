#!/usr/bin/env node
/**
 * Generate a deterministic command-to-agent/skill registry.
 *
 * Usage:
 *   node scripts/ci/generate-command-registry.js
 *   node scripts/ci/generate-command-registry.js --json
 *   node scripts/ci/generate-command-registry.js --write
 *   node scripts/ci/generate-command-registry.js --check
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DEFAULT_OUTPUT_PATH = path.join(ROOT, 'docs', 'COMMAND-REGISTRY.json');

function normalizePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function listMarkdownFiles(root, relativeDir) {
  const directory = path.join(root, relativeDir);
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort();
}

function listKnownAgents(root) {
  return new Set(
    listMarkdownFiles(root, 'agents')
      .map(filename => filename.replace(/\.md$/, ''))
  );
}

function listKnownSkills(root) {
  const skillsDir = path.join(root, 'skills');
  if (!fs.existsSync(skillsDir)) {
    return new Set();
  }

  return new Set(
    fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(entry => (
        entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md'))
      ))
      .map(entry => entry.name)
      .sort()
  );
}

function cleanYamlScalar(value) {
  return value.trim()
    .replace(/^['"]/, '')
    .replace(/['"]$/, '');
}

function extractDescription(content) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter) {
    const description = frontmatter[1].match(/^description:\s*(.+)$/m);
    if (description) {
      return cleanYamlScalar(description[1]);
    }
  }

  const heading = content.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : '';
}

function collectKnownReferences(content, patterns, knownNames) {
  const refs = new Set();

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const ref = match[1];
      if (knownNames.has(ref)) {
        refs.add(ref);
      }
    }
  }

  return refs;
}

function extractReferences(content, knownAgents, knownSkills) {
  const agentPatterns = [
    /@([a-z][a-z0-9-]*)/gi,
    /\bagent:\s*['"]?([a-z][a-z0-9-]*)/gi,
    /\bsubagent(?:_type)?:\s*['"]?([a-z][a-z0-9-]*)/gi,
    /\bagents\/([a-z][a-z0-9-]*)\.md\b/gi,
  ];

  const skillPatterns = [
    /\bskill:\s*['"]?\/?([a-z][a-z0-9-]*)/gi,
    /\bskills\/([a-z][a-z0-9-]*)\/SKILL\.md\b/gi,
    /\bskills\/([a-z][a-z0-9-]*)\b/gi,
    /\/([a-z][a-z0-9-]*)\b/gi,
  ];

  return {
    agents: Array.from(collectKnownReferences(content, agentPatterns, knownAgents)).sort(),
    skills: Array.from(collectKnownReferences(content, skillPatterns, knownSkills)).sort(),
  };
}

function inferCommandType(content, commandName) {
  const lower = `${commandName}\n${content}`.toLowerCase();

  if (commandName.startsWith('multi-') || lower.includes('orchestrat')) {
    return 'orchestration';
  }
  if (lower.includes('test') || lower.includes('tdd') || lower.includes('coverage')) {
    return 'testing';
  }
  if (lower.includes('review') || lower.includes('audit') || lower.includes('security')) {
    return 'review';
  }
  if (lower.includes('plan') || lower.includes('design') || lower.includes('architecture')) {
    return 'planning';
  }
  if (lower.includes('refactor') || lower.includes('clean') || lower.includes('simplify')) {
    return 'refactoring';
  }
  if (lower.includes('build') || lower.includes('compile') || lower.includes('setup')) {
    return 'build';
  }

  return 'general';
}

function processCommandFile(root, filename, knownAgents, knownSkills) {
  const commandName = filename.replace(/\.md$/, '');
  const relativePath = normalizePath(path.join('commands', filename));
  const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const references = extractReferences(content, knownAgents, knownSkills);

  return {
    command: commandName,
    description: extractDescription(content),
    type: inferCommandType(content, commandName),
    primaryAgents: references.agents.slice(0, 3),
    allAgents: references.agents,
    skills: references.skills,
    path: relativePath,
  };
}

function sortCountMap(countMap) {
  return Object.fromEntries(
    Object.entries(countMap).sort(([left], [right]) => left.localeCompare(right))
  );
}

function topUsage(countMap, keyName) {
  return Object.entries(countMap)
    .sort(([leftName, leftCount], [rightName, rightCount]) => (
      rightCount - leftCount || leftName.localeCompare(rightName)
    ))
    .slice(0, 10)
    .map(([name, count]) => ({ [keyName]: name, count }));
}

function generateRegistry(options = {}) {
  const root = options.root || ROOT;
  const commandFiles = listMarkdownFiles(root, 'commands');
  const knownAgents = listKnownAgents(root);
  const knownSkills = listKnownSkills(root);

  const commands = commandFiles.map(filename => (
    processCommandFile(root, filename, knownAgents, knownSkills)
  ));

  const byType = {};
  const agentUsage = {};
  const skillUsage = {};

  for (const command of commands) {
    byType[command.type] = (byType[command.type] || 0) + 1;
    for (const agent of command.allAgents) {
      agentUsage[agent] = (agentUsage[agent] || 0) + 1;
    }
    for (const skill of command.skills) {
      skillUsage[skill] = (skillUsage[skill] || 0) + 1;
    }
  }

  return {
    schemaVersion: 1,
    totalCommands: commands.length,
    commands,
    statistics: {
      byType: sortCountMap(byType),
      topAgents: topUsage(agentUsage, 'agent'),
      topSkills: topUsage(skillUsage, 'skill'),
    },
  };
}

function formatRegistry(registry) {
  return `${JSON.stringify(registry, null, 2)}\n`;
}

function writeRegistry(registry, outputPath = DEFAULT_OUTPUT_PATH) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, formatRegistry(registry), 'utf8');
}

function checkRegistry(registry, outputPath = DEFAULT_OUTPUT_PATH) {
  const expected = formatRegistry(registry);
  let current;

  try {
    current = fs.readFileSync(outputPath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read ${normalizePath(path.relative(ROOT, outputPath))}: ${error.message}`);
  }

  if (current !== expected) {
    throw new Error(`${normalizePath(path.relative(ROOT, outputPath))} is out of date; run npm run command-registry:write`);
  }
}

function formatTextSummary(registry) {
  const lines = [
    'Command registry statistics',
    '',
    `Total commands: ${registry.totalCommands}`,
    '',
    'By type:',
  ];

  for (const [type, count] of Object.entries(registry.statistics.byType)) {
    lines.push(`  ${type}: ${count}`);
  }

  lines.push('', 'Top agents:');
  for (const { agent, count } of registry.statistics.topAgents) {
    lines.push(`  ${agent}: ${count}`);
  }

  lines.push('', 'Top skills:');
  for (const { skill, count } of registry.statistics.topSkills) {
    lines.push(`  ${skill}: ${count}`);
  }

  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const allowed = new Set(['--json', '--write', '--check']);
  const flags = new Set();

  for (const arg of argv) {
    if (!allowed.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    flags.add(arg);
  }

  return {
    json: flags.has('--json'),
    write: flags.has('--write'),
    check: flags.has('--check'),
  };
}

function run(argv = process.argv.slice(2), options = {}) {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const outputPath = options.outputPath || DEFAULT_OUTPUT_PATH;

  try {
    const args = parseArgs(argv);
    const registry = generateRegistry({ root: options.root || ROOT });

    if (args.check) {
      checkRegistry(registry, outputPath);
      stdout.write('Command registry is up to date.\n');
      return 0;
    }

    if (args.write) {
      writeRegistry(registry, outputPath);
      stdout.write(`Command registry written to ${normalizePath(path.relative(process.cwd(), outputPath))}\n`);
      return 0;
    }

    stdout.write(args.json ? formatRegistry(registry) : formatTextSummary(registry));
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(run());
}

module.exports = {
  checkRegistry,
  extractDescription,
  extractReferences,
  formatRegistry,
  generateRegistry,
  inferCommandType,
  parseArgs,
  run,
  writeRegistry,
};
