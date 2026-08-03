#!/usr/bin/env node

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_PROMPT_BYTES = 64 * 1024;
const HOST_PROVIDERS = new Set(['anthropic', 'openai', 'unknown']);

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
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--strict-config',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '--cd', tempDir,
    '--color', 'never',
    '--config', 'sandbox_permissions=[]',
    '--config', 'shell_environment_policy.inherit="none"',
    '--config', 'mcp_servers={}',
    '--output-last-message', outputFile,
    '-',
  ];
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
  const makeTemp = dependencies.mkdtempSync || fs.mkdtempSync;
  const readFile = dependencies.readFileSync || fs.readFileSync;
  const remove = dependencies.rmSync || fs.rmSync;
  const tempDir = makeTemp(path.join(os.tmpdir(), 'ecc-council-review-'));
  const outputFile = path.join(tempDir, 'last-message.txt');

  try {
    const result = spawn('codex', buildCodexArgs(tempDir, outputFile), {
      cwd: tempDir,
      env: buildEnvironment(dependencies.env || process.env),
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
  buildCodexArgs,
  buildEnvironment,
  parseArgs,
  providerLabel,
  runStdinReview,
  runReview,
};
