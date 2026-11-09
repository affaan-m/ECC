#!/usr/bin/env node
'use strict';

const path = require('path');
const { classifyDestructiveCommand } = require('./gateguard-fact-force');
const { run: noVerify } = require('./block-no-verify');
const { isSensitiveTargetFor, isHardLinkedTargetFor } = require('../lib/gateguard-target-class');
const { shellPreflight } = require('../lib/copilot-shell-preflight');
const { checkEvidence } = require('../lib/copilot-evidence');
const MAX_INPUT = 1024 * 1024;
const block = reason => ({ exitCode: 2, stderr: `BLOCKED: ${reason}` });

// A bounded lexer for literal PowerShell git invocations, not a PowerShell
// interpreter. Dynamic execution is handled by the canonical PS classifier.
// Literal tokens are sent to the existing git policy as quoted Bash words,
// never executed or interpreted by a shell.
function powerShellSegments(source) {
  const segments = [];
  let tokens = [];
  let word = '';
  let active = false;
  let quote = null;
  let comment = false;
  const flushWord = () => { if (active) tokens.push(word); word = ''; active = false; };
  const flushSegment = () => { flushWord(); if (tokens.length) segments.push(tokens); tokens = []; };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (comment) { if (char === '\n') { comment = false; flushSegment(); } continue; }
    if (quote === "'") {
      if (char === "'" && source[index + 1] === "'") { word += "'"; index++; }
      else if (char === "'") quote = null;
      else word += char;
      continue;
    }
    if (char === '`') {
      if (++index >= source.length) throw new Error('Incomplete PowerShell escape.');
      if (source[index] !== '\n' && source[index] !== '\r') word += source[index];
      continue;
    }
    if (quote === '"') {
      if (char === '$' && source[index + 1] === '(') {
        const nested = subexpression(source, index + 2);
        segments.push(...powerShellSegments(nested.body));
        index = nested.end;
      } else if (char === '"') quote = null;
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; active = true; continue; }
    if (char === '#') { flushWord(); comment = true; continue; }
    if (';|&\n\r{}()'.includes(char)) { flushSegment(); continue; }
    if (/\s/.test(char)) { flushWord(); continue; }
    word += char; active = true;
  }
  if (quote) throw new Error('Incomplete PowerShell quote.');
  flushSegment();
  return segments;
}

function subexpression(source, start) {
  let depth = 1;
  let quote = null;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === '`' && quote !== "'") { index++; continue; }
    if (quote) {
      if (char === quote) {
        if (quote === "'" && source[index + 1] === "'") index++;
        else quote = null;
      }
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return { body: source.slice(start, index), end: index };
  }
  throw new Error('Incomplete PowerShell subexpression.');
}

function powerShellNoVerify(command) {
  for (const tokens of powerShellSegments(command)) {
    const basename = tokens[0].replace(/\\/g, '/').split('/').pop().toLowerCase();
    if (/^\$env:git_config/i.test(tokens[0])) return block('PowerShell git environment overrides require operator review.');
    if (['set-alias', 'new-alias', 'sal', 'nal', 'start-process', 'saps', 'start'].includes(basename)
      && tokens.some(token => /(?:^|[\\/])git(?:\.exe)?$/i.test(token))) {
      return block('Indirect PowerShell git invocation requires operator review.');
    }
    const isGit = basename === 'git' || basename === 'git.exe';
    const wrapper = ['powershell', 'pwsh', 'powershell.exe', 'pwsh.exe', 'cmd', 'cmd.exe', 'bash', 'sh', 'iex', 'invoke-expression'].includes(basename);
    if (!isGit && !wrapper) continue;
    const literalCommand = tokens.map(token => `'${token.replace(/'/g, "'\\''")}'`).join(' ');
    const result = noVerify(JSON.stringify({ tool_input: { command: literalCommand } }));
    if (result.exitCode) return result;
  }
  return { exitCode: 0 };
}

function checkShell(input) {
  const command = input.tool_input.command;
  if (typeof command !== 'string' || !command.trim()) return block('Missing shell command.');
  const destructive = classifyDestructiveCommand(input.tool_name, command);
  if (destructive.length) return block('Destructive operation requires explicit operator review; retrying does not establish authorization.');
  const bypass = input.tool_name === 'PowerShell' ? powerShellNoVerify(command) : noVerify(JSON.stringify(input));
  if (bypass.exitCode) return bypass;
  const preflight = shellPreflight(input, powerShellSegments);
  if (preflight.blocked) return block(preflight.reason);
  return { exitCode: 0, ...(preflight.context ? {
    stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: preflight.context } }),
  } : {}) };
}

function checkFiles(input, env) {
  const args = input.tool_input;
  if (args.edits !== undefined && !Array.isArray(args.edits)) return block('Invalid edit list.');
  const shared = args.file_path;
  const candidates = [shared, ...(args.edits || []).map(edit => edit?.file_path || shared)].filter(value => value !== undefined);
  if (!candidates.length || candidates.length > 65) return block('Missing or excessive write target paths.');
  for (const file of candidates) {
    if (typeof file !== 'string' || !file.trim() || file.includes('\0')) return block('Invalid write target.');
    const resolved = path.resolve(input.cwd, file);
    if (isSensitiveTargetFor(resolved, input) || isHardLinkedTargetFor(resolved, input)) {
      return block('Sensitive or linked file requires explicit operator review.');
    }
  }
  const evidence = checkEvidence(input, env);
  return evidence.allowed ? { exitCode: 0 } : block(evidence.reason);
}

function run(raw, env = process.env) {
  try {
    if (typeof raw === 'string' && Buffer.byteLength(raw) > MAX_INPUT) return block('Guard input exceeds its limit.');
    const input = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!input || Array.isArray(input) || typeof input !== 'object' || !input.tool_input || typeof input.tool_input !== 'object') return block('Invalid guard input.');
    if (typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd) || input.cwd.includes('\0')) return block('Invalid workspace.');
    if (['Bash', 'PowerShell'].includes(input.tool_name)) return checkShell(input);
    if (['Edit', 'Write'].includes(input.tool_name)) return checkFiles(input, env);
    return block('Unsupported guard tool.');
  } catch {
    return block('Guard could not establish safety for this request.');
  }
}

module.exports = { run, powerShellSegments };
if (require.main === module) {
  let raw = '';
  let size = 0;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { size += Buffer.byteLength(chunk); if (size <= MAX_INPUT) raw += chunk; });
  process.stdin.on('end', () => {
    const result = size > MAX_INPUT ? block('Guard input exceeds its limit.') : run(raw);
    if (result.stderr) process.stderr.write(`${result.stderr}\n`);
    process.stdout.write(`${result.stdout || '{}'}\n`);
    process.exitCode = result.exitCode;
  });
  process.stdin.on('error', () => { process.exitCode = 2; });
}
