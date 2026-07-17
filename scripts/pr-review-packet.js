#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCHEMA_VERSION = 'ecc.pr-review-packet.v1';
const DEFAULT_REVIEW_DIR = path.join('.claude', 'reviews');
const DEFAULT_FORMAT = 'markdown';
const MAX_ARTIFACTS_PER_KIND = 10;

const VALUE_FLAGS = new Set([
  '--artifact-dir',
  '--base',
  '--format',
  '--head',
  '--output',
  '--pr',
  '--repo-root',
  '--root',
  '--write'
]);

const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.dart', '.ex', '.exs', '.fs', '.go',
  '.h', '.hpp', '.html', '.java', '.js', '.jsx', '.kt', '.kts', '.lua', '.m',
  '.mm', '.php', '.py', '.rb', '.rs', '.scala', '.scss', '.sh', '.sql',
  '.swift', '.ts', '.tsx', '.vue'
]);

const ASSET_EXTENSIONS = new Set([
  '.avif', '.eot', '.gif', '.ico', '.jpeg', '.jpg', '.mp3', '.mp4', '.ogg',
  '.otf', '.pdf', '.png', '.svg', '.ttf', '.wav', '.webm', '.woff', '.woff2'
]);

const LOCKFILE_NAMES = new Set([
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'composer.lock',
  'go.sum',
  'package-lock.json',
  'pnpm-lock.yaml',
  'poetry.lock',
  'yarn.lock'
]);

function usage() {
  return [
    'Usage: node scripts/pr-review-packet.js [options]',
    '',
    'Create a deterministic PR review packet with rename/copy-aware diff maps.',
    '',
    'Options:',
    '  --base <ref>              Base ref for diff (default: upstream or origin/main)',
    '  --head <ref>              Head ref for diff (default: HEAD)',
    '  --pr <number|url|branch>  Include GitHub PR metadata when gh is available',
    '  --repo-root, --root <dir> Repository root (default: git root from cwd)',
    '  --artifact-dir <dir>      Directory for default artifact path (default: .claude/reviews)',
    '  --format <markdown|json|text>',
    '                            Output format (default: markdown)',
    '  --markdown                Alias for --format markdown',
    '  --json                    Alias for --format json',
    '  --text                    Alias for --format text',
    '  --write <path>            Write output to a file',
    '  --output <path>           Alias for --write',
    '  --find-copies             Enable copy detection (default)',
    '  --no-find-copies          Disable copy detection',
    '  --find-copies-harder      Search unmodified files as copy sources; slower',
    '  --no-github               Skip gh metadata even when --pr is supplied',
    '  --help, -h                Show this help',
    '',
    'Examples:',
    '  node scripts/pr-review-packet.js --base origin/main --write .claude/reviews/pr-review-packet.md',
    '  node scripts/pr-review-packet.js --pr 123 --json',
  ].join('\n');
}

function readValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

function assignOption(options, flag, value) {
  if (flag === '--artifact-dir') options.artifactDir = value;
  else if (flag === '--base') options.base = value;
  else if (flag === '--format') options.format = value.toLowerCase();
  else if (flag === '--head') options.head = value;
  else if (flag === '--output' || flag === '--write') options.writePath = value;
  else if (flag === '--pr') options.pr = value;
  else if (flag === '--repo-root' || flag === '--root') options.repoRoot = value;
  else throw new Error(`Unknown argument: ${flag}`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    artifactDir: DEFAULT_REVIEW_DIR,
    base: null,
    findCopies: true,
    findCopiesHarder: false,
    format: DEFAULT_FORMAT,
    head: 'HEAD',
    help: false,
    pr: null,
    repoRoot: null,
    skipGithub: false,
    writePath: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--markdown') {
      parsed.format = 'markdown';
      continue;
    }

    if (arg === '--json') {
      parsed.format = 'json';
      continue;
    }

    if (arg === '--text') {
      parsed.format = 'text';
      continue;
    }

    if (arg === '--find-copies') {
      parsed.findCopies = true;
      continue;
    }

    if (arg === '--no-find-copies') {
      parsed.findCopies = false;
      parsed.findCopiesHarder = false;
      continue;
    }

    if (arg === '--find-copies-harder') {
      parsed.findCopies = true;
      parsed.findCopiesHarder = true;
      continue;
    }

    if (arg === '--no-github') {
      parsed.skipGithub = true;
      continue;
    }

    if (VALUE_FLAGS.has(arg)) {
      assignOption(parsed, arg, readValue(args, index, arg));
      index += 1;
      continue;
    }

    const inlineValueFlag = Array.from(VALUE_FLAGS).find(flag => arg.startsWith(`${flag}=`));
    if (inlineValueFlag) {
      assignOption(parsed, inlineValueFlag, arg.slice(inlineValueFlag.length + 1));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['markdown', 'json', 'text'].includes(parsed.format)) {
    throw new Error(`Invalid format: ${parsed.format}. Use markdown, json, or text.`);
  }

  return parsed;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    env: options.env || process.env,
    maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${details ? `: ${details}` : ''}`);
  }

  return result.stdout || '';
}

function runCommandMaybe(command, args, options = {}) {
  try {
    return { ok: true, stdout: runCommand(command, args, options), error: null };
  } catch (error) {
    return { ok: false, stdout: '', error: error.message };
  }
}

function resolveRepoRoot(startDir) {
  const cwd = path.resolve(startDir || process.cwd());
  const result = runCommandMaybe('git', ['rev-parse', '--show-toplevel'], { cwd });
  if (result.ok && result.stdout.trim()) {
    return path.resolve(result.stdout.trim());
  }
  return cwd;
}

function gitOutput(repoRoot, args) {
  return runCommand('git', args, { cwd: repoRoot });
}

function gitOutputMaybe(repoRoot, args) {
  return runCommandMaybe('git', args, { cwd: repoRoot });
}

function currentBranch(repoRoot) {
  const branch = gitOutputMaybe(repoRoot, ['branch', '--show-current']);
  return branch.ok ? branch.stdout.trim() : '';
}

function firstExistingRef(repoRoot, refs) {
  for (const ref of refs) {
    const result = gitOutputMaybe(repoRoot, ['rev-parse', '--verify', '--quiet', ref]);
    if (result.ok && result.stdout.trim()) {
      return ref;
    }
  }
  return null;
}

function resolveDefaultBase(repoRoot) {
  const upstream = gitOutputMaybe(repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (upstream.ok && upstream.stdout.trim()) {
    return upstream.stdout.trim();
  }

  const originHead = gitOutputMaybe(repoRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead.ok && originHead.stdout.trim()) {
    return originHead.stdout.trim();
  }

  return firstExistingRef(repoRoot, [
    'origin/main',
    'origin/master',
    'main',
    'master'
  ]) || 'HEAD~1';
}

function normalizePrInput(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(/\/pull\/(\d+)(?:\D|$)/) || text.match(/^#?(\d+)$/);
  return match ? match[1] : text;
}

function runGhJson(args, options = {}) {
  const shimPath = process.env.ECC_GH_SHIM;
  const command = shimPath ? process.execPath : 'gh';
  const commandArgs = shimPath ? [shimPath, ...args] : args;
  const result = runCommand(command, commandArgs, {
    cwd: options.cwd || process.cwd(),
    env: process.env,
    maxBuffer: 20 * 1024 * 1024
  });
  return JSON.parse(result || '{}');
}

function fetchGithubContext(repoRoot, prInput) {
  const normalized = normalizePrInput(prInput);
  if (!normalized) {
    return { pr: null, checks: [], warnings: [] };
  }

  const warnings = [];
  let pr = null;
  let checks = [];

  try {
    pr = runGhJson([
      'pr',
      'view',
      normalized,
      '--json',
      'number,title,body,author,baseRefName,headRefName,url,isDraft,mergeStateStatus,changedFiles,additions,deletions,statusCheckRollup'
    ], { cwd: repoRoot });
  } catch (error) {
    warnings.push(`GitHub PR metadata unavailable: ${error.message}`);
  }

  try {
    checks = runGhJson([
      'pr',
      'checks',
      normalized,
      '--json',
      'name,state,conclusion,workflow,startedAt,completedAt'
    ], { cwd: repoRoot });
    if (!Array.isArray(checks)) checks = [];
  } catch (error) {
    warnings.push(`GitHub check metadata unavailable: ${error.message}`);
  }

  return { pr, checks, warnings };
}

function buildDiffArgs(options) {
  const args = ['diff', '--find-renames'];
  if (options.findCopies) {
    args.push('--find-copies');
  }
  if (options.findCopiesHarder) {
    args.push('--find-copies-harder');
  }
  return args;
}

function buildDiffRange(base, head) {
  if (!base || base === head) {
    return head;
  }
  return `${base}...${head}`;
}

function parseNameStatus(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const parts = line.split('\t');
      const statusToken = parts[0] || '';
      const kind = statusToken.slice(0, 1);
      const scoreRaw = statusToken.slice(1);
      const score = scoreRaw ? Number.parseInt(scoreRaw, 10) : null;

      if (kind === 'R' || kind === 'C') {
        return {
          change: kind === 'R' ? 'renamed' : 'copied',
          newPath: parts[2] || '',
          oldPath: parts[1] || '',
          path: parts[2] || parts[1] || '',
          score: Number.isFinite(score) ? score : null,
          status: statusToken
        };
      }

      const changeByKind = {
        A: 'added',
        D: 'deleted',
        M: 'modified',
        T: 'typechanged',
        U: 'unmerged',
        X: 'unknown'
      };

      return {
        change: changeByKind[kind] || 'modified',
        newPath: parts[1] || '',
        oldPath: '',
        path: parts[1] || '',
        score: null,
        status: statusToken
      };
    })
    .filter(item => item.path);
}

function parseNumstat(text) {
  const stats = new Map();

  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0] === '-' ? null : Number.parseInt(parts[0], 10);
    const deleted = parts[1] === '-' ? null : Number.parseInt(parts[1], 10);
    const rawPath = parts.slice(2).join('\t');
    const parsedPath = normalizeNumstatPath(rawPath);
    stats.set(parsedPath.path, {
      added: Number.isFinite(added) ? added : null,
      deleted: Number.isFinite(deleted) ? deleted : null,
      oldPath: parsedPath.oldPath
    });
  }

  return stats;
}

function normalizeNumstatPath(rawPath) {
  const braceMatch = rawPath.match(/^(.*)\{(.+)\s=>\s(.+)\}(.*)$/);
  if (braceMatch) {
    return {
      oldPath: `${braceMatch[1]}${braceMatch[2]}${braceMatch[4]}`.replace(/\/+/g, '/'),
      path: `${braceMatch[1]}${braceMatch[3]}${braceMatch[4]}`.replace(/\/+/g, '/')
    };
  }

  const arrowMatch = rawPath.match(/^(.+)\s=>\s(.+)$/);
  if (arrowMatch) {
    return {
      oldPath: arrowMatch[1],
      path: arrowMatch[2]
    };
  }

  return { oldPath: '', path: rawPath };
}

function classifyFile(filePath, change = '') {
  const normalized = filePath.split(path.sep).join('/');
  const basename = path.basename(normalized);
  const ext = path.extname(normalized).toLowerCase();

  if (change === 'deleted') return 'deleted';
  if (normalized.includes('/generated/') || normalized.startsWith('generated/') || normalized.includes('/dist/') || normalized.startsWith('dist/') || normalized.includes('/build/') || normalized.startsWith('build/')) {
    return 'generated';
  }
  if (LOCKFILE_NAMES.has(basename)) return 'lockfiles';
  if (normalized.startsWith('docs/') || ext === '.md' || basename.toLowerCase().startsWith('readme')) {
    return 'docs';
  }
  if (
    normalized.startsWith('.github/')
    || normalized.startsWith('config/')
    || normalized.startsWith('scripts/ci/')
    || basename.startsWith('.')
    || ['.json', '.yaml', '.yml', '.toml', '.ini', '.conf'].includes(ext)
  ) {
    return 'config';
  }
  if (normalized.includes('/migrations/') || normalized.startsWith('migrations/') || normalized.startsWith('supabase/migrations/') || normalized.startsWith('prisma/migrations/')) {
    return 'migrations';
  }
  if (
    normalized.includes('/test/')
    || normalized.includes('/tests/')
    || normalized.startsWith('test/')
    || normalized.startsWith('tests/')
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized)
    || normalized.includes('__tests__')
  ) {
    return 'tests';
  }
  if (ASSET_EXTENSIONS.has(ext)) return 'assets';
  if (SOURCE_EXTENSIONS.has(ext)) return 'source';
  return 'unknown';
}

function groupFiles(files) {
  const groups = {};
  for (const file of files) {
    const group = classifyFile(file.path, file.change);
    if (!groups[group]) groups[group] = [];
    groups[group].push(file);
  }

  return Object.fromEntries(Object.entries(groups).sort(([left], [right]) => left.localeCompare(right)));
}

function listFilesRecursive(rootDir, maxDepth = 3) {
  const results = [];
  if (!fs.existsSync(rootDir)) return results;

  function walk(currentDir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  walk(rootDir, 0);
  return results;
}

function collectRelatedArtifacts(repoRoot) {
  const buckets = [
    { kind: 'plans', dirs: [path.join('.claude', 'plans'), path.join('.claude', 'PRPs', 'plans')] },
    { kind: 'prds', dirs: [path.join('.claude', 'prds'), path.join('.claude', 'PRPs', 'prds')] },
    { kind: 'reviews', dirs: [path.join('.claude', 'reviews'), path.join('.claude', 'PRPs', 'reviews')] },
    { kind: 'reports', dirs: [path.join('.claude', 'reports'), path.join('.claude', 'PRPs', 'reports')] }
  ];

  return buckets.map(bucket => {
    const files = bucket.dirs
      .flatMap(dir => listFilesRecursive(path.join(repoRoot, dir), 4))
      .map(filePath => {
        let stat = null;
        try {
          stat = fs.statSync(filePath);
        } catch {
          stat = { mtimeMs: 0 };
        }
        return {
          path: path.relative(repoRoot, filePath).split(path.sep).join('/'),
          mtimeMs: stat.mtimeMs
        };
      })
      .filter(item => /\.(md|markdown|txt|json)$/i.test(item.path))
      .sort((left, right) => {
        if (right.mtimeMs !== left.mtimeMs) return right.mtimeMs - left.mtimeMs;
        return left.path.localeCompare(right.path);
      })
      .slice(0, MAX_ARTIFACTS_PER_KIND);

    return { kind: bucket.kind, files };
  });
}

function buildPacket(options = {}) {
  const repoRoot = resolveRepoRoot(options.repoRoot);
  const head = options.head || 'HEAD';
  const base = options.base || resolveDefaultBase(repoRoot);
  const range = buildDiffRange(base, head);
  const warnings = [];

  const diffArgs = buildDiffArgs(options);
  const nameStatus = gitOutput(repoRoot, [...diffArgs, '--name-status', range]);
  const numstat = gitOutput(repoRoot, [...diffArgs, '--numstat', range]);
  const stat = gitOutput(repoRoot, [...diffArgs, '--stat', range]);
  const summary = gitOutput(repoRoot, [...diffArgs, '--summary', range]);

  const numstats = parseNumstat(numstat);
  const files = parseNameStatus(nameStatus).map(file => ({
    ...file,
    group: classifyFile(file.path, file.change),
    additions: numstats.get(file.path) ? numstats.get(file.path).added : null,
    deletions: numstats.get(file.path) ? numstats.get(file.path).deleted : null
  }));

  const github = options.skipGithub
    ? { pr: null, checks: [], warnings: [] }
    : fetchGithubContext(repoRoot, options.pr);
  warnings.push(...github.warnings);

  const totals = {
    filesChanged: files.length,
    additions: files.reduce((sum, file) => sum + (Number.isFinite(file.additions) ? file.additions : 0), 0),
    deletions: files.reduce((sum, file) => sum + (Number.isFinite(file.deletions) ? file.deletions : 0), 0),
    renamed: files.filter(file => file.change === 'renamed').length,
    copied: files.filter(file => file.change === 'copied').length,
    deleted: files.filter(file => file.change === 'deleted').length
  };

  const groupCounts = {};
  for (const file of files) {
    groupCounts[file.group] = (groupCounts[file.group] || 0) + 1;
  }

  return {
    schema_version: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repoRoot,
    git: {
      base,
      head,
      range,
      currentBranch: currentBranch(repoRoot)
    },
    options: {
      findCopies: Boolean(options.findCopies),
      findCopiesHarder: Boolean(options.findCopiesHarder)
    },
    github: {
      pr: github.pr,
      checks: github.checks
    },
    totals,
    groupCounts,
    files,
    groups: groupFiles(files),
    maps: {
      renames: files.filter(file => file.change === 'renamed'),
      copies: files.filter(file => file.change === 'copied')
    },
    relatedArtifacts: collectRelatedArtifacts(repoRoot),
    raw: {
      stat: stat.trim(),
      summary: summary.trim()
    },
    warnings
  };
}

function markdownEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function code(value) {
  return `\`${markdownEscape(value)}\``;
}

function renderMarkdown(packet) {
  const lines = [
    '# ECC PR Review Packet',
    '',
    `Generated: ${packet.generatedAt}`,
    `Repository: ${code(packet.repoRoot)}`,
    `Diff range: ${code(packet.git.range)}`,
    `Current branch: ${packet.git.currentBranch ? code(packet.git.currentBranch) : 'unknown'}`,
    '',
    '## Review Map',
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    `| Files changed | ${packet.totals.filesChanged} |`,
    `| Additions | ${packet.totals.additions} |`,
    `| Deletions | ${packet.totals.deletions} |`,
    `| Renames | ${packet.totals.renamed} |`,
    `| Copies | ${packet.totals.copied} |`,
    `| Deleted files | ${packet.totals.deleted} |`,
    ''
  ];

  if (packet.github.pr) {
    const pr = packet.github.pr;
    lines.push(
      '## GitHub PR',
      '',
      `PR: ${pr.url ? `[${markdownEscape(`#${pr.number} ${pr.title}`)}](${pr.url})` : markdownEscape(`#${pr.number} ${pr.title}`)}`,
      `Author: ${pr.author && pr.author.login ? code(pr.author.login) : 'unknown'}`,
      `Branch: ${code(`${pr.headRefName || packet.git.head} -> ${pr.baseRefName || packet.git.base}`)}`,
      `Draft: ${pr.isDraft ? 'yes' : 'no'}`,
      `Merge state: ${pr.mergeStateStatus ? code(pr.mergeStateStatus) : 'unknown'}`,
      ''
    );
  }

  lines.push(
    '## File Groups',
    '',
    '| Group | Files |',
    '| --- | ---: |'
  );

  for (const [group, count] of Object.entries(packet.groupCounts).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`| ${markdownEscape(group)} | ${count} |`);
  }

  if (Object.keys(packet.groupCounts).length === 0) {
    lines.push('| none | 0 |');
  }

  lines.push('', '## Rename And Copy Map', '');

  const moves = [...packet.maps.renames, ...packet.maps.copies];
  if (moves.length === 0) {
    lines.push('No renames or copies detected.', '');
  } else {
    lines.push('| Type | Score | From | To |', '| --- | ---: | --- | --- |');
    for (const move of moves) {
      lines.push(`| ${move.change} | ${move.score === null ? '' : move.score} | ${code(move.oldPath)} | ${code(move.path)} |`);
    }
    lines.push('');
  }

  lines.push('## Changed Files', '');
  for (const [group, files] of Object.entries(packet.groups)) {
    lines.push(`### ${group}`, '', '| Change | +/- | Path | Previous path |', '| --- | ---: | --- | --- |');
    for (const file of files) {
      const added = Number.isFinite(file.additions) ? file.additions : '-';
      const deleted = Number.isFinite(file.deletions) ? file.deletions : '-';
      const previous = file.oldPath ? code(file.oldPath) : '';
      lines.push(`| ${markdownEscape(file.change)} | +${added}/-${deleted} | ${code(file.path)} | ${previous} |`);
    }
    lines.push('');
  }

  lines.push('## Related ECC Artifacts', '');
  for (const bucket of packet.relatedArtifacts) {
    lines.push(`### ${bucket.kind}`);
    if (bucket.files.length === 0) {
      lines.push('', '- none', '');
    } else {
      lines.push('');
      for (const artifact of bucket.files) {
        lines.push(`- ${code(artifact.path)}`);
      }
      lines.push('');
    }
  }

  lines.push('## GitHub Checks', '');
  if (!packet.github.checks || packet.github.checks.length === 0) {
    lines.push('No GitHub check metadata available.', '');
  } else {
    lines.push('| Check | State | Conclusion | Workflow |', '| --- | --- | --- | --- |');
    for (const check of packet.github.checks) {
      lines.push(`| ${markdownEscape(check.name || 'unknown')} | ${markdownEscape(check.state || '')} | ${markdownEscape(check.conclusion || '')} | ${markdownEscape(check.workflow || '')} |`);
    }
    lines.push('');
  }

  lines.push('## Diff Stat', '', '```text', packet.raw.stat || 'No diff stat.', '```', '');

  lines.push('## Rename/Copy Summary', '', '```text', packet.raw.summary || 'No rename/copy summary.', '```', '');

  if (packet.warnings.length > 0) {
    lines.push('## Warnings', '');
    for (const warning of packet.warnings) {
      lines.push(`- ${markdownEscape(warning)}`);
    }
    lines.push('');
  }

  lines.push(
    '## Reviewer Handoff',
    '',
    '- Start with the rename/copy map before reviewing individual hunks.',
    '- Read changed files in full when the group is source, tests, migrations, or config.',
    '- Treat deleted files and moved files as behavior changes until callers/imports are verified.',
    '- Use related ECC artifacts to check whether the implementation still matches the plan.'
  );

  return `${lines.join('\n')}\n`;
}

function renderText(packet) {
  const lines = [
    'ECC PR Review Packet',
    `Generated: ${packet.generatedAt}`,
    `Range: ${packet.git.range}`,
    `Files changed: ${packet.totals.filesChanged}`,
    `Additions/deletions: +${packet.totals.additions}/-${packet.totals.deletions}`,
    `Renames/copies: ${packet.totals.renamed}/${packet.totals.copied}`,
    '',
    'Groups:'
  ];

  for (const [group, count] of Object.entries(packet.groupCounts).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`  ${group}: ${count}`);
  }

  lines.push('', 'Rename/copy map:');
  const moves = [...packet.maps.renames, ...packet.maps.copies];
  if (moves.length === 0) {
    lines.push('  none');
  } else {
    for (const move of moves) {
      lines.push(`  ${move.change} ${move.score === null ? '' : `${move.score}% `}${move.oldPath} -> ${move.path}`);
    }
  }

  if (packet.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of packet.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function renderPacket(packet, format) {
  if (format === 'json') return `${JSON.stringify(packet, null, 2)}\n`;
  if (format === 'text') return renderText(packet);
  return renderMarkdown(packet);
}

function writeOutput(writePath, output) {
  fs.mkdirSync(path.dirname(writePath), { recursive: true });
  fs.writeFileSync(writePath, output, 'utf8');
}

function defaultArtifactPath(options, packet) {
  const artifactDir = path.resolve(packet.repoRoot, options.artifactDir || DEFAULT_REVIEW_DIR);
  const prNumber = packet.github.pr && packet.github.pr.number ? `pr-${packet.github.pr.number}-` : '';
  return path.join(artifactDir, `${prNumber}review-packet.${options.format === 'json' ? 'json' : 'md'}`);
}

function main(argv = process.argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const packet = buildPacket(options);
  const output = renderPacket(packet, options.format);
  const writePath = options.writePath ? path.resolve(options.writePath) : null;

  if (writePath) {
    writeOutput(writePath, output);
  }

  process.stdout.write(output);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  SCHEMA_VERSION,
  buildPacket,
  classifyFile,
  defaultArtifactPath,
  parseArgs,
  parseNameStatus,
  parseNumstat,
  renderMarkdown,
  renderPacket,
  renderText,
  resolveDefaultBase
};
