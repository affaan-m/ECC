'use strict';
const fs = require('node:fs');
const path = require('node:path');

// JSON-file-backed link store. Missing or corrupt files start clean; every
// mutation is flushed synchronously so a restart never loses a committed link.
function createStore(file) {
  let links = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [code, value] of Object.entries(raw.links || {})) links.set(code, value);
  } catch { /* missing or corrupt: start empty */ }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ links: Object.fromEntries(links) }, null, 1)}\n`);
  };
  return {
    get: code => links.get(code) || null,
    set(code, value) { links.set(code, value); save(); },
    delete(code) { const had = links.delete(code); if (had) save(); return had; },
    incrementHits(code) {
      const link = links.get(code);
      if (link) { link.hits = (link.hits || 0) + 1; save(); }
    },
  };
}

module.exports = { createStore };
