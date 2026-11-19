#!/usr/bin/env node
/**
 * Report which curated skills have reference evidence, for the catalog review
 * in docs/ROADMAP.md: "every skill has a test, a command, an agent, or a
 * README mention, or it is marked for removal".
 *
 * Evidence contract:
 * - test: a test file under tests/ (`*.test.{js,cjs,mjs}`, `test_*.py`,
 *   `*_test.py`), outside tests/fixtures/, that names the skill's path
 *   (`skills/<name>`, `skills\<name>`, or `'skills', '<name>'` as in
 *   path.join), quotes the name as a whole string literal (a list the test
 *   iterates), or whose file name is the skill name. A fixture that lists a
 *   skill, such as a routing corpus, is data and not a test of that skill.
 * - command: a commands/*.md file that mentions the skill name.
 * - agent: an agents/*.md file that mentions the skill name.
 * - readme: README.md mentions the skill name.
 *
 * A mention is the skill name as a whole token: `api` does not match inside
 * `api-design`. Generated mirrors (.agents/, .opencode/, docs/<locale>/,
 * legacy-command-shims/) are not evidence. Ambiguous text counts as a
 * reference: a skill wrongly reported as unreferenced could be removed, while
 * a false reference only keeps it listed for review.
 *
 * Read-only by design: the report never edits, marks, or removes a skill, and
 * exits 0 whatever it finds. Removal stays a maintainer decision.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA = 'ecc.skill-references/v1';
const KINDS = ['test', 'command', 'agent', 'readme'];
const TEST_FILE_PATTERN = /(?:\.test\.(?:js|cjs|mjs)|^test_.+\.py|_test\.py)$/;
const TOKEN_PATTERN = /(?<![A-Za-z0-9_-])[a-z0-9]+(?:-[a-z0-9]+)*(?![A-Za-z0-9_-])/g;
// `\\+`: a Windows separator is usually escaped in source (`'skills\\name'`).
const SKILL_PATH_PATTERN = /skills(?:\/|\\+|['"]\s*,\s*['"])([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_-])/g;
// A whole quoted literal, as in `for (const skill of ['a', 'b'])` before path.join.
const QUOTED_NAME_PATTERN = /(['"`])([a-z0-9]+(?:-[a-z0-9]+)*)\1/g;

function listSkills(root) {
  const skillsDir = path.join(root, 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort();
}

function walkFiles(dir, accept, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walkFiles(full, accept, acc);
    } else if (entry.isFile() && accept(full, entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function evidenceSources(root) {
  const fixtures = path.join(root, 'tests', 'fixtures') + path.sep;
  const markdown = (_full, name) => name.endsWith('.md');
  const readme = path.join(root, 'README.md');
  return {
    test: walkFiles(path.join(root, 'tests'), (full, name) => !full.startsWith(fixtures) && TEST_FILE_PATTERN.test(name)),
    command: walkFiles(path.join(root, 'commands'), markdown),
    agent: walkFiles(path.join(root, 'agents'), markdown),
    readme: fs.existsSync(readme) ? [readme] : [],
  };
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Earliest line in `text` where each known skill matches one of `patterns` ([regex, group]). */
function firstMatches(text, patterns, skills) {
  const found = new Map();
  for (const [pattern, group] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[group];
      if (!skills.has(name)) continue;
      const line = lineAt(text, match.index);
      if (!found.has(name) || line < found.get(name)) found.set(name, line);
    }
  }
  return found;
}

const TEST_PATTERNS = [[SKILL_PATH_PATTERN, 1], [QUOTED_NAME_PATTERN, 2]];
const MENTION_PATTERNS = [[TOKEN_PATTERN, 0]];

function testFileSkill(file, skills) {
  const stem = path.basename(file).replace(/\.test\.(?:js|cjs|mjs)$|\.py$/, '');
  // Strip one marker only: test_py_test.py names the skill py-test.
  const base = (stem.startsWith('test_') ? stem.slice(5) : stem.replace(/_test$/, '')).replace(/_/g, '-');
  return skills.has(base) ? base : null;
}

function collectSkillReferences(root) {
  const resolved = path.resolve(root);
  const names = listSkills(resolved);
  const skills = new Set(names);
  const evidence = new Map(names.map(name => [name, Object.fromEntries(KINDS.map(kind => [kind, []]))]));
  const sources = evidenceSources(resolved);
  for (const kind of KINDS) {
    for (const file of sources[kind].sort()) {
      const text = fs.readFileSync(file, 'utf8');
      const relative = path.relative(resolved, file).split(path.sep).join('/');
      const found = firstMatches(text, kind === 'test' ? TEST_PATTERNS : MENTION_PATTERNS, skills);
      const named = kind === 'test' ? testFileSkill(file, skills) : null;
      if (named && !found.has(named)) found.set(named, 1);
      for (const [name, line] of found) evidence.get(name)[kind].push({ file: relative, line });
    }
  }
  const rows = names.map(name => ({ name, evidence: evidence.get(name) }));
  const unreferenced = rows.filter(row => KINDS.every(kind => row.evidence[kind].length === 0)).map(row => row.name);
  const counts = Object.fromEntries(KINDS.map(kind => [kind, rows.filter(row => row.evidence[kind].length > 0).length]));
  return { schema: SCHEMA, total: names.length, counts, unreferenced, skills: rows };
}

function formatText(report) {
  const lines = [
    'Skill reference audit (report only)',
    `Curated skills: ${report.total}`,
    `With evidence: test ${report.counts.test}, command ${report.counts.command}, agent ${report.counts.agent}, readme ${report.counts.readme}`,
    `No test, command, agent, or README reference: ${report.unreferenced.length}`,
    ...report.unreferenced.map(name => `  ${name}`),
  ];
  return lines.join('\n') + '\n';
}

function formatSkill(report, name) {
  const row = report.skills.find(skill => skill.name === name);
  if (!row) return null;
  const lines = [`${name}`];
  for (const kind of KINDS) {
    const hits = row.evidence[kind];
    lines.push(`  ${kind}: ${hits.length ? '' : 'none'}`);
    for (const hit of hits) lines.push(`    ${hit.file}:${hit.line}`);
  }
  return lines.join('\n') + '\n';
}

function parseArgs(argv) {
  const options = { json: false, root: path.join(__dirname, '..', '..'), skill: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--root' || arg === '--skill') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
      i += 1;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

const USAGE = `Usage: node scripts/ci/skill-references.js [--json] [--skill <name>] [--root <repo>]

  --json          Emit the full report, with file:line evidence per skill
  --skill <name>  Show the evidence for one skill
  --root <repo>   Audit another checkout (default: this repository)
`;

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  const report = collectSkillReferences(options.root);
  if (options.skill) {
    const text = formatSkill(report, options.skill);
    if (!text) {
      process.stderr.write(`Unknown skill: ${options.skill}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(options.json ? `${JSON.stringify(report.skills.find(s => s.name === options.skill), null, 2)}\n` : text);
    return;
  }
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
}

module.exports = { SCHEMA, KINDS, collectSkillReferences, formatText, formatSkill, parseArgs };

if (require.main === module) main();
