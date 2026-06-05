#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const packageRoot = path.join(repoRoot, 'plugins', 'ecc');

const COPY_ENTRIES = [
  ['.codex-plugin', '.codex-plugin'],
  ['.mcp.json', '.mcp.json'],
  ['agents', 'agents'],
  ['commands', 'commands'],
  ['skills', 'skills'],
  ['assets/ecc-icon.svg', 'assets/ecc-icon.svg'],
  ['assets/hero.png', 'assets/hero.png'],
];

function copyEntry(sourceRelativePath, destinationRelativePath) {
  const sourcePath = path.join(repoRoot, sourceRelativePath);
  const destinationPath = path.join(packageRoot, destinationRelativePath);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing Codex package source: ${sourceRelativePath}`);
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.cpSync(sourcePath, destinationPath, {
    recursive: true,
    dereference: true,
    force: true,
    errorOnExist: false,
  });
}

function main() {
  fs.rmSync(packageRoot, { recursive: true, force: true });
  fs.mkdirSync(packageRoot, { recursive: true });

  for (const [sourceRelativePath, destinationRelativePath] of COPY_ENTRIES) {
    copyEntry(sourceRelativePath, destinationRelativePath);
  }

  const manifestPath = path.join(packageRoot, '.codex-plugin', 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== 'ecc') {
    throw new Error(`Expected packaged Codex plugin name "ecc", got "${manifest.name}"`);
  }
  if (manifest.skills !== './skills/') {
    throw new Error(`Expected packaged Codex plugin skills path "./skills/", got "${manifest.skills}"`);
  }
  if (manifest.mcpServers !== './.mcp.json') {
    throw new Error(`Expected packaged Codex plugin mcpServers path "./.mcp.json", got "${manifest.mcpServers}"`);
  }

  console.log(`[ecc-codex-package] Built ${path.relative(repoRoot, packageRoot)}`);
}

try {
  main();
} catch (error) {
  console.error(`[ecc-codex-package] ${error.message}`);
  process.exit(1);
}
