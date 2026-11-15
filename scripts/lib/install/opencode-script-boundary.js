'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SOURCE = 'manifests/install-assets/commonjs-scripts-package.json';
const key = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const markerPath = root => path.join(root, 'scripts', 'package.json');
const isScriptBoundary = (operation, root) => operation.kind === 'copy-file'
  && operation.sourceRelativePath === SOURCE && key(operation.destinationPath) === key(markerPath(root));

// A nested package owns its own module scope. Symlinks and uncertain trees are
// preserved conservatively rather than followed while deciding scope changes.
// Native .ts and transpiled JSX/TSX inherit package type too. Explicit
// .mjs/.cjs/.mts/.cts formats remain independent of this boundary.
function scopedScriptFiles(directory, { nested = false, depth = 0 } = {}) {
  if (depth > 40) throw new Error('OpenCode scripts tree exceeds the safe inspection depth');
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe OpenCode scripts directory: ${directory}`);
  const packageStat = fs.lstatSync(path.join(directory, 'package.json'), { throwIfNoEntry: false });
  if (nested && packageStat?.isFile()) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unsafe OpenCode scripts symlink: ${file}`);
    if (entry.isDirectory()) files.push(...scopedScriptFiles(file, { nested: true, depth: depth + 1 }));
    else if (entry.isFile() && /\.(?:js|jsx|ts|tsx)$/i.test(entry.name)) files.push(file);
    if (files.length > 12000) throw new Error('OpenCode scripts tree exceeds the safe inspection count');
  }
  return files;
}

function assertCommonJSMetadata(content, file) {
  if (content === null) {
    if (fs.lstatSync(file, { throwIfNoEntry: false })) {
      throw new Error(`Refusing CommonJS runtime migration: invalid user module boundary at ${file}.`);
    }
    return;
  }
  let metadata;
  try { metadata = JSON.parse(content.toString('utf8')); }
  catch { throw new Error(`Refusing CommonJS runtime migration: invalid user module boundary at ${file}.`); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || (metadata.type !== undefined && metadata.type !== 'commonjs')) {
    throw new Error(`Refusing CommonJS runtime migration: preserve the existing user module boundary at ${file}.`);
  }
}

function assertSelectedScriptScopes(plan, readFile, scriptsRoot) {
  const inspected = new Set();
  for (const operation of plan.operations) {
    if (operation.kind !== 'copy-file' || !/\.(?:js|jsx|ts|tsx)$/i.test(operation.destinationPath)) continue;
    const relative = path.relative(scriptsRoot, operation.destinationPath);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) continue;
    // Check every selected entry/helper, including nested library boundaries
    // which the unrelated-user-script scope walk intentionally skips.
    let directory = path.dirname(operation.destinationPath);
    while (key(directory) !== key(scriptsRoot)) {
      const file = path.join(directory, 'package.json');
      if (!inspected.has(key(file))) {
        assertCommonJSMetadata(readFile(file), file);
        inspected.add(key(file));
      }
      directory = path.dirname(directory);
    }
  }
}

function assertScriptBoundary(plan, { readFile, previousOperations = [], writtenDestinations = new Set(), expectedContent }) {
  if (!plan.operations.some(operation => isScriptBoundary(operation, plan.targetRoot))) return;
  const marker = markerPath(plan.targetRoot);
  assertSelectedScriptScopes(plan, readFile, path.dirname(marker));
  const content = readFile(marker);
  assertCommonJSMetadata(content, marker);
  if (content !== null) {
    const ownedMarker = previousOperations.find(operation => operation.ownership === 'managed'
      && isScriptBoundary(operation, plan.targetRoot));
    // A reinstall bridge may omit digests after preflight validated the old
    // receipt. At publication the fixed boundary asset still proves its bytes.
    const expectedMarker = ownedMarker && !ownedMarker.contentSha256
      ? expectedContent(plan.operations.find(operation => isScriptBoundary(operation, plan.targetRoot))) : null;
    const markerDigest = ownedMarker?.contentSha256 || (expectedMarker
      ? crypto.createHash('sha256').update(expectedMarker).digest('hex') : null);
    if (ownedMarker && crypto.createHash('sha256').update(content).digest('hex') !== markerDigest) {
      throw new Error(`Refusing CommonJS runtime migration: preserve the edited user module boundary at ${marker}.`);
    }
    // Existing user-owned CommonJS metadata is skipped by the ownership guard;
    // retaining its bytes does not change anyone's module interpretation.
    return;
  }
  const previous = new Map(previousOperations.filter(operation => operation.ownership === 'managed')
    .map(operation => [key(operation.destinationPath), operation]));
  const written = new Set([...writtenDestinations].map(key));
  const planned = new Map(plan.operations.map(operation => [key(operation.destinationPath), operation]));
  for (const file of scopedScriptFiles(path.dirname(marker))) {
    const operation = previous.get(key(file));
    const bytes = readFile(file);
    const expected = written.has(key(file))
      ? expectedContent(planned.get(key(file))) : null;
    const digest = bytes === null ? null : crypto.createHash('sha256').update(bytes).digest('hex');
    const expectedDigest = expected === null
      ? operation?.contentSha256 : crypto.createHash('sha256').update(expected).digest('hex');
    if (!expectedDigest || digest !== expectedDigest) {
      throw new Error(`Refusing CommonJS runtime migration: unowned or edited JavaScript/TypeScript at ${file} would change module scope. Give user scripts their own package.json scope before retrying.`);
    }
  }
}

function retainScriptBoundary(operation, targetRoot) {
  if (!isScriptBoundary(operation, targetRoot)) return false;
  try { return scopedScriptFiles(path.dirname(operation.destinationPath)).length > 0; }
  catch { return true; }
}

module.exports = { assertScriptBoundary, isScriptBoundary, retainScriptBoundary };
