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
    for (const mode of ['failure', 'empty', 'success', 'stale-empty', 'failure-second', 'copy-failure', 'publish-failure', 'cleanup-failure', 'directory-mode']) {
      fs.writeFileSync(path.join(bin, 'rm'), ['#!/bin/sh',
        mode === 'cleanup-failure' ? 'case "$2" in */.iconify-prior.*) exit 1;; esac' : '',
        'exec /usr/bin/rm "$@"', '',
      ].join('\n'), { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'cp'), ['#!/bin/sh',
        mode === 'copy-failure' ? 'case "$1" in */ecc-iconify.*/*.png) /usr/bin/cp "$1" "$4"; exit 1;; esac' : '',
        'exec /usr/bin/cp "$@"', '',
      ].join('\n'), { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'mv'), ['#!/bin/sh',
        mode === 'publish-failure' ? 'case "$1" in */.iconify-publish.*) exit 1;; esac' : '',
        'exec /usr/bin/mv "$@"', '',
      ].join('\n'), { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'sips'), [
        '#!/bin/sh',
        mode === 'failure' ? 'exit 1'
          : ['empty', 'stale-empty'].includes(mode) ? 'exit 0'
            : mode === 'failure-second' ? 'case "$6" in *@2x.png) exit 1;; esac; printf "fixture PNG" > "$6"'
              : 'printf "fixture PNG" > "$6"',
        '',
      ].join('\n'), { mode: 0o755 });
      const output = path.join(root, mode);
      const imageset = path.join(output, 'icon.imageset');
      const existing = ['stale-empty', 'failure-second', 'copy-failure', 'publish-failure', 'directory-mode'].includes(mode);
      const filenames = ['icon.png', 'icon@2x.png', 'icon@3x.png'];
      if (existing) {
        fs.mkdirSync(imageset, { recursive: true });
        for (const filename of filenames) fs.writeFileSync(path.join(imageset, filename), 'old icon');
        fs.writeFileSync(path.join(imageset, 'Contents.json'), 'old manifest');
        if (mode === 'directory-mode') fs.chmodSync(imageset, 0o750);
      }
      const result = spawnSync('bash', [script, 'mdi:test', 'icon', '--output', output], {
        encoding: 'utf8', timeout: 10000,
        env: { ...process.env, TMPDIR: root, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      });
      try {
        assert.ok(fs.readdirSync(imageset).every(name => !name.startsWith('.iconify.')));
        if (['success', 'cleanup-failure', 'directory-mode'].includes(mode)) {
          assert.strictEqual(result.status, 0, result.stderr);
          if (mode === 'directory-mode') assert.strictEqual(fs.statSync(imageset).mode & 0o777, 0o750);
          if (mode === 'cleanup-failure') assert.ok(result.stderr.includes('WARNING: Imageset published'));
          const manifest = JSON.parse(fs.readFileSync(path.join(imageset, 'Contents.json'), 'utf8'));
          assert.strictEqual(manifest.images.length, 3);
          for (const image of manifest.images) {
            assert.ok(fs.statSync(path.join(imageset, image.filename)).size > 0);
          }
        } else {
          assert.notStrictEqual(result.status, 0);
          assert.ok(result.stderr.includes('ERROR'));
          if (['copy-failure', 'publish-failure'].includes(mode)) {
            assert.ok(result.stderr.includes('.iconify-publish.'));
            assert.ok(result.stderr.includes('ecc-iconify.'));
          }
          if (!['copy-failure', 'publish-failure'].includes(mode)) {
            const source = mode === 'failure-second' ? 'icon@2x.svg' : 'icon.svg';
            assert.ok(fs.existsSync(path.join(imageset, source)), 'keep the downloaded source on conversion failure');
          }
          if (existing) {
            assert.strictEqual(fs.readFileSync(path.join(imageset, 'Contents.json'), 'utf8'), 'old manifest');
            for (const filename of filenames) {
              assert.strictEqual(fs.readFileSync(path.join(imageset, filename), 'utf8'), 'old icon');
            }
          } else {
            assert.ok(!fs.existsSync(path.join(imageset, 'Contents.json')), 'do not publish an incomplete imageset');
          }
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
