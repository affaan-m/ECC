// Tiny JSON-file-backed key/value store. All operations are synchronous so a
// check-and-set within one event-loop turn cannot interleave.
import fs from 'node:fs';
import path from 'node:path';

function storePath() {
  return process.env.STORE_FILE || path.join(process.cwd(), '.data', 'store.json');
}

function load() {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')); } catch { return {}; }
}

function save(data) {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
}

export function get(key) {
  return load()[key];
}

export function has(key) {
  return Object.prototype.hasOwnProperty.call(load(), key);
}

export function set(key, value) {
  const data = load();
  data[key] = value;
  save(data);
  return value;
}
