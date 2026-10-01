#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.resolve(__dirname, '../../skills/ios-icon-gen/scripts/iconify_gen.sh');
let passed = 0;
let failed = 0;

if (process.platform === 'win32') {
  console.log('POSIX icon conversion integration cases skipped on Windows');
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-icon-conversion-'));
  try {
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'curl'), [
      '#!/bin/sh',
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = "-o" ]; then printf "<svg/>" > "$2"; exit 0; fi',
      '  shift',
      'done',
      'exit 1',
      '',
    ].join('\n'), { mode: 0o755 });
    for (const mode of ['failure', 'empty', 'success']) {
      fs.writeFileSync(path.join(bin, 'sips'), [
        '#!/bin/sh',
        mode === 'failure' ? 'exit 1' : mode === 'empty' ? 'exit 0' : 'printf "fixture PNG" > "$6"',
        '',
      ].join('\n'), { mode: 0o755 });
      const output = path.join(root, mode);
      const result = spawnSync('bash', [script, 'mdi:test', 'icon', '--output', output], {
        encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      });
      const imageset = path.join(output, 'icon.imageset');
      try {
        if (mode === 'success') {
          assert.strictEqual(result.status, 0, result.stderr);
          const manifest = JSON.parse(fs.readFileSync(path.join(imageset, 'Contents.json'), 'utf8'));
          assert.strictEqual(manifest.images.length, 3);
          for (const image of manifest.images) {
            assert.ok(fs.statSync(path.join(imageset, image.filename)).size > 0);
          }
        } else {
          assert.notStrictEqual(result.status, 0);
          assert.ok(result.stderr.includes('ERROR'));
          assert.ok(fs.existsSync(path.join(imageset, 'icon.svg')), 'keep the downloaded source on conversion failure');
          assert.ok(!fs.existsSync(path.join(imageset, 'Contents.json')), 'do not publish an incomplete imageset');
        }
        console.log(`  ✓ ${mode}`);
        passed++;
      } catch (error) {
        console.log(`  ✗ ${mode}: ${error.message}`);
        failed++;
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
console.log(`Passed: ${passed}\nFailed: ${failed}`);
process.exitCode = failed > 0 ? 1 : 0;
