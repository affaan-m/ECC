'use strict';

const fs = require('fs');
const path = require('path');

function loadEnv(file = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

function expand(value) {
  if (typeof value === 'string') return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] || '');
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, expand(inner)]));
  return value;
}

function loadConfig() {
  loadEnv();
  return expand(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'app.json'), 'utf8')));
}

module.exports = { loadConfig };
