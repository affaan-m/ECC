#!/usr/bin/env node
/**
 * Check OpenSpec freshness at FILE level.
 *
 * ── v1 contract ─────────────────────────────────────────────────
 * For each spec file under <root>/openspec/, parse its `<!-- enforced: -->`
 * anchors and the `Last verified:` date, then ask git whether the anchor's
 * TARGET FILE changed after that date. This is a FILE-LEVEL freshness check:
 * the `::symbol` part of an anchor is recorded but never resolved — verifying
 * that a symbol exists inside a file is out of scope for v1.
 *
 * Truthful verdicts (a spec resolves to the strongest of these):
 *   FRESH       every enforced target exists, is inside the project, is
 *               committed, and has not changed since `Last verified`
 *   STALE       an enforced target changed after `Last verified`, or the
 *               verification itself is older than ECC_SPEC_STALE_DAYS
 *   ORPHANED    an enforced target file is missing from the tree or escapes
 *               the project (via `..` or a symlink out of the root)
 *   UNVERIFIED  no git / not a repo / SHALLOW clone / missing or invalid
 *               `Last verified` date / target file never committed — i.e.
 *               evidence is unavailable, NOT a sign of staleness
 *   UNKNOWN     an enforced anchor does not parse to path::symbol
 *
 * Safety:
 *   - git is always invoked through execFileSync with an argv array. Paths are
 *     passed after `--`; the date is validated to YYYY-MM-DD first and passed
 *     as a single argument. Nothing from spec Markdown reaches a shell.
 *   - the project root must not be a symlink; every enforced target is resolved
 *     through fs.realpathSync and must stay inside the real project root.
 *   - shallow clones report UNVERIFIED — incomplete history is never
 *     mislabelled ORPHANED or STALE.
 *
 * Exit contract:
 *   0 = no stale specs (or ECC_SPEC_STALE_WARN_ONLY === "true")
 *   1 = at least one stale spec (STALE only; ORPHANED/UNVERIFIED are reported,
 *       not gating failures)
 *   2 = configuration / input error
 *
 * Output: single JSON line to stdout {specs[], staleCount, totalCount}
 * Diagnostics: all prose to stderr
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ── CLI args & env ──────────────────────────────────────────────

function resolveProjectRoot() {
  const rootIdx = process.argv.indexOf('--project-root');
  if (rootIdx !== -1 && rootIdx + 1 < process.argv.length) {
    return process.argv[rootIdx + 1];
  }
  if (process.env.ECC_SPEC_PROJECT_ROOT) {
    return process.env.ECC_SPEC_PROJECT_ROOT;
  }
  return process.cwd();
}

function resolveStaleDays() {
  const envVal = process.env.ECC_SPEC_STALE_DAYS;
  if (envVal === undefined || envVal === '') {
    return 30; // Default
  }
  // Strict integer (reject "1.5", "0x10", "+3", etc.), not parseInt coercion.
  if (!/^\d+$/.test(envVal)) {
    console.error(`FATAL: ECC_SPEC_STALE_DAYS must be an integer 1-365, got: "${envVal}"`);
    process.exit(2);
  }
  const days = parseInt(envVal, 10);
  if (days <= 0 || days > 365) {
    console.error(`FATAL: ECC_SPEC_STALE_DAYS must be an integer 1-365, got: "${envVal}"`);
    process.exit(2);
  }
  return days;
}

const WARN_ONLY = process.env.ECC_SPEC_STALE_WARN_ONLY === 'true';

function die(message) {
  console.error(`FATAL: ${message}`);
  process.exit(2);
}

// ── Root validation (real-path contained) ───────────────────────

const projectRootArg = resolveProjectRoot();
const staleDays = resolveStaleDays();

let rootStat;
try {
  rootStat = fs.lstatSync(projectRootArg);
} catch (err) {
  die(`Cannot access --project-root: ${projectRootArg} (${err.message})`);
}
if (!rootStat.isDirectory()) {
  die(`--project-root is not a directory: ${projectRootArg}`);
}
if (rootStat.isSymbolicLink()) {
  die(`--project-root must not be a symlink: ${projectRootArg}`);
}

const projectRoot = fs.realpathSync(projectRootArg);
const openspecDir = path.join(projectRoot, 'openspec');

// ── v1 parsing constants ────────────────────────────────────────

const ENFORCED_RE = /<!--\s*enforced:\s*(.*?)\s*-->/g;
const LAST_VERIFIED_RE = /^[>\s]*last\s+verified:\s*(.*)$/im;
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

/** Parse `path::symbol`; reject whitespace, absolute paths, `..`, backslashes. */
function parseAnchor(raw) {
  const trimmed = raw.trim();
  if (trimmed === '' || /\s/.test(trimmed)) {
    return { invalid: true, reason: 'must not contain whitespace' };
  }
  const sep = trimmed.indexOf('::');
  if (sep <= 0 || sep === trimmed.length - 2) {
    return { invalid: true, reason: 'expected <path>::<symbol>' };
  }
  const anchorPath = trimmed.slice(0, sep);
  const symbol = trimmed.slice(sep + 2);
  if (anchorPath.startsWith('/')) {
    return { invalid: true, reason: 'path must be repo-relative (no leading "/")' };
  }
  if (anchorPath.includes('\\')) {
    return { invalid: true, reason: 'path must use forward slashes' };
  }
  if (anchorPath.split('/').includes('..')) {
    return { invalid: true, reason: 'path must not traverse outside the project ("../")' };
  }
  return { path: anchorPath, symbol };
}

/** Extract a validated calendar date (YYYY-MM-DD) from a `Last verified` value. */
function parseVerifiedDate(rawValue) {
  const m = rawValue.match(DATE_RE);
  if (!m) return null;
  const time = new Date(`${m[1]}T00:00:00Z`).getTime();
  if (Number.isNaN(time)) return null;
  return { date: m[1], time };
}

function isInside(base, candidate) {
  const rel = path.relative(base, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

// ── Git helpers (argv only, never a shell string) ───────────────

let gitState = null;

function gitProbe() {
  if (gitState !== null) return gitState;
  gitState = { available: false, repo: false, shallow: false };
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', cwd: projectRoot });
    gitState.available = true;
  } catch {
    return gitState;
  }
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore', cwd: projectRoot });
    gitState.repo = true;
  } catch {
    return gitState;
  }
  try {
    const out = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
      encoding: 'utf8',
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    gitState.shallow = out === 'true';
  } catch {
    gitState.shallow = false;
  }
  return gitState;
}

/** stdout of `git log --format=%H --after=<date> -- <path>` (empty when none). */
function gitHashesAfter(date, anchorPath) {
  const out = execFileSync(
    'git',
    ['log', '--format=%H', `--after=${date}`, '--', anchorPath],
    { encoding: 'utf8', cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return out.trim().split('\n').filter(Boolean);
}

function gitAllHashes(anchorPath) {
  const out = execFileSync(
    'git',
    ['log', '--format=%H', '--', anchorPath],
    { encoding: 'utf8', cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  return out.trim().split('\n').filter(Boolean);
}

/**
 * File-level freshness for one enforced target.
 * @returns {{ status: string, reason?: string }}
 */
function targetFreshness(anchorPath) {
  const probe = gitProbe();
  if (!probe.available || !probe.repo) {
    return { status: 'UNVERIFIED', reason: 'git unavailable or not a repository' };
  }
  if (probe.shallow) {
    return { status: 'UNVERIFIED', reason: 'shallow clone — history incomplete' };
  }

  const resolved = path.resolve(projectRoot, anchorPath);
  if (!isInside(projectRoot, resolved)) {
    return { status: 'ORPHANED', reason: `target escapes project root: ${anchorPath}` };
  }

  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    return { status: 'ORPHANED', reason: `target file not found: ${anchorPath}` };
  }
  if (!isInside(projectRoot, real)) {
    return { status: 'ORPHANED', reason: `target resolves outside project (symlink): ${anchorPath}` };
  }

  let all;
  try {
    all = gitAllHashes(anchorPath);
  } catch (err) {
    return { status: 'UNVERIFIED', reason: `git error: ${err.message}` };
  }
  if (all.length === 0) {
    return { status: 'UNVERIFIED', reason: `target has no git history: ${anchorPath}` };
  }
  return { status: 'FRESH' }; // changed-after is decided by the caller with the date
}

// ── Spec walking & parsing ──────────────────────────────────────

function walkMdFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    return results;
  }
  if (!stat.isDirectory()) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMdFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

function parseSpecFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { error: 'unreadable' };
  }

  const enforced = [];
  let m;
  const re = new RegExp(ENFORCED_RE.source, 'g');
  while ((m = re.exec(content)) !== null) {
    enforced.push(m[1].trim());
  }

  const lv = content.match(LAST_VERIFIED_RE);
  const lastVerifiedRaw = lv ? lv[1].trim() : null;

  return { enforced, lastVerifiedRaw, error: null };
}

/**
 * @returns {{ status, path, lastVerified?, enforced?, reasons? }}
 */
function evaluateSpec(relPath, parsed) {
  const { enforced, lastVerifiedRaw } = parsed;
  const base = { path: relPath };

  if (lastVerifiedRaw === null) {
    return {
      ...base,
      status: 'UNVERIFIED',
      enforced: enforced.length > 0 ? enforced : undefined,
      reasons: ['missing "Last verified:" date'],
    };
  }

  const verified = parseVerifiedDate(lastVerifiedRaw);
  if (!verified) {
    return {
      ...base,
      status: 'UNVERIFIED',
      enforced: enforced.length > 0 ? enforced : undefined,
      lastVerified: lastVerifiedRaw,
      reasons: [`unparseable "Last verified:" value: "${lastVerifiedRaw}"`],
    };
  }

  if (enforced.length === 0) {
    return { ...base, status: 'FRESH', lastVerified: verified.date };
  }

  const ageDays = (Date.now() - verified.time) / 86400000;
  const reasons = [];
  const weights = { STALE: 4, ORPHANED: 3, UNVERIFIED: 2, UNKNOWN: 1, FRESH: 0 };
  let status = 'FRESH';
  const bump = (s) => {
    if (weights[s] > weights[status]) status = s;
  };

  for (const raw of enforced) {
    const anchor = parseAnchor(raw);
    if (anchor.invalid) {
      bump('UNKNOWN');
      reasons.push(`invalid enforced anchor "${raw}" (${anchor.reason})`);
      continue;
    }
    if (ageDays > staleDays) {
      bump('STALE');
      reasons.push(`Last verified ${Math.round(ageDays)} days ago (threshold: ${staleDays} days)`);
    }
    const verdict = targetFreshness(anchor.path);
    if (verdict.status !== 'FRESH') {
      bump(verdict.status);
      reasons.push(`"${anchor.path}": ${verdict.reason}`);
      continue;
    }
    // File exists & is committed: was it changed after the verification date?
    let changed;
    try {
      changed = gitHashesAfter(verified.date, anchor.path).length > 0;
    } catch (err) {
      bump('UNVERIFIED');
      reasons.push(`"${anchor.path}": git error: ${err.message}`);
      continue;
    }
    if (changed) {
      bump('STALE');
      reasons.push(`"${anchor.path}" changed after last verified ${verified.date}`);
    }
  }

  return {
    ...base,
    status,
    enforced,
    lastVerified: verified.date,
    reasons: reasons.length > 0 ? reasons : undefined,
  };
}

// ── Main ────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(openspecDir)) {
    console.log(JSON.stringify({ specs: [], staleCount: 0, totalCount: 0 }));
    process.exit(0);
  }

  const mdFiles = walkMdFiles(openspecDir);
  if (mdFiles.length === 0) {
    console.log(JSON.stringify({ specs: [], staleCount: 0, totalCount: 0 }));
    process.exit(0);
  }

  const specs = [];
  for (const filePath of mdFiles) {
    const parsed = parseSpecFile(filePath);
    const relPath = path.relative(openspecDir, filePath);
    if (parsed.error) {
      specs.push({ path: relPath, status: 'UNKNOWN' });
      console.error(`WARNING: could not parse ${relPath}: ${parsed.error}`);
      continue;
    }
    specs.push(evaluateSpec(relPath, parsed));
  }

  const staleCount = specs.filter((s) => s.status === 'STALE').length;
  const result = { specs, staleCount, totalCount: specs.length };

  for (const spec of specs) {
    if (spec.reasons) {
      console.error(`INFO: ${spec.path}: ${spec.status} — ${spec.reasons.join('; ')}`);
    }
  }
  console.error(`Checked ${specs.length} spec(s): ${staleCount} stale.`);

  console.log(JSON.stringify(result));

  if (staleCount > 0 && !WARN_ONLY) {
    process.exit(1);
  }
  process.exit(0);
}

main();
