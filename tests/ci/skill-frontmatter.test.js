#!/usr/bin/env node
/**
 * Validate the YAML frontmatter of every SKILL.md in the repository.
 *
 * The localized docs trees drifted into four failure modes that no YAML parser
 * accepts (see #2630): a following key glued onto the description line, quotes
 * dropped from a description containing ": ", a description opening on the
 * reserved "@" indicator, and a missing frontmatter block. Each of them is
 * invisible until something downstream tries to parse the file.
 *
 * The repo has no YAML dependency, so this is a structural check rather than a
 * full parse: it rejects the constructs a YAML parser rejects, without
 * pretending to be one. Quoted and block scalars are accepted as-is.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
const REQUIRED_KEYS = ['name', 'description'];

// Characters YAML reserves as indicators; a plain scalar cannot start with one.
const RESERVED_START = /^[@`%*&!|>]/;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function listSkillFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) listSkillFiles(path.join(dir, entry.name), acc);
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

function isSafeScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return true;                                  // nested mapping or empty value
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return true;   // quoted
  if (/^[|>][-+\d]*$/.test(trimmed)) return true;             // block scalar header
  if (RESERVED_START.test(trimmed)) return false;             // e.g. "@Observable…"
  if (trimmed.includes(': ') || trimmed.endsWith(':')) return false;     // key-like sequence
  return true;
}

/** Collect the frontmatter problems of one file; empty array means valid. */
function frontmatterProblems(file) {
  const content = fs.readFileSync(file, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return ['no frontmatter block'];

  const problems = [];
  const seen = new Set();
  const lines = match[1].split(/\r?\n/);
  let blockIndent = null;   // inside a block scalar: skip anything more indented

  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;

    if (blockIndent !== null) {
      if (indent > blockIndent) continue;
      blockIndent = null;
    }

    const entry = line.match(/^(\s*)([A-Za-z0-9_.-]+):(.*)$/);
    if (entry) {
      const [, pad, key, rest] = entry;
      if (!pad) seen.add(key);
      if (/^[|>][-+\d]*\s*$/.test(rest.trim())) {
        blockIndent = indent;
      } else if (!isSafeScalar(rest)) {
        problems.push(`${key}: value must be quoted (${rest.trim().slice(0, 60)}…)`);
      }
      continue;
    }

    const item = line.match(/^\s*-\s+(.*)$/);
    if (item) {
      if (!isSafeScalar(item[1])) problems.push(`list item must be quoted (${item[1].slice(0, 60)}…)`);
      continue;
    }

    // An indented line that is neither a key nor a list item continues the
    // previous plain scalar; YAML forbids ": " there too, so check it the same way.
    if (indent > 0) {
      if (!isSafeScalar(line)) problems.push(`continuation line must be quoted (${line.trim().slice(0, 60)}…)`);
      continue;
    }

    problems.push(`unparsable line (${line.trim().slice(0, 60)}…)`);
  }

  for (const key of REQUIRED_KEYS) {
    if (!seen.has(key)) problems.push(`missing "${key}"`);
  }
  return problems;
}

function run() {
  console.log('\n=== Testing SKILL.md frontmatter ===\n');
  let passed = 0;
  let failed = 0;
  const skillFiles = listSkillFiles(REPO_ROOT);

  if (test('repository exposes SKILL.md files to validate', () => {
    assert.ok(skillFiles.length > 0, 'no SKILL.md found');
  })) passed++; else failed++;

  if (test(`every SKILL.md has parseable frontmatter (${skillFiles.length} files)`, () => {
    const broken = [];
    for (const file of skillFiles) {
      const problems = frontmatterProblems(file);
      if (problems.length) broken.push(`${path.relative(REPO_ROOT, file)} → ${problems.join('; ')}`);
    }
    assert.strictEqual(
      broken.length,
      0,
      `${broken.length} file(s) with invalid frontmatter:\n      ${broken.join('\n      ')}`
    );
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

run();
