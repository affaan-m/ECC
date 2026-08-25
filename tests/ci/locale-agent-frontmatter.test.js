#!/usr/bin/env node
/**
 * The translated agent docs under docs/<locale>/agents/ must not contradict the
 * agent that actually ships in agents/.
 *
 * scripts/ci/validate-agents.js only reads agents/, so the locale copies were
 * unvalidated and drifted: 39 of them named a costlier model tier than
 * canonical, and 15 listed a different tool set — including every locale copy
 * of security-reviewer and database-reviewer, which advertised Write and Edit
 * for agents that ship read-only.
 *
 * Only the machine-readable frontmatter is compared. Prose is translated and
 * the list style differs per locale on purpose, so `tools` is compared as a
 * SET, not as a string.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');

function frontmatter(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):[ \t]*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

function toolSet(raw) {
  if (raw === undefined) return null;
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  return new Set(
    inner
      .split(',')
      .map(entry => entry.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  );
}

function sameSet(a, b) {
  if (a === null || b === null) return a === b;
  return a.size === b.size && [...a].every(item => b.has(item));
}

function localeAgentDirs() {
  if (!fs.existsSync(DOCS_DIR)) return [];
  return fs
    .readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(DOCS_DIR, entry.name, 'agents'))
    .filter(dir => fs.existsSync(dir));
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

function main() {
  console.log('\n=== Testing locale agent frontmatter against canonical ===\n');

  const canonical = new Map();
  for (const file of fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'))) {
    const fields = frontmatter(path.join(AGENTS_DIR, file));
    if (fields) canonical.set(file, fields);
  }

  const localeFiles = [];
  for (const dir of localeAgentDirs()) {
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
      if (canonical.has(file)) {
        localeFiles.push({ file, filePath: path.join(dir, file) });
      }
    }
  }

  const rel = filePath => path.relative(REPO_ROOT, filePath).split(path.sep).join('/');

  const tests = [
    ['there are locale agent docs to check', () => {
      assert.ok(canonical.size > 0, 'no canonical agents found');
      assert.ok(localeFiles.length > 0, 'no locale agent docs found');
    }],

    ['every locale agent doc has parseable frontmatter', () => {
      const bad = localeFiles
        .filter(({ filePath }) => frontmatter(filePath) === null)
        .map(({ filePath }) => rel(filePath));
      assert.deepStrictEqual(bad, [], `missing frontmatter:\n  ${bad.join('\n  ')}`);
    }],

    ['locale agent docs name the same agent as canonical', () => {
      const drift = [];
      for (const { file, filePath } of localeFiles) {
        const fields = frontmatter(filePath);
        if (!fields) continue;
        if (fields.name !== canonical.get(file).name) {
          drift.push(`${rel(filePath)}: ${fields.name} != ${canonical.get(file).name}`);
        }
      }
      assert.deepStrictEqual(drift, [], `name drift:\n  ${drift.join('\n  ')}`);
    }],

    ['locale agent docs declare the canonical model tier', () => {
      const drift = [];
      for (const { file, filePath } of localeFiles) {
        const fields = frontmatter(filePath);
        if (!fields) continue;
        const want = canonical.get(file).model;
        if (want !== undefined && fields.model !== undefined && fields.model !== want) {
          drift.push(`${rel(filePath)}: ${fields.model} != ${want}`);
        }
      }
      assert.deepStrictEqual(
        drift,
        [],
        `model drift (locale doc promises a different tier than ships):\n  ${drift.join('\n  ')}`
      );
    }],

    ['locale agent docs declare the canonical tool set', () => {
      const drift = [];
      for (const { file, filePath } of localeFiles) {
        const fields = frontmatter(filePath);
        if (!fields) continue;
        const want = toolSet(canonical.get(file).tools);
        const have = toolSet(fields.tools);
        if (want === null || have === null) continue;
        if (!sameSet(want, have)) {
          drift.push(`${rel(filePath)}: [${[...have]}] != [${[...want]}]`);
        }
      }
      assert.deepStrictEqual(
        drift,
        [],
        `tool drift (locale doc grants tools the agent does not have):\n  ${drift.join('\n  ')}`
      );
    }],

    ['a read-only reviewer is never documented with Write or Edit', () => {
      // The specific failure this file was written for: every locale copy of
      // security-reviewer and database-reviewer advertised Write and Edit.
      const offenders = [];
      for (const { file, filePath } of localeFiles) {
        const want = toolSet(canonical.get(file).tools);
        if (want === null || want.has('Write') || want.has('Edit')) continue;
        const fields = frontmatter(filePath);
        const have = toolSet(fields && fields.tools);
        if (have && (have.has('Write') || have.has('Edit'))) {
          offenders.push(rel(filePath));
        }
      }
      assert.deepStrictEqual(offenders, [], `read-only agents documented as writable:\n  ${offenders.join('\n  ')}`);
    }],
  ];

  let passed = 0;
  let failed = 0;
  for (const [name, fn] of tests) {
    if (runTest(name, fn)) passed += 1;
    else failed += 1;
  }

  console.log(`\n  Checked ${localeFiles.length} locale docs against ${canonical.size} agents`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main();
