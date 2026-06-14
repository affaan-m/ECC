#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const canonicalSkillsDir = path.join(repoRoot, 'skills');
const codexMetadataSkillsDir = path.join(repoRoot, '.agents', 'skills');
const pluginRoots = [
  path.join(repoRoot, 'plugins', 'ecc'),
  path.join(repoRoot, 'plugins', 'everything-codex'),
];

const allowedFrontmatterKeys = new Set([
  'allowed-tools',
  'description',
  'license',
  'metadata',
  'name',
]);

function listSkillDirs(rootPath) {
  return fs.readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(rootPath, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function copyDirectory(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
}

function copyDirectoryEntriesExceptSkill(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'SKILL.md') {
      continue;
    }
    copyDirectory(path.join(source, entry.name), path.join(target, entry.name));
  }
}

function normalizeTextFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) {
    return;
  }

  const source = buffer.toString('utf8');
  const normalized = source
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '');

  if (normalized !== source) {
    fs.writeFileSync(filePath, normalized, 'utf8');
  }
}

function normalizeTextFiles(rootPath) {
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      normalizeTextFiles(entryPath);
    } else if (entry.isFile()) {
      normalizeTextFile(entryPath);
    }
  }
}

function splitFrontmatter(source, skillName) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) {
    throw new Error(`${skillName}/SKILL.md is missing YAML frontmatter`);
  }
  return {
    frontmatter: match[1],
    body: source.slice(match[0].length),
    newline: match[2],
  };
}

function collectAllowedFrontmatterBlocks(frontmatter, skillName) {
  const blocks = new Map();
  let currentKey = null;
  let keepCurrentBlock = false;
  let currentBlock = null;

  function flushCurrentBlock() {
    if (keepCurrentBlock && currentKey && currentBlock) {
      blocks.set(currentKey, currentBlock);
    }
  }

  for (const line of frontmatter.split(/\r?\n/)) {
    const topLevelKey = line.match(/^([A-Za-z0-9_-]+):/);
    if (topLevelKey) {
      flushCurrentBlock();
      currentKey = topLevelKey[1];
      keepCurrentBlock = allowedFrontmatterKeys.has(currentKey);
      if (keepCurrentBlock) {
        currentBlock = [currentKey === 'name' ? `name: ${skillName}` : line];
      } else {
        currentBlock = null;
      }
      continue;
    }

    if (keepCurrentBlock && currentKey && currentBlock) {
      currentBlock.push(line);
    }
  }

  flushCurrentBlock();
  return blocks;
}

function sanitizeFrontmatter(frontmatter, skillName, overlayFrontmatter = null) {
  const blocks = collectAllowedFrontmatterBlocks(frontmatter, skillName);

  if (overlayFrontmatter) {
    for (const [key, lines] of collectAllowedFrontmatterBlocks(overlayFrontmatter, skillName)) {
      blocks.set(key, lines);
    }
  }

  for (const requiredKey of ['name', 'description']) {
    if (!blocks.has(requiredKey)) {
      throw new Error(`${skillName}/SKILL.md is missing required Codex frontmatter key: ${requiredKey}`);
    }
  }

  return Array.from(blocks.values()).flat().join('\n').trimEnd();
}

function sanitizeSkillFile(skillPath, skillName, overlaySkillPath = null) {
  const source = fs.readFileSync(skillPath, 'utf8');
  const { frontmatter, body, newline } = splitFrontmatter(source, skillName);
  const overlayFrontmatter = overlaySkillPath
    ? splitFrontmatter(fs.readFileSync(overlaySkillPath, 'utf8'), skillName).frontmatter
    : null;
  const sanitizedFrontmatter = sanitizeFrontmatter(frontmatter, skillName, overlayFrontmatter);
  fs.writeFileSync(skillPath, `---\n${sanitizedFrontmatter}\n---${newline}${body}`, 'utf8');
}

function buildPluginSkills(pluginRoot) {
  const targetSkillsDir = path.join(pluginRoot, 'skills');
  fs.rmSync(targetSkillsDir, { recursive: true, force: true });
  fs.mkdirSync(targetSkillsDir, { recursive: true });

  const copiedSkills = new Set();

  for (const skillName of listSkillDirs(canonicalSkillsDir)) {
    const source = path.join(canonicalSkillsDir, skillName);
    const target = path.join(targetSkillsDir, skillName);
    const overlaySkillPath = path.join(codexMetadataSkillsDir, skillName, 'SKILL.md');
    copyDirectory(source, target);
    sanitizeSkillFile(
      path.join(target, 'SKILL.md'),
      skillName,
      fs.existsSync(overlaySkillPath) ? overlaySkillPath : null,
    );
    copiedSkills.add(skillName);
  }

  for (const skillName of listSkillDirs(codexMetadataSkillsDir)) {
    const source = path.join(codexMetadataSkillsDir, skillName);
    const target = path.join(targetSkillsDir, skillName);
    if (copiedSkills.has(skillName)) {
      copyDirectoryEntriesExceptSkill(source, target);
      normalizeTextFiles(target);
      continue;
    }

    copyDirectory(source, target);
    sanitizeSkillFile(path.join(target, 'SKILL.md'), skillName);
    normalizeTextFiles(target);
    copiedSkills.add(skillName);
  }

  normalizeTextFiles(targetSkillsDir);

  return copiedSkills.size;
}

function main() {
  const results = pluginRoots.map((pluginRoot) => ({
    pluginRoot: path.relative(repoRoot, pluginRoot),
    skillCount: buildPluginSkills(pluginRoot),
  }));

  for (const result of results) {
    console.log(`${result.pluginRoot}: bundled ${result.skillCount} Codex skills`);
  }
}

main();
