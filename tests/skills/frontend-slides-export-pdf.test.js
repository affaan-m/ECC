#!/usr/bin/env node
/**
 * Stubbed run of skills/frontend-slides/scripts/export-pdf.sh: npm, npx and
 * node are replaced by stubs, so no network or browser is needed.
 *
 * Run with: node tests/skills/frontend-slides-export-pdf.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'skills', 'frontend-slides', 'scripts', 'export-pdf.sh');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function withStubbedExport(htmlRelPath, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-export-'));
  try {
    const bin = path.join(root, 'bin');
    const work = path.join(root, 'work');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.dirname(path.join(work, htmlRelPath)), { recursive: true });
    // npm/npx succeed without doing anything; open/xdg-open must not launch a viewer.
    for (const name of ['npm', 'npx', 'open', 'xdg-open']) {
      fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    // node stub checks the served HTML exists, then writes the PDF to the output path argument.
    fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\n[ -f "$2/$3" ] || exit 3\nprintf "%%PDF-stub" > "$4"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(work, htmlRelPath), '<html></html>\n');
    const run = (args, extraEnv = {}) => spawnSync('bash', [SCRIPT, ...args], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    });
    fn({ work, run });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runTests() {
  console.log('\n=== Testing frontend-slides export-pdf.sh ===\n');

  if (process.platform === 'win32') {
    console.log('  - skipped: bash script test on Windows');
    console.log('\nPassed: 0');
    console.log('Failed: 0');
    return;
  }

  let passed = 0;
  let failed = 0;

  if (test('writes a relative output path next to the caller, not into the deleted temp dir', () => {
    withStubbedExport('presentation.html', ({ work, run }) => {
      const result = run(['./presentation.html', './slides.pdf']);
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      assert.ok(fs.existsSync(path.join(work, 'slides.pdf')), 'slides.pdf was not written to the working directory');
    });
  })) passed++; else failed++;

  if (test('resolves nested relative input and output paths when CDPATH is exported', () => {
    withStubbedExport(path.join('decks', 'presentation.html'), ({ work, run }) => {
      const result = run(['decks/presentation.html', 'exports/slides.pdf'], { CDPATH: '.' });
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      assert.ok(fs.existsSync(path.join(work, 'exports', 'slides.pdf')), 'exports/slides.pdf was not written');
    });
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

runTests();
