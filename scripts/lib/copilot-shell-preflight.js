'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { scanShell, createBudget } = require('../hooks/lib/shell-scan');
const { isSensitiveTargetFor, isHardLinkedTargetFor } = require('./gateguard-target-class');
const { findFileIssues, shouldCheckFile, validateCommitMessage } = require('../hooks/pre-bash-commit-quality');
const { run: pushReminder } = require('../hooks/pre-bash-git-push-reminder');
const basename = value => value.replace(/\\/g, '/').split('/').pop().replace(/\.(exe|cmd)$/i, '').toLowerCase();

function bashCommands(command) {
  const budget = createBudget(command.length);
  const pending = [command];
  const entries = [];
  for (let cursor = 0; cursor < pending.length; cursor++) {
    if (cursor > 32) throw new Error('Nested shell inspection quota exceeded.');
    for (const item of scanShell(pending[cursor], budget).commands.filter(item => item.words?.length)) {
      pending.push(...item.nested);
      const words = leadingWords(item.words.map(word => word.value));
      const name = basename(words[0] || '');
      if (['bash', 'sh', 'zsh', 'dash', 'eval'].includes(name)) {
        const flag = words.findIndex(word => word === '-c');
        const source = name === 'eval' ? words.slice(1).join(' ') : flag >= 0 ? words[flag + 1] : null;
        if (source) pending.push(source);
      }
      entries.push({ words, dynamic: item.words.some(word => word.dynamic),
        redirects: item.redirects.filter(redirect => /^(?:\d*|&)>>?$/.test(redirect.operator))
          .map(redirect => ({ path: redirect.word.value, dynamic: redirect.word.dynamic })),
      });
    }
  }
  return entries;
}

function leadingWords(words) {
  let index = 0;
  while (index < words.length - 1 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])
    || ['command', 'builtin', 'exec', 'env', 'sudo', 'nohup', 'then', 'do', 'else', 'if', 'while', '!'].includes(words[index]))) index++;
  return words.slice(index);
}

function sensitiveTarget(file, input) {
  if (typeof file !== 'string' || !file || /[\0\r\n]/.test(file)) return true;
  return isSensitiveTargetFor(path.resolve(input.cwd, file), input)
    || isHardLinkedTargetFor(path.resolve(input.cwd, file), input);
}

// These are literal-write entry points, not a model of arbitrary programs.
const BASH_WRITERS = new Set(['cp', 'mv', 'tee', 'touch', 'install', 'rm', 'mkdir', 'ln']);
const PS_WRITERS = new Set(['set-content', 'add-content', 'out-file', 'new-item', 'copy-item', 'move-item',
  'remove-item', 'rename-item', 'clear-content', 'sc', 'ac', 'ni', 'cp', 'mv', 'rm', 'ri', 'ren', 'copy', 'move', 'del']);
const PS_VALUE_OPTIONS = new Set(['-value', '-encoding', '-itemtype', '-stream']);
function writeTargets(entry, tool) {
  const targets = [...entry.redirects];
  const isPowerShell = tool === 'PowerShell';
  const words = entry.words;
  const writes = (isPowerShell ? PS_WRITERS : BASH_WRITERS).has(basename(words[0]));
  if (!writes) return targets;
  if (entry.dynamic) throw new Error('Dynamic write targets cannot be established.');
  for (let index = 1; index < words.length; index++) {
    const word = words[index];
    if (isPowerShell && PS_VALUE_OPTIONS.has(word.toLowerCase())) { index++; continue; }
    const named = isPowerShell && word.match(/^-(?:literalpath|filepath|path|destination|newname):(.+)$/i);
    if (named) targets.push({ path: named[1], dynamic: /[$@]/.test(named[1]) });
    else if (!word.startsWith('-')) targets.push({ path: word, dynamic: isPowerShell && /[$@]/.test(word) });
  }
  if (!targets.length && !(tool === 'Bash' && basename(words[0]) === 'tee')) throw new Error('Literal write target unavailable.');
  if (isPowerShell && targets.some(target => /[,(){}]/.test(target.path))) throw new Error('Computed write target requires review.');
  return targets;
}

function gitRead(cwd, args, deadline, runner) {
  const remaining = deadline - Date.now();
  if (remaining < 1) throw new Error('Commit inspection timed out.');
  const result = runner('git', ['--no-pager', '-c', 'core.fsmonitor=false', ...args], {
    cwd, shell: false, encoding: 'utf8', timeout: remaining, maxBuffer: 256 * 1024,
  });
  if (result.error || result.signal || result.status !== 0 || typeof result.stdout !== 'string') throw new Error('Commit inspection unavailable.');
  return result.stdout;
}

function inspectCommit(input, words, runner) {
  const deadline = Date.now() + 2500;
  const raw = gitRead(input.cwd, ['diff', '--cached', '--name-only', '-z', '--no-ext-diff', '--diff-filter=ACMR'], deadline, runner);
  const files = raw.split('\0').filter(Boolean).filter(shouldCheckFile);
  if (files.length > 32) throw new Error('Commit inspection quota exceeded.');
  let bytes = 0;
  const issues = files.flatMap(file => {
    const content = gitRead(input.cwd, ['show', `:${file}`], deadline, runner);
    bytes += Buffer.byteLength(content);
    if (bytes > 1024 * 1024) throw new Error('Commit inspection quota exceeded.');
    return findFileIssues(file, { content });
  });
  if (issues.some(issue => issue.severity === 'error')) return { blocked: true,
    reason: 'Staged content contains debugger statements or potential secrets; review required.' };
  const messageIndex = words.findIndex(word => word === '-m' || word === '--message');
  const format = messageIndex >= 0 && words[messageIndex + 1]
    ? validateCommitMessage(`git commit -m ${JSON.stringify(words[messageIndex + 1])}`) : null;
  return { context: `ECC commit preflight: ${files.length} staged source file(s) inspected; ${issues.length} advisory issue(s).`
    + (format?.issues.length ? ' Review the conventional commit subject.' : '')
    + ' Linters are handled separately by end-of-response quality checks.' };
}

function shellPreflight(input, psSegments, options = {}) {
  const command = input.tool_input.command;
  const commands = input.tool_name === 'PowerShell' ? psSegments(command).map(words => ({ words, dynamic: false,
    redirects: words.flatMap((word, index) => {
      const match = word.match(/^\d*(>>?)(.*)$/);
      if (!match) return [];
      const target = match[2] || words[index + 1];
      return [{ path: target, dynamic: typeof target !== 'string' || /[$@]/.test(target) }];
    }) })) : bashCommands(command);
  const contexts = [];
  const changingDirectory = commands.some(entry => ['cd', 'pushd', 'popd', 'set-location', 'sl'].includes(basename(entry.words[0])));
  for (const entry of commands) {
    const targets = writeTargets(entry, input.tool_name);
    if (changingDirectory && targets.length) return { blocked: true, reason: 'Shell writes after a directory change require explicit target review.' };
    for (const target of targets) {
      if (target.dynamic || sensitiveTarget(target.path, input)) return { blocked: true, reason: 'Sensitive, linked, or dynamic shell write target requires operator review.' };
    }
    const words = entry.words;
    const name = basename(words[0]);
    const subcommand = name === 'git' ? gitSubcommand(words) : null;
    if (subcommand === 'commit') {
      if (changingDirectory || words[1] !== 'commit' || entry.dynamic) return { blocked: true, reason: 'Commit inspection requires a direct git invocation in the attested workspace.' };
      const result = inspectCommit(input, words, options.runner || spawnSync);
      if (result.blocked) return result;
      contexts.push(result.context);
    }
    if (name === 'git' && words[1] === 'push') {
      const result = pushReminder({ tool_input: { command: 'git push' } });
      contexts.push(...(result.additionalContext || []));
    }
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)
      && /^(?:run\s+)?dev(?::[^\s]+)?$/.test(words.slice(1, words[1] === 'run' ? 3 : 2).join(' '))) {
      contexts.push('ECC dev-server preflight: keep logs observable and use the host background execution controls. No tmux or command rewrite was applied.');
    }
  }
  return { context: contexts.join('\n') };
}

function gitSubcommand(words) {
  const values = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);
  for (let index = 1; index < words.length; index++) {
    if (values.has(words[index])) { index++; continue; }
    if (words[index].startsWith('-')) continue;
    return words[index];
  }
  return null;
}

module.exports = { shellPreflight };
