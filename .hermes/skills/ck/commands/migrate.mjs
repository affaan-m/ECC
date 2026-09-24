#!/usr/bin/env node
/**
 * ck — Context Keeper v2
 * migrate.mjs — convert v1 (CONTEXT.md + meta.json) to v2 (context.json)
 *
 * Usage:
 *   node migrate.mjs           — migrate all v1 projects
 *   node migrate.mjs --dry-run — preview without writing
 *
 * Safe: backs up meta.json to meta.json.v1-backup, never deletes data.
 * exit 0: success  exit 1: error
 */

import { readFileSync, existsSync, renameSync } from 'fs';
import { resolve } from 'path';
import { readProjects, writeProjects, saveContext, today, shortId, CONTEXTS_DIR } from './shared.mjs';

const isDryRun = process.argv.includes('--dry-run');

if (isDryRun) {
  console.log('ck migrate — DRY RUN (no files will be written)\n');
}

// ── v1 markdown parsers ───────────────────────────────────────────────────────

function extractSection(md, heading) {
  const re = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

function parseBullets(text) {
  if (!text) return [];
  return text.split('\n')
    .filter(l => /^[-*\d]\s/.test(l.trim()))
    .map(l => l.replace(/^[-*\d]+\.?\s+/, '').trim())
    .filter(Boolean);
}

function parseDecisionsTable(text) {
  if (!text) return [];
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || line.match(/^[|\s-]+$/)) continue;
    const cols = line.split('|').map(c => c.trim()).filter((c, i) => i > 0 && i < 4);
    if (cols.length >= 1 && !cols[0].startsWith('Decision') && !cols[0].startsWith('_')) {
      rows.push({ what: cols[0] || '', why: cols[1] || '', date: cols[2] || '' });
    }
  }
  return rows;
}

/**
 * Parse "Where I Left Off" which in v1 can be:
 * - Simple bullet list
 * - Multi-session blocks: "Session N (date):\n- bullet\n"
 * Returns array of session-like objects {date?, leftOff}
 */
function parseLeftOff(text) {
  if (!text) return [{ leftOff: null }];

  // Detect multi-session format: "Session N ..."
  const sessionBlocks = text.split(/(?=Session \d+)/);
  if (sessionBlocks.length > 1) {
    return sessionBlocks
      .filter(b => b.trim())
      .map(block => {
        const dateMatch = block.match(/\((\d{4}-\d{2}-\d{2})\)/);
        const bullets = parseBullets(block);
        return {
          date: dateMatch?.[1] || null,
          leftOff: bullets.length ? bullets.join('\n') : block.replace(/^Session \d+.*\n/, '').trim(),
        };
      });
  }

  // Simple format
  const bullets = parseBullets(text);
  return [{ leftOff: bullets.length ? bullets.join('\n') : text.trim() }];
}

// ── Main migration ─────────────────────────────────────────────────────────────

const projects = readProjects();
let migrated = 0;
let skipped = 0;
let errors = 0;

for (const [projectPath, info] of Object.entries(projects)) {
  const contextDir = info.contextDir;
  const contextDirPath = resolve(CONTEXTS_DIR, contextDir);
  const contextJsonPath = resolve(contextDirPath, 'context.json');
  const contextMdPath   = resolve(contextDirPath, 'CONTEXT.md');
  const metaPath        = resolve(contextDirPath, 'meta.json');

  // Already v2
  if (existsSync(contextJsonPath)) {
    try {
      const existing = JSON.parse(readFileSync(contextJsonPath, 'utf8'));
      if (existing.version === 2) {
        console.log(`  ✓ ${contextDir} — already v2, skipping`);
        skipped++;
        continue;
      }
    } catch { /* fall through to migrate */ }
  }

  console.log(`\n  → Migrating: ${contextDir}`);

  try {
    // Read v1 files
    const contextMd = existsSync(contextMdPath) ? readFileSync(contextMdPath, 'utf8') : '';
    let meta = {};
    if (existsSync(metaPath)) {
      try {
        meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      } catch (e) {
        console.warn(`  ! ${contextDir}: invalid meta.json, continuing with defaults (${e.message})`);
      }
    }

    // Extract fields from CONTEXT.md
    const description   = extractSection(contextMd, 'What This Is') || extractSection(contextMd, 'About') || null;
    const stackRaw      = extractSection(contextMd, 'Tech Stack') || '';
    const stack         = stackRaw.split(/[,\n]/).map(s => s.replace(/^[-*]\s+/, '').trim()).filter(Boolean);
    const goal          = (extractSection(contextMd, 'Current Goal') || '').split('\n')[0].trim() || null;
    const constraintRaw = extractSection(contextMd, 'Do Not Do') || '';
    const constraints   = parseBullets(constraintRaw);
    const decisionsRaw  = extractSection(contextMd, 'Decisions Made') || '';
    const decisions     = parseDecisionsTable(decisionsRaw);
    const nextStepsRaw  = extractSection(contextMd, 'Next Steps') || '';
    const nextSteps     = parseBullets(nextStepsRaw);
    const blockersRaw   = extractSection(contextMd, 'Blockers') || '';
    const blockers      = parseBullets(blockersRaw).filter(b => b.toLowerCase() !== 'none');
    const leftOffRaw    = extractSection(contextMd, 'Where I Left Off') || '';
    const leftOffParsed = parseLeftOff(leftOffRaw);

    // Build sessions from parsed left-off blocks (may be multiple)
    const sessions = leftOffParsed.map((lo, idx) => ({
      id: idx === leftOffParsed.length - 1 && meta.lastSessionId
        ? meta.lastSessionId.slice(0, 8)
        : shortId(),
      date: lo.date || meta.lastUpdated || today(),
      summary: idx === leftOffParsed.length - 1
        ? (meta.lastSessionSummary || 'Migrated from v1')
        : `Session ${idx + 1} (migrated)`,
      leftOff: lo.leftOff,
      nextSteps: idx === leftOffParsed.length - 1 ? nextSteps : [],
      decisions: idx === leftOffParsed.length - 1 ? decisions : [],
      blockers: idx === leftOffParsed.length - 1 ? blockers : [],
    }));

    const context = {
      version: 2,
      name: contextDir,
      path: meta.path || projectPath,
      description,
      stack,
      goal,
      constraints,
      repo: meta.repo || null,
      createdAt: meta.lastUpdated || today(),
      sessions,
    };

    if (isDryRun) {
      console.log(`    description: ${description?.slice(0, 60) || '(none)'}`);
      console.log(`    stack:       ${stack.join(', ') || '(none)'}`);
      console.log(`    goal:        ${goal?.slice(0, 60) || '(none)'}`);
      console.log(`    sessions:    ${sessions.length}`);
      console.log(`    decisions:   ${decisions.length}`);
      console.log(`    nextSteps:   ${nextSteps.length}`);
      migrated++;
      continue;
    }

    // Backup meta.json
    if (existsSync(metaPath)) {
      renameSync(metaPath, resolve(contextDirPath, 'meta.json.v1-backup'));
    }

    // Write context.json + regenerated CONTEXT.md
    saveContext(contextDir, context);

    // Update projects.json entry
    projects[projectPath].lastUpdated = today();

    console.log(`    ✓ Migrated — ${sessions.length} session(s), ${decisions.length} decision(s)`);
    migrated++;
  } catch (e) {
    console.log(`    ✗ Error: ${e.message}`);
    errors++;
  }
}

if (!isDryRun && migrated > 0) {
  writeProjects(projects);
}

console.log(`\nck migrate: ${migrated} migrated, ${skipped} already v2, ${errors} errors`);
if (isDryRun) console.log('Run without --dry-run to apply.');
if (errors > 0) process.exit(1);
