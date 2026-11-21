#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_FORMATTER_OUTPUT = 2 * 1024 * 1024;
const FORMATS = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.md']);
const PACKAGE_NAMES = { prettier: 'prettier', biome: '@biomejs/biome' };
const PRETTIER_CONFIGS = [
  '.editorconfig', '.prettierignore', '.prettierrc',
  ...['json', 'json5', 'yaml', 'yml', 'toml', 'js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].flatMap(extension => [
    '.prettierrc.' + extension, 'prettier.config.' + extension,
  ]),
];
const CHILD_ENV = /^(PATH|HOME|USERPROFILE|SYSTEMROOT|WINDIR|LANG|LC_ALL|PATHEXT)$/i;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

function fail(reason) {
  const error = new Error(reason);
  error.qualityReason = reason;
  throw error;
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--file', '--fix', '--defaults'].includes(flag) || Object.hasOwn(result, flag)) {
      fail('invalid-arguments');
    }
    result[flag] = flag === '--file' ? args[++index] : true;
  }
  if (!result['--file']) fail('invalid-arguments');
  return result;
}

function hasPathControlCharacter(value) {
  return Array.from(value).some(character => character.charCodeAt(0) < 0x20);
}

function relativeParts(filename, reason) {
  if (path.posix.isAbsolute(filename) || path.win32.isAbsolute(filename)) fail(reason);
  const parts = filename.split(/[\\/]/);
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*]|[. ]$/.test(part) || hasPathControlCharacter(part)
      || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
    fail(reason);
  }
  return parts;
}

function locate(root, parts, type, reason) {
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const state = fs.lstatSync(current);
    const expected = index === parts.length - 1 ? type : 'directory';
    if (state.isSymbolicLink() || (expected === 'directory' ? !state.isDirectory() : !state.isFile())) {
      fail(reason);
    }
  }
  return current;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFile(left, right) {
  return sameIdentity(left, right) && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function captureSourceDirectories(root, parts) {
  const directories = [root];
  for (const part of parts.slice(0, -1)) directories.push(path.join(directories.at(-1), part));
  return directories.map(directory => {
    const state = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!state?.isDirectory()) fail('unsafe-file');
    return { directory, state };
  });
}

function sourceDirectoriesUnchanged(directories) {
  try {
    return directories.every(({ directory, state }) => {
      const current = fs.lstatSync(directory, { throwIfNoEntry: false });
      return current?.isDirectory() && sameIdentity(state, current);
    });
  } catch {
    return false;
  }
}

function readFile(file, limit, reason, { allowHardLinks = false } = {}) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || (!allowHardLinks && before.nlink !== 1) || before.size > limit) fail(reason);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  const handle = fs.openSync(file, flags);
  try {
    const state = fs.fstatSync(handle);
    if (!state.isFile() || (!allowHardLinks && state.nlink !== 1) || !sameFile(before, state)) fail(reason);
    const buffer = Buffer.alloc(state.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(handle, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length !== state.size || !sameFile(state, fs.fstatSync(handle))) fail(reason);
    return { state, bytes: buffer.subarray(0, length) };
  } finally {
    fs.closeSync(handle);
  }
}

function readManifest(file, options) {
  return JSON.parse(UTF8.decode(readFile(file, MAX_MANIFEST_BYTES, 'unsafe-manifest', options).bytes));
}

function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function projectConfig(root, file) {
  let directory = path.dirname(file);
  let biome = false;
  let prettier = false;
  let packageYaml = false;
  while (true) {
    biome ||= ['biome.json', 'biome.jsonc'].some(name => exists(path.join(directory, name)));
    prettier ||= PRETTIER_CONFIGS.some(name => exists(path.join(directory, name)));
    packageYaml ||= exists(path.join(directory, 'package.yaml'));
    const manifest = path.join(directory, 'package.json');
    if (!prettier && exists(manifest)) {
      try {
        prettier = Object.hasOwn(readManifest(manifest), 'prettier');
      } catch {
        prettier = true;
      }
    }
    if (directory === root) return { biome, prettier: prettier || packageYaml, allowBiomeFallback: !prettier };
    directory = path.dirname(directory);
  }
}

function formatterPackage(root, name) {
  const nameParts = name.split('/');
  let modules;
  let localPackage;
  let state;
  try {
    modules = locate(root, ['node_modules'], 'directory', 'unsafe-formatter');
    const parent = nameParts.length === 1
      ? modules
      : locate(modules, nameParts.slice(0, -1), 'directory', 'unsafe-formatter');
    localPackage = path.join(parent, nameParts.at(-1));
    state = fs.lstatSync(localPackage);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    fail('unsafe-formatter');
  }
  if (state.isDirectory() && !state.isSymbolicLink()) return { directory: localPackage };
  if (!state.isSymbolicLink()) fail('unsafe-formatter');

  // pnpm's public package link points directly to its package inside the local virtual store.
  // Check the link destination and then verify each store path component is a real directory.
  try {
    const target = path.resolve(path.dirname(localPackage), fs.readlinkSync(localPackage));
    const parts = path.relative(path.toNamespacedPath(modules), path.toNamespacedPath(target)).split(path.sep);
    const slotPrefix = name.replace('/', '+') + '@';
    if (parts.length !== nameParts.length + 3 || parts[0] !== '.pnpm'
      || !parts[1].startsWith(slotPrefix) || parts[1].length === slotPrefix.length
      || parts[2] !== 'node_modules'
      || nameParts.some((part, index) => part !== parts[index + 3])) {
      fail('unsafe-formatter');
    }
    return {
      directory: locate(modules, parts, 'directory', 'unsafe-formatter'),
      allowHardLinks: true,
    };
  } catch {
    fail('unsafe-formatter');
  }
}

function formatterBin(root, formatter) {
  const name = PACKAGE_NAMES[formatter];
  const pkg = formatterPackage(root, name);
  if (!pkg) return null;
  const { directory, allowHardLinks } = pkg;
  try {
    const manifest = readManifest(path.join(directory, 'package.json'), { allowHardLinks });
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[formatter];
    if (manifest.name !== name || typeof bin !== 'string') fail('unsafe-formatter');
    const parts = relativeParts(bin.replace(/^\.\//, ''), 'unsafe-formatter');
    return locate(directory, parts, 'file', 'unsafe-formatter');
  } catch {
    fail('unsafe-formatter');
  }
}

function runFormatter(root, formatter, bin, extension, bytes) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const relativeTemp = path.relative(root, tempRoot);
  if (relativeTemp === '' || (!path.isAbsolute(relativeTemp) && relativeTemp.split(path.sep)[0] !== '..')) {
    fail('unsafe-temp-location');
  }
  const scratch = fs.mkdtempSync(path.join(tempRoot, 'ecc-quality-'));
  try {
    const virtualFile = 'ecc-quality' + extension;
    const config = path.join(scratch, 'biome.json');
    const args = formatter === 'biome'
      ? ['format', '--config-path=' + config, '--stdin-file-path=' + virtualFile]
      : ['--no-config', '--no-editorconfig', '--stdin-filepath', virtualFile];
    if (formatter === 'biome') fs.writeFileSync(config, '{}\n', { flag: 'wx' });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => CHILD_ENV.test(key)));
    const result = spawnSync(process.execPath, [bin, ...args], {
      cwd: scratch,
      env: { ...env, TMP: scratch, TEMP: scratch, TMPDIR: scratch },
      input: bytes,
      timeout: 15000,
      killSignal: 'SIGKILL',
      maxBuffer: MAX_FORMATTER_OUTPUT,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (result.error?.code === 'ENOBUFS') fail('formatter-output-limit');
    if (result.error?.code === 'ETIMEDOUT') fail('formatter-timeout');
    if (result.error) fail('formatter-unavailable');
    return result;
  } finally {
    fs.rmSync(scratch, { force: true, recursive: true });
  }
}

function assertUnchanged(file, original, directories) {
  try {
    if (!sourceDirectoriesUnchanged(directories)) fail('file-changed');
    const current = readFile(file, MAX_SOURCE_BYTES, 'file-changed');
    if (!sourceDirectoriesUnchanged(directories) || !sameFile(original.state, current.state)
      || !original.bytes.equals(current.bytes)) fail('file-changed');
  } catch {
    fail('file-changed');
  }
}

function writeFix(file, original, replacement, directories) {
  const staging = path.join(path.dirname(file), '.ecc-quality-' + crypto.randomBytes(12).toString('hex'));
  const mode = original.state.mode & 0o777;
  if (!sourceDirectoriesUnchanged(directories)) fail('file-changed');
  const handle = fs.openSync(staging, 'wx', mode);
  let stageState;
  let published = false;
  try {
    try {
      stageState = fs.fstatSync(handle);
      if (!sourceDirectoriesUnchanged(directories)) fail('file-changed');
      fs.writeFileSync(handle, replacement);
      if (process.platform !== 'win32') fs.fchmodSync(handle, mode);
    } finally {
      fs.closeSync(handle);
    }
    if (!sourceDirectoriesUnchanged(directories)) fail('file-changed');
    const currentStage = fs.lstatSync(staging, { throwIfNoEntry: false });
    if (!currentStage?.isFile() || currentStage.nlink !== 1 || currentStage.size !== replacement.length
      || !sameIdentity(stageState, currentStage)) fail('file-changed');
    assertUnchanged(file, original, directories);
    fs.renameSync(staging, file);
    published = true;
  } finally {
    if (!published && stageState && sourceDirectoriesUnchanged(directories)) {
      const currentStage = fs.lstatSync(staging, { throwIfNoEntry: false });
      if (currentStage?.isFile() && sameIdentity(stageState, currentStage)) fs.rmSync(staging, { force: true });
    }
  }
}

function report(status, details) {
  console.log(JSON.stringify({ coverage: 'formatter-defaults', status, ...details }));
  return { passed: 0, failed: 1, unavailable: 2 }[status];
}

function main(args) {
  let formatter;
  let config;
  try {
    const options = parseArgs(args);
    const parts = relativeParts(options['--file'], 'unsafe-file');
    const extension = path.extname(parts.at(-1)).toLowerCase();
    if (!FORMATS.has(extension)) fail('unsupported-format');
    const root = fs.realpathSync(process.cwd());
    const directories = captureSourceDirectories(root, parts);
    const file = path.join(root, ...parts);
    const original = readFile(file, MAX_SOURCE_BYTES, 'unsafe-file');
    if (!sourceDirectoriesUnchanged(directories)) fail('unsafe-file');
    let input;
    try {
      input = UTF8.decode(original.bytes);
    } catch {
      fail('invalid-source-encoding');
    }

    const settings = projectConfig(root, file);
    formatter = extension !== '.md' && settings.biome ? 'biome' : 'prettier';
    let bin = formatterBin(root, formatter);
    if (!bin && formatter === 'prettier' && extension !== '.md' && settings.allowBiomeFallback) {
      bin = formatterBin(root, 'biome');
      if (bin) formatter = 'biome';
    }
    if (!bin) fail('formatter-not-installed');
    config = settings[formatter] ? (options['--defaults'] ? 'bypassed' : 'present') : 'none-detected';
    if (config === 'present') fail('project-config-present');

    const details = { formatter, projectConfig: config, fixed: false };
    if (!sourceDirectoriesUnchanged(directories)) fail('file-changed');
    const formatted = runFormatter(root, formatter, bin, extension, original.bytes);
    if (formatted.status !== 0) return report('failed', { ...details, reason: 'formatter-failed' });
    if (formatted.stdout.length > MAX_FORMATTER_OUTPUT) fail('formatter-output-limit');
    try {
      UTF8.decode(formatted.stdout);
    } catch {
      fail('invalid-formatter-output');
    }
    if (formatted.stdout.length === 0 && input.trim() !== '') fail('invalid-formatter-output');
    assertUnchanged(file, original, directories);
    if (formatted.stdout.equals(original.bytes)) return report('passed', details);
    if (!options['--fix']) return report('failed', { ...details, reason: 'formatting-difference' });
    writeFix(file, original, formatted.stdout, directories);
    return report('passed', { ...details, fixed: true });
  } catch (error) {
    return report('unavailable', {
      formatter,
      projectConfig: config,
      fixed: false,
      reason: error.qualityReason || 'quality-check-unavailable',
    });
  }
}

process.exitCode = main(process.argv.slice(2));
