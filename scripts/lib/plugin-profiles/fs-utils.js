/**
 * Filesystem and hashing helpers shared by the plugin-profiles modules.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Normalize a filesystem path to forward slashes.
 *
 * @param {string} relPath Path in platform-native form.
 * @returns {string} Path with POSIX separators.
 */
function toPosix(relPath) {
  return String(relPath).split(path.sep).join('/');
}

/**
 * sha256 hex digest of a string or buffer.
 *
 * @param {string|Buffer} content Content to hash.
 * @returns {string} Hex digest.
 */
function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Read and parse a JSON file, reporting the logical name on failure.
 *
 * @param {string} filePath Absolute path to the JSON file.
 * @param {string} label Human-readable name used in the error message.
 * @returns {object} Parsed JSON.
 */
function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }
}

/**
 * Resolve a CommonJS-style specifier to a file: exact path, then `.js`, then
 * `/index.js`.
 *
 * @param {string} absPath Absolute candidate path.
 * @returns {string|null} Resolved file or null.
 */
function resolveModuleCandidate(absPath) {
  for (const candidate of [absPath, `${absPath}.js`, path.join(absPath, 'index.js')]) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // try the next candidate shape
    }
  }
  return null;
}

/**
 * List the immediate child directory names of a directory.
 *
 * @param {string} rootDir Directory to list.
 * @returns {Array<string>} Sorted directory names ([] when absent).
 */
function listChildDirectories(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

/**
 * List the immediate `.md` file names of a directory.
 *
 * @param {string} rootDir Directory to list.
 * @returns {Array<string>} Sorted file names ([] when absent).
 */
function listMarkdownFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }
  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort();
}

/**
 * Recursively list files under a directory as POSIX paths relative to it.
 *
 * @param {string} rootDir Directory to walk.
 * @returns {Array<string>} Sorted relative file paths.
 */
function listFilesRecursive(rootDir) {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
      } else if (entry.isFile()) {
        files.push(toPosix(path.relative(rootDir, absPath)));
      }
    }
  };
  if (fs.existsSync(rootDir)) {
    walk(rootDir);
  }
  return files.sort();
}

/**
 * Find symlinks at or under an absolute path, without following them.
 *
 * fs.cpSync({recursive: true}) copies symlinks as symlinks (Node's default
 * dereference is false), and listFilesRecursive() above only counts
 * entry.isFile(), so a symlink is invisible to computeTreeDigest(). A
 * carrier that copies one can silently start serving whatever the link
 * currently resolves to, outside the receipted, content-addressed tree,
 * while its digest still reports "unmodified". Selected sources are
 * rejected outright when they contain one rather than trying to validate
 * where the link points — see docs/PLUGIN-PROFILES.md's self-containment
 * rule.
 *
 * @param {string} absPath Absolute file or directory to check.
 * @returns {Array<string>} Absolute paths of any symlinks found, at or
 *   under absPath. A symlinked directory is reported once and not
 *   descended into (its target is outside what generation controls).
 */
function findSymlinksUnder(absPath) {
  const found = [];
  let stat;
  try {
    stat = fs.lstatSync(absPath);
  } catch {
    return found;
  }
  if (stat.isSymbolicLink()) {
    found.push(absPath);
    return found;
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
      const childPath = path.join(absPath, entry.name);
      if (entry.isSymbolicLink()) {
        found.push(childPath);
      } else if (entry.isDirectory()) {
        found.push(...findSymlinksUnder(childPath));
      }
    }
  }
  return found;
}

/**
 * Collapse untrusted catalog text to one line: newlines, carriage returns,
 * and C0/C1 control bytes would otherwise let a description forge extra
 * Markdown table rows in the generated catalog skill.
 *
 * @param {string} text Text to flatten.
 * @returns {string} Single-line text.
 */
function flattenLine(text) {
  // eslint-disable-next-line no-control-regex
  return String(text || '').replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = {
  toPosix,
  sha256,
  readJson,
  resolveModuleCandidate,
  listChildDirectories,
  listMarkdownFiles,
  listFilesRecursive,
  findSymlinksUnder,
  flattenLine,
};
