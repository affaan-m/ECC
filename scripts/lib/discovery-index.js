'use strict';

/**
 * Build a deterministic index of every public ECC surface: skills, agents,
 * and commands.
 *
 * The index is the single source the website uses to publish one page per
 * surface, and the source `llms.txt` is generated from. Keeping it here means
 * the catalog never drifts from the files that actually ship.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SITE_ORIGIN = 'https://ecc.tools';
const REPO_BLOB = 'https://github.com/affaan-m/ECC/blob/main';

const SURFACES = Object.freeze({
  skill: Object.freeze({ dir: 'skills', urlSegment: 'skills' }),
  agent: Object.freeze({ dir: 'agents', urlSegment: 'agents' }),
  command: Object.freeze({ dir: 'commands', urlSegment: 'commands' }),
});

function cleanYamlScalar(value) {
  return String(value)
    .trim()
    .replace(/^['"]/, '')
    .replace(/['"]$/, '')
    .trim();
}

function readFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }

  return match[1].split(/\r?\n/).reduce((fields, line) => {
    const field = line.match(/^([a-zA-Z-]+):\s*(.+)$/);
    if (!field) {
      return fields;
    }

    return { ...fields, [field[1]]: cleanYamlScalar(field[2]) };
  }, {});
}

function firstParagraph(content) {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  const paragraph = body
    .split(/\r?\n\r?\n/)
    .map(block => block.trim())
    .find(block => block.length > 0 && !block.startsWith('#'));

  return paragraph ? paragraph.replace(/\s+/g, ' ') : '';
}

function toSummary(frontmatter, content) {
  const summary = frontmatter.description || firstParagraph(content);
  return summary.length > 300 ? `${summary.slice(0, 297).trimEnd()}...` : summary;
}

function readSurfaceFile(absolutePath) {
  try {
    return fs.readFileSync(absolutePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read catalog entry ${absolutePath}: ${error.message}`);
  }
}

function listSkillEntries(root) {
  const skillsDir = path.join(root, SURFACES.skill.dir);
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => fs.existsSync(path.join(skillsDir, name, 'SKILL.md')))
    .sort()
    .map(name => buildEntry('skill', name, `${SURFACES.skill.dir}/${name}/SKILL.md`, root));
}

function listMarkdownEntries(type, root) {
  const directory = path.join(root, SURFACES[type].dir);
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort()
    .map(filename => buildEntry(
      type,
      filename.replace(/\.md$/, ''),
      `${SURFACES[type].dir}/${filename}`,
      root
    ));
}

function buildEntry(type, name, relativePath, root) {
  const content = readSurfaceFile(path.join(root, relativePath));
  const frontmatter = readFrontmatter(content);

  return Object.freeze({
    type,
    name: frontmatter.name || name,
    slug: name,
    summary: toSummary(frontmatter, content),
    model: frontmatter.model || null,
    tools: frontmatter.tools || null,
    source: relativePath,
    sourceUrl: `${REPO_BLOB}/${relativePath}`,
    url: `${SITE_ORIGIN}/${SURFACES[type].urlSegment}/${name}`,
  });
}

/**
 * Every catalog entry, sorted by type then slug so output never churns.
 */
function buildCatalog(root = ROOT) {
  return Object.freeze([
    ...listSkillEntries(root),
    ...listMarkdownEntries('agent', root),
    ...listMarkdownEntries('command', root),
  ]);
}

function countByType(entries) {
  return entries.reduce(
    (counts, entry) => ({ ...counts, [entry.type]: (counts[entry.type] || 0) + 1 }),
    {}
  );
}

module.exports = {
  ROOT,
  SITE_ORIGIN,
  REPO_BLOB,
  SURFACES,
  buildCatalog,
  countByType,
  readFrontmatter,
  toSummary,
};
