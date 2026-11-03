'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_READ_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
function workspacePath(root, value, missing = false) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error('Invalid workspace path.');
  const relative = path.isAbsolute(value) ? path.relative(root, value) : value.replace(/\\/g, '/');
  const parts = relative.split(/[\\/]/).filter(part => part && part !== '.');
  if (!parts.length || parts.some(part => part === '..' || /[:]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Path must be a portable workspace descendant.');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlink path rejected.'); }
    catch (error) { if (!missing || error.code !== 'ENOENT') throw error; }
  }
  return current;
}
function readJson(file, fallback) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_READ_BYTES) throw new Error('Unsafe or oversized JSON file.');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw error; }
}
function execute(command, args, cwd, env = process.env, timeout = 30000) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', shell: false, windowsHide: true, timeout, maxBuffer: MAX_OUTPUT_BYTES });
  if (result.error || result.signal || result.status === null) throw new Error('Command unavailable, timed out or exceeded output limit.');
  return { exitCode: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}
function flagArgs(args, values, booleans) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (Object.hasOwn(result, arg)) throw new Error('Duplicate command option.');
    if (booleans.includes(arg)) result[arg] = true;
    else if (values.includes(arg) && args[index + 1] && !args[index + 1].startsWith('--')) result[arg] = args[++index];
    else throw new Error('Invalid command option or missing value.');
  }
  return result;
}
function formatterInvocation(root, target, fix) {
  const extension = path.extname(target).toLowerCase();
  if (extension === '.go') return { command: 'gofmt', args: [fix ? '-w' : '-l', target], formatter: 'gofmt' };
  if (extension === '.py') return { command: 'ruff', args: ['format', ...(fix ? [] : ['--check']), target], formatter: 'ruff' };
  if (!['.js', '.jsx', '.ts', '.tsx', '.json', '.md'].includes(extension)) throw new Error('No supported formatter for this extension.');
  const biome = ['biome.json', 'biome.jsonc'].some(file => fs.existsSync(path.join(root, file)));
  const formatter = biome ? 'biome' : 'prettier';
  const packageDir = biome ? 'node_modules/@biomejs/biome' : 'node_modules/prettier';
  const packageFile = workspacePath(root, `${packageDir}/package.json`);
  const pkg = readJson(packageFile);
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[formatter];
  if (typeof bin !== 'string') throw new Error('Install the configured formatter locally before running the gate.');
  const script = workspacePath(root, path.relative(root, path.resolve(path.dirname(packageFile), bin)));
  return { command: process.execPath, args: [script, ...(biome ? ['check', ...(fix ? ['--write'] : [])] : [fix ? '--write' : '--check']), target], formatter };
}
function qualityGate(root, args) {
  const options = flagArgs(args, ['--file'], ['--fix']);
  if (!options['--file']) throw new Error('quality-gate requires --file.');
  const target = workspacePath(root, options['--file']);
  if (!fs.statSync(target).isFile()) throw new Error('Formatter target must be a regular file.');
  const invocation = formatterInvocation(root, target, Boolean(options['--fix']));
  const result = execute(invocation.command, invocation.args, root);
  const failed = result.exitCode !== 0 || (invocation.formatter === 'gofmt' && !options['--fix'] && result.stdout.trim());
  return { exitCode: failed ? 1 : 0, output: { status: failed ? 'failed' : 'passed', formatter: invocation.formatter, file: path.relative(root, target), fixed: Boolean(options['--fix']), diagnostic: (result.stderr || result.stdout).slice(0, 8192) } };
}
function audit(root, args) {
  const options = flagArgs(args, ['--format', '--scope'], []);
  if (options['--format'] && !['json', 'text'].includes(options['--format'])) throw new Error('Audit format must be json or text.');
  if (options['--scope'] && !['repo', 'hooks', 'skills', 'commands', 'agents'].includes(options['--scope'])) throw new Error('Invalid audit scope.');
  const exists = value => { try { workspacePath(root, value); return true; } catch { return false; } };
  const pkg = readJson(path.join(root, 'package.json'), {});
  const state = readJson(path.join(root, '.github/ecc-install-state.json'), null);
  const pairs = [
    ['Tool Coverage', exists('.github/skills') || exists('.github/agents'), 'Native Copilot skill/agent definitions'],
    ['Context Efficiency', exists('.github/instructions') || exists('.github/copilot-instructions.md'), 'Project Copilot instructions'],
    ['Quality Gates', Boolean(pkg.scripts?.lint || pkg.scripts?.test), 'Project lint/test scripts'],
    ['Memory Persistence', exists('.github/skills/save-session') || exists('.ecc/memory'), 'Copilot checkpoint workflow or Memory Vault'],
    ['Eval Coverage', exists('tests') || exists('test') || exists('evals'), 'Repository test/eval directories'],
    ['Security Guardrails', exists('.github/hooks/ecc.json'), 'Managed native Copilot hook registration; efficacy needs behavioral validation'],
    ['Cost Efficiency', exists('.github/skills/model-route'), 'Explicit model-routing workflow; no inferred usage savings'],
    ['GitHub Integration', exists('.github/workflows'), 'GitHub workflow definitions'],
    ['Vercel Integration', exists('vercel.json') || exists('.vercel'), 'Vercel project configuration'],
    ['Netlify Integration', exists('netlify.toml') || exists('.netlify'), 'Netlify project configuration'],
    ['Cloudflare Integration', exists('wrangler.toml') || exists('wrangler.jsonc'), 'Cloudflare project configuration'],
    ['Fly Integration', exists('fly.toml'), 'Fly project configuration'],
  ];
  const categories = pairs.map(([name, pass, evidence]) => ({ name, pass, evidence, applicable: !name.endsWith('Integration') || name === 'GitHub Integration' || pass }));
  const applicable = categories.filter(category => category.applicable);
  return { exitCode: 0, output: { schema: 'ecc.copilot.audit.v1', scope: options['--scope'] || 'repo', project: root,
    managedInstall: Boolean(state), score: Math.round(100 * applicable.filter(category => category.pass).length / applicable.length), categories,
    limitation: 'Read-only configuration evidence, not security certification or a live integration test.' } };
}

module.exports = { workspacePath, readJson, execute, flagArgs, qualityGate, audit, MAX_READ_BYTES };
