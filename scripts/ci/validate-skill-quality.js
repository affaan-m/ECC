#!/usr/bin/env node
/**
 * Validate the quality of curated skill files.
 *
 * Checks for the minimum structure and safety bar expected by ECC before a
 * contribution is merged, without overblocking contributors during initial
 * onboarding.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const { checkQualityRules } = require('./skill-quality-rules');

const STRICT = process.argv.includes('--strict') || process.env.CI_STRICT_SKILLS === '1';

function parseFrontmatter(content) {
  const cleaned = content.replace(/^\uFEFF/, '');
  const match = cleaned.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;

  try {
    const parsed = yaml.load(match[1]);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { __invalid: true };
    }
    return parsed;
  } catch (error) {
    const message = error && error.message ? error.message : 'unknown YAML parse error';
    logError(`YAML frontmatter parse failed: ${message}`);
    return { __invalid: true };
  }
}

function logInfo(message) {
  console.info(message);
}

function logError(message) {
  console.error(`ERROR: ${message}`);
}

function logWarning(message) {
  console.warn(`WARN: ${message}`);
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    const message = error && error.message ? error.message : 'unknown read error';
    logError(`${filePath} could not be read: ${message}`);
    return null;
  }
}

function getSkillFiles(targetPath) {
  if (!targetPath || !fs.existsSync(targetPath)) return { files: [], unreadablePaths: [] };

  let targetStat;
  try {
    targetStat = fs.statSync(targetPath);
  } catch (error) {
    logError(`Unable to inspect target path ${targetPath}: ${error && error.message ? error.message : 'unknown filesystem error'}`);
    return { files: [], unreadablePaths: [targetPath] };
  }

  if (targetStat.isFile()) {
    return {
      files: path.basename(targetPath) === 'SKILL.md' ? [targetPath] : [],
      unreadablePaths: [],
    };
  }

  if (!targetStat.isDirectory()) return { files: [], unreadablePaths: [] };

  const files = [];
  const unreadablePaths = [];

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      logError(`Unable to read directory ${currentDir}: ${error && error.message ? error.message : 'unknown filesystem error'}`);
      unreadablePaths.push(currentDir);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        files.push(fullPath);
      }
    }
  }

  walk(targetPath);
  return { files: files.sort(), unreadablePaths };
}

function parseChangedRef(args) {
  const inline = args.find((arg) => arg.startsWith('--changed='));
  if (inline) return inline.slice('--changed='.length) || null;
  const index = args.indexOf('--changed');
  if (index === -1) return null;
  const next = args[index + 1];
  return next && !next.startsWith('--') ? next : null;
}

function getChangedSkillFiles(baseRef) {
  const git = (args) => spawnSync('git', args, { encoding: 'utf8' });
  const diff = git(['diff', '-z', '--name-only', '--diff-filter=AMR', `${baseRef}...HEAD`, '--', '*SKILL.md']);
  if (diff.status !== 0) {
    logError(`Unable to diff against ${baseRef}: ${(diff.stderr || '').trim() || 'git failed'}`);
    return null;
  }
  const worktree = git(['diff', '-z', '--name-only', '--diff-filter=AMR', 'HEAD', '--', '*SKILL.md']);
  const untracked = git(['ls-files', '-z', '--others', '--exclude-standard', '--', '*SKILL.md']);
  const names = [diff, worktree, untracked]
    .flatMap((result) => (result.stdout || '').split('\0'))
    .filter((name) => path.basename(name) === 'SKILL.md' && name.split('/')[0] === 'skills');

  return [...new Set(names)]
    .map((name) => path.resolve(process.cwd(), name))
    .filter((file) => fs.existsSync(file))
    .sort();
}

function validateSkillFile(skillFile) {
  const relativePath = path.relative(process.cwd(), skillFile) || skillFile;
  const contents = readFileSafe(skillFile);
  if (!contents) {
    logError(`${relativePath} could not be read`);
    return false;
  }

  const frontmatter = parseFrontmatter(contents);
  let ok = true;

  if (!frontmatter) {
    logError(`${relativePath} is missing YAML frontmatter`);
    ok = false;
  } else if (frontmatter.__invalid) {
    logError(`${relativePath} has invalid YAML frontmatter`);
    ok = false;
  } else {
    if (typeof frontmatter.name !== 'string' || !frontmatter.name.trim()) {
      logError(`${relativePath} is missing a name field`);
      ok = false;
    }
    if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) {
      logError(`${relativePath} is missing a description field`);
      ok = false;
    }

    const dirName = path.basename(path.dirname(skillFile));
    if (frontmatter.name && frontmatter.name !== dirName) {
      logError(`${relativePath} has name "${frontmatter.name}" but directory is "${dirName}"`);
      ok = false;
    }
  }

  const qualityFindings = checkQualityRules(contents, relativePath, STRICT);
  for (const finding of qualityFindings) {
    const message = `${relativePath}:${finding.line} - ${finding.message}`;
    if (finding.severity === 'error' || STRICT) {
      logError(message);
      logInfo(`Fix: ${finding.hint}`);
      ok = false;
    } else {
      logWarning(message);
      logInfo(`Fix: ${finding.hint}`);
    }
  }

  const trimmed = contents.trim();
  if (trimmed.length < 200) {
    const message = `${relativePath} is very short and may not provide enough guidance`;
    if (STRICT) {
      logError(message);
    } else {
      logWarning(message);
    }
    ok = ok && !STRICT;
  }

  return ok;
}

function main() {
  const changedRef = parseChangedRef(process.argv.slice(2));
  if (process.argv.includes('--changed') || process.argv.some((arg) => arg.startsWith('--changed='))) {
    if (!changedRef) {
      logError('--changed requires a base ref, e.g. --changed origin/main');
      process.exit(1);
    }
    const changedFiles = getChangedSkillFiles(changedRef);
    if (changedFiles === null) process.exit(1);
    if (changedFiles.length === 0) {
      logInfo(`No added or modified skill files since ${changedRef}`);
      process.exit(0);
    }
    const failed = changedFiles.map(validateSkillFile).includes(false);
    if (failed) process.exit(1);
    logInfo(`Validated ${changedFiles.length} changed skill file(s) successfully.`);
    process.exit(0);
  }

  const cliArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const explicitTarget = cliArgs[0] || process.env.ECC_SKILLS_DIR || 'skills';
  const targetPath = path.resolve(process.cwd(), explicitTarget);

  if (!fs.existsSync(targetPath)) {
    logError(`Target does not exist: ${targetPath}`);
    process.exit(1);
  }

  const targetStat = fs.statSync(targetPath);
  if (!targetStat.isFile() && !targetStat.isDirectory()) {
    logError(`Unsupported target type: ${targetPath}. Provide a SKILL.md file or a directory of skill files.`);
    process.exit(1);
  }

  if (targetStat.isFile() && path.basename(targetPath) !== 'SKILL.md') {
    logError(`Unsupported target file: ${targetPath}. Provide a SKILL.md file.`);
    process.exit(1);
  }

  const { files, unreadablePaths } = getSkillFiles(targetPath);

  if (unreadablePaths.length > 0) {
    logError(`Validation aborted because one or more target directories could not be read: ${unreadablePaths.join(', ')}`);
    process.exit(1);
  }

  if (files.length === 0) {
    logInfo(`No skill files found under ${targetPath}`);
    process.exit(0);
  }

  let hasErrors = false;
  for (const file of files) {
    const isValid = validateSkillFile(file);
    if (!isValid) hasErrors = true;
  }

  if (hasErrors) {
    process.exit(1);
  }

  logInfo(`Validated ${files.length} skill file(s) successfully.`);
}

main();
