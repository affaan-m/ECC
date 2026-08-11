#!/usr/bin/env node
/**
 * PreCompact Hook - Save LLM-generated summary before context compaction
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs before Claude compacts context. Generates a rich LLM summary of the
 * current session and writes it to the active session .tmp file so that the
 * next session start gets a high-quality summary even after lossy compaction.
 *
 * Falls back to a plain log entry when transcript_path is unavailable or the
 * LLM call fails.
 */

const path = require('path');
const fs = require('fs');
const { getSessionsDir, getDateTimeString, getTimeString, findFiles, ensureDir, appendFile, readFile, writeFile, getProjectName, log } = require('../lib/utils');
const { generateSessionSummary } = require('../lib/llm-summary');

const SUMMARY_START_MARKER = '<!-- ECC:SUMMARY:START -->';
const SUMMARY_END_MARKER = '<!-- ECC:SUMMARY:END -->';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Canonicalize a path (resolve symlinks); fall back to the input on failure.
 * Mirrors session-start.js#normalizePath so worktree comparisons agree.
 */
function normalizePath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Pick the session file that belongs to the CURRENT worktree.
 *
 * The sessions dir is shared across every project/worktree, so the newest
 * `*-session.tmp` is frequently a DIFFERENT project's session. Matching by
 * mtime (`sessions[0]`) therefore writes the compaction summary into the wrong
 * project. Match on the `**Worktree:**` header (written by session-end.js)
 * against cwd, mirroring session-start.js#selectMatchingSession:
 *   1. exact worktree (cwd) match — newest wins
 *   2. truly legacy sessions with NO Worktree header: same **Project:** name
 *   3. otherwise null — do NOT annotate a foreign worktree's session
 * A present-but-blank Worktree header counts as non-legacy (never a project
 * fallback), so a foreign session is not matched by name.
 *
 * @param {Array<{path: string}>} sessions - newest-first session list
 * @param {string} cwd
 * @param {string} currentProject
 * @param {(p: string) => (string|null)} [readFn]
 * @returns {string|null} path of the chosen session, or null if none match
 */
function selectActiveSessionPath(sessions, cwd, currentProject, readFn = readFile) {
  if (!sessions || sessions.length === 0) return null;
  const normalizedCwd = normalizePath(cwd);
  let projectMatch = null;

  for (const session of sessions) {
    const content = readFn(session.path);
    if (!content) continue;

    // (.*) not (.+): an explicit but empty header (`**Worktree:**` / `**Worktree:**\n`)
    // must still register as present (hasWorktreeHeader) so it does not fall back
    // to project-name matching against a foreign session.
    const worktreeMatch = content.match(/\*\*Worktree:\*\*\s*(.*)$/m);
    const hasWorktreeHeader = Boolean(worktreeMatch);
    const sessionWorktree = worktreeMatch ? worktreeMatch[1].trim() : '';

    if (sessionWorktree && normalizePath(sessionWorktree) === normalizedCwd) {
      return session.path;
    }

    // Project-name fallback only for truly legacy sessions with NO Worktree
    // header at all — a present-but-blank header is not treated as legacy.
    if (!projectMatch && currentProject && !hasWorktreeHeader) {
      const projectFieldMatch = content.match(/\*\*Project:\*\*\s*(.+)$/m);
      const sessionProject = projectFieldMatch ? projectFieldMatch[1].trim() : '';
      if (sessionProject && sessionProject === currentProject) {
        projectMatch = session.path;
      }
    }
  }

  return projectMatch;
}

const MAX_STDIN = 1024 * 1024;
let stdinData = '';

if (require.main === module) {
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', chunk => {
    if (stdinData.length < MAX_STDIN) {
      stdinData += chunk.substring(0, MAX_STDIN - stdinData.length);
    }
  });

  process.stdin.on('end', () => {
    main().catch(err => {
      log(`[PreCompact] Error: ${err.message}`);
      process.exit(0);
    });
  });
}

async function main() {
  let transcriptPath = null;
  try {
    const input = JSON.parse(stdinData);
    if (input && typeof input.transcript_path === 'string' && input.transcript_path.length > 0) {
      transcriptPath = input.transcript_path;
    }
  } catch {
    // stdin not JSON or missing — proceed without transcript
  }

  const sessionsDir = getSessionsDir();
  const compactionLog = path.join(sessionsDir, 'compaction-log.txt');

  ensureDir(sessionsDir);

  const timestamp = getDateTimeString();
  appendFile(compactionLog, `[${timestamp}] Context compaction triggered\n`);

  const sessions = findFiles(sessionsDir, '*-session.tmp');
  if (sessions.length === 0) {
    log('[PreCompact] No active session file found');
    process.exit(0);
  }

  // Select the session for THIS worktree, not merely the newest across all
  // projects (the sessions dir is shared). Skip when none matches rather than
  // writing the summary into a foreign project's session file.
  const activeSession = selectActiveSessionPath(sessions, process.cwd(), getProjectName());
  if (!activeSession) {
    log('[PreCompact] No session matches the current worktree; skipping annotation');
    process.exit(0);
  }
  const timeStr = getTimeString();

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    appendFile(activeSession, `\n---\n**[Compaction occurred at ${timeStr}]** - Context was summarized\n`);
    log('[PreCompact] No transcript available; logged compaction event only');
    process.exit(0);
  }

  // Generate LLM summary right before compaction — most critical timing
  log('[PreCompact] Generating LLM summary before compaction...');
  const llmSummary = generateSessionSummary(transcriptPath);

  if (!llmSummary) {
    appendFile(activeSession, `\n---\n**[Compaction occurred at ${timeStr}]** - Context was summarized\n`);
    log('[PreCompact] LLM summary unavailable; logged compaction event only');
    process.exit(0);
  }

  const existing = readFile(activeSession);
  if (existing && existing.includes(SUMMARY_START_MARKER) && existing.includes(SUMMARY_END_MARKER)) {
    const newBlock = `${SUMMARY_START_MARKER}\n${llmSummary}\n<!-- LLM_SUMMARY:pre-compact:${timeStr} -->\n${SUMMARY_END_MARKER}`;
    const updated = existing.replace(new RegExp(`${escapeRegExp(SUMMARY_START_MARKER)}[\\s\\S]*?${escapeRegExp(SUMMARY_END_MARKER)}`), () => newBlock);
    writeFile(activeSession, updated);
    log('[PreCompact] LLM summary written to session file before compaction');
  } else {
    appendFile(activeSession, `\n---\n**[Compaction at ${timeStr}]**\n\n${llmSummary}\n`);
    log('[PreCompact] LLM summary appended (no summary markers found)');
  }

  process.exit(0);
}

module.exports = { selectActiveSessionPath, normalizePath };
