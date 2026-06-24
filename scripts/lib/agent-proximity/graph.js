'use strict';

/**
 * Lightweight dependency-graph builder for the agent-proximity metric.
 *
 * Edge f → g iff f imports/requires g. This is the structure the dependency
 * channel (distance.js, eqs. 4-5) walks: two agents far apart in the tree still
 * collide if one edits a file the other imports.
 *
 * v0 scans JS/TS `require()` / `import ... from` / `import(...)` for relative
 * specifiers and resolves them to repo-relative paths. It is intentionally
 * static and dependency-free; richer languages and call-graph edges are future
 * channels that slot into the same adjacency shape.
 */

const fs = require('fs');
const path = require('path');

const SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'];
const RESOLVE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json'];

function toRepoRel(repoRoot, absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

// Match relative specifiers only (./ or ../). Bare specifiers are node_modules
// and never the target of an in-repo collision.
const SPEC_PATTERNS = [
  /require\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  /import\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/g,
  /import\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  /export\s+(?:\*|\{[^}]*\})\s+from\s+['"](\.[^'"]+)['"]/g
];

function extractRelativeSpecifiers(source) {
  const specs = new Set();
  for (const re of SPEC_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
      specs.add(m[1]);
    }
  }
  return [...specs];
}

/**
 * Resolve a relative specifier from `fromFile` to a repo-relative path, trying
 * extension and /index resolution like Node/TS would.
 */
function resolveSpecifier(repoRoot, fromFile, spec) {
  const baseDir = path.dirname(path.join(repoRoot, fromFile));
  const target = path.resolve(baseDir, spec);
  const candidates = [target];
  for (const ext of RESOLVE_EXTENSIONS) candidates.push(target + ext);
  for (const ext of RESOLVE_EXTENSIONS) candidates.push(path.join(target, 'index' + ext));
  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        return toRepoRel(repoRoot, cand);
      }
    } catch {
      /* ignore unreadable candidate */
    }
  }
  return null;
}

function isSourceFile(p) {
  return SOURCE_EXTENSIONS.includes(path.extname(p));
}

/**
 * Build a dependency graph from an explicit list of repo-relative files.
 * Returns { adjacency: { file: [importedFile, ...] }, files: [...] }.
 *
 * @param {string} repoRoot
 * @param {string[]} files repo-relative paths to scan
 * @param {object} [deps] injectable fs for testing: { readFileSync, existsSync, statSync }
 */
function buildDependencyGraph(repoRoot, files, deps = {}) {
  const read = deps.readFileSync || fs.readFileSync;
  const adjacency = {};
  const scanned = [];
  for (const rel of files || []) {
    const normalized = String(rel).replace(/\\/g, '/');
    if (!isSourceFile(normalized)) continue;
    scanned.push(normalized);
    let source = '';
    try {
      source = String(read(path.join(repoRoot, normalized), 'utf8'));
    } catch {
      adjacency[normalized] = adjacency[normalized] || [];
      continue;
    }
    const edges = new Set(adjacency[normalized] || []);
    for (const spec of extractRelativeSpecifiers(source)) {
      const resolved = resolveSpecifier(repoRoot, normalized, spec);
      if (resolved && resolved !== normalized) edges.add(resolved);
    }
    adjacency[normalized] = [...edges];
  }
  return { adjacency, files: scanned };
}

/**
 * Build a graph directly from an in-memory map of { file: sourceText }, for
 * callers that already have file contents (and for tests). Specifiers are
 * resolved against the provided file set rather than the filesystem.
 */
function buildDependencyGraphFromSources(sources = {}) {
  const adjacency = {};
  const fileList = Object.keys(sources).map(f => f.replace(/\\/g, '/'));
  const fileSet = new Set(fileList);
  const tryResolve = (fromFile, spec) => {
    const base = path.posix.dirname(fromFile);
    const target = path.posix.normalize(path.posix.join(base, spec));
    const candidates = [target];
    for (const ext of RESOLVE_EXTENSIONS) candidates.push(target + ext);
    for (const ext of RESOLVE_EXTENSIONS) candidates.push(path.posix.join(target, 'index' + ext));
    return candidates.find(c => fileSet.has(c)) || null;
  };
  for (const file of fileList) {
    const edges = new Set();
    for (const spec of extractRelativeSpecifiers(String(sources[file] || ''))) {
      const resolved = tryResolve(file, spec);
      if (resolved && resolved !== file) edges.add(resolved);
    }
    adjacency[file] = [...edges];
  }
  return { adjacency, files: fileList };
}

module.exports = {
  buildDependencyGraph,
  buildDependencyGraphFromSources,
  extractRelativeSpecifiers,
  resolveSpecifier,
  isSourceFile
};
