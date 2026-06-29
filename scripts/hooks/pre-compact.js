#!/usr/bin/env node
/**
 * PreCompact Hook - Save state before context compaction
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs before Claude compacts context, giving you a chance to
 * preserve important state that might get lost in summarization.
 */

const path = require('path');
const fs = require('fs');
const {
  getSessionsDir,
  getDateTimeString,
  getTimeString,
  findFiles,
  ensureDir,
  appendFile,
  readFile,
  getProjectName,
  log
} = require('../lib/utils');

/**
 * Canonicalize a path (resolve symlinks); fall back to the input on failure.
 * Mirrors session-start.js#normalizePath so worktree comparisons agree.
 * @param {string} p
 * @returns {string}
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
 * `*-session.tmp` is frequently a DIFFERENT project's session. Previously this
 * hook blindly annotated sessions[0] (newest by mtime), so a compaction in
 * project A could append its marker to project B's session file. Match on the
 * `**Worktree:**` header (written by session-end.js) against cwd, mirroring
 * session-start.js#selectMatchingSession:
 *   1. exact worktree (cwd) match — newest wins
 *   2. legacy sessions without Worktree metadata: same **Project:** name
 *   3. otherwise null — do NOT touch a foreign worktree's session
 * (The global compaction-log.txt still records every event regardless.)
 *
 * @param {Array<{path: string}>} sessions - newest-first session list
 * @param {string} cwd
 * @param {string} currentProject
 * @param {(p: string) => (string|null)} [readFn]
 * @returns {string|null} path of the chosen session file, or null if none match
 */
function selectActiveSessionPath(sessions, cwd, currentProject, readFn = readFile) {
  if (!sessions || sessions.length === 0) return null;
  const normalizedCwd = normalizePath(cwd);
  let projectMatch = null;

  for (const session of sessions) {
    const content = readFn(session.path);
    if (!content) continue;

    const worktreeMatch = content.match(/\*\*Worktree:\*\*\s*(.+)$/m);
    const sessionWorktree = worktreeMatch ? worktreeMatch[1].trim() : '';

    // Exact worktree match — best possible, return immediately.
    if (sessionWorktree && normalizePath(sessionWorktree) === normalizedCwd) {
      return session.path;
    }

    // Project-name match only for legacy sessions written before Worktree
    // metadata existed; an explicit, non-matching Worktree is never a match.
    if (!projectMatch && currentProject && !sessionWorktree) {
      const projectFieldMatch = content.match(/\*\*Project:\*\*\s*(.+)$/m);
      const sessionProject = projectFieldMatch ? projectFieldMatch[1].trim() : '';
      if (sessionProject && sessionProject === currentProject) {
        projectMatch = session.path;
      }
    }
  }

  return projectMatch;
}

async function main() {
  const sessionsDir = getSessionsDir();
  const compactionLog = path.join(sessionsDir, 'compaction-log.txt');

  ensureDir(sessionsDir);

  // Log compaction event with timestamp (always, regardless of session match)
  const timestamp = getDateTimeString();
  appendFile(compactionLog, `[${timestamp}] Context compaction triggered\n`);

  // Annotate the current worktree's session file (not whichever happens to be
  // newest across all projects).
  const sessions = findFiles(sessionsDir, '*-session.tmp');
  const activeSession = selectActiveSessionPath(sessions, process.cwd(), getProjectName());

  if (activeSession) {
    const timeStr = getTimeString();
    appendFile(activeSession, `\n---\n**[Compaction occurred at ${timeStr}]** - Context was summarized\n`);
  }

  log('[PreCompact] State saved before compaction');
  process.exit(0);
}

module.exports = { selectActiveSessionPath, normalizePath };

if (require.main === module) {
  main().catch(err => {
    console.error('[PreCompact] Error:', err.message);
    process.exit(0);
  });
}
