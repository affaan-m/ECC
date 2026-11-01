'use strict';

/**
 * Optional second opinion from the project's own `block-no-verify` npm package.
 *
 * Loading it executes project code, so it is OFF by default. It runs only when
 * the user opts in through their own environment (ECC_BLOCK_NO_VERIFY_PACKAGE=on)
 * AND the project's package.json declares the package. ECC never depends on it.
 * Only <project>/node_modules/block-no-verify itself is loaded: no ancestor
 * node_modules, no NODE_PATH, no global install. Any problem means "no opinion".
 */

const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'block-no-verify';
const MIN_VERSION = [1, 4, 1];
const ENABLE_VALUES = new Set(['on', '1', 'true', 'enabled']);

function isEnabled() {
  return ENABLE_VALUES.has(String(process.env.ECC_BLOCK_NO_VERIFY_PACKAGE || '').trim().toLowerCase());
}

function resolveProjectDir(rawInput) {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try {
    const parsed = JSON.parse(String(rawInput || '').trim());
    if (parsed && typeof parsed.cwd === 'string' && parsed.cwd) return parsed.cwd;
  } catch {
    // plain-text input carries no cwd
  }
  return process.cwd();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isDeclared(projectDir) {
  const manifest = readJson(path.join(projectDir, 'package.json'));
  return Boolean(
    (manifest.dependencies && PACKAGE_NAME in manifest.dependencies) ||
    (manifest.devDependencies && PACKAGE_NAME in manifest.devDependencies)
  );
}

function versionAtLeastMin(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  if (!match) return false;
  for (let i = 0; i < 3; i++) {
    const part = Number(match[i + 1]);
    if (part !== MIN_VERSION[i]) return part > MIN_VERSION[i];
  }
  return true;
}

function commonJsEntry(manifest) {
  let entry = manifest.exports && manifest.exports['.'];
  entry = entry && entry.require;
  if (entry && typeof entry === 'object') entry = entry.default;
  return typeof entry === 'string' ? entry : null;
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function loadPackage(projectDir) {
  if (!isDeclared(projectDir)) return null;
  const modulesDir = fs.realpathSync(path.join(projectDir, 'node_modules'));
  const pkgDir = fs.realpathSync(path.join(modulesDir, PACKAGE_NAME));
  if (!isInside(modulesDir, pkgDir)) return null;
  const manifest = readJson(path.join(pkgDir, 'package.json'));
  if (manifest.name !== PACKAGE_NAME || !versionAtLeastMin(manifest.version)) return null;
  const entry = commonJsEntry(manifest);
  if (!entry) return null;
  const entryPath = fs.realpathSync(path.resolve(pkgDir, entry));
  // Stay inside the project's own copy (rejects symlink escapes).
  if (!isInside(pkgDir, entryPath)) return null;
  return require(entryPath);
}

/**
 * @param {string} command Shell command already allowed by ECC's own scanner.
 * @param {string} rawInput Raw hook payload (used only to find the project cwd).
 * @returns {{blocked: true, reason: string}|{blocked: false}}
 */
function checkWithProjectPackage(command, rawInput) {
  try {
    if (!isEnabled()) return { blocked: false };
    const pkg = loadPackage(path.resolve(resolveProjectDir(rawInput)));
    if (!pkg || typeof pkg.checkCommand !== 'function') return { blocked: false };
    const result = pkg.checkCommand(command);
    if (result && result.blocked === true) {
      const detail = typeof result.reason === 'string' && result.reason ? result.reason : 'hook bypass detected';
      return { blocked: true, reason: `BLOCKED: block-no-verify package (project dependency): ${detail}` };
    }
  } catch {
    // absent, unloadable, or throwing package: ECC's own verdict stands
  }
  return { blocked: false };
}

module.exports = { checkWithProjectPackage };
