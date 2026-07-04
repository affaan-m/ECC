#!/usr/bin/env node
/**
 * Check whether OpenSpec specs are stale by comparing Last verified commit
 * hashes against HEAD. Reads enforced file paths from each spec and checks
 * for changes since the verification commit.
 *
 * Exit codes:
 *   0 — all specs fresh (or no specs to check)
 *   1 — one or more specs stale or unverified
 *   2 — one or more specs orphaned (verification commit lost)
 *   3 — CLI usage error
 *
 * Env vars:
 *   ECC_SPEC_STALE_DAYS — staleness threshold in days (default: 30)
 *   ECC_SPEC_STALE_WARN_ONLY — exit 0 even when stale (default: unset)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const SPECS_DIR = path.join(ROOT, 'openspec', 'specs');
const STALE_DAYS = parseInt(process.env.ECC_SPEC_STALE_DAYS || '30', 10);
const WARN_ONLY = process.env.ECC_SPEC_STALE_WARN_ONLY === 'true';

function git(args, opts = {}) {
  try {
    return execSync(`git ${args}`, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

function collectSpecs(dir) {
  if (!fs.existsSync(dir)) return [];

  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSpecs(full));
    } else if (entry.isFile() && entry.name === 'spec.md') {
      results.push(full);
    }
  }
  return results;
}

function parseSpec(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const capability = path.basename(path.dirname(filePath));
  const relativePath = path.relative(ROOT, filePath);

  // Extract Last verified line
  const verifiedMatch = content.match(/>\s*Last verified:\s*(\d{4}-\d{2}-\d{2})\s*\(commit\s+([a-f0-9]+)\)/i);
  const lastVerifiedDate = verifiedMatch ? verifiedMatch[1] : null;
  const lastVerifiedCommit = verifiedMatch ? verifiedMatch[2] : null;

  // Extract enforced locations
  const enforced = [];
  const enforcedRe = /<!--\s*enforced:\s*([^\s>]+(?:\.[^\s>]+)?)/g;
  let m;
  while ((m = enforcedRe.exec(content)) !== null) {
    enforced.push(m[1].replace(/\(\)$/, ''));
  }

  // Extract requirement/invariant names for stale reporting
  const blocks = [];
  const blockRe = /###\s+(Requirement|Invariant):\s*(.+)$/gm;
  while ((m = blockRe.exec(content)) !== null) {
    blocks.push({ type: m[1], name: m[2].trim() });
  }

  return { capability, relativePath, lastVerifiedDate, lastVerifiedCommit, enforced, blocks };
}

function main() {
  const specFiles = collectSpecs(SPECS_DIR);

  if (specFiles.length === 0) {
    console.log('No specs found — nothing to check.');
    process.exit(0);
  }

  const headCommit = git('rev-parse HEAD');
  const specs = [];
  const errors = [];

  for (const specFile of specFiles) {
    const spec = parseSpec(specFile);
    if (!spec) {
      errors.push(`Failed to parse: ${specFile}`);
      continue;
    }
    specs.push(spec);
  }

  // Classify each spec
  const results = specs.map(spec => {
    if (!spec.lastVerifiedCommit) {
      return { ...spec, status: 'UNVERIFIED', ageDays: null, commitsSince: null, filesChanged: 0, changedFiles: [] };
    }

    // Verify commit exists
    const commitExists = git(`rev-list -1 ${spec.lastVerifiedCommit}`);
    if (!commitExists) {
      return { ...spec, status: 'ORPHANED', ageDays: null, commitsSince: null, filesChanged: 0, changedFiles: [] };
    }

    // Calculate age
    const verifiedDate = new Date(spec.lastVerifiedDate);
    const now = new Date();
    const ageDays = Math.floor((now - verifiedDate) / (1000 * 60 * 60 * 24));

    // Count commits since verification
    const commitsSinceRaw = git(`rev-list --count ${spec.lastVerifiedCommit}..HEAD`);
    const commitsSince = commitsSinceRaw ? parseInt(commitsSinceRaw, 10) : 0;

    // Check if enforced files changed
    const changedFiles = [];
    if (spec.enforced.length > 0) {
      const fileNames = [...new Set(spec.enforced.map(e => {
        // Convert ClassName.methodName → likely file path
        const parts = e.split('.');
        return parts[0];
      }))];

      for (const fileName of fileNames) {
        // Find the actual file by searching
        const found = git(`diff --name-only ${spec.lastVerifiedCommit}..HEAD -- '**/${fileName}.*'`);
        if (found && found.length > 0) {
          changedFiles.push(...found.split('\n').filter(Boolean));
        }
      }
    }

    const rulesChanged = spec.blocks.map(b => b.name);
    const isStale = changedFiles.length > 0 || ageDays >= STALE_DAYS;
    const status = isStale ? 'STALE' : 'FRESH';

    return {
      ...spec,
      status,
      ageDays,
      commitsSince,
      filesChanged: changedFiles.length,
      changedFiles,
      staleRequirements: isStale ? rulesChanged : [],
    };
  });

  // Summary
  const summary = {
    total: results.length,
    fresh: results.filter(r => r.status === 'FRESH').length,
    stale: results.filter(r => r.status === 'STALE').length,
    orphaned: results.filter(r => r.status === 'ORPHANED').length,
    unverified: results.filter(r => r.status === 'UNVERIFIED').length,
  };

  const report = {
    checked_at: new Date().toISOString(),
    head_commit: headCommit,
    threshold_days: STALE_DAYS,
    summary,
    specs: results,
  };

  // Output
  console.log(JSON.stringify(report, null, 2));

  // Errors (parse failures)
  if (errors.length > 0) {
    console.error('\nParse errors:');
    errors.forEach(e => console.error(`  - ${e}`));
  }

  // Exit code logic
  if (WARN_ONLY) {
    console.log('\n[WARN ONLY] Spec freshness check completed with warnings.');
    process.exit(0);
  }

  if (summary.orphaned > 0) {
    console.error(`\nERROR: ${summary.orphaned} spec(s) orphaned — verification commits lost.`);
    process.exit(2);
  }

  if (summary.stale > 0 || summary.unverified > 0) {
    console.error(`\nFAIL: ${summary.stale} stale, ${summary.unverified} unverified.`);
    console.error('Run spec-miner to update baseline specs, or set ECC_SPEC_STALE_WARN_ONLY=true.');
    process.exit(1);
  }

  console.log('\nAll specs fresh.');
  process.exit(0);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(3);
  }
}

module.exports = { collectSpecs, parseSpec, git };
