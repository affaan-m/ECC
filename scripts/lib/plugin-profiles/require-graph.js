/**
 * Static require()/import() graph extraction for the carrier's fail-closed
 * dependency closure.
 *
 * Nothing here executes the scripts it reads. Every specifier is classified
 * and reported; callers decide what is a refusal.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { toPosix, resolveModuleCandidate } = require('./fs-utils');

const RELATIVE_REQUIRE_PATTERN = /\b(?:require|import)\(\s*['"](\.[^'"]*)['"]\s*\)/g;
const DIRNAME_JOIN_REQUIRE_PATTERN = /\brequire\(\s*path\.join\(\s*__dirname\s*((?:,\s*['"][^'"]+['"]\s*)+)\)\s*\)/g;
// Tolerates one level of nested parentheses so `require(path.join(...))`
// is captured whole rather than cut at the inner `)`.
const DYNAMIC_REQUIRE_PATTERN = /\brequire\(\s*(?!['"])((?:[^()]|\([^()]*\))+)\)/g;

/**
 * Strip comments so a doc comment that mentions a require shape does not
 * create a phantom dependency.
 *
 * @param {string} rawSource File contents.
 * @returns {string} Source with block and line comments removed.
 */
function stripComments(rawSource) {
  return String(rawSource || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Extract the relative module specifiers a source file requires.
 *
 * Three shapes are followed: `require('./x')`, `import('./x')`, and
 * `require(path.join(__dirname, 'a', 'b'))` with string-literal segments.
 * Any other non-literal `require(...)` cannot be resolved statically and is
 * reported as dynamic.
 *
 * @param {string} rawSource File contents.
 * @returns {{specifiers: Array<string>, dynamic: Array<string>}} Findings.
 */
function extractRequireSpecifiers(rawSource) {
  const specifiers = [];
  const dynamic = [];
  const source = stripComments(rawSource);

  RELATIVE_REQUIRE_PATTERN.lastIndex = 0;
  let match = RELATIVE_REQUIRE_PATTERN.exec(source);
  while (match !== null) {
    specifiers.push(match[1]);
    match = RELATIVE_REQUIRE_PATTERN.exec(source);
  }

  DIRNAME_JOIN_REQUIRE_PATTERN.lastIndex = 0;
  match = DIRNAME_JOIN_REQUIRE_PATTERN.exec(source);
  while (match !== null) {
    const segments = [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
    specifiers.push(`./${segments.join('/')}`);
    match = DIRNAME_JOIN_REQUIRE_PATTERN.exec(source);
  }

  DYNAMIC_REQUIRE_PATTERN.lastIndex = 0;
  match = DYNAMIC_REQUIRE_PATTERN.exec(source);
  while (match !== null) {
    const argument = match[1].trim();
    const isLiteralDirnameJoin = /^path\.join\(\s*__dirname\s*(?:,\s*['"][^'"]+['"]\s*)+\)$/.test(argument);
    if (!isLiteralDirnameJoin) {
      dynamic.push(argument);
    }
    match = DYNAMIC_REQUIRE_PATTERN.exec(source);
  }

  return { specifiers, dynamic };
}

/**
 * Resolve every entry specifier to an absolute file, recording the ones that
 * do not resolve.
 *
 * @param {Array<string>} entryPaths Repo-relative entry scripts.
 * @param {string} resolvedRoot Absolute repository root.
 * @param {Array<object>} unresolved Sink for unresolved entries.
 * @returns {Array<string>} Absolute resolved entry files.
 */
function resolveEntryFiles(entryPaths, resolvedRoot, unresolved) {
  const queue = [];
  for (const entryPath of entryPaths) {
    const resolved = resolveModuleCandidate(path.join(resolvedRoot, ...entryPath.split('/')));
    if (resolved) {
      queue.push(resolved);
    } else {
      unresolved.push({ from: '<entry>', specifier: entryPath });
    }
  }
  return queue;
}

/**
 * Walk the transitive require() graph of one or more entry scripts.
 *
 * Only relative specifiers are followed — bare specifiers are Node builtins
 * or npm packages, neither of which lives in the repo tree. Nothing is
 * skipped silently: every relative specifier that fails to resolve is
 * returned in `unresolved`, and every non-literal require is returned in
 * `dynamic` so callers can decide how to treat it.
 *
 * @param {Array<string>} entryPaths Repo-relative entry scripts.
 * @param {string} repoRoot Absolute repository root.
 * @returns {{files: Array<string>, unresolved: Array<{from: string, specifier: string}>, dynamic: Array<{from: string, expression: string}>}}
 */
function resolveScriptClosure(entryPaths, repoRoot) {
  const resolvedRoot = path.resolve(repoRoot);
  const seen = new Set();
  const unresolved = [];
  const dynamic = [];
  const toRelative = absPath => toPosix(path.relative(resolvedRoot, absPath));
  const queue = resolveEntryFiles(entryPaths, resolvedRoot, unresolved);

  while (queue.length > 0) {
    const current = queue.pop();
    const relative = toRelative(current);
    if (seen.has(relative) || relative.startsWith('..') || path.isAbsolute(relative)) {
      continue;
    }
    seen.add(relative);

    let source;
    try {
      source = fs.readFileSync(current, 'utf8');
    } catch (error) {
      unresolved.push({ from: relative, specifier: `<unreadable: ${error.message}>` });
      continue;
    }

    const findings = extractRequireSpecifiers(source);
    for (const specifier of findings.specifiers) {
      const next = resolveModuleCandidate(path.resolve(path.dirname(current), specifier));
      if (next) {
        queue.push(next);
      } else {
        unresolved.push({ from: relative, specifier });
      }
    }
    for (const expression of findings.dynamic) {
      dynamic.push({ from: relative, expression });
    }
  }

  return { files: [...seen].sort(), unresolved, dynamic };
}

module.exports = {
  extractRequireSpecifiers,
  resolveScriptClosure,
};
