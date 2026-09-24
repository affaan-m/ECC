#!/usr/bin/env node
/**
 * Verify repo catalog counts against tracked documentation files.
 *
 * Usage:
 *   node scripts/ci/catalog.js
 *   node scripts/ci/catalog.js --json
 *   node scripts/ci/catalog.js --md
 *   node scripts/ci/catalog.js --text
 *   node scripts/ci/catalog.js --write --text
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const README_PATH = path.join(ROOT, 'README.md');
const AGENTS_PATH = path.join(ROOT, 'AGENTS.md');
const README_ZH_CN_PATH = path.join(ROOT, 'README.zh-CN.md');
const DOCS_ZH_CN_README_PATH = path.join(ROOT, 'docs', 'zh-CN', 'README.md');
const DOCS_ZH_CN_AGENTS_PATH = path.join(ROOT, 'docs', 'zh-CN', 'AGENTS.md');
const PLUGIN_JSON_PATH = path.join(ROOT, '.claude-plugin', 'plugin.json');
const MARKETPLACE_JSON_PATH = path.join(ROOT, '.claude-plugin', 'marketplace.json');
const WRITE_MODE = process.argv.includes('--write');

const OUTPUT_MODE = process.argv.includes('--md')
  ? 'md'
  : process.argv.includes('--text')
    ? 'text'
    : 'json';

function normalizePathSegments(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function listMatchingFiles(root, relativeDir, matcher) {
  const directory = path.join(root, relativeDir);
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => matcher(entry))
    .map(entry => normalizePathSegments(path.join(relativeDir, entry.name)))
    .sort();
}

function buildCatalog(root = ROOT) {
  const agents = listMatchingFiles(root, 'agents', entry => entry.isFile() && entry.name.endsWith('.md'));
  const commands = listMatchingFiles(root, 'commands', entry => entry.isFile() && entry.name.endsWith('.md'));
  const skills = listMatchingFiles(root, 'skills', entry => (
    entry.isDirectory() && fs.existsSync(path.join(root, 'skills', entry.name, 'SKILL.md'))
  )).map(skillDir => `${skillDir}/SKILL.md`);

  return {
    agents: { count: agents.length, files: agents, glob: 'agents/*.md' },
    commands: { count: commands.length, files: commands, glob: 'commands/*.md' },
    skills: { count: skills.length, files: skills, glob: 'skills/*/SKILL.md' }
  };
}

function readFileOrThrow(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read ${path.basename(filePath)}: ${error.message}`);
  }
}

function writeFileOrThrow(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    throw new Error(`Failed to write ${path.basename(filePath)}: ${error.message}`);
  }
}

function replaceOrThrow(content, regex, replacer, source) {
  if (!regex.test(content)) {
    throw new Error(`${source} is missing the expected catalog marker`);
  }

  return content.replace(regex, replacer);
}

function parseReadmeExpectations(readmeContent) {
  const expectations = [];

  const quickStartMatch = readmeContent.match(
    /access to\s+(\d+)\s+agents,\s+(\d+)\s+skills,\s+and\s+(\d+)\s+(?:commands|legacy command shims?)/i
  );
  if (!quickStartMatch) {
    throw new Error('README.md is missing the quick-start catalog summary');
  }

  expectations.push(
    { category: 'agents', mode: 'exact', expected: Number(quickStartMatch[1]), source: 'README.md quick-start summary' },
    { category: 'skills', mode: 'exact', expected: Number(quickStartMatch[2]), source: 'README.md quick-start summary' },
    { category: 'commands', mode: 'exact', expected: Number(quickStartMatch[3]), source: 'README.md quick-start summary' }
  );

  const releaseNoteMatch = readmeContent.match(
    /actual OSS surface:\s+(\d+)\s+agents,\s+(\d+)\s+skills,\s+and\s+(\d+)\s+legacy command shims/i
  );
  if (!releaseNoteMatch) {
    throw new Error('README.md is missing the rc.1 release-note catalog summary');
  }

  expectations.push(
    { category: 'agents', mode: 'exact', expected: Number(releaseNoteMatch[1]), source: 'README.md rc.1 release-note summary' },
    { category: 'skills', mode: 'exact', expected: Number(releaseNoteMatch[2]), source: 'README.md rc.1 release-note summary' },
    { category: 'commands', mode: 'exact', expected: Number(releaseNoteMatch[3]), source: 'README.md rc.1 release-note summary' }
  );

  const projectTreeAgentsMatch = readmeContent.match(/^\|\s*--\s*agents\/\s*#\s*(\d+)\s+specialized subagents for delegation\s*$/im);
  if (!projectTreeAgentsMatch) {
    throw new Error('README.md project tree is missing the agents count');
  }

  expectations.push({
    category: 'agents',
    mode: 'exact',
    expected: Number(projectTreeAgentsMatch[1]),
    source: 'README.md project tree (agents)'
  });

  const tablePatterns = [
    { category: 'agents', regex: /\|\s*(?:\*\*)?Agents(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s+agents\s*\|/i, source: 'README.md comparison table' },
    { category: 'commands', regex: /\|\s*(?:\*\*)?Commands(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s+commands(?:\s*\([^)]*\))?\s*\|/i, source: 'README.md comparison table' },
    { category: 'skills', regex: /\|\s*(?:\*\*)?Skills(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s+skills\s*\|/i, source: 'README.md comparison table' }
  ];

  for (const pattern of tablePatterns) {
    const match = readmeContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} row`);
    }

    expectations.push({
      category: pattern.category,
      mode: 'exact',
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  const parityPatterns = [
    {
      category: 'agents',
      regex: /^\|\s*(?:\*\*)?Agents(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*Shared\s*\(AGENTS\.md\)\s*\|\s*Shared\s*\(AGENTS\.md\)\s*\|\s*12\s*\|(?:\s*N\/A\s*\|)?$/im,
      source: 'README.md parity table'
    },
    {
      category: 'commands',
      regex: /^\|\s*(?:\*\*)?Commands(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*Shared\s*\|\s*Instruction-based\s*\|\s*\d+\s*\|(?:\s*\d+\s+prompts\s*\|)?$/im,
      source: 'README.md parity table'
    },
    {
      category: 'skills',
      regex: /^\|\s*(?:\*\*)?Skills(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*Shared\s*\|\s*10\s*\(native format\)\s*\|\s*37\s*\|(?:\s*Via instructions\s*\|)?$/im,
      source: 'README.md parity table'
    }
  ];

  for (const pattern of parityPatterns) {
    const match = readmeContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} row`);
    }

    expectations.push({
      category: pattern.category,
      mode: 'exact',
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  return expectations;
}

function parseZhRootReadmeExpectations(readmeContent) {
  const match = readmeContent.match(/你现在可以使用\s+(\d+)\s+个代理、\s*(\d+)\s*个技能和\s*(\d+)\s*个命令/i);
  if (!match) {
    throw new Error('README.zh-CN.md is missing the quick-start catalog summary');
  }

  return [
    { category: 'agents', mode: 'exact', expected: Number(match[1]), source: 'README.zh-CN.md quick-start summary' },
    { category: 'skills', mode: 'exact', expected: Number(match[2]), source: 'README.zh-CN.md quick-start summary' },
    { category: 'commands', mode: 'exact', expected: Number(match[3]), source: 'README.zh-CN.md quick-start summary' }
  ];
}

function parseZhDocsReadmeExpectations(readmeContent) {
  const expectations = [];

  const quickStartMatch = readmeContent.match(/你现在可以使用\s+(\d+)\s+个智能体、\s*(\d+)\s*项技能和\s*(\d+)\s*个命令了/i);
  if (!quickStartMatch) {
    throw new Error('docs/zh-CN/README.md is missing the quick-start catalog summary');
  }

  expectations.push(
    { category: 'agents', mode: 'exact', expected: Number(quickStartMatch[1]), source: 'docs/zh-CN/README.md quick-start summary' },
    { category: 'skills', mode: 'exact', expected: Number(quickStartMatch[2]), source: 'docs/zh-CN/README.md quick-start summary' },
    { category: 'commands', mode: 'exact', expected: Number(quickStartMatch[3]), source: 'docs/zh-CN/README.md quick-start summary' }
  );

  const tablePatterns = [
    { category: 'agents', regex: /\|\s*智能体\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s*个\s*\|/i, source: 'docs/zh-CN/README.md comparison table' },
    { category: 'commands', regex: /\|\s*命令\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s*个\s*\|/i, source: 'docs/zh-CN/README.md comparison table' },
    { category: 'skills', regex: /\|\s*技能\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s*项\s*\|/i, source: 'docs/zh-CN/README.md comparison table' }
  ];

  for (const pattern of tablePatterns) {
    const match = readmeContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} row`);
    }

    expectations.push({
      category: pattern.category,
      mode: 'exact',
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  const parityPatterns = [
    {
      category: 'agents',
      regex: /^\|\s*(?:\*\*)?智能体(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*共享\s*\(AGENTS\.md\)\s*\|\s*共享\s*\(AGENTS\.md\)\s*\|\s*12\s*\|$/im,
      source: 'docs/zh-CN/README.md parity table'
    },
    {
      category: 'commands',
      regex: /^\|\s*(?:\*\*)?命令(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*共享\s*\|\s*基于指令\s*\|\s*\d+\s*\|$/im,
      source: 'docs/zh-CN/README.md parity table'
    },
    {
      category: 'skills',
      regex: /^\|\s*(?:\*\*)?技能(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*共享\s*\|\s*10\s*\(原生格式\)\s*\|\s*37\s*\|$/im,
      source: 'docs/zh-CN/README.md parity table'
    }
  ];

  for (const pattern of parityPatterns) {
    const match = readmeContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} row`);
    }

    expectations.push({
      category: pattern.category,
      mode: 'exact',
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  return expectations;
}

function parseAgentsDocExpectations(agentsContent) {
  const summaryMatch = agentsContent.match(/providing\s+(\d+)\s+specialized agents,\s+(\d+)(\+)?\s+skills,\s+(\d+)\s+commands/i);
  if (!summaryMatch) {
    throw new Error('AGENTS.md is missing the catalog summary line');
  }

  const expectations = [
    { category: 'agents', mode: 'exact', expected: Number(summaryMatch[1]), source: 'AGENTS.md summary' },
    {
      category: 'skills',
      mode: summaryMatch[3] ? 'minimum' : 'exact',
      expected: Number(summaryMatch[2]),
      source: 'AGENTS.md summary'
    },
    { category: 'commands', mode: 'exact', expected: Number(summaryMatch[4]), source: 'AGENTS.md summary' }
  ];

  const structurePatterns = [
    {
      category: 'agents',
      mode: 'exact',
      regex: /^\s*agents\/\s*[—–-]\s*(\d+)\s+specialized subagents\s*$/im,
      source: 'AGENTS.md project structure'
    },
    {
      category: 'skills',
      mode: 'minimum',
      regex: /^\s*skills\/\s*[—–-]\s*(\d+)(\+)?\s+workflow skills and domain knowledge\s*$/im,
      source: 'AGENTS.md project structure'
    },
    {
      category: 'commands',
      mode: 'exact',
      regex: /^\s*commands\/\s*[—–-]\s*(\d+)\s+slash commands\s*$/im,
      source: 'AGENTS.md project structure'
    }
  ];

  for (const pattern of structurePatterns) {
    const match = agentsContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} entry`);
    }

    expectations.push({
      category: pattern.category,
      mode: pattern.mode === 'minimum' && match[2] ? 'minimum' : pattern.mode,
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  return expectations;
}

function parseZhAgentsDocExpectations(agentsContent) {
  const summaryMatch = agentsContent.match(/提供\s+(\d+)\s+个专业代理、\s*(\d+)(\+)?\s*项技能、\s*(\d+)\s+条命令/i);
  if (!summaryMatch) {
    throw new Error('docs/zh-CN/AGENTS.md is missing the catalog summary line');
  }

  const expectations = [
    { category: 'agents', mode: 'exact', expected: Number(summaryMatch[1]), source: 'docs/zh-CN/AGENTS.md summary' },
    {
      category: 'skills',
      mode: summaryMatch[3] ? 'minimum' : 'exact',
      expected: Number(summaryMatch[2]),
      source: 'docs/zh-CN/AGENTS.md summary'
    },
    { category: 'commands', mode: 'exact', expected: Number(summaryMatch[4]), source: 'docs/zh-CN/AGENTS.md summary' }
  ];

  const structurePatterns = [
    {
      category: 'agents',
      mode: 'exact',
      regex: /^\s*agents\/\s*[—–-]\s*(\d+)\s+个专业子代理\s*$/im,
      source: 'docs/zh-CN/AGENTS.md project structure'
    },
    {
      category: 'skills',
      mode: 'minimum',
      regex: /^\s*skills\/\s*[—–-]\s*(\d+)(\+)?\s+个工作流技能和领域知识\s*$/im,
      source: 'docs/zh-CN/AGENTS.md project structure'
    },
    {
      category: 'commands',
      mode: 'exact',
      regex: /^\s*commands\/\s*[—–-]\s*(\d+)\s+个斜杠命令\s*$/im,
      source: 'docs/zh-CN/AGENTS.md project structure'
    }
  ];

  for (const pattern of structurePatterns) {
    const match = agentsContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} entry`);
    }

    expectations.push({
      category: pattern.category,
      mode: pattern.mode === 'minimum' && match[2] ? 'minimum' : pattern.mode,
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  return expectations;
}

function parseCatalogDescriptionExpectations(content, source, getDescription) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error.message}`);
  }

  const description = getDescription(parsed);
  if (typeof description !== 'string') {
    throw new Error(`${source} is missing the catalog count description`);
  }

  const match = description.match(/(\d+)\s+agents,\s+(\d+)\s+skills,\s+(\d+)\s+legacy command shims?/i);
  if (!match) {
    throw new Error(`${source} is missing the catalog count description`);
  }

  return [
    { category: 'agents', mode: 'exact', expected: Number(match[1]), source },
    { category: 'skills', mode: 'exact', expected: Number(match[2]), source },
    { category: 'commands', mode: 'exact', expected: Number(match[3]), source },
  ];
}

function evaluateExpectations(catalog, expectations) {
  return expectations.map(expectation => {
    const actual = catalog[expectation.category].count;
    const ok = expectation.mode === 'minimum'
      ? actual >= expectation.expected
      : actual === expectation.expected;

    return {
      ...expectation,
      actual,
      ok
    };
  });
}

function formatExpectation(expectation) {
  const comparator = expectation.mode === 'minimum' ? '>=' : '=';
  return `${expectation.source}: ${expectation.category} documented ${comparator} ${expectation.expected}, actual ${expectation.actual}`;
}

function syncEnglishReadme(content, catalog) {
  let nextContent = content;

  nextContent = replaceOrThrow(
    nextContent,
    /(access to\s+)(\d+)(\s+agents,\s+)(\d+)(\s+skills,\s+and\s+)(\d+)(\s+(?:commands|legacy command shims?))/i,
    (_, prefix, __, agentsSuffix, ___, skillsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsSuffix}${catalog.commands.count} legacy command shims`,
    'README.md quick-start summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(actual OSS surface:\s+)(\d+)(\s+agents,\s+)(\d+)(\s+skills,\s+and\s+)(\d+)(\s+legacy command shims)/i,
    (_, prefix, __, agentsSuffix, ___, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'README.md rc.1 release-note summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*--\s*agents\/\s*#\s*)(\d+)(\s+specialized subagents for delegation\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'README.md project tree (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*(?:\*\*)?Agents(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s+agents\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'README.md comparison table (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*(?:\*\*)?Commands(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s+commands\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'README.md comparison table (commands)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*(?:\*\*)?Skills(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s+skills\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.skills.count}${suffix}`,
    'README.md comparison table (skills)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?Agents(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*Shared\s*\(AGENTS\.md\)\s*\|\s*Shared\s*\(AGENTS\.md\)\s*\|\s*12\s*\|(?:\s*N\/A\s*\|)?)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'README.md parity table (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?Commands(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*Shared\s*\|\s*Instruction-based\s*\|\s*\d+\s*\|(?:\s*\d+\s+prompts\s*\|)?)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'README.md parity table (commands)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?Skills(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*Shared\s*\|\s*10\s*\(native format\)\s*\|\s*37\s*\|(?:\s*Via instructions\s*\|)?)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.skills.count}${suffix}`,
    'README.md parity table (skills)'
  );

  return nextContent;
}

function syncEnglishAgents(content, catalog) {
  let nextContent = content;

  nextContent = replaceOrThrow(
    nextContent,
    /(providing\s+)(\d+)(\s+specialized agents,\s+)(\d+)(\+?)(\s+skills,\s+)(\d+)(\s+commands)/i,
    (_, prefix, __, agentsSuffix, ___, skillsPlus, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsPlus}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'AGENTS.md summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*agents\/\s*[—–-]\s*)(\d+)(\s+specialized subagents\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'AGENTS.md project structure (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*skills\/\s*[—–-]\s*)(\d+)(\+?)(\s+workflow skills and domain knowledge\s*)$/im,
    (_, prefix, __, plus, suffix) => `${prefix}${catalog.skills.count}${plus}${suffix}`,
    'AGENTS.md project structure (skills)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*commands\/\s*[—–-]\s*)(\d+)(\s+slash commands\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'AGENTS.md project structure (commands)'
  );

  return nextContent;
}

function syncZhRootReadme(content, catalog) {
  return replaceOrThrow(
    content,
    /(你现在可以使用\s+)(\d+)(\s+个代理、\s*)(\d+)(\s*个技能和\s*)(\d+)(\s*个命令[。.!！]?)/i,
    (_, prefix, __, agentsSuffix, ___, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'README.zh-CN.md quick-start summary'
  );
}

function syncZhDocsReadme(content, catalog) {
  let nextContent = content;

  nextContent = replaceOrThrow(
    nextContent,
    /(你现在可以使用\s+)(\d+)(\s+个智能体、\s*)(\d+)(\s*项技能和\s*)(\d+)(\s*个命令了[。.!！]?)/i,
    (_, prefix, __, agentsSuffix, ___, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'docs/zh-CN/README.md quick-start summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*智能体\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s*个\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'docs/zh-CN/README.md comparison table (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*命令\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s*个\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'docs/zh-CN/README.md comparison table (commands)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*技能\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s*项\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.skills.count}${suffix}`,
    'docs/zh-CN/README.md comparison table (skills)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?智能体(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*共享\s*\(AGENTS\.md\)\s*\|\s*共享\s*\(AGENTS\.md\)\s*\|\s*12\s*\|)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'docs/zh-CN/README.md parity table (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?命令(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*共享\s*\|\s*基于指令\s*\|\s*\d+\s*\|)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'docs/zh-CN/README.md parity table (commands)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?技能(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*共享\s*\|\s*10\s*\(原生格式\)\s*\|\s*37\s*\|)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.skills.count}${suffix}`,
    'docs/zh-CN/README.md parity table (skills)'
  );

  return nextContent;
}

function syncZhAgents(content, catalog) {
  let nextContent = content;

  nextContent = replaceOrThrow(
    nextContent,
    /(提供\s+)(\d+)(\s+个专业代理、\s*)(\d+)(\+?)(\s*项技能、\s*)(\d+)(\s+条命令)/i,
    (_, prefix, __, agentsSuffix, ___, skillsPlus, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsPlus}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'docs/zh-CN/AGENTS.md summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*agents\/\s*[—–-]\s*)(\d+)(\s+个专业子代理\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'docs/zh-CN/AGENTS.md project structure (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*skills\/\s*[—–-]\s*)(\d+)(\+?)(\s+个工作流技能和领域知识\s*)$/im,
    (_, prefix, __, plus, suffix) => `${prefix}${catalog.skills.count}${plus}${suffix}`,
    'docs/zh-CN/AGENTS.md project structure (skills)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*commands\/\s*[—–-]\s*)(\d+)(\s+个斜杠命令\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'docs/zh-CN/AGENTS.md project structure (commands)'
  );

  return nextContent;
}

function syncCatalogDescription(content, catalog, source, getDescription, setDescription) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error.message}`);
  }

  const description = getDescription(parsed);
  if (typeof description !== 'string') {
    throw new Error(`${source} is missing the catalog count description`);
  }

  const nextDescription = replaceOrThrow(
    description,
    /(\d+)(\s+agents,\s+)(\d+)(\s+skills,\s+)(\d+)(\s+legacy command shims?)/i,
    (_, __, agentsSuffix, ___, skillsSuffix, ____, commandsSuffix) =>
      `${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    source
  );

  setDescription(parsed, nextDescription);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function createDocumentSpecs(paths = {}) {
  const {
    readmePath = README_PATH,
    agentsPath = AGENTS_PATH,
    zhRootReadmePath = README_ZH_CN_PATH,
    zhDocsReadmePath = DOCS_ZH_CN_README_PATH,
    zhDocsAgentsPath = DOCS_ZH_CN_AGENTS_PATH,
    pluginJsonPath = PLUGIN_JSON_PATH,
    marketplaceJsonPath = MARKETPLACE_JSON_PATH,
  } = paths;

  return [
    {
      filePath: readmePath,
      parseExpectations: parseReadmeExpectations,
      syncContent: syncEnglishReadme,
    },
    {
      filePath: agentsPath,
      parseExpectations: parseAgentsDocExpectations,
      syncContent: syncEnglishAgents,
    },
    {
      filePath: zhRootReadmePath,
      parseExpectations: parseZhRootReadmeExpectations,
      syncContent: syncZhRootReadme,
    },
    {
      filePath: zhDocsReadmePath,
      parseExpectations: parseZhDocsReadmeExpectations,
      syncContent: syncZhDocsReadme,
    },
    {
      filePath: zhDocsAgentsPath,
      parseExpectations: parseZhAgentsDocExpectations,
      syncContent: syncZhAgents,
    },
    {
      filePath: pluginJsonPath,
      parseExpectations: content => parseCatalogDescriptionExpectations(
        content,
        '.claude-plugin/plugin.json description',
        parsed => parsed.description
      ),
      syncContent: (content, catalog) => syncCatalogDescription(
        content,
        catalog,
        '.claude-plugin/plugin.json description',
        parsed => parsed.description,
        (parsed, description) => { parsed.description = description; }
      ),
    },
    {
      filePath: marketplaceJsonPath,
      parseExpectations: content => parseCatalogDescriptionExpectations(
        content,
        '.claude-plugin/marketplace.json plugin description',
        parsed => parsed.plugins?.[0]?.description
      ),
      syncContent: (content, catalog) => syncCatalogDescription(
        content,
        catalog,
        '.claude-plugin/marketplace.json plugin description',
        parsed => parsed.plugins?.[0]?.description,
        (parsed, description) => { parsed.plugins[0].description = description; }
      ),
    },
  ];
}

function createDocumentSpecsForRoot(root) {
  return createDocumentSpecs({
    readmePath: path.join(root, 'README.md'),
    agentsPath: path.join(root, 'AGENTS.md'),
    zhRootReadmePath: path.join(root, 'README.zh-CN.md'),
    zhDocsReadmePath: path.join(root, 'docs', 'zh-CN', 'README.md'),
    zhDocsAgentsPath: path.join(root, 'docs', 'zh-CN', 'AGENTS.md'),
    pluginJsonPath: path.join(root, '.claude-plugin', 'plugin.json'),
    marketplaceJsonPath: path.join(root, '.claude-plugin', 'marketplace.json'),
  });
}

const DOCUMENT_SPECS = createDocumentSpecs();

function renderText(result) {
  console.log('Catalog counts:');
  console.log(`- agents: ${result.catalog.agents.count}`);
  console.log(`- commands: ${result.catalog.commands.count}`);
  console.log(`- skills: ${result.catalog.skills.count}`);
  console.log('');

  const mismatches = result.checks.filter(check => !check.ok);
  if (mismatches.length === 0) {
    console.log('Documentation counts match the repository catalog.');
    return;
  }

  console.error('Documentation count mismatches found:');
  for (const mismatch of mismatches) {
    console.error(`- ${formatExpectation(mismatch)}`);
  }
}

function renderMarkdown(result) {
  const mismatches = result.checks.filter(check => !check.ok);
  console.log('# ECC Catalog Verification\n');
  console.log('| Category | Count | Pattern |');
  console.log('| --- | ---: | --- |');
  console.log(`| Agents | ${result.catalog.agents.count} | \`${result.catalog.agents.glob}\` |`);
  console.log(`| Commands | ${result.catalog.commands.count} | \`${result.catalog.commands.glob}\` |`);
  console.log(`| Skills | ${result.catalog.skills.count} | \`${result.catalog.skills.glob}\` |`);
  console.log('');

  if (mismatches.length === 0) {
    console.log('Documentation counts match the repository catalog.');
    return;
  }

  console.log('## Mismatches\n');
  for (const mismatch of mismatches) {
    console.log(`- ${formatExpectation(mismatch)}`);
  }
}

function runCatalogCheck(options = {}) {
  const root = options.root || ROOT;
  const writeMode = options.writeMode ?? WRITE_MODE;
  const documentSpecs = options.documentSpecs || (
    root === ROOT ? DOCUMENT_SPECS : createDocumentSpecsForRoot(root)
  );
  const catalog = buildCatalog(root);

  if (writeMode) {
    for (const spec of documentSpecs) {
      const currentContent = readFileOrThrow(spec.filePath);
      const nextContent = spec.syncContent(currentContent, catalog);
      if (nextContent !== currentContent) {
        writeFileOrThrow(spec.filePath, nextContent);
      }
    }
  }

  const expectations = documentSpecs.flatMap(spec => (
    spec.parseExpectations(readFileOrThrow(spec.filePath))
  ));
  const checks = evaluateExpectations(catalog, expectations);
  return { catalog, checks };
}

function main(options = {}) {
  const outputMode = options.outputMode || OUTPUT_MODE;
  const result = runCatalogCheck(options);

  if (outputMode === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (outputMode === 'md') {
    renderMarkdown(result);
  } else {
    renderText(result);
  }

  if (result.checks.some(check => !check.ok)) {
    process.exit(1);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  buildCatalog,
  createDocumentSpecs,
  createDocumentSpecsForRoot,
  evaluateExpectations,
  formatExpectation,
  main,
  parseAgentsDocExpectations,
  parseCatalogDescriptionExpectations,
  parseReadmeExpectations,
  parseZhAgentsDocExpectations,
  parseZhDocsReadmeExpectations,
  parseZhRootReadmeExpectations,
  runCatalogCheck,
  syncCatalogDescription,
  syncEnglishAgents,
  syncEnglishReadme,
  syncZhAgents,
  syncZhDocsReadme,
  syncZhRootReadme,
};
