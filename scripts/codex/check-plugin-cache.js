#!/usr/bin/env node
'use strict';

/**
 * Verify that the installed Codex plugin cache can resolve every file path
 * referenced by the cached plugin manifest.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

function usage() {
  console.log([
    'Usage: check-plugin-cache.js [options]',
    '',
    'Options:',
    '  --codex-home <dir>   Override CODEX_HOME (default: $CODEX_HOME or ~/.codex)',
    '  --plugin-dir <dir>   Check a specific installed plugin cache directory',
    '  --marketplace <name> Marketplace cache name (default: ecc)',
    '  --plugin <name>      Plugin cache name (default: ecc)',
    '  --version <version>  Plugin version (default: package.json version)',
    '  --help              Show this help text',
  ].join('\n'));
}

function validateCacheSegment(flag, value) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.includes('\0') ||
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\') ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    throw new Error(`Invalid ${flag}: expected a single cache path segment`);
  }
  return value;
}

function parseArgs(argv) {
  const defaults = {
    marketplace: 'ecc',
    plugin: 'ecc',
    version: PACKAGE_JSON.version,
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    pluginDir: null,
  };
  const optionKeys = {
    '--codex-home': 'codexHome',
    '--plugin-dir': 'pluginDir',
    '--marketplace': 'marketplace',
    '--plugin': 'plugin',
    '--version': 'version',
  };
  let parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed = { ...parsed, help: true };
      continue;
    }

    const key = optionKeys[arg];
    if (!key) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;

    parsed = { ...parsed, [key]: value };
  }

  const options = { ...defaults, ...parsed };
  return {
    ...options,
    marketplace: validateCacheSegment('--marketplace', options.marketplace),
    plugin: validateCacheSegment('--plugin', options.plugin),
    version: validateCacheSegment('--version', options.version),
    codexHome: path.resolve(options.codexHome),
    pluginDir: options.pluginDir ? path.resolve(options.pluginDir) : null,
  };
}

function log(message) {
  console.log(`[ecc-codex] ${message}`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${error.message}`);
  }
}

function pluginCacheDir(options) {
  if (options.pluginDir) {
    return options.pluginDir;
  }
  return path.join(
    options.codexHome,
    'plugins',
    'cache',
    options.marketplace,
    options.plugin,
    options.version
  );
}

function listInstalledVersions(options) {
  const versionsRoot = path.join(
    options.codexHome,
    'plugins',
    'cache',
    options.marketplace,
    options.plugin
  );
  try {
    return fs.readdirSync(versionsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function manifestPathFor(pluginDir) {
  return path.join(pluginDir, '.codex-plugin', 'plugin.json');
}

function collectManifestRefs(manifest) {
  const refs = [];
  if (typeof manifest.skills === 'string') {
    refs.push({ label: 'skills', ref: manifest.skills, kind: 'directory' });
  }
  if (typeof manifest.mcpServers === 'string') {
    refs.push({ label: 'mcpServers', ref: manifest.mcpServers, kind: 'file' });
  }
  if (manifest.interface && typeof manifest.interface.composerIcon === 'string') {
    refs.push({
      label: 'interface.composerIcon',
      ref: manifest.interface.composerIcon,
      kind: 'file',
    });
  }
  if (manifest.interface && typeof manifest.interface.logo === 'string') {
    refs.push({ label: 'interface.logo', ref: manifest.interface.logo, kind: 'file' });
  }
  return refs;
}

function pathExists(target, kind) {
  try {
    const stat = fs.statSync(target);
    return kind === 'directory' ? stat.isDirectory() : stat.isFile();
  } catch {
    return false;
  }
}

function checkCache(options) {
  const cacheDir = pluginCacheDir(options);
  const manifestPath = manifestPathFor(cacheDir);

  log('Codex plugin cache check');
  log(`Codex home: ${options.codexHome}`);
  log(`Plugin cache: ${cacheDir}`);

  if (!fs.existsSync(manifestPath)) {
    const versions = listInstalledVersions(options);
    log(`[FAIL] Cached plugin manifest missing: ${manifestPath}`);
    if (versions.length > 0) {
      log(`Installed versions found: ${versions.join(', ')}`);
      log(`Re-run with --version <version> if you want to inspect a different cache entry.`);
    } else {
      log(`No installed cache entries found for ${options.marketplace}/${options.plugin}.`);
      if (options.marketplace === 'ecc' && options.plugin === 'ecc') {
        log('Run: codex plugin marketplace add affaan-m/ECC');
      } else {
        log('Install the requested plugin into the Codex plugin cache.');
      }
      log('Then run: codex plugin list');
    }
    return 1;
  }

  const manifest = readJson(manifestPath);
  const refs = collectManifestRefs(manifest);
  let failures = 0;

  log(`Manifest: ${manifestPath}`);
  for (const entry of refs) {
    const target = path.resolve(cacheDir, entry.ref);
    const relativeTarget = path.relative(cacheDir, target);
    if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      failures += 1;
      log(`[FAIL] ${entry.label} escapes cache boundary`);
      continue;
    }
    if (pathExists(target, entry.kind)) {
      log(`[OK] ${entry.label} -> ${target}`);
    } else {
      failures += 1;
      log(`[FAIL] ${entry.label} missing -> ${target}`);
    }
  }

  if (refs.length === 0) {
    log('[WARN] Cached manifest has no string path references to verify.');
  }

  if (failures > 0) {
    log(`${failures} cached manifest reference(s) do not resolve.`);
    log('codex plugin list only confirms marketplace registration; it is not proof of runtime skill loading.');
    const syncScript = path.join(REPO_ROOT, 'scripts', 'sync-ecc-to-codex.sh');
    if (fs.existsSync(syncScript)) {
      log('Use the supported sync path until the cache contains the referenced files:');
      log('npm install && bash scripts/sync-ecc-to-codex.sh');
    } else {
      log('Use the supported manual sync workflow from your ECC installation.');
    }
    return 1;
  }

  log('All cached manifest references resolve.');
  return 0;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[ecc-codex] ${error.message}`);
    usage();
    process.exit(1);
  }

  if (options.help) {
    usage();
    process.exit(0);
  }

  try {
    process.exit(checkCache(options));
  } catch (error) {
    console.error(`[ecc-codex] ${error.message}`);
    process.exit(1);
  }
}

main();
