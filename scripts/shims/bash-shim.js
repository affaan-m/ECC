'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CANDIDATE_BASHES = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
];

function findRealBash() {
  for (const candidate of CANDIDATE_BASHES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to locate Git Bash. Checked common Git for Windows install paths.');
}

function toBashPath(value) {
  if (!/^[A-Za-z]:[\\/]/.test(value)) {
    return value;
  }

  const drive = value[0].toLowerCase();
  const rest = value.slice(2).replace(/\\/g, '/').replace(/^\/+/, '');
  return `/${drive}/${rest}`;
}

function quoteBash(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

const realBash = findRealBash();
let rawArgs;
try {
  rawArgs = process.env.BASH_SHIM_ARGS_JSON
    ? JSON.parse(process.env.BASH_SHIM_ARGS_JSON)
    : process.argv.slice(2);
} catch (_) {
  rawArgs = process.argv.slice(2);
}
const rawInput = fs.readFileSync(0, 'utf8');
const commandMode = rawArgs[0] === '-c' || rawArgs[0] === '-lc';
let args = rawArgs.map((arg, index) => (
  commandMode && index === 1 ? arg : toBashPath(arg)
));
const launchCwd = process.env.BASH_SHIM_CWD || process.cwd();
let cwd = launchCwd;

if (rawArgs.length > 0 && !rawArgs[0].startsWith('-')) {
  const [script, ...rest] = args;
  const commandParts = [
    'cd',
    quoteBash(toBashPath(launchCwd)),
    '&&',
    quoteBash(script),
    ...rest.map(quoteBash),
  ];

  args = ['-lc', commandParts.join(' ')];
}

const result = spawnSync(realBash, args, {
  cwd,
  input: rawInput,
  encoding: 'utf8',
  env: process.env,
  maxBuffer: 10 * 1024 * 1024,
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
