#!/usr/bin/env node
/**
 * Flatten rules from rules/ directory into .hermes/rules/
 * Creates namespaced flat files for Hermes harness
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RULES_DIR = path.join(REPO_ROOT, 'rules');
const HERMES_RULES_DIR = path.join(REPO_ROOT, '.hermes', 'rules');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function listRelativeFiles(dirPath, prefix = '') {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const files = [];

  for (const entry of entries) {
    const entryPrefix = prefix ? path.join(prefix, entry.name) : entry.name;
    const absolutePath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...listRelativeFiles(absolutePath, entryPrefix));
    } else if (entry.isFile()) {
      files.push(entryPrefix);
    }
  }

  return files;
}

function normalizeRelativePath(relativePath) {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
}

function flattenRules() {
  ensureDir(HERMES_RULES_DIR);

  const entries = fs.readdirSync(RULES_DIR, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  let count = 0;

  for (const entry of entries) {
    const namespace = entry.name;
    const entryPath = path.join(RULES_DIR, entry.name);

    if (entry.isDirectory()) {
      const relativeFiles = listRelativeFiles(entryPath);
      for (const relativeFile of relativeFiles) {
        const flattenedFileName = `${namespace}-${normalizeRelativePath(relativeFile).replace(/\//g, '-')}`;
        const sourceFile = path.join(entryPath, relativeFile);
        const destFile = path.join(HERMES_RULES_DIR, flattenedFileName);

        fs.copyFileSync(sourceFile, destFile);
        count++;
      }
    } else if (entry.isFile()) {
      const sourceFile = path.join(RULES_DIR, entry.name);
      const destFile = path.join(HERMES_RULES_DIR, entry.name);

      fs.copyFileSync(sourceFile, destFile);
      count++;
    }
  }

  console.log(`Flattened ${count} rules to ${HERMES_RULES_DIR}`);
}

flattenRules();
