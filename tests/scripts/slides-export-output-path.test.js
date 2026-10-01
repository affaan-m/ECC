#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.resolve(__dirname, '../../skills/frontend-slides/scripts/export-pdf.sh');
let passed = 0;
let failed = 0;

if (process.platform === 'win32') {
  console.log('POSIX slide export path integration cases skipped on Windows');
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-slide-output-'));
  try {
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    // Isolate dependency installation, rendering and desktop opening. The node
    // stand-in writes to the output argument received from the actual shell CLI.
    for (const command of ['npm', 'npx', 'open', 'xdg-open']) {
      fs.writeFileSync(path.join(bin, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    fs.writeFileSync(path.join(bin, 'node'), [
      '#!/bin/sh',
      'mkdir -p "$(dirname "$4")"',
      'printf "fixture PDF\\n" > "$4"',
      '',
    ].join('\n'), { mode: 0o755 });

    const cases = [
      { name: 'default output next to the input', output: null, expected: 'deck.pdf' },
      { name: 'relative output in the caller directory', output: 'slides.pdf', expected: 'slides.pdf' },
      { name: 'relative output with spaces and a new directory', output: 'exports with spaces/my deck.pdf', expected: 'exports with spaces/my deck.pdf' },
      { name: 'absolute output', output: 'absolute', expected: 'absolute slides.pdf' },
    ];
    for (const [index, scenario] of cases.entries()) {
      const cwd = path.join(root, `case-${index}`);
      fs.mkdirSync(cwd);
      fs.writeFileSync(path.join(cwd, 'deck.html'), '<section class="slide">fixture</section>');
      const expected = path.join(cwd, scenario.expected);
      const args = [script, './deck.html'];
      if (scenario.output) args.push(scenario.output === 'absolute' ? expected : scenario.output);
      const result = spawnSync('bash', args, {
        cwd,
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      });
      try {
        assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
        assert.strictEqual(fs.readFileSync(expected, 'utf8'), 'fixture PDF\n');
        assert.ok(result.stdout.includes(expected), 'reported output must identify the caller-selected file');
        console.log(`  ✓ ${scenario.name}`);
        passed++;
      } catch (error) {
        console.log(`  ✗ ${scenario.name}: ${error.message}`);
        failed++;
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log(`Passed: ${passed}\nFailed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
