#!/usr/bin/env node
'use strict';

/**
 * Install ECC commands/*.md into ~/.grok/commands as Grok slash commands.
 * Use the unprefixed command stem unless a preexisting *different* skill or
 * Grok builtin already owns that name. Never modify files outside destDir.
 */

const fs = require('fs');
const path = require('path');
const { assertWithinTrustedRoot } = require('../lib/path-safety');
const { isWhitespaceEquivalent } = require('./install-agents-skills');
const {
  generateFromSource,
  parseDescription,
  stripFrontmatter,
} = require('./generate-command-file');

const GROK_BUILTIN_COMMANDS = new Set([
  'always-approve', 'auto', 'agents', 'agents-dashboard', 'btw', 'changelog',
  'clear', 'compact', 'compact-mode', 'config', 'config-agents', 'context',
  'copy', 'cost', 'dashboard', 'deep-research', 'delete', 'docs', 'doctor',
  'dream', 'edit-prompt', 'effort', 'exit', 'expand', 'export', 'feedback',
  'find', 'flush', 'fork', 'full', 'fullscreen', 'goal', 'history', 'home',
  'hooks', 'howto', 'imagine', 'imagine-video', 'import-claude', 'info',
  'jump', 'login', 'logout', 'loop', 'm', 'marketplace', 'mcps', 'mem',
  'memory', 'minimal', 'ml', 'model', 'multiline', 'new', 'personas',
  'plan', 'plan-view', 'plugins', 'privacy', 'quit', 'release-notes',
  'remember', 'rename', 'resume', 'rewind', 'session-info', 'sessions',
  'settings', 'show-plan', 'skills', 'status', 't', 'theme', 'timeline',
  'timestamps', 'title', 'tour', 'tutorial', 'undo', 'usage', 'view-plan',
  'vim-mode', 'welcome', 'workflow', 'workflows',
]);

function log(message) {
  process.stderr.write(`[ecc-commands] ${message}\n`);
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) return null;
  return value;
}

function readRepeatableFlag(args, name) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== name) continue;
    const value = args[i + 1];
    if (!value || value.startsWith('--')) continue;
    values.push(value);
  }
  return values;
}

function prefixedName(stem) {
  return stem.startsWith('ecc-') ? stem : `ecc-${stem}`;
}

function assertSafeDestFile(destDir, fileName, action = 'write') {
  if (fileName !== path.basename(fileName) || fileName === '' || fileName === '.' || fileName === '..') {
    throw new Error(`Refusing unsafe managed command name: ${fileName}`);
  }
  return assertWithinTrustedRoot(path.resolve(destDir, fileName), destDir, action);
}

function listCommandFiles(srcDir) {
  return fs.readdirSync(srcDir)
    .filter(name => name.endsWith('.md'))
    .sort()
    .map(name => path.join(srcDir, name));
}

function collectSkillBodies(skillRoots) {
  const bodies = new Map();
  for (const root of skillRoots) {
    if (!root || !fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || bodies.has(entry.name)) continue;
      const skillFile = path.join(root, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      bodies.set(entry.name, fs.readFileSync(skillFile, 'utf8'));
    }
  }
  return bodies;
}

function readManifest(manifestPath) {
  if (!manifestPath || !fs.existsSync(manifestPath)) return [];
  return fs.readFileSync(manifestPath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function isCommandEquivalent(sourceText, existingText) {
  const source = stripFrontmatter(sourceText);
  const existing = stripFrontmatter(existingText);
  return isWhitespaceEquivalent(
    parseDescription(source.frontmatter),
    parseDescription(existing.frontmatter)
  ) && isWhitespaceEquivalent(source.body, existing.body);
}

function resolveCommandName(options) {
  const {
    stem,
    sourceText,
    skillBodies,
    builtins = GROK_BUILTIN_COMMANDS,
    destDir,
    managedNames = new Set(),
  } = options;
  const nativeFile = `${stem}.md`;
  const destNativePath = destDir ? path.join(destDir, nativeFile) : null;
  const destOccupiedByForeign = Boolean(
    destNativePath
    && fs.existsSync(destNativePath)
    && !managedNames.has(nativeFile)
  );
  const preexistingSkill = skillBodies.get(stem);
  const hasConflict = builtins.has(stem) || Boolean(preexistingSkill) || destOccupiedByForeign;

  if (!hasConflict) {
    return { name: stem, reason: 'free' };
  }

  const compareTarget = preexistingSkill
    || (destOccupiedByForeign ? fs.readFileSync(destNativePath, 'utf8') : null);
  if (compareTarget && isCommandEquivalent(sourceText, compareTarget)) {
    return { name: null, reason: 'equivalent', skip: true };
  }
  return { name: prefixedName(stem), reason: builtins.has(stem) ? 'builtin' : 'different-skill' };
}

function assertSafeManifestPath(destDir, manifestPath) {
  const resolved = path.resolve(manifestPath);
  if (fs.existsSync(resolved) && !fs.lstatSync(resolved).isFile()) {
    throw new Error(`Refusing to manage non-regular command manifest: ${resolved}`);
  }
  return assertWithinTrustedRoot(resolved, destDir, 'write');
}

function installGrokCommands(options) {
  const srcDir = path.resolve(options.srcDir);
  const destDir = path.resolve(options.destDir);
  const dryRun = Boolean(options.dryRun);
  const requestedManifest = options.manifestPath
    ? path.resolve(options.manifestPath)
    : path.join(destDir, 'ecc-commands-manifest.txt');
  const manifestPath = assertSafeManifestPath(destDir, requestedManifest);
  const skillBodies = collectSkillBodies(options.skillRoots || []);
  const managedNames = new Set(readManifest(manifestPath));
  const result = {
    written: [],
    skipped: [],
    prefixed: [],
    removed: [],
  };

  if (!dryRun) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const writtenNames = new Set();
  for (const srcPath of listCommandFiles(srcDir)) {
    const stem = path.basename(srcPath, '.md');
    const sourceText = fs.readFileSync(srcPath, 'utf8');
    const resolution = resolveCommandName({
      stem,
      sourceText,
      skillBodies,
      destDir,
      managedNames,
    });
    if (resolution.skip) {
      log(`  [skip-equivalent] ${stem}`);
      result.skipped.push(stem);
      continue;
    }
    const fileName = `${resolution.name}.md`;
    if (fs.existsSync(path.join(destDir, fileName)) && !managedNames.has(fileName)) {
      log(`  [keep-existing] ${fileName}`);
      result.skipped.push(resolution.name);
      continue;
    }
    const outPath = assertSafeDestFile(destDir, fileName, 'write');
    if (resolution.name !== stem) {
      log(`  [prefix] /${stem} -> /${resolution.name} (${resolution.reason})`);
      result.prefixed.push(resolution.name);
    }
    if (!dryRun) {
      generateFromSource({ srcPath, outPath, name: resolution.name });
    }
    result.written.push(outPath);
    writtenNames.add(fileName);
  }

  for (const oldName of managedNames) {
    if (writtenNames.has(oldName)) continue;
    const oldPath = assertSafeDestFile(destDir, oldName, 'delete');
    if (!fs.existsSync(oldPath) || !fs.lstatSync(oldPath).isFile()) continue;
    if (!dryRun) {
      fs.unlinkSync(oldPath);
    }
    result.removed.push(oldPath);
    log(`  [remove-stale] ${oldName}`);
  }

  if (!dryRun) {
    const manifestBody = `${[...writtenNames].sort().join('\n')}\n`;
    fs.writeFileSync(manifestPath, manifestBody);
  }
  result.written.push(manifestPath);
  return result;
}

function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const srcDir = readFlag(argv, '--src');
  const destDir = readFlag(argv, '--dest');
  const manifestPath = readFlag(argv, '--manifest');
  const skillRoots = readRepeatableFlag(argv, '--skill-root');
  if (!srcDir || !destDir) {
    process.stderr.write(
      'Usage: install-grok-commands.js --src <commandsDir> --dest <grokCommandsDir> [--manifest <file>] [--skill-root <dir>...] [--dry-run]\n'
    );
    process.exit(1);
  }
  const result = installGrokCommands({
    srcDir,
    destDir,
    manifestPath,
    skillRoots,
    dryRun,
  });
  log(
    `${dryRun ? 'Dry run — would write' : 'Wrote'} ${result.written.length - 1} command(s); `
    + `prefixed ${result.prefixed.length}; skipped ${result.skipped.length}; `
    + `removed stale ${result.removed.length}`
  );
  for (const filePath of result.written) {
    process.stdout.write(`${filePath}\n`);
  }
}

module.exports = {
  GROK_BUILTIN_COMMANDS,
  collectSkillBodies,
  installGrokCommands,
  prefixedName,
  resolveCommandName,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[ecc-commands] ERROR: ${error.message}\n`);
    process.exit(1);
  }
}
