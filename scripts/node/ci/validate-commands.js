#!/usr/bin/env node
/**
 * Validate command markdown files are non-empty, readable,
 * and have valid cross-references to other commands, agents, and skills.
 *
 * Supports nested directory layout:
 * commands/{common,node,python,rust,typescript}/*.md
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '../../..');
const COMMANDS_DIR = path.join(ROOT_DIR, 'commands');
const AGENTS_DIR = path.join(ROOT_DIR, 'agents');
const SKILLS_DIR = path.join(ROOT_DIR, 'skills');

// Language prefixes used in nested directory layouts.
const LANG_PREFIXES = ['node-', 'python-', 'rust-', 'typescript-', 'fastapi-'];

/**
 * Recursively collect .md filenames (without extension) from a directory.
 * Also registers names with language prefixes stripped so that short
 * references like `/tdd` match files named `node-tdd.md`.
 */
function collectMdNames(dir) {
  const names = new Set();
  if (!fs.existsSync(dir)) return names;
  const files = fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.md'));
  for (const f of files) {
    const filePath = path.join(dir, f);
    try {
      if (fs.statSync(filePath).isFile()) {
        const basename = path.basename(f, '.md');
        const normalized = f.replace(/\\/g, '/');
        const dirname = path.dirname(normalized);
        names.add(basename);
        if (dirname !== '.') {
          names.add(`${dirname}/${basename}`);
        }
        // Also add the short name without language prefix
        for (const prefix of LANG_PREFIXES) {
          if (basename.startsWith(prefix)) {
            names.add(basename.slice(prefix.length));
            break;
          }
        }
      }
    } catch {
      // skip unreadable entries
    }
  }
  return names;
}

/**
 * Recursively collect directory names that could be skill directories
 */
function collectSkillNames(dir) {
  const names = new Set();
  if (!fs.existsSync(dir)) return names;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subPath = path.join(dir, entry.name);
    if (fs.existsSync(path.join(subPath, 'SKILL.md'))) {
      // Flat layout: direct skill dir with SKILL.md
      names.add(entry.name);
    } else {
      // Check subdirectories (nested layout: skills/{lang}/skill-name/)
      try {
        const subEntries = fs.readdirSync(subPath, { withFileTypes: true });
        const subDirs = subEntries.filter(e => e.isDirectory());
        if (subDirs.length > 0) {
          // Nested layout: language group with skill subdirs
          for (const sub of subDirs) {
            names.add(sub.name);
            names.add(`${entry.name}/${sub.name}`);
          }
        } else {
          // Flat layout without SKILL.md — still a valid reference target
          names.add(entry.name);
        }
      } catch {
        // Can't read dir, but add name anyway for reference checking
        names.add(entry.name);
      }
    }
  }
  return names;
}

function validateCommands() {
  if (!fs.existsSync(COMMANDS_DIR)) {
    console.log('No commands directory found, skipping validation');
    process.exit(0);
  }

  const allFiles = fs.readdirSync(COMMANDS_DIR, { recursive: true }).filter(f => f.endsWith('.md'));
  let hasErrors = false;
  let warnCount = 0;
  let validFileCount = 0;

  // Build set of valid command names (basename without .md)
  const validCommands = collectMdNames(COMMANDS_DIR);

  // Build set of valid agent names (basename without .md)
  const validAgents = collectMdNames(AGENTS_DIR);

  // Build set of valid skill directory names
  const validSkills = collectSkillNames(SKILLS_DIR);

  for (const file of allFiles) {
    const filePath = path.join(COMMANDS_DIR, file);
    try {
      if (!fs.statSync(filePath).isFile()) continue;
    } catch {
      continue;
    }

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      console.error(`ERROR: ${file} - ${err.message}`);
      hasErrors = true;
      continue;
    }

    // Validate the file is non-empty readable markdown
    if (content.trim().length === 0) {
      console.error(`ERROR: ${file} - Empty command file`);
      hasErrors = true;
      continue;
    }

    validFileCount++;

    // Strip fenced code blocks before checking cross-references
    const contentNoCodeBlocks = content.replace(/```[\s\S]*?```/g, '');

    // Check cross-references to other commands (e.g., `/build-fix`)
    for (const line of contentNoCodeBlocks.split('\n')) {
      if (/creates:|would create:/i.test(line)) continue;
      const lineRefs = line.matchAll(/`\/([a-z][-a-z0-9]*)`/g);
      for (const match of lineRefs) {
        const refName = match[1];
        if (!validCommands.has(refName)) {
          console.error(`ERROR: ${file} - references non-existent command /${refName}`);
          hasErrors = true;
        }
      }
    }

    // Check agent references (e.g., "agents/planner.md" or
    // "agents/python/python-reviewer.md")
    const agentPathRefs = contentNoCodeBlocks.matchAll(/agents\/([a-z][-a-z0-9]*(?:\/[a-z][-a-z0-9]*)*)\.md/g);
    for (const match of agentPathRefs) {
      const refName = match[1];
      if (!validAgents.has(refName)) {
        console.error(`ERROR: ${file} - references non-existent agent agents/${refName}.md`);
        hasErrors = true;
      }
    }

    // Check skill directory references (e.g., "skills/tdd-workflow/" or
    // "skills/python/python-testing/")
    const skillRefs = contentNoCodeBlocks.matchAll(/skills\/([a-z][-a-z0-9]*(?:\/[a-z][-a-z0-9]*)*)\//g);
    for (const match of skillRefs) {
      const refName = match[1];
      if (!validSkills.has(refName)) {
        console.warn(`WARN: ${file} - references skill directory skills/${refName}/ (not found locally)`);
        warnCount++;
      }
    }

    // Check agent name references in workflow diagrams (e.g., "planner -> tdd-guide")
    const workflowLines = contentNoCodeBlocks.matchAll(/^([a-z][-a-z0-9]*(?:\s*->\s*[a-z][-a-z0-9]*)+)$/gm);
    for (const match of workflowLines) {
      const agents = match[1].split(/\s*->\s*/);
      for (const agent of agents) {
        if (!validAgents.has(agent)) {
          console.error(`ERROR: ${file} - workflow references non-existent agent "${agent}"`);
          hasErrors = true;
        }
      }
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  let msg = `Validated ${validFileCount} command files`;
  if (warnCount > 0) {
    msg += ` (${warnCount} warnings)`;
  }
  console.log(msg);
}

validateCommands();
