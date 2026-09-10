#!/usr/bin/env node
/**
 * Report file and function lengths for a set of JavaScript files.
 *
 * The repository guideline is files under 800 lines and functions under 50.
 * This is a reporting aid for reviews and refactors, not a CI gate: pass
 * `--max-file` / `--max-function` to make it exit non-zero on violations.
 *
 * Usage:
 *   node scripts/ci/check-module-size.js scripts/lib/plugin-profiles
 *   node scripts/ci/check-module-size.js --max-file 800 --max-function 50 <paths...>
 *
 * Function length is measured by brace balance from a `function` keyword or
 * an arrow-function assignment at statement level. It is a heuristic meant
 * to surface the worst offenders, not a parser.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function collectJsFiles(target, out) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (target.endsWith('.js')) {
      out.push(target);
    }
    return;
  }
  for (const entry of fs.readdirSync(target)) {
    if (entry === 'node_modules' || entry === '.git') {
      continue;
    }
    collectJsFiles(path.join(target, entry), out);
  }
}

function stripStringsAndComments(line) {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function measureFunctions(lines) {
  const found = [];
  let current = null;
  let depth = 0;

  lines.forEach((raw, index) => {
    const line = stripStringsAndComments(raw);
    if (current === null && /^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/.test(line)) {
      current = { name: /function\s+([A-Za-z0-9_$]+)/.exec(line)[1], start: index + 1 };
      depth = 0;
    }
    if (current === null) {
      return;
    }
    depth += (line.match(/\{/g) || []).length;
    depth -= (line.match(/\}/g) || []).length;
    if (depth <= 0 && index + 1 > current.start) {
      found.push({ ...current, lines: index + 1 - current.start + 1 });
      current = null;
    }
  });
  return found;
}

function parseArgs(argv) {
  const options = { maxFile: null, maxFunction: null, targets: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--max-file') {
      options.maxFile = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--max-function') {
      options.maxFunction = Number(argv[i + 1]);
      i += 1;
    } else {
      options.targets.push(argv[i]);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.targets.length === 0) {
    console.error('Usage: node scripts/ci/check-module-size.js [--max-file N] [--max-function N] <path...>');
    process.exitCode = 1;
    return;
  }

  const files = [];
  for (const target of options.targets) {
    collectJsFiles(path.resolve(target), files);
  }

  let violations = 0;
  for (const file of files.sort()) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
    const functions = measureFunctions(lines).sort((a, b) => b.lines - a.lines);
    const longest = functions[0];
    console.log(`${String(lines.length).padStart(5)} lines  ${rel}`
      + (longest ? `  (longest function: ${longest.name} ${longest.lines} lines)` : ''));
    if (options.maxFile && lines.length > options.maxFile) {
      console.error(`  VIOLATION: ${rel} is ${lines.length} lines (max ${options.maxFile})`);
      violations += 1;
    }
    if (options.maxFunction) {
      for (const fn of functions.filter(entry => entry.lines > options.maxFunction)) {
        console.error(`  VIOLATION: ${rel}:${fn.start} ${fn.name}() is ${fn.lines} lines (max ${options.maxFunction})`);
        violations += 1;
      }
    }
  }

  if (violations > 0) {
    process.exitCode = 1;
  }
}

main();
