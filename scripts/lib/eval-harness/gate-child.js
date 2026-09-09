'use strict';

/**
 * Sandboxed variant runner. Spawned by gate.js inside a copy of the variant
 * directory with the effect fence preloaded. It receives task inputs only
 * (never expected outputs) on stdin and prints one JSON result per task.
 */

const fs = require('fs');
const path = require('path');

function main() {
  const raw = fs.readFileSync(0, 'utf8');
  const request = JSON.parse(raw);
  const entry = path.resolve(process.cwd(), request.entry || 'run.js');
  let variant;
  try {
    variant = require(entry);
  } catch (error) {
    process.stdout.write(JSON.stringify({ fatal: `cannot load ${request.entry}: ${error.message}` }) + '\n');
    return;
  }
  if (typeof variant.solve !== 'function') {
    process.stdout.write(JSON.stringify({ fatal: 'variant must export solve(input)' }) + '\n');
    return;
  }
  const results = [];
  for (const task of request.tasks) {
    try {
      results.push({ id: task.id, output: variant.solve(task.input) });
    } catch (error) {
      results.push({ id: task.id, error: error && error.code ? `${error.code}: ${error.message}` : String(error && error.message) });
    }
  }
  process.stdout.write(JSON.stringify({ results }) + '\n');
}

main();
