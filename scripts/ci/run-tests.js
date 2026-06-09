#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-tests-'));
const shimsDir = path.join(root, 'scripts', 'shims');

process.env.TEMP = scratchDir;
process.env.TMP = scratchDir;
process.env.TMPDIR = scratchDir;
process.env.npm_config_cache = path.join(scratchDir, '.npm-cache');
process.env.PATH = `${shimsDir}${path.delimiter}${process.env.PATH || ''}`;
process.env.Path = process.env.PATH;
process.env.PATHEXT = '.CMD;.COM;.EXE;.BAT';
const patchPath = path.join(root, 'scripts', 'ci', 'windows-temp-rm-patch.js');
const requirePath = patchPath.includes(' ') ? `"${patchPath}"` : patchPath;
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--require ${requirePath}`;

require(path.join(root, 'tests', 'run-all.js'));
