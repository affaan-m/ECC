#!/usr/bin/env node
/**
 * SessionStart Hook - Load previous context on new session
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs when a new Claude session starts. Loads the most recent session
 * summary into Claude's context via stdout, and reports available
 * sessions and learned skills.
 */

const {
  getSessionsDir,
  getSessionSearchDirs,
  getLearnedSkillsDir,
  getProjectName,
  findFiles,
  ensureDir,
  readFile,
  stripAnsi,
  log
} = require('../lib/utils');
const { resolveProjectContext, writeSessionLease, resolveSessionId, getHomunculusDir } = require('../lib/observer-sessions');
const { getPackageManager, getSelectionPrompt } = require('../lib/package-manager');
const { listAliases } = require('../lib/session-aliases');
const { detectProjectType } = require('../lib/project-detect');
const path = require('path');
const fs = require('fs');

const INSTINCT_CONFIDENCE_THRESHOLD = 0.7;
const MAX_INJECTED_INSTINCTS = 6;
const MAX_INJECTED_LEARNED_SKILLS = 6;
const MAX_LEARNED_SKILL_SUMMARY_CHARS = 220;
const DEFAULT_SESSION_START_CONTEXT_MAX_CHARS = 8000;
const DEFAULT_SESSION_RETENTION_DAYS = 30;
const SESSION_START_MODE_INVALID = 'invalid';
const SESSION_START_MODE_SKIP = 'skip';

/**
 * Resolve a filesystem path to its canonical (real) form.
 *
 * Handles symlinks and, on case-insensitive filesystems (macOS, Windows),
 * normalizes casing so that path comparisons are reliable.
 * Falls back to the original path if resolution fails (e.g. path no longer exists).
 *
 * @param {string} p - The path to normalize.
 * @returns {string} The canonical path, or the original if resolution fails.
 */
function normalizePath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function dedupeRecentSessions(searchDirs) {
  const recentSessionsByName = new Map();

  for (const [dirIndex, dir] of searchDirs.entries()) {
    const matches = findFiles(dir, '*-session.tmp', { maxAge: 7 });

    for (const match of matches) {
      const basename = path.basename(match.path);
      const current = {
        ...match,
        basename,
        dirIndex,
      };
      const existing = recentSessionsByName.get(basename);

      if (
        !existing
        || current.mtime > existing.mtime
        || (current.mtime === existing.mtime && current.dirIndex < existing.dirIndex)
      ) {
        recentSessionsByName.set(basename, current);
      }
    }
  }

  return Array.from(recentSessionsByName.values())
    .sort((left, right) => right.mtime - left.mtime || left.dirIndex - right.dirIndex);
}

/**
 * Resolve session retention days from the ECC_SESSION_RETENTION_DAYS env var.
 *
 * @returns {number|null} The retention window in days, or `null` when the
 *   user has explicitly opted out of pruning. Falsy/garbage values fall back
 *   to {@link DEFAULT_SESSION_RETENTION_DAYS}.
 */
function getSessionRetentionDays() {
  const raw = process.env.ECC_SESSION_RETENTION_DAYS;
  if (!raw) return DEFAULT_SESSION_RETENTION_DAYS;

  const normalized = String(raw).trim().toLowerCase();
  if (['0', 'off', 'false', 'disabled', 'never', 'none'].includes(normalized)) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_RETENTION_DAYS;
}

function isSessionStartContextDisabled() {
  const raw = String(process.env.ECC_SESSION_START_CONTEXT || '').trim().toLowerCase();
  return ['0', 'false', 'off', 'none', 'disabled'].includes(raw);
}

function getSessionStartMaxContextChars() {
  const raw = process.env.ECC_SESSION_START_MAX_CHARS;
  if (!raw) return DEFAULT_SESSION_START_CONTEXT_MAX_CHARS;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_SESSION_START_CONTEXT_MAX_CHARS;
}

function getSessionStartMode(rawInput) {
  const input = String(rawInput || '');
  if (!input.trim()) return null;

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    log(`[SessionStart] Invalid stdin payload; skipping previous session summary injection. Length: ${input.length}`);
    return SESSION_START_MODE_INVALID;
  }

  const supportedModes = new Set(['startup', 'resume', 'clear', 'compact']);
  const hookName = typeof payload.hookName === 'string' ? payload.hookName.trim() : '';
  if (hookName.startsWith('SessionStart:')) {
    const mode = hookName.slice('SessionStart:'.length).trim().toLowerCase();
    return supportedModes.has(mode) ? mode : SESSION_START_MODE_SKIP;
  }

  if (payload.hook_event_name === 'SessionStart') {
    const mode = typeof payload.source === 'string' ? payload.source.trim().toLowerCase() : '';
    return supportedModes.has(mode) ? mode : SESSION_START_MODE_SKIP;
  }

  return SESSION_START_MODE_SKIP;
}

function limitSessionStartContext(additionalContext, maxChars = getSessionStartMaxContextChars()) {
  const context = String(additionalContext || '');

  if (context.length <= maxChars) {
    return context;
  }

  const marker = '\n\n[SessionStart truncated context. Set ECC_SESSION_START_MAX_CHARS to raise the cap or ECC_SESSION_START_CONTEXT=off to disable injected context.]';
  const prefixLength = Math.max(0, maxChars - marker.length);
  log(`[SessionStart] Truncated additional context from ${context.length} to ${maxChars} chars`);

  return `${context.slice(0, prefixLength).trimEnd()}${marker}`.slice(0, maxChars);
}

function pruneExpiredSessions(searchDirs, retentionDays) {
  const uniqueDirs = Array.from(new Set(searchDirs.filter(dir => typeof dir === 'string' && dir.length > 0)));
  let removed = 0;

  for (const dir of uniqueDirs) {
    if (!fs.existsSync(dir)) continue;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('-session.tmp')) continue;

      const fullPath = path.join(dir, entry.name);
      let stats;
      try {
        stats = fs.statSync(fullPath);
      } catch {
        continue;
      }

      const ageInDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
      if (ageInDays <= retentionDays) continue;

      try {
        fs.rmSync(fullPath, { force: true });
        removed += 1;
      } catch (error) {
        log(`[SessionStart] Warning: failed to prune expired session ${fullPath}: ${error.message}`);
      }
    }
  }

  return removed;
}

/**
 * Select the best matching session for the current working directory.
 *
 * Session files written by session-end.js contain header fields like:
 *   **Project:** my-project
 *   **Worktree:** /path/to/project
 *
 * This function reads each session file once, caching its content, and
 * returns both the selected session object and its already-read content
 * to avoid duplicate I/O in the caller.
 *
 * Priority (highest to lowest):
 *   1. Exact worktree (cwd) match — most recent
 *   2. Same project name match for legacy sessions without Worktree metadata
 *   3. No injection when sessions belong to a different worktree/project
 *
 * Sessions are already sorted newest-first, so the first match in each
 * category wins.
 *
 * @param {Array<Object>} sessions - Deduplicated session list, sorted newest-first.
 * @param {string} cwd - Current working directory (process.cwd()).
 * @param {string} currentProject - Current project name from getProjectName().
 * @returns {{ session: Object, content: string, matchReason: string } | null}
 *   The best matching session with its cached content and match reason,
 *   or null if the sessions array is empty or all files are unreadable.
 */
function selectMatchingSession(sessions, cwd, currentProject) {
  if (sessions.length === 0) return null;

  // Normalize cwd once outside the loop to avoid repeated syscalls
  const normalizedCwd = normalizePath(cwd);

  let projectMatch = null;
  let projectMatchContent = null;
  let readableSessions = 0;

  for (const session of sessions) {
    const content = readFile(session.path);
    if (!content) continue;
    readableSessions++;

    // Extract **Worktree:** field
    const worktreeMatch = content.match(/\*\*Worktree:\*\*\s*(.+)$/m);
    const sessionWorktree = worktreeMatch ? worktreeMatch[1].trim() : '';

    // Exact worktree match — best possible, return immediately
    // Normalize both paths to handle symlinks and case-insensitive filesystems
    if (sessionWorktree && normalizePath(sessionWorktree) === normalizedCwd) {
      return { session, content, matchReason: 'worktree' };
    }

    // Project name match is only safe for legacy session files written before
    // Worktree metadata existed. A different explicit Worktree is not a match.
    if (!projectMatch && currentProject && !sessionWorktree) {
      const projectFieldMatch = content.match(/\*\*Project:\*\*\s*(.+)$/m);
      const sessionProject = projectFieldMatch ? projectFieldMatch[1].trim() : '';
      if (sessionProject && sessionProject === currentProject) {
        projectMatch = session;
        projectMatchContent = content;
      }
    }
  }

  if (projectMatch) {
    return { session: projectMatch, content: projectMatchContent, matchReason: 'project' };
  }

  log(readableSessions > 0
    ? '[SessionStart] No worktree/project session match found'
    : '[SessionStart] All session files were unreadable');
  return null;
}

function parseInstinctFile(content) {
  const instincts = [];
  let current = null;
  let inFrontmatter = false;
  let contentLines = [];

  for (const line of String(content).split('\n')) {
    if (line.trim() === '---') {
      if (inFrontmatter) {
        inFrontmatter = false;
      } else {
        if (current && current.id) {
          current.content = contentLines.join('\n').trim();
          instincts.push(current);
        }
        current = {};
        contentLines = [];
        inFrontmatter = true;
      }
      continue;
    }

    if (inFrontmatter) {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) continue;
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key === 'confidence') {
        const parsed = Number.parseFloat(value);
        current[key] = Number.isFinite(parsed) ? parsed : 0.5;
      } else {
        current[key] = value;
      }
    } else if (current) {
      contentLines.push(line);
    }
  }

  if (current && current.id) {
    current.content = contentLines.join('\n').trim();
    instincts.push(current);
  }

  return instincts;
}

function readInstinctsFromDir(directory, scope) {
  if (!directory || !fs.existsSync(directory)) return [];

  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(ya?ml|md)$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  const instincts = [];
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    try {
      const parsed = parseInstinctFile(fs.readFileSync(filePath, 'utf8'));
      for (const instinct of parsed) {
        instincts.push({
          ...instinct,
          _scopeLabel: scope,
          _sourceFile: filePath,
        });
      }
    } catch (error) {
      log(`[SessionStart] Warning: failed to parse instinct file ${filePath}: ${error.message}`);
    }
  }

  return instincts;
}

function extractInstinctAction(content) {
  const actionMatch = String(content || '').match(/## Action\s*\n+([\s\S]+?)(?:\n## |\n---|$)/);
  const actionBlock = (actionMatch ? actionMatch[1] : String(content || '')).trim();
  const firstLine = actionBlock
    .split('\n')
    .map(line => line.trim())
    .find(Boolean);

  return firstLine || '';
}

function summarizeActiveInstincts(observerContext) {
  const homunculusDir = getHomunculusDir();
  const globalDirs = [
    { dir: path.join(homunculusDir, 'instincts', 'personal'), scope: 'global' },
    { dir: path.join(homunculusDir, 'instincts', 'inherited'), scope: 'global' },
  ];
  const projectDirs = observerContext.isGlobal ? [] : [
    { dir: path.join(observerContext.projectDir, 'instincts', 'personal'), scope: 'project' },
    { dir: path.join(observerContext.projectDir, 'instincts', 'inherited'), scope: 'project' },
  ];

  const scopedInstincts = [
    ...projectDirs.flatMap(({ dir, scope }) => readInstinctsFromDir(dir, scope)),
    ...globalDirs.flatMap(({ dir, scope }) => readInstinctsFromDir(dir, scope)),
  ];

  const deduped = new Map();
  for (const instinct of scopedInstincts) {
    if (!instinct.id || instinct.confidence < INSTINCT_CONFIDENCE_THRESHOLD) continue;
    const existing = deduped.get(instinct.id);
    if (!existing || (existing._scopeLabel !== 'project' && instinct._scopeLabel === 'project')) {
      deduped.set(instinct.id, instinct);
    }
  }

  const ranked = Array.from(deduped.values())
    .map(instinct => ({
      ...instinct,
      action: extractInstinctAction(instinct.content),
    }))
    .filter(instinct => instinct.action)
    .sort((left, right) => {
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      if (left._scopeLabel !== right._scopeLabel) return left._scopeLabel === 'project' ? -1 : 1;
      return String(left.id).localeCompare(String(right.id));
    })
    .slice(0, MAX_INJECTED_INSTINCTS);

  if (ranked.length === 0) {
    return '';
  }

  log(`[SessionStart] Injecting ${ranked.length} instinct(s) into session context`);

  const lines = ranked.map(instinct => {
    const scope = instinct._scopeLabel === 'project' ? 'project' : 'global';
    const confidence = `${Math.round(instinct.confidence * 100)}%`;
    return `- [${scope} ${confidence}] ${instinct.action}`;
  });

  return `Active instincts:\n${lines.join('\n')}`;
}

function stripMarkdownInline(value) {
  return String(value || '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateSummary(value, maxLength = MAX_LEARNED_SKILL_SUMMARY_CHARS) {
  const normalized = collapseWhitespace(stripMarkdownInline(value));
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function extractMarkdownHeading(content) {
  const match = String(content || '').match(/^#\s+(.+)$/m);
  return match ? stripMarkdownInline(match[1]) : '';
}

function extractSection(content, headingPattern) {
  const source = String(content || '');
  const match = source.match(new RegExp(`^##\\s+${headingPattern}\\s*\\n+([\\s\\S]+?)(?:\\n##\\s+|$)`, 'im'));
  return match ? match[1].trim() : '';
}

function extractFirstParagraph(content) {
  const withoutHeading = String(content || '').replace(/^#\s+.+$/m, '').trim();
  return withoutHeading
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .find(Boolean) || '';
}

function summarizeLearnedSkillFile(filePath, learnedRoot) {
  const content = readFile(filePath);
  if (!content) return null;

  const isDirectorySkill = path.basename(filePath).toLowerCase() === 'skill.md';
  const slug = isDirectorySkill
    ? path.basename(path.dirname(filePath))
    : path.basename(filePath, path.extname(filePath));
  const title = extractMarkdownHeading(content) || slug;
  const summary = truncateSummary(
    extractSection(content, 'When to Use')
      || extractSection(content, 'Trigger')
      || extractSection(content, 'Problem')
      || extractFirstParagraph(content)
      || title
  );

  if (!summary) return null;

  let mtime = 0;
  try {
    mtime = fs.statSync(filePath).mtimeMs;
  } catch {
    // Keep unreadable/deleted files out of recency priority without failing the hook.
  }

  const relativePath = path.relative(learnedRoot, filePath);
  return {
    slug,
    title: truncateSummary(title, 80),
    summary,
    relativePath,
    mtime,
  };
}

function collectLearnedSkillFiles(learnedDir) {
  const flatMarkdownFiles = findFiles(learnedDir, '*.md');
  const directorySkillFiles = findFiles(learnedDir, 'SKILL.md', { recursive: true });
  const byPath = new Map();

  for (const match of [...flatMarkdownFiles, ...directorySkillFiles]) {
    byPath.set(match.path, match);
  }

  return Array.from(byPath.values())
    .sort((left, right) => right.mtime - left.mtime || left.path.localeCompare(right.path));
}

function summarizeLearnedSkills(learnedDir, learnedSkillFiles = collectLearnedSkillFiles(learnedDir)) {
  const summaries = learnedSkillFiles
    .map(match => summarizeLearnedSkillFile(match.path, learnedDir))
    .filter(Boolean)
    .slice(0, MAX_INJECTED_LEARNED_SKILLS);

  if (summaries.length === 0) {
    return '';
  }

  log(`[SessionStart] Injecting ${summaries.length} learned skill(s) into session context`);

  const lines = summaries.map(skill => {
    const titleSuffix = skill.title && skill.title !== skill.slug ? ` (${skill.title})` : '';
    return `- ${skill.slug}${titleSuffix}: ${skill.summary}`;
  });

  return [
    'Available learned skills:',
    'Reference only; apply a learned skill only when it is relevant to the current user request.',
    ...lines,
  ].join('\n');
}

async function main() {
  const sessionsDir = getSessionsDir();
  const sessionSearchDirs = getSessionSearchDirs();
  const learnedDir = getLearnedSkillsDir();
  const additionalContextParts = [];
  const observerContext = resolveProjectContext();
  const maxContextChars = getSessionStartMaxContextChars();
  const explicitContextDisabled = isSessionStartContextDisabled();
  const shouldInjectContext = !explicitContextDisabled && maxContextChars !== 0;
  const sessionStartMode = getSessionStartMode(fs.readFileSync(0, 'utf8'));

  // Ensure directories exist
  ensureDir(sessionsDir);
  ensureDir(learnedDir);

  const retentionDays = getSessionRetentionDays();
  if (retentionDays === null) {
    log('[SessionStart] Pruning disabled via ECC_SESSION_RETENTION_DAYS');
  } else {
    const prunedSessions = pruneExpiredSessions(sessionSearchDirs, retentionDays);
    if (prunedSessions > 0) {
      log(`[SessionStart] Pruned ${prunedSessions} expired session(s) older than ${retentionDays} day(s)`);
    }
  }

  const observerSessionId = resolveSessionId();
  if (observerSessionId) {
    writeSessionLease(observerContext, observerSessionId, {
      hook: 'SessionStart',
      projectRoot: observerContext.projectRoot
    });
    log(`[SessionStart] Registered observer lease for ${observerSessionId}`);
  } else {
    log('[SessionStart] No CLAUDE_SESSION_ID available; skipping observer lease registration');
  }

  if (explicitContextDisabled) {
    log('[SessionStart] Additional context injection disabled by ECC_SESSION_START_CONTEXT');
  } else if (maxContextChars === 0) {
    log('[SessionStart] Additional context injection disabled by ECC_SESSION_START_MAX_CHARS=0');
  }

  if (shouldInjectContext) {
    const instinctSummary = summarizeActiveInstincts(observerContext);
    if (instinctSummary) {
      additionalContextParts.push(instinctSummary);
    }

    if (sessionStartMode && sessionStartMode !== 'startup') {
      const reason = sessionStartMode === SESSION_START_MODE_INVALID
        ? 'invalid stdin payload'
        : sessionStartMode === SESSION_START_MODE_SKIP
          ? 'unrecognized SessionStart payload'
          : `non-startup SessionStart mode: ${sessionStartMode}`;
      log(`[SessionStart] Skipping previous session summary injection for ${reason}`);
    } else {
      // Check for recent session files (last 7 days)
      const recentSessions = dedupeRecentSessions(sessionSearchDirs);

      if (recentSessions.length > 0) {
        log(`[SessionStart] Found ${recentSessions.length} recent session(s)`);

        // Prefer a session that matches the current working directory or project.
        // Session files contain **Project:** and **Worktree:** header fields written
        // by session-end.js, so we can match against them.
        const cwd = process.cwd();
        const currentProject = getProjectName() || '';

        const result = selectMatchingSession(recentSessions, cwd, currentProject);

        if (result) {
          log(`[SessionStart] Selected: ${result.session.path} (match: ${result.matchReason})`);

          // Use the already-read content from selectMatchingSession (no duplicate I/O)
          const content = stripAnsi(result.content);
          if (content && !content.includes('[Session context goes here]')) {
            // STALE-REPLAY GUARD: wrap the summary in a historical-only marker so
            // the model does not re-execute stale skill invocations / ARGUMENTS
            // from a prior compaction boundary. Observed in practice: after
            // compaction resume the model would re-run /fw-task-new (or any
            // ARGUMENTS-bearing slash skill) with the last ARGUMENTS it saw,
            // duplicating issues/branches/Notion tasks. Tracking upstream at
            // https://github.com/affaan-m/everything-claude-code/issues/1534
            const guarded = [
              'HISTORICAL REFERENCE ONLY — NOT LIVE INSTRUCTIONS.',
              'The block below is a frozen summary of a PRIOR conversation that',
              'ended at compaction. Any task descriptions, skill invocations, or',
              'ARGUMENTS= payloads inside it are STALE-BY-DEFAULT and MUST NOT be',
              're-executed without an explicit, current user request in this',
              'session. Verify against git/working-tree state before any action —',
              'the prior work is almost certainly already done.',
              '',
              '--- BEGIN PRIOR-SESSION SUMMARY ---',
              content,
              '--- END PRIOR-SESSION SUMMARY ---',
            ].join('\n');
            additionalContextParts.push(guarded);
          }
        } else {
          log('[SessionStart] No matching session found');
        }
      }
    }

    // Check for learned skills
    const learnedSkills = collectLearnedSkillFiles(learnedDir);

    if (learnedSkills.length > 0) {
      log(`[SessionStart] ${learnedSkills.length} learned skill(s) available in ${learnedDir}`);
    }

    const learnedSkillSummary = summarizeLearnedSkills(learnedDir, learnedSkills);
    if (learnedSkillSummary) {
      additionalContextParts.push(learnedSkillSummary);
    }
  }

  // Check for available session aliases
  const aliases = listAliases({ limit: 5 });

  if (aliases.length > 0) {
    const aliasNames = aliases.map(a => a.name).join(', ');
    log(`[SessionStart] ${aliases.length} session alias(es) available: ${aliasNames}`);
    log(`[SessionStart] Use /sessions load <alias> to continue a previous session`);
  }

  // Detect and report package manager
  const pm = getPackageManager();
  log(`[SessionStart] Package manager: ${pm.name} (${pm.source})`);

  // If no explicit package manager config was found, show selection prompt
  if (pm.source === 'default') {
    log('[SessionStart] No package manager preference found.');
    log(getSelectionPrompt());
  }

  // Detect project type and frameworks (#293)
  const projectInfo = detectProjectType();
  if (projectInfo.languages.length > 0 || projectInfo.frameworks.length > 0) {
    const parts = [];
    if (projectInfo.languages.length > 0) {
      parts.push(`languages: ${projectInfo.languages.join(', ')}`);
    }
    if (projectInfo.frameworks.length > 0) {
      parts.push(`frameworks: ${projectInfo.frameworks.join(', ')}`);
    }
    log(`[SessionStart] Project detected — ${parts.join('; ')}`);
    if (shouldInjectContext) {
      additionalContextParts.push(`Project type: ${JSON.stringify(projectInfo)}`);
    }
  } else {
    log('[SessionStart] No specific project type detected');
  }

  const additionalContext = shouldInjectContext
    ? limitSessionStartContext(additionalContextParts.join('\n\n'), maxContextChars)
    : '';
  await writeSessionStartPayload(additionalContext);
}

function writeSessionStartPayload(additionalContext) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const payload = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext
      }
    });

    const handleError = (err) => {
      if (settled) return;
      settled = true;
      if (err) {
        log(`[SessionStart] stdout write error: ${err.message}`);
      }
      reject(err || new Error('stdout stream error'));
    };

    process.stdout.once('error', handleError);
    process.stdout.write(payload, (err) => {
      process.stdout.removeListener('error', handleError);
      if (settled) return;
      settled = true;
      if (err) {
        log(`[SessionStart] stdout write error: ${err.message}`);
        reject(err);
        return;
      }
      resolve();
    });
  });
}

main().catch(err => {
  console.error('[SessionStart] Error:', err.message);
  process.exitCode = 0; // Don't block on errors
});
