#!/usr/bin/env node
/**
 * Validate OpenSpec markdown against the v1 schema contract.
 *
 * ── v1 schema contract (source of truth) ─────────────────────────
 * Baseline spec file (contains Requirement/Invariant blocks):
 *   - `### Requirement: <title>` MUST have at least one
 *     `#### Scenario: <name>` child.
 *   - `### Invariant: <title>` MUST carry an `<!-- enforced: -->` anchor.
 *   - YAML frontmatter is OPTIONAL. When present it is not validated here.
 * Delta file (contains `<!-- ADDED: -->`, `<!-- MODIFIED: -->`,
 *   `<!-- REMOVED: -->` markers):
 *   - Each DECLARED block MUST be non-empty. An empty block is an error even
 *     when a later block has content.
 *
 * Metadata HTML comments — keys are an explicit allowlist:
 *   id, entities, enforced, test, depends_on, triggers, verified_by,
 *   status, removal_reason, deferred, uncertainty
 *   - key on the allowlist              → metadata (no value rule beyond non-marker)
 *   - key machine-shaped (`[a-z][a-z0-9_-]*`) but NOT on the allowlist
 *                                        → ERROR (typo guard)
 *   - everything else (`Note:`, `TODO:`, no colon) → ordinary comment, allowed
 * ADDED/MODIFIED/REMOVED are structural delta markers, not metadata.
 *
 * Enforced anchor grammar:
 *   <!-- enforced: <repo-relative/path.ext>::<symbol> -->
 *   relative path + symbol, no whitespace, no leading "/", no "../" or
 *   backslash traversal. This is the FILE-LEVEL anchor; symbol resolution is
 *   out of scope for v1 (freshness checks target the file, not the symbol).
 *
 * Output: single JSON line to stdout {valid, errors[]}
 * Diagnostics: all prose to stderr
 * Exit: 0 = valid, 1 = one or more validation errors, 2 = config/input error
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── CLI args & env ──────────────────────────────────────────────

function resolveOpenspecRoot() {
  const rootIdx = process.argv.indexOf('--openspec-root');
  if (rootIdx !== -1 && rootIdx + 1 < process.argv.length) {
    return process.argv[rootIdx + 1];
  }
  if (process.env.ECC_OPENSPEC_ROOT) {
    return process.env.ECC_OPENSPEC_ROOT;
  }
  return process.cwd();
}

const openspecRoot = resolveOpenspecRoot();

function die(message, exitCode) {
  console.error(`FATAL: ${message}`);
  process.exit(exitCode);
}

try {
  const stat = fs.statSync(openspecRoot);
  if (!stat.isDirectory()) {
    die(`--openspec-root is not a directory: ${openspecRoot}`, 2);
  }
} catch (err) {
  die(`Cannot access --openspec-root: ${openspecRoot} (${err.message})`, 2);
}

const openspecDir = path.join(openspecRoot, 'openspec');

// ── v1 schema constants ─────────────────────────────────────────

const METADATA_ALLOWLIST = new Set([
  'id',
  'entities',
  'enforced',
  'test',
  'depends_on',
  'triggers',
  'verified_by',
  'status',
  'removal_reason',
  'deferred',
  'uncertainty',
]);

const MACHINE_KEY_RE = /^[a-z][a-z0-9_-]*$/;
const REQUIREMENT_RE = /^###\s+Requirement:\s*(.+)$/;
const INVARIANT_RE = /^###\s+Invariant:\s*(.+)$/;
const SCENARIO_RE = /^####\s+Scenario:\s*/m;
const HTML_COMMENT_RE = /<!--([\s\S]*?)-->/g;
const ENFORCED_RE = /<!--\s*enforced:\s*(.*?)\s*-->/g;
const DELTA_MARKER_RE = /<!--\s*(ADDED|MODIFIED|REMOVED)\s*:\s*-->/g;

// ── Helpers ─────────────────────────────────────────────────────

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

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMdFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Validate an enforced anchor string against the v1 grammar.
 * @returns {{ path: string, symbol: string } | { invalid: true, reason: string }}
 */
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
  const segments = anchorPath.split('/');
  if (segments.includes('..')) {
    return { invalid: true, reason: 'path must not traverse outside the project ("../")' };
  }
  return { path: anchorPath, symbol };
}

const INVALID_ANCHOR_MSG = (rel, raw, reason) =>
  `${rel}: Invalid enforced anchor "${raw}" (${reason}; expected <relative/path.ext>::<symbol>)`;

/**
 * Walk every HTML comment in a file and classify it.
 * Returns { errors, metadata[] } — metadata entries not currently consumed by
 * structural checks, but presence of an error means the file is invalid.
 */
function classifyComments(rel, content, errors) {
  const meta = [];
  let match;
  const re = new RegExp(HTML_COMMENT_RE.source, 'g');
  while ((match = re.exec(content)) !== null) {
    const body = match[1].trim();
    if (body === '') continue;
    const colon = body.indexOf(':');
    if (colon === -1) continue; // ordinary comment
    const key = body.slice(0, colon).trim();
    const value = body.slice(colon + 1).trim();

    // Structural delta markers are not metadata.
    if (key === 'ADDED' || key === 'MODIFIED' || key === 'REMOVED') continue;

    if (METADATA_ALLOWLIST.has(key)) {
      meta.push({ key, value });
      continue;
    }
    if (MACHINE_KEY_RE.test(key)) {
      errors.push(`${rel}: Unknown metadata key "${key}" (not in allowlist)`);
      continue;
    }
    // Uppercase / prose keys (`Note:`, `TODO:`, `PR:`) are ordinary comments.
  }
  return meta;
}

/** Collect every enforced anchor string in the file (any location). */
function collectEnforcedAnchors(content) {
  const anchors = [];
  let match;
  const re = new RegExp(ENFORCED_RE.source, 'g');
  while ((match = re.exec(content)) !== null) {
    anchors.push(match[1].trim());
  }
  return anchors;
}

/**
 * Split content into top-level sections by `### Requirement:` / `### Invariant:`
 * headings. Returns [{ type, title, body }]. Text before the first heading is
 * dropped from block validation (document preamble is allowed).
 */
function splitBlocks(content) {
  const blocks = [];
  const lines = content.split('\n');
  let current = null;
  for (const line of lines) {
    let m = line.match(REQUIREMENT_RE);
    if (m) {
      current = { type: 'Requirement', title: m[1].trim(), body: [] };
      blocks.push(current);
      continue;
    }
    m = line.match(INVARIANT_RE);
    if (m) {
      current = { type: 'Invariant', title: m[1].trim(), body: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.body.push(line);
  }
  return blocks;
}

/** Validate a baseline spec file (Requirement/Invariant blocks). */
function validateBaseline(rel, content, errors) {
  const blocks = splitBlocks(content);

  for (const block of blocks) {
    const body = block.body.join('\n');
    if (block.type === 'Requirement' && !SCENARIO_RE.test(body)) {
      errors.push(`${rel}: Requirement "${block.title}" has no Scenario`);
    }
    if (block.type === 'Invariant') {
      const enforcedIn = collectEnforcedAnchors(body);
      if (enforcedIn.length === 0) {
        errors.push(`${rel}: Invariant "${block.title}" missing <!-- enforced: --> anchor`);
      }
    }
  }
}

/** Validate a delta file: every declared ADDED/MODIFIED/REMOVED block is non-empty. */
function validateDelta(rel, content, errors) {
  // Each marker opens a block whose body runs from the END of that marker to
  // the START of the next marker (or EOF). Using the next marker's end as the
  // boundary would swallow the next marker's text into the current block.
  const markers = [];
  let match;
  const re = new RegExp(DELTA_MARKER_RE.source, 'g');
  while ((match = re.exec(content)) !== null) {
    markers.push({
      name: match[1],
      bodyStart: match.index + match[0].length, // end of this marker's "-->"
      markerStart: match.index, // start of this marker, used as the NEXT block's end
    });
  }

  markers.forEach((m, i) => {
    const blockEnd = i + 1 < markers.length ? markers[i + 1].markerStart : content.length;
    const body = content.slice(m.bodyStart, blockEnd).trim();
    if (body === '') {
      errors.push(`${rel}: Empty ${m.name} block (declared but no content)`);
    }
  });
}

// ── Per-file validation ─────────────────────────────────────────

function validateSpecFile(filePath) {
  const errors = [];
  const rel = path.relative(openspecDir, filePath);

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return [`${rel}: Cannot read file: ${err.message}`];
  }

  if (content.trim() === '') {
    return [`${rel}: Empty spec file`];
  }

  // Metadata allowlist + typo guard + ordinary-comment handling.
  classifyComments(rel, content, errors);

  // Every enforced anchor anywhere in the file must satisfy the grammar.
  for (const raw of collectEnforcedAnchors(content)) {
    const parsed = parseAnchor(raw);
    if (parsed.invalid) {
      errors.push(INVALID_ANCHOR_MSG(rel, raw, parsed.reason));
    }
  }

  // Fresh regex per call: /g regexes are stateful across .test() calls.
  const isDelta = new RegExp(DELTA_MARKER_RE.source, 'g').test(content);
  if (isDelta) {
    validateDelta(rel, content, errors);
    return errors;
  }

  validateBaseline(rel, content, errors);
  return errors;
}

// ── Main ────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(openspecDir)) {
    console.log(JSON.stringify({ valid: true, errors: [] }));
    process.exit(0);
  }

  const mdFiles = walkMdFiles(openspecDir);
  if (mdFiles.length === 0) {
    console.log(JSON.stringify({ valid: true, errors: [] }));
    process.exit(0);
  }

  const allErrors = [];
  for (const filePath of mdFiles) {
    const fileErrors = validateSpecFile(filePath);
    allErrors.push(...fileErrors);
  }

  if (allErrors.length > 0) {
    console.error(`Found ${allErrors.length} validation error(s):`);
    for (const err of allErrors) {
      console.error(`  - ${err}`);
    }
  } else {
    console.error(`Validated ${mdFiles.length} spec file(s): no errors found.`);
  }

  console.log(JSON.stringify({ valid: allErrors.length === 0, errors: allErrors }));

  process.exit(allErrors.length > 0 ? 1 : 0);
}

main();
