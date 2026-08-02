#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXPECTED_NAME = 'ecc-universal';
const EXPECTED_BIN = 'scripts/ecc.js';
const REQUIRED_FILES = Object.freeze([
  'scripts/ecc.js',
  'manifests/install-components.json',
  'manifests/install-modules.json',
  'manifests/install-profiles.json',
]);

function fail(message) {
  throw new Error(message);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function requireRegularFile(packageRoot, relativePath) {
  const resolvedPath = path.resolve(packageRoot, relativePath);
  if (!isWithin(packageRoot, resolvedPath)) {
    fail(`Package path escapes the extracted root: ${relativePath}`);
  }
  let file;
  try {
    file = fs.lstatSync(resolvedPath);
  } catch {
    fail(`Packed package is missing ${relativePath}.`);
  }
  if (!file.isFile() || file.isSymbolicLink()) {
    fail(`Packed package path is not a regular file: ${relativePath}`);
  }
  return resolvedPath;
}

function validatePackedPackage(packageRoot) {
  const resolvedRoot = path.resolve(packageRoot);
  const packageJsonPath = requireRegularFile(resolvedRoot, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  if (manifest.name !== EXPECTED_NAME) {
    fail(`Unexpected packed package name: ${manifest.name || '<missing>'}.`);
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    fail('Packed package version is missing.');
  }
  if (!manifest.bin || manifest.bin.ecc !== EXPECTED_BIN) {
    fail(`Packed package bin.ecc must map to ${EXPECTED_BIN}.`);
  }

  for (const requiredFile of REQUIRED_FILES) {
    requireRegularFile(resolvedRoot, requiredFile);
  }

  const binTarget = path.resolve(resolvedRoot, manifest.bin.ecc);
  if (!isWithin(resolvedRoot, binTarget)) {
    fail('Packed package bin.ecc escapes the extracted package root.');
  }
  if (process.platform !== 'win32') {
    fs.accessSync(binTarget, fs.constants.X_OK);
  }
  return binTarget;
}

function run(executable, argv, options = {}) {
  const result = spawnSync(executable, argv, {
    ...options,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) {
    fail(`Unable to run ${executable}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    fail(`${executable} exited with status ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function preparePackedCli(sourceRoot, outputRoot) {
  const resolvedSource = path.resolve(sourceRoot);
  const resolvedOutput = path.resolve(outputRoot);
  if (resolvedSource !== '/ecc') {
    fail('Package source must be the read-only /ecc checkout.');
  }
  if (resolvedOutput !== '/tmp' && !resolvedOutput.startsWith('/tmp/')) {
    fail('Packed CLI output must remain under /tmp.');
  }

  fs.mkdirSync(resolvedOutput, { recursive: true, mode: 0o700 });
  const workRoot = fs.mkdtempSync(path.join(resolvedOutput, 'artifact-'));
  const childEnv = {
    ...process.env,
    NPM_CONFIG_CACHE: '/tmp/npm-cache',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_ignore_scripts: 'true',
    npm_config_offline: 'true',
  };
  const packed = run('npm', [
    'pack',
    resolvedSource,
    '--ignore-scripts',
    '--pack-destination',
    workRoot,
    '--json',
  ], { env: childEnv });

  let metadata;
  try {
    metadata = JSON.parse(packed.stdout);
  } catch (error) {
    fail(`npm pack returned invalid JSON: ${error.message}`);
  }
  const filename = metadata?.[0]?.filename;
  if (
    typeof filename !== 'string'
    || path.basename(filename) !== filename
    || !filename.endsWith('.tgz')
  ) {
    fail('npm pack did not return a confined tarball filename.');
  }

  const archivePath = path.resolve(workRoot, filename);
  if (!isWithin(workRoot, archivePath)) {
    fail('npm pack tarball escaped the artifact directory.');
  }
  const extractRoot = path.join(workRoot, 'extracted');
  fs.mkdirSync(extractRoot, { mode: 0o700 });
  run('tar', ['-xzf', archivePath, '-C', extractRoot]);

  const binTarget = validatePackedPackage(path.join(extractRoot, 'package'));
  const binRoot = path.join(workRoot, 'bin');
  fs.mkdirSync(binRoot, { mode: 0o700 });
  const publicBin = path.join(binRoot, 'ecc');
  fs.symlinkSync(binTarget, publicBin);
  return publicBin;
}

function main() {
  try {
    const publicBin = preparePackedCli(process.argv[2], process.argv[3]);
    process.stdout.write(`${publicBin}\n`);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { isWithin, preparePackedCli, validatePackedPackage };
