'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeAgentTools } = require('./agent-tools');

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns { frontmatter: {}, body: string }.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Handle JSON arrays (e.g. tools: ["Read", "Grep"])
    if (value.startsWith('[') && value.endsWith(']')) {
      try {
        value = JSON.parse(value);
      } catch {
        // keep as string
      }
    }

    // Strip surrounding quotes
    if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    if (key === 'tools') {
      value = normalizeAgentTools(value);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body: match[2] || '' };
}

/**
 * Extract the first meaningful paragraph from agent body as a summary.
 * Skips headings, list items, code blocks, and table rows.
 */
function extractSummary(body, maxSentences = 1) {
  const lines = body.split('\n');
  const paragraphs = [];
  let current = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track fenced code blocks
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    if (trimmed === '') {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }

    // Skip headings, list items (bold, plain, asterisk), numbered lists, table rows
    if (
      trimmed.startsWith('#') ||
      trimmed.startsWith('- ') ||
      trimmed.startsWith('* ') ||
      /^\d+\.\s/.test(trimmed) ||
      trimmed.startsWith('|')
    ) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }

    current.push(trimmed);
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }

  const firstParagraph = paragraphs.find(p => p.length > 0);
  if (!firstParagraph) return '';

  const sentences = firstParagraph.match(/[^.!?]+[.!?]+/g) || [firstParagraph];
  return sentences.slice(0, maxSentences).map(s => s.trim()).join(' ').trim();
}

/**
 * Load and parse a single agent file.
 */
function loadAgent(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const { frontmatter, body } = parseFrontmatter(content);
  const fileName = path.basename(filePath, '.md');

  return {
    fileName,
    name: frontmatter.name || fileName,
    description: frontmatter.description || '',
    tools: Array.isArray(frontmatter.tools) ? frontmatter.tools : [],
    model: frontmatter.model || 'sonnet',
    body,
    byteSize: Buffer.byteLength(content, 'utf8'),
  };
}

/**
 * Load all agents from a directory.
 */
function loadAgents(agentsDir) {
  if (!fs.existsSync(agentsDir)) return [];

  return fs.readdirSync(agentsDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => loadAgent(path.join(agentsDir, f)));
}

/**
 * Compress an agent to catalog entry (metadata only).
 */
function compressToCatalog(agent) {
  return {
    name: agent.name,
    description: agent.description,
    tools: agent.tools,
    model: agent.model,
  };
}

/**
 * Compress an agent to summary entry (metadata + first paragraph).
 */
function compressToSummary(agent) {
  return {
    ...compressToCatalog(agent),
    summary: extractSummary(agent.body),
  };
}

const allowedModes = ['catalog', 'summary', 'full'];

/**
 * Build a compressed catalog from a directory of agents.
 *
 * Modes:
 *  - 'catalog': name, description, tools, model only (~2-3k tokens for 27 agents)
 *  - 'summary': catalog + first paragraph summary (~4-5k tokens)
 *  - 'full':    no compression, full body included
 *
 * Returns { agents: [], stats: { totalAgents, originalBytes, compressedBytes, compressedTokenEstimate, mode } }
 */
function buildAgentCatalog(agentsDir, options = {}) {
  const mode = options.mode || 'catalog';

  if (!allowedModes.includes(mode)) {
    throw new Error(`Invalid mode "${mode}". Allowed modes: ${allowedModes.join(', ')}`);
  }

  const filter = options.filter || null;

  let agents = loadAgents(agentsDir);

  if (typeof filter === 'function') {
    agents = agents.filter(filter);
  }

  const originalBytes = agents.reduce((sum, a) => sum + a.byteSize, 0);

  let compressed;
  if (mode === 'catalog') {
    compressed = agents.map(compressToCatalog);
  } else if (mode === 'summary') {
    compressed = agents.map(compressToSummary);
  } else {
    compressed = agents.map(a => ({
      name: a.name,
      description: a.description,
      tools: a.tools,
      model: a.model,
      body: a.body,
    }));
  }

  const compressedJson = JSON.stringify(compressed);
  // Rough token estimate: ~4 chars per token for English text
  const compressedTokenEstimate = Math.ceil(compressedJson.length / 4);

  return {
    agents: compressed,
    stats: {
      totalAgents: agents.length,
      originalBytes,
      compressedBytes: Buffer.byteLength(compressedJson, 'utf8'),
      compressedTokenEstimate,
      mode,
    },
  };
}

/**
 * Lazy-load a single agent's full content by name.
 * Returns null if not found.
 */
function lazyLoadAgent(agentsDir, agentName) {
  // Validate agentName: only allow alphanumeric, hyphen, underscore
  if (!/^[\w-]+$/.test(agentName)) {
    return null;
  }

  const filePath = path.resolve(agentsDir, `${agentName}.md`);

  // Verify the resolved path is still within agentsDir
  const resolvedAgentsDir = path.resolve(agentsDir);
  if (!filePath.startsWith(resolvedAgentsDir + path.sep)) {
    return null;
  }

  if (!fs.existsSync(filePath)) return null;
  return loadAgent(filePath);
}

module.exports = {
  buildAgentCatalog,
  compressToCatalog,
  compressToSummary,
  extractSummary,
  lazyLoadAgent,
  loadAgent,
  loadAgents,
  parseFrontmatter,
};
