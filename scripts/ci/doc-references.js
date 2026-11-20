#!/usr/bin/env node
/**
 * Report which tracked docs no other tracked file references, for the Track A
 * exit criterion in docs/ROADMAP.md: "no zero-reference tracked doc outside
 * `docs/releases/`".
 *
 * Scope: git-tracked `*.md` and `*.mdx` files at the repository root and under
 * docs/, except docs/releases/. Root files that tools and GitHub read by
 * convention (README.md, AGENTS.md, CLAUDE.md, CODE_OF_CONDUCT.md,
 * CONTRIBUTING.md, SECURITY.md, SUPPORT.md) are listed as exempt, not
 * audited.
 *
 * Evidence contract: a doc is referenced when any other tracked file names it
 * as
 * - a link target: `[text](target)`, `[label]: target`, `href="target"` or
 *   `src="target"`, resolved against the referring file (`/` is the
 *   repository root);
 * - a GitHub URL into this repository, under its current or former name
 *   (`github.com/affaan-m/ECC/blob/<ref>/<path>`, `tree/`, `raw/`, or
 *   raw.githubusercontent.com), at any ref;
 * - a path literal ending in `.md` or `.mdx`, as in package.json or a script,
 *   resolved against both the referring file and the repository root.
 * A target that is a directory references that directory's README.md, which
 * GitHub renders when the directory opens. Link destinations follow CommonMark:
 * `<...>` may contain spaces, and unbracketed ones may contain balanced or
 * `\\(`-escaped parentheses. A file does not reference itself; binary files
 * and tracked paths missing from the working tree are skipped, and any other
 * read error fails the audit rather than hiding references.
 * Ambiguous text counts as a reference: a doc wrongly reported as unreferenced
 * could be deleted, while a false reference only keeps it in place.
 *
 * Read-only by design: the report never edits, moves, or deletes a doc, and
 * exits 0 whatever it finds. Removal stays a maintainer decision.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCHEMA = 'ecc.doc-references/v1';
const DOC_PATTERN = /\.mdx?$/i;
const EXEMPT = ['AGENTS.md', 'CLAUDE.md', 'CODE_OF_CONDUCT.md', 'CONTRIBUTING.md', 'README.md', 'SECURITY.md', 'SUPPORT.md'];
const LOCALE_PATTERN = /^docs\/([a-z]{2}(?:-[A-Z]{2})?)\//;
// A tracked path that is gone from the working tree, or is a directory (a submodule).
const SKIPPED_READ_CODES = new Set(['ENOENT', 'ENOTDIR', 'EISDIR']);

const INLINE_LINK_PATTERN = /\]\(\s*/g;
const REFERENCE_DEFINITION_PATTERN = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^<>\n]*)>|(\S+))/gm;
const HTML_LINK_PATTERN = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
const ESCAPED_PUNCTUATION_PATTERN = /\\([!-/:-@[-`{-~])/g;
const REPO_URL_PATTERN = /(?:github\.com\/affaan-m\/(?:ECC|everything-claude-code)\/(?:blob|tree|raw)|raw\.githubusercontent\.com\/affaan-m\/(?:ECC|everything-claude-code))\/[^/\s)]+\/([^\s)"'#?>`]+)/gi;
const PATH_LITERAL_PATTERN = /(?<![\w./-])((?:\.{1,2}\/)*[\w.@-]+(?:\/[\w.@-]+)*\.mdx?)(?![\w-])/gi;

function trackedFiles(root) {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return output.split('\0').filter(Boolean).sort();
}

function isAudited(file) {
  if (!DOC_PATTERN.test(file)) return false;
  if (!file.includes('/')) return true;
  return file.startsWith('docs/') && !file.startsWith('docs/releases/');
}

/**
 * The CommonMark link destination starting at `start`: `<...>` (spaces allowed),
 * or text up to whitespace or an unbalanced `)`, with `\\(` escapes skipped.
 */
function destinationAt(text, start) {
  if (text[start] === '<') {
    const end = text.indexOf('>', start + 1);
    const inner = end < 0 ? '' : text.slice(start + 1, end);
    return /[<\n]/.test(inner) ? '' : inner;
  }
  let depth = 0;
  let end = start;
  for (; end < text.length; end += 1) {
    const char = text[end];
    if (char === '\\') end += 1;
    else if (char === '(') depth += 1;
    else if (char === ')' && depth === 0) break;
    else if (char === ')') depth -= 1;
    else if (/\s/.test(char)) break;
  }
  return text.slice(start, end);
}

/** Inline, reference-definition and HTML link targets in `text`, as [target, index]. */
function linkTargets(text) {
  const targets = [];
  for (const match of text.matchAll(INLINE_LINK_PATTERN)) targets.push([destinationAt(text, match.index + match[0].length), match.index]);
  for (const match of text.matchAll(REFERENCE_DEFINITION_PATTERN)) targets.push([match[1] ?? match[2], match.index]);
  for (const match of text.matchAll(HTML_LINK_PATTERN)) targets.push([match[1], match.index]);
  return targets;
}

function cleanTarget(raw) {
  let target = raw.replace(ESCAPED_PUNCTUATION_PATTERN, '$1').replace(/[#?].*$/, '');
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep a target with a stray `%` as written.
  }
  return target;
}

/** Repository-relative paths a target could name, from `dir` and from the root. */
function resolveTarget(target, dir, { rootToo }) {
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return [];
  if (target.startsWith('/')) return [path.posix.normalize(target.slice(1))];
  const out = [path.posix.normalize(path.posix.join(dir, target))];
  if (rootToo) out.push(path.posix.normalize(target));
  return out.filter(candidate => !candidate.startsWith('../'));
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Each candidate path in `text` with the index of its first occurrence. */
function candidates(text, file) {
  const dir = path.posix.dirname(file);
  const found = new Map();
  const add = (paths, index) => {
    for (const candidate of paths) if (!found.has(candidate) || index < found.get(candidate)) found.set(candidate, index);
  };
  for (const [target, index] of linkTargets(text)) add(resolveTarget(cleanTarget(target), dir, { rootToo: false }), index);
  for (const match of text.matchAll(REPO_URL_PATTERN)) add([path.posix.normalize(cleanTarget(match[1]).replace(/\/+$/, ''))], match.index);
  for (const match of text.matchAll(PATH_LITERAL_PATTERN)) add(resolveTarget(match[1], dir, { rootToo: true }), match.index);
  return found;
}

/** A tracked file's text, or null for a binary file or a path with nothing to read; other errors propagate. */
function readText(root, file) {
  let buffer;
  try {
    buffer = fs.readFileSync(path.join(root, file));
  } catch (error) {
    if (SKIPPED_READ_CODES.has(error.code)) return null;
    throw error;
  }
  return buffer.includes(0) ? null : buffer.toString('utf8');
}

/** Per-locale totals, built as new objects from the rows. */
function localeCounts(rows) {
  const names = [...new Set(rows.map(row => row.locale).filter(Boolean))].sort();
  return Object.fromEntries(names.map(locale => {
    const inLocale = rows.filter(row => row.locale === locale);
    return [locale, { total: inLocale.length, unreferenced: inLocale.filter(row => row.referrers.length === 0).length }];
  }));
}

function collectDocReferences(root) {
  const resolved = path.resolve(root);
  const files = trackedFiles(resolved);
  const exempt = files.filter(file => EXEMPT.includes(file));
  const docs = files.filter(file => isAudited(file) && !EXEMPT.includes(file));
  const referrers = new Map(docs.map(doc => [doc, []]));
  for (const file of files) {
    const text = readText(resolved, file);
    if (text === null) continue;
    const lines = new Map();
    for (const [candidate, index] of candidates(text, file)) {
      const doc = referrers.has(candidate) ? candidate : `${candidate.replace(/\/$/, '')}/README.md`;
      if (!referrers.has(doc) || doc === file) continue;
      const line = lineAt(text, index);
      if (!lines.has(doc) || line < lines.get(doc)) lines.set(doc, line);
    }
    for (const [doc, line] of lines) referrers.get(doc).push({ file, line });
  }
  const rows = docs.map(doc => ({ path: doc, locale: (doc.match(LOCALE_PATTERN) || [])[1] || null, referrers: referrers.get(doc) }));
  const unreferenced = rows.filter(row => row.referrers.length === 0).map(row => row.path);
  return { schema: SCHEMA, total: docs.length, exempt, unreferenced, locales: localeCounts(rows), docs: rows };
}

function formatText(report) {
  const english = report.docs.filter(row => !row.locale);
  const unreferencedEnglish = english.filter(row => row.referrers.length === 0).map(row => row.path);
  const lines = [
    'Doc reference audit (report only)',
    `Tracked docs in scope: ${report.total} (exempt by convention: ${report.exempt.join(', ') || 'none'})`,
    `No reference from another tracked file: ${report.unreferenced.length}`,
    '',
    `Non-locale docs: ${unreferencedEnglish.length} of ${english.length} unreferenced`,
    ...unreferencedEnglish.map(doc => `  ${doc}`),
  ];
  const locales = Object.keys(report.locales).sort();
  if (locales.length) {
    lines.push('', 'Locale trees (paths in --json):');
    for (const locale of locales) {
      const { total, unreferenced } = report.locales[locale];
      lines.push(`  docs/${locale}/: ${unreferenced} of ${total} unreferenced`);
    }
  }
  return lines.join('\n') + '\n';
}

function formatDoc(report, doc) {
  const row = report.docs.find(entry => entry.path === doc);
  if (!row) return null;
  const lines = [doc, `  referrers: ${row.referrers.length ? '' : 'none'}`];
  for (const hit of row.referrers) lines.push(`    ${hit.file}:${hit.line}`);
  return lines.join('\n') + '\n';
}

function parseArgs(argv) {
  const options = { json: false, root: path.join(__dirname, '..', '..'), doc: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--root' || arg === '--doc') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
      i += 1;
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

const USAGE = `Usage: node scripts/ci/doc-references.js [--json] [--doc <path>] [--root <repo>]

  --json          Emit the full report, with file:line referrers per doc
  --doc <path>    Show the referrers of one doc (repository-relative path)
  --root <repo>   Audit another git checkout (default: this repository)
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
  let report;
  try {
    report = collectDocReferences(options.root);
  } catch (error) {
    process.stderr.write(`Cannot audit ${options.root}: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (options.doc) {
    const doc = options.doc.split(path.sep).join('/').replace(/^\.\//, '');
    const text = formatDoc(report, doc);
    if (!text) {
      process.stderr.write(`Not an audited doc: ${options.doc}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(options.json ? `${JSON.stringify(report.docs.find(row => row.path === doc), null, 2)}\n` : text);
    return;
  }
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
}

module.exports = { SCHEMA, EXEMPT, collectDocReferences, formatText, formatDoc, parseArgs };

if (require.main === module) main();
