'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

// A private CommonJS graph for filesystem fault fixtures. Dependencies share
// this graph (including opaque lock identities), never the process module cache.
function createFileSystemLoader(fileSystem) {
  const sourceRoot = path.resolve(__dirname, '../../../scripts');
  const cache = new Map();
  function load(filename) {
    const absolute = path.resolve(filename);
    const relative = path.relative(sourceRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !absolute.endsWith('.js')) {
      throw new Error('Fixture loader requires a JavaScript module under scripts/');
    }
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const child = new Module(absolute, module);
    child.filename = absolute;
    child.paths = Module._nodeModulePaths(path.dirname(absolute));
    const nativeRequire = Module.createRequire(absolute);
    child.require = request => {
      if (request === 'fs' || request === 'node:fs') return fileSystem;
      const resolved = nativeRequire.resolve(request);
      const dependency = path.relative(sourceRoot, resolved);
      if (path.isAbsolute(resolved) && !dependency.startsWith('..')
        && !path.isAbsolute(dependency) && resolved.endsWith('.js')) return load(resolved);
      return nativeRequire(request);
    };
    cache.set(absolute, child);
    try {
      child._compile(fs.readFileSync(absolute, 'utf8'), absolute);
      child.loaded = true;
      return child.exports;
    } catch (error) {
      cache.delete(absolute);
      throw error;
    }
  }
  return load;
}

module.exports = { createFileSystemLoader };
