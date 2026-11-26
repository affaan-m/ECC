#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_PROMPT_BYTES = 64 * 1024;
const SUPPORTED_CODEX_VERSION = '0.146.0';
const HOST_PROVIDERS = new Set(['anthropic', 'openai', 'unknown']);
const REQUIRED_TOOLLESS_FEATURES = Object.freeze([
  'apps',
  'auth_elicitation',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'code_mode_host',
  'goals',
  'hooks',
  'image_generation',
  'in_app_browser',
  'multi_agent',
  'plugin_sharing',
  'plugins',
  'remote_plugin',
  'shell_snapshot',
  'shell_tool',
  'skill_search',
  'skill_mcp_dependency_install',
  'tool_call_mcp_elicitation',
  'tool_suggest',
  'unified_exec',
  'workspace_dependencies',
]);

function usage() {
  return [
    'Usage: review-with-codex.js --consent-to-openai --host-provider <anthropic|openai|unknown>',
    '                              [--timeout-seconds <10-120>]',
    '',
    'Reads one compact review packet from stdin and prints the labeled Codex critique.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    consent: false,
    hostProvider: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--consent-to-openai') {
      options.consent = true;
    } else if (arg === '--host-provider') {
      options.hostProvider = argv[index + 1];
      index += 1;
    } else if (arg === '--timeout-seconds') {
      const seconds = Number(argv[index + 1]);
      if (!Number.isInteger(seconds) || seconds < 10 || seconds > 120) {
        throw new Error('--timeout-seconds must be an integer from 10 to 120');
      }
      options.timeoutMs = seconds * 1000;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (options.help) return options;
  if (!options.consent) {
    throw new Error('explicit --consent-to-openai is required');
  }
  if (!HOST_PROVIDERS.has(options.hostProvider)) {
    throw new Error('--host-provider must be anthropic, openai, or unknown');
  }
  return options;
}

function providerLabel(hostProvider) {
  if (hostProvider === 'anthropic') return 'cross-provider external critique';
  if (hostProvider === 'openai') return 'same-provider external critique';
  return 'provider relationship unverified';
}

function buildCodexArgs(tempDir, outputFile) {
  return [
    '--ask-for-approval', 'never',
    ...REQUIRED_TOOLLESS_FEATURES.flatMap((feature) => ['--disable', feature]),
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--strict-config',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--cd', tempDir,
    '--color', 'never',
    '--config', 'shell_environment_policy.inherit="none"',
    '--config', 'skills.include_instructions=false',
    '--config', 'web_search="disabled"',
    '--config', 'mcp_servers={}',
    '--output-last-message', outputFile,
    '-',
  ];
}

// The quoted script path in an npm (`%dp0%\...`) or pnpm (`%~dp0\...`) cmd shim.
const CMD_SHIM_ENTRY = /"%(?:dp0%|~dp0)\\([^"%]+\.[cm]?js)"/gi;
const CODEX_PACKAGE_SEGMENT = '\\node_modules\\@openai\\codex\\';

function windowsPathDirs(env) {
  const pathValue = env.PATH || env.Path || env.path || '';
  return pathValue
    .split(';')
    .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

function readShimEntry(shimPath, readFile, exists) {
  let shim;
  try {
    shim = String(readFile(shimPath, 'utf8'));
  } catch {
    return null;
  }
  const shimDir = path.win32.dirname(shimPath);
  for (const match of shim.matchAll(CMD_SHIM_ENTRY)) {
    const entry = path.win32.join(shimDir, match[1]);
    if (entry.toLowerCase().includes(CODEX_PACKAGE_SEGMENT) && exists(entry)) return entry;
  }
  return null;
}

/**
 * Picks how to start Codex without a shell. npm installs Codex on Windows as a
 * `codex.cmd` shim, which spawn cannot run without `shell: true`, and a shell
 * would have to re-quote the temp paths in the arguments. So PATH is walked in
 * order, as cmd.exe would: `codex.exe` runs as-is, and a `codex.cmd` shim is
 * replaced by node running the @openai/codex script it points to. A shim that
 * points elsewhere is skipped; if no launchable Codex follows, that is an
 * error rather than "not installed". Other platforms, and a Windows PATH with
 * neither file, keep the bare `codex`.
 */
function resolveCodexLauncher(dependencies = {}) {
  const fallback = { command: 'codex', prefixArgs: [] };
  if ((dependencies.platform || process.platform) !== 'win32') return fallback;

  const exists = dependencies.existsSync || fs.existsSync;
  const readFile = dependencies.readFileSync || fs.readFileSync;
  const execPath = dependencies.execPath || process.execPath;
  let unlaunchableShim = null;
  for (const dir of windowsPathDirs(dependencies.env || process.env)) {
    const exePath = path.win32.join(dir, 'codex.exe');
    if (exists(exePath)) return { command: exePath, prefixArgs: [] };

    const shimPath = path.win32.join(dir, 'codex.cmd');
    if (!exists(shimPath)) continue;
    const entry = readShimEntry(shimPath, readFile, exists);
    if (entry) return { command: execPath, prefixArgs: [entry] };
    unlaunchableShim = unlaunchableShim || shimPath;
  }
  if (unlaunchableShim) {
    throw new Error(
      `Codex CLI was found at ${unlaunchableShim} but could not be launched: `
      + 'it does not point to an installed @openai/codex script'
    );
  }
  return fallback;
}

function spawnCodex(spawn, launcher, args, options) {
  return spawn(launcher.command, [...launcher.prefixArgs, ...args], options);
}

function probeCodex(spawn, launcher, args, options, label) {
  const result = spawnCodex(spawn, launcher, args, options);
  if (result.error) {
    if (result.error.code === 'ENOENT') throw new Error('Codex CLI is not installed');
    throw new Error(`Codex ${label} probe failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || '').trim().split('\n').slice(-1)[0];
    throw new Error(`Codex ${label} probe failed${detail ? `: ${detail}` : ''}`);
  }
  return (result.stdout || '').trim();
}

function verifyToollessSupport(dependencies = {}) {
  const spawn = dependencies.spawnSync || spawnSync;
  const launcher = dependencies.launcher || resolveCodexLauncher(dependencies);
  const options = {
    cwd: os.tmpdir(),
    env: buildEnvironment(dependencies.env || process.env),
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 256 * 1024,
    windowsHide: true,
  };
  const versionText = probeCodex(spawn, launcher, ['--version'], options, 'version');
  const versionMatch = versionText.match(/^codex-cli\s+([^\s]+)$/m);
  if (!versionMatch) {
    throw new Error('Codex version could not be verified for tool-less review');
  }
  if (versionMatch[1] !== SUPPORTED_CODEX_VERSION) {
    throw new Error(
      `unsupported Codex version ${versionMatch[1]}; `
      + `tool-less review requires exactly ${SUPPORTED_CODEX_VERSION}`
    );
  }

  const featuresText = probeCodex(spawn, launcher, ['features', 'list'], options, 'feature');
  const stages = new Map();
  for (const line of featuresText.split('\n')) {
    const match = line.trim().match(
      /^(\S+)\s+(stable|under development|experimental|deprecated|removed)\s+(true|false)$/
    );
    if (match) stages.set(match[1], match[2]);
  }
  const unavailable = REQUIRED_TOOLLESS_FEATURES.filter(
    (feature) => stages.get(feature) !== 'stable'
  );
  if (unavailable.length > 0) {
    throw new Error(
      `Codex ${versionMatch[1]} cannot guarantee tool-less review; `
      + `required stable feature toggles unavailable: ${unavailable.join(', ')}`
    );
  }
  return versionMatch[1];
}

function buildEnvironment(sourceEnv = process.env) {
  const allowed = [
    'PATH', 'HOME', 'USERPROFILE', 'CODEX_HOME',
    'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'ComSpec', 'PATHEXT',
  ];
  return Object.fromEntries(
    allowed.filter((name) => sourceEnv[name]).map((name) => [name, sourceEnv[name]])
  );
}

function runReview(prompt, options, dependencies = {}) {
  if (!prompt.trim()) throw new Error('review packet is empty');
  if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
    throw new Error(`review packet exceeds ${MAX_PROMPT_BYTES} bytes`);
  }
  if (!options.consent) throw new Error('OpenAI transfer consent is required');
  if (options.timeoutMs < 10_000 || options.timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error('timeout is outside the 10-120 second safety range');
  }

  const spawn = dependencies.spawnSync || spawnSync;
  const environment = buildEnvironment(dependencies.env || process.env);
  const verifySupport = dependencies.verifyToollessSupport || verifyToollessSupport;
  const launcher = resolveCodexLauncher({ ...dependencies, env: environment });
  verifySupport({ spawnSync: spawn, env: environment, launcher });
  const makeTemp = dependencies.mkdtempSync || fs.mkdtempSync;
  const readFile = dependencies.readFileSync || fs.readFileSync;
  const remove = dependencies.rmSync || fs.rmSync;
  const tempDir = makeTemp(path.join(os.tmpdir(), 'ecc-council-review-'));
  const outputFile = path.join(tempDir, 'last-message.txt');

  try {
    const result = spawnCodex(spawn, launcher, buildCodexArgs(tempDir, outputFile), {
      cwd: tempDir,
      env: environment,
      input: prompt,
      encoding: 'utf8',
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });

    if (result.error) {
      if (result.error.code === 'ETIMEDOUT') throw new Error('Codex review timed out');
      if (result.error.code === 'ENOENT') throw new Error('Codex CLI is not installed');
      throw new Error(`Codex invocation failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const detail = (result.stderr || '').trim().split('\n').slice(-1)[0];
      throw new Error(`Codex review failed${detail ? `: ${detail}` : ''}`);
    }

    let text;
    try {
      text = readFile(outputFile, 'utf8').trim();
    } catch (error) {
      throw new Error(`Codex returned no final response: ${error.message}`);
    }
    if (!text) throw new Error('Codex returned an empty final response');
    return `${providerLabel(options.hostProvider)}\n${text}`;
  } finally {
    remove(tempDir, { recursive: true, force: true });
  }
}

function runStdinReview(options, dependencies = {}) {
  const stdin = dependencies.stdin || process.stdin;
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const review = dependencies.runReview || runReview;
  const setExitCode = dependencies.setExitCode || ((code) => { process.exitCode = code; });
  const chunks = [];
  let promptBytes = 0;
  let promptOverflow = false;
  stdin.setEncoding('utf8');
  stdin.on('data', (chunk) => {
    if (promptOverflow) return;
    promptBytes += Buffer.byteLength(chunk, 'utf8');
    if (promptBytes > MAX_PROMPT_BYTES) {
      promptOverflow = true;
      chunks.length = 0;
      return;
    }
    chunks.push(chunk);
  });
  stdin.on('end', () => {
    if (promptOverflow) {
      stderr.write(
        `external review absent: review packet exceeds ${MAX_PROMPT_BYTES} bytes\n`
      );
      setExitCode(1);
      return;
    }
    try {
      stdout.write(`${review(chunks.join(''), options)}\n`);
    } catch (error) {
      stderr.write(`external review absent: ${error.message}\n`);
      setExitCode(1);
    }
  });
  return 0;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    return 2;
  }

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  return runStdinReview(options);
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  MAX_PROMPT_BYTES,
  REQUIRED_TOOLLESS_FEATURES,
  SUPPORTED_CODEX_VERSION,
  buildCodexArgs,
  buildEnvironment,
  parseArgs,
  providerLabel,
  resolveCodexLauncher,
  runStdinReview,
  runReview,
  verifyToollessSupport,
};
