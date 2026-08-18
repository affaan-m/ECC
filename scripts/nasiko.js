#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const {
  inspectInstalledNasiko,
  installNasiko,
  normalizePlatform,
  uninstallNasiko,
  validateInstallDirectory,
} = require('./lib/nasiko-release');

function helpText() {
  return `
ECC Nasiko control-plane bridge

Usage:
  ecc nasiko status [--install-dir <absolute-path>] [--json]
  ecc nasiko install --version v0.1.0 --yes [--install-dir <absolute-path>] [--json]
  ecc nasiko install --version v0.1.0 --dry-run [--install-dir <absolute-path>] [--json]
  ecc nasiko uninstall --version v0.1.0 --yes [--install-dir <absolute-path>] [--json]

The installer is opt-in, accepts only ECC-qualified pinned releases, downloads
content-addressed OCI artifacts from registry.nasiko.dev, verifies SHA-256
digests before extraction, and never executes fetched shell or PowerShell code.
`;
}

function parseMutationArguments(argumentsList, command = 'install') {
  let options = { dryRun: false, installDir: undefined, json: false, version: undefined, yes: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--version' || argument === '--install-dir') {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      options = {
        ...options,
        [argument === '--version' ? 'version' : 'installDir']: value,
      };
      index += 1;
    } else if (argument === '--yes' || argument === '-y') {
      options = { ...options, yes: true };
    } else if (argument === '--dry-run') {
      options = { ...options, dryRun: true };
    } else if (argument === '--json') {
      options = { ...options, json: true };
    } else {
      throw new Error(`Unknown Nasiko ${command} argument: ${argument}`);
    }
  }
  if (!options.version) throw new Error(`Nasiko ${command} requires --version v0.1.0.`);
  if (options.installDir) validateInstallDirectory(options.installDir);
  return options;
}

function defaultExecutablePath() {
  const normalized = normalizePlatform();
  if (normalized.os === 'windows') {
    return process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'nasiko', 'bin', normalized.binaryName)
      : null;
  }
  return path.join(os.homedir(), '.local', 'bin', normalized.binaryName);
}

function resolveExecutable(options = {}) {
  const configured = process.env.ECC_NASIKO_CLI_EXECUTABLE;
  const normalized = normalizePlatform();
  const candidate = options.installDir
    ? path.join(validateInstallDirectory(options.installDir), normalized.binaryName)
    : configured || defaultExecutablePath();
  if (!candidate) return null;
  if (!path.isAbsolute(candidate)) {
    throw new Error('ECC_NASIKO_CLI_EXECUTABLE must be an absolute path.');
  }
  return candidate;
}

function readStatus(options = {}) {
  const executable = resolveExecutable(options);
  if (!executable) return { installed: false, qualified: false, version: null, executable: null };
  return inspectInstalledNasiko(executable);
}

function parseStatusArguments(argumentsList) {
  let options = { installDir: undefined, json: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--json') options = { ...options, json: true };
    else if (argument === '--install-dir') {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --install-dir.');
      options = { ...options, installDir: validateInstallDirectory(value) };
      index += 1;
    } else throw new Error(`Unknown Nasiko status argument: ${argument}`);
  }
  return options;
}

async function main(argumentsList = process.argv.slice(2)) {
  const [command, ...rest] = argumentsList;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(helpText());
    return 0;
  }
  if (command === 'status') {
    const options = parseStatusArguments(rest);
    const status = readStatus(options);
    if (options.json) process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    else process.stdout.write(status.qualified
      ? `Qualified Nasiko ${status.version} is installed at ${status.executable}.\n`
      : status.installed
        ? `An unqualified Nasiko file exists at ${status.executable}; it was not executed.\n`
      : 'Nasiko is not installed in the ECC-qualified location.\n');
    return 0;
  }
  if (command === 'install') {
    const options = parseMutationArguments(rest, 'install');
    const result = await installNasiko(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (result.dryRun) process.stdout.write(`Would install Nasiko ${result.version} to ${result.destination}.\n`);
    else process.stdout.write(`${result.reused ? 'Using existing' : 'Installed'} Nasiko ${result.version} at ${result.destination}.\n`);
    return 0;
  }
  if (command === 'uninstall') {
    const options = parseMutationArguments(rest, 'uninstall');
    const result = uninstallNasiko(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (result.dryRun) process.stdout.write(`Would uninstall Nasiko ${result.version} from ${result.destination}.\n`);
    else process.stdout.write(result.removed ? `Uninstalled Nasiko ${result.version}.\n` : 'Nasiko was not installed.\n');
    return 0;
  }
  throw new Error(`Unsupported Nasiko command: ${command}`);
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    process.stderr.write(`Error: ${String(error?.message || error).replace(/[\r\n]+/g, ' ')}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseInstallArguments: parseMutationArguments, parseMutationArguments, parseStatusArguments, readStatus, resolveExecutable };
