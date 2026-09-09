#!/usr/bin/env node
'use strict';

/**
 * Copy ECC repo .agents/skills into ~/.agents/skills without modifying
 * existing dest files (including Codex source-command-* wrappers).
 *
 * For each source skill directory <name>:
 *   - If dest has source-command-<name> and its SKILL.md is equivalent
 *     ignoring whitespace/linebreaks, skip the native copy.
 *   - Otherwise copy missing native files only. Never overwrite.
 */

const fs = require('fs');
const path = require('path');
const { assertWithinTrustedRoot } = require('../lib/path-safety');

function log(message) {
  process.stderr.write(`[ecc-skills] ${message}\n`);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wrapperDirName(skillName) {
  return `source-command-${skillName}`;
}

function wrapperDirPattern(skillName) {
  return new RegExp(`^source-command-${escapeRegex(skillName)}$`);
}

function hasSourceCommandWrapper(existingNames, skillName) {
  const pattern = wrapperDirPattern(skillName);
  return existingNames.some(name => pattern.test(name));
}

function normalizeFluff(text) {
  return String(text).replace(/\s+/g, '');
}

function isWhitespaceEquivalent(left, right) {
  return normalizeFluff(left) === normalizeFluff(right);
}

function listDirectoryNames(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function listRelativeFiles(dirPath, prefix = '') {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRelativeFiles(fullPath, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

function readOptionalUtf8(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function copyFileIfMissing(srcFile, destFile, dryRun) {
  if (fs.existsSync(destFile)) {
    return 'exists';
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(srcFile, destFile);
  }
  return 'copied';
}

function installAgentsSkills(options) {
  const srcDir = path.resolve(options.srcDir);
  const destDir = path.resolve(options.destDir);
  const dryRun = Boolean(options.dryRun);
  const result = {
    copied: [],
    skippedExists: [],
    skippedEquivalent: [],
  };

  if (!fs.existsSync(srcDir)) {
    throw new Error(`Skill source directory not found: ${srcDir}`);
  }

  const existingNames = listDirectoryNames(destDir);
  const skillNames = listDirectoryNames(srcDir);

  for (const skillName of skillNames) {
    if (skillName.startsWith('source-command-')) {
      log(`  [skip] refusing to install source-command skill from source: ${skillName}`);
      continue;
    }

    if (hasSourceCommandWrapper(existingNames, skillName)) {
      const wrapperMarkdown = readOptionalUtf8(
        path.join(destDir, wrapperDirName(skillName), 'SKILL.md')
      );
      const nativeMarkdown = readOptionalUtf8(path.join(srcDir, skillName, 'SKILL.md'));
      if (
        wrapperMarkdown !== null
        && nativeMarkdown !== null
        && isWhitespaceEquivalent(wrapperMarkdown, nativeMarkdown)
      ) {
        log(`  [skip-equivalent] ${skillName} matches ${wrapperDirName(skillName)}`);
        result.skippedEquivalent.push(skillName);
        continue;
      }
      log(`  [add-native] ${skillName} differs from ${wrapperDirName(skillName)}; leaving wrapper unchanged`);
    }

    const sourceSkillDir = path.join(srcDir, skillName);
    for (const relativePath of listRelativeFiles(sourceSkillDir)) {
      const destRelativePath = `${skillName}/${relativePath}`;
      if (destRelativePath.split(/[\\/]/).some(segment => segment === '..')) {
        throw new Error(`Refusing skill path with parent segments: ${destRelativePath}`);
      }
      const destFile = assertWithinTrustedRoot(
        path.resolve(destDir, destRelativePath),
        destDir,
        'copy'
      );
      const action = copyFileIfMissing(
        path.join(sourceSkillDir, relativePath),
        destFile,
        dryRun
      );
      if (action === 'copied') {
        result.copied.push(destRelativePath);
      } else {
        result.skippedExists.push(destRelativePath);
      }
    }
  }

  return result;
}

function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const positional = argv.filter(arg => !arg.startsWith('-'));
  const srcDir = positional[0];
  const destDir = positional[1];
  if (!srcDir || !destDir) {
    process.stderr.write('Usage: install-agents-skills.js <srcDir> <destDir> [--dry-run]\n');
    process.exit(1);
  }

  const result = installAgentsSkills({ srcDir, destDir, dryRun });
  log(
    `${dryRun ? 'Dry run — would copy' : 'Copied'} ${result.copied.length} file(s); `
    + `skipped existing ${result.skippedExists.length}; `
    + `skipped equivalent ${result.skippedEquivalent.length}`
  );
  for (const relativePath of result.copied) {
    process.stdout.write(`${path.resolve(destDir, relativePath)}\n`);
  }
}

module.exports = {
  escapeRegex,
  hasSourceCommandWrapper,
  installAgentsSkills,
  isWhitespaceEquivalent,
  main,
  normalizeFluff,
  wrapperDirName,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[ecc-skills] ERROR: ${error.message}\n`);
    process.exit(1);
  }
}
