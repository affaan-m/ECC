#!/usr/bin/env node
/**
 * Stop Hook (Session End) - Persist learnings during active sessions
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs on Stop events (after each response). Extracts a meaningful summary
 * from the session transcript (via stdin JSON transcript_path) and updates a
 * session file for cross-session continuity.
 */

const path = require('path');
const fs = require('fs');
const { getSessionsDir, getDateString, getTimeString, getSessionIdShort, sanitizeSessionId, getProjectName, getRepoIdentity, ensureDir, readFile, writeFile, runCommand, stripAnsi, log } = require('../lib/utils');
const { generateSessionSummary, getContextRemainingPct, getContextThreshold } = require('../lib/llm-summary');

const SUMMARY_START_MARKER = '<!-- ECC:SUMMARY:START -->';
const SUMMARY_END_MARKER = '<!-- ECC:SUMMARY:END -->';
const SESSION_SEPARATOR = '\n---\n';

// Harness noise: local command echoes, caveats, system reminders.
const HARNESS_NOISE = /^<(local-command-caveat|local-command-stdout|command-name|command-message|command-args|system-reminder|task-notification)/i;
const TRANSCRIPT_UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const NEXT_SESSION_FOOTER = '\n\n### Notes for Next Session\n-\n\n### Context to Load\n```\n[relevant files]\n```';
const EMPTY_SESSION_BODY = '## Current State\n\n[Session context goes here]\n\n### Completed\n- [ ]\n\n### In Progress\n- [ ]\n\n### Notes for Next Session\n-\n\n### Context to Load\n```\n[relevant files]\n```';

/**
 * Text of a user turn, or '' when the entry is not a user ask worth keeping.
 */
function userMessageText(entry) {
  if (entry.type !== 'user' && entry.role !== 'user' && entry.message?.role !== 'user') return '';
  // Support both direct content and nested message.content (Claude Code JSONL format)
  const rawContent = entry.message?.content ?? entry.content;
  // Skip tool_result carrier turns — they are not user asks.
  if (Array.isArray(rawContent) && rawContent.some(c => c && c.type === 'tool_result')) return '';
  const text = typeof rawContent === 'string' ? rawContent : Array.isArray(rawContent) ? rawContent.map(c => (c && c.text) || '').join(' ') : '';
  const cleaned = stripAnsi(text).trim();
  // `isMeta` is also used for genuine channel- and plugin-originated
  // human prompts. Exclude known structured noise instead of
  // discarding every metadata-marked user turn.
  return HARNESS_NOISE.test(cleaned) ? '' : cleaned;
}

/**
 * Record one tool invocation: its name, and its target when it edits a file.
 */
function recordToolUse(toolName, filePath, tally) {
  if (toolName) tally.toolsUsed.add(toolName);
  if (filePath && (toolName === 'Edit' || toolName === 'Write')) {
    tally.filesModified.add(filePath);
  }
}

/**
 * Fold one transcript entry into the running tally.
 */
function collectEntry(entry, tally) {
  // Collect user messages (first 200 chars each)
  const text = userMessageText(entry);
  if (text) tally.userMessages.push(text.slice(0, 200));

  // Collect tool names and modified files (direct tool_use entries)
  if (entry.type === 'tool_use' || entry.tool_name) {
    const toolName = entry.tool_name || entry.name || '';
    recordToolUse(toolName, entry.tool_input?.file_path || entry.input?.file_path || '', tally);
  }

  // Extract tool uses from assistant message content blocks (Claude Code JSONL format)
  if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
    for (const block of entry.message.content) {
      if (block.type === 'tool_use') recordToolUse(block.name || '', block.input?.file_path || '', tally);
    }
  }
}

/**
 * Extract a meaningful summary from the session transcript.
 * Reads the JSONL transcript and pulls out key information:
 * - User messages (tasks requested)
 * - Tools used
 * - Files modified
 */
function extractSessionSummary(transcriptPath) {
  const content = readFile(transcriptPath);
  if (!content) return null;

  const lines = content.split('\n').filter(Boolean);
  const tally = { userMessages: [], toolsUsed: new Set(), filesModified: new Set() };
  let parseErrors = 0;

  for (const line of lines) {
    try {
      collectEntry(JSON.parse(line), tally);
    } catch {
      parseErrors++;
    }
  }

  if (parseErrors > 0) {
    log(`[SessionEnd] Skipped ${parseErrors}/${lines.length} unparseable transcript lines`);
  }

  if (tally.userMessages.length === 0) return null;

  return {
    userMessages: tally.userMessages.slice(-10), // Last 10 user messages
    toolsUsed: Array.from(tally.toolsUsed).slice(0, 20),
    filesModified: Array.from(tally.filesModified).slice(0, 30),
    totalMessages: tally.userMessages.length
  };
}

// Read hook input from stdin (Claude Code provides transcript_path via stdin JSON)
const MAX_STDIN = 1024 * 1024;
let stdinData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  if (stdinData.length < MAX_STDIN) {
    const remaining = MAX_STDIN - stdinData.length;
    stdinData += chunk.substring(0, remaining);
  }
});

process.stdin.on('end', () => {
  runMain();
});

function runMain() {
  main().catch(err => {
    console.error('[SessionEnd] Error:', err.message);
    process.exit(0);
  });
}

function getSessionMetadata() {
  const branchResult = runCommand('git rev-parse --abbrev-ref HEAD');

  return {
    project: getProjectName() || 'unknown',
    branch: branchResult.success ? branchResult.output : 'unknown',
    worktree: process.cwd(),
    repo: getRepoIdentity()
  };
}

function extractHeaderField(header, label) {
  const match = header.match(new RegExp(`\\*\\*${escapeRegExp(label)}:\\*\\*\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

function buildSessionHeader(today, currentTime, metadata, existingContent = '') {
  const headingMatch = existingContent.match(/^#\s+.+$/m);
  const heading = headingMatch ? headingMatch[0] : `# Session: ${today}`;
  const date = extractHeaderField(existingContent, 'Date') || today;
  const started = extractHeaderField(existingContent, 'Started') || currentTime;

  const lines = [
    heading,
    `**Date:** ${date}`,
    `**Started:** ${started}`,
    `**Last Updated:** ${currentTime}`,
    `**Project:** ${metadata.project}`,
    `**Branch:** ${metadata.branch}`,
    `**Worktree:** ${metadata.worktree}`
  ];
  if (metadata.repo) {
    lines.push(`**Repo:** ${metadata.repo}`);
  }
  lines.push('');
  return lines.join('\n');
}

function mergeSessionHeader(content, today, currentTime, metadata) {
  const separatorIndex = content.indexOf(SESSION_SEPARATOR);
  if (separatorIndex === -1) {
    return null;
  }

  const existingHeader = content.slice(0, separatorIndex);
  const body = content.slice(separatorIndex + SESSION_SEPARATOR.length);
  const nextHeader = buildSessionHeader(today, currentTime, metadata, existingHeader);
  return `${nextHeader}${SESSION_SEPARATOR}${body}`;
}

/**
 * Parse stdin JSON to get transcript_path; fall back to env var on missing,
 * empty, or non-string values as well as on malformed JSON.
 */
function resolveTranscriptPath() {
  try {
    const input = JSON.parse(stdinData);
    if (input && typeof input.transcript_path === 'string' && input.transcript_path.length > 0) {
      return input.transcript_path;
    }
  } catch {
    // Malformed stdin: fall through to the env-var fallback below.
  }
  const envTranscriptPath = process.env.CLAUDE_TRANSCRIPT_PATH;
  return typeof envTranscriptPath === 'string' && envTranscriptPath.length > 0 ? envTranscriptPath : null;
}

/**
 * Derive shortId from transcript_path UUID when available, using the SAME
 * last-8-chars convention as getSessionIdShort(sessionId.slice(-8)). This keeps
 * backward compatibility for normal sessions (the derived shortId matches what
 * getSessionIdShort() would have produced from the same UUID), while making
 * every session map to a unique filename based on its own transcript UUID.
 *
 * Without this, a parent session and any `claude -p ...` subprocess spawned by
 * another Stop hook share the project-name fallback filename, and the subprocess
 * overwrites the parent's summary. See issue #1494 for full repro details.
 */
function sessionShortId(transcriptPath) {
  const m = transcriptPath ? path.basename(transcriptPath).match(TRANSCRIPT_UUID) : null;
  // Run through sanitizeSessionId() for byte-for-byte parity with
  // getSessionIdShort(sessionId.slice(-8)).
  const derived = m ? sanitizeSessionId(m[1].slice(-8).toLowerCase()) : null;
  return derived || getSessionIdShort();
}

/**
 * Decide whether to call LLM for a richer summary.
 * Triggers: summary budget remaining < 20%, or every 50 user messages as a baseline.
 */
function maybeGenerateLlmSummary(transcriptPath, summary) {
  const contextPct = getContextRemainingPct(transcriptPath);
  const isContextLow = contextPct !== null && contextPct < getContextThreshold();
  const interval = parseInt(process.env.ECC_LLM_SUMMARY_INTERVAL || '50', 10);
  const safeInterval = Number.isFinite(interval) && interval > 0 ? interval : 50;
  const isPeriodicTurn = summary.totalMessages > 0 && summary.totalMessages % safeInterval === 0;
  if (!isContextLow && !isPeriodicTurn) return null;

  log(`[SessionEnd] LLM summary triggered (summary budget: ${contextPct ?? 'unknown'}%, messages: ${summary.totalMessages})`);
  let skipped = false;
  const llmSummary = generateSessionSummary(transcriptPath, {
    onSkip: reason => {
      skipped = true;
      log(`[SessionEnd] LLM summary skipped (${reason}); falling back to mechanical extraction`);
    }
  });
  if (llmSummary) {
    log('[SessionEnd] LLM summary generated successfully');
  } else if (!skipped) {
    log('[SessionEnd] LLM summary failed; falling back to mechanical extraction');
  }
  return llmSummary;
}

function summaryBlockFor(summary, llmSummary) {
  return llmSummary ? `${SUMMARY_START_MARKER}\n${llmSummary}\n${SUMMARY_END_MARKER}` : buildSummaryBlock(summary);
}

/**
 * Replace only the generated summary block. This keeps repeated Stop
 * invocations idempotent and preserves user-authored sections in the same
 * session file.
 */
function replaceSummaryBlock(content, summaryBlock) {
  // Use function replacers: summaryBlock embeds raw user-message text, and a
  // string replacement argument interprets $-sequences ($&, $$, $`, $', $n).
  // A $& in a user message would otherwise re-inject the entire matched block
  // and corrupt the persisted summary. A function replacer is treated literally.
  if (content.includes(SUMMARY_START_MARKER) && content.includes(SUMMARY_END_MARKER)) {
    return content.replace(new RegExp(`${escapeRegExp(SUMMARY_START_MARKER)}[\\s\\S]*?${escapeRegExp(SUMMARY_END_MARKER)}`), () => summaryBlock);
  }
  // Migration path for files created before summary markers existed.
  return content.replace(
    /## (?:Session Summary|Current State)[\s\S]*?$/,
    () => `${summaryBlock}${NEXT_SESSION_FOOTER}\n`
  );
}

function updateSessionFile(sessionFile, { today, currentTime, metadata, summary, llmSummary }) {
  const existing = readFile(sessionFile);
  let updatedContent = existing;

  if (existing) {
    const merged = mergeSessionHeader(existing, today, currentTime, metadata);
    if (merged) {
      updatedContent = merged;
    } else {
      log(`[SessionEnd] Failed to normalize header in ${sessionFile}`);
    }
  }

  if (summary && updatedContent) {
    updatedContent = replaceSummaryBlock(updatedContent, summaryBlockFor(summary, llmSummary));
  }

  if (updatedContent) {
    writeFile(sessionFile, updatedContent);
  }

  log(`[SessionEnd] Updated session file: ${sessionFile}`);
}

function createSessionFile(sessionFile, { today, currentTime, metadata, summary, llmSummary }) {
  const block = llmSummary || summary ? summaryBlockFor(summary, llmSummary) : null;
  const summarySection = block ? `${block}${NEXT_SESSION_FOOTER}` : EMPTY_SESSION_BODY;
  const template = `${buildSessionHeader(today, currentTime, metadata)}${SESSION_SEPARATOR}${summarySection}\n`;

  writeFile(sessionFile, template);
  log(`[SessionEnd] Created session file: ${sessionFile}`);
}

async function main() {
  const transcriptPath = resolveTranscriptPath();

  // ECC's LLM summary helper launches a one-shot Claude subprocess whose Stop
  // hooks inherit this dedicated marker. Skip that known internal session
  // before touching session state. Transcript cardinality is not a safe proxy:
  // an ordinary user session may legitimately contain one prompt and no tools.
  if (process.env.ECC_LLM_SUMMARY_SUBPROCESS === '1') {
    log('[SessionEnd] Skipped ECC LLM summary subprocess');
    return;
  }

  // Read known transcripts before resolving session metadata or touching the
  // session directory. Missing, unreadable, or unparseable transcript data keeps
  // the established fallback behavior because it cannot be classified reliably.
  let summary = null;
  let transcriptExists = false;
  if (transcriptPath) {
    transcriptExists = fs.existsSync(transcriptPath);
    if (transcriptExists) {
      summary = extractSessionSummary(transcriptPath);
    } else {
      log(`[SessionEnd] Transcript not found: ${transcriptPath}`);
    }
  }

  const sessionsDir = getSessionsDir();
  const today = getDateString();
  const shortId = sessionShortId(transcriptPath);
  const sessionFile = path.join(sessionsDir, `${today}-${shortId}-session.tmp`);
  const metadata = getSessionMetadata();

  ensureDir(sessionsDir);

  const currentTime = getTimeString();
  const llmSummary = transcriptPath && summary && transcriptExists ? maybeGenerateLlmSummary(transcriptPath, summary) : null;
  const context = { today, currentTime, metadata, summary, llmSummary };

  if (fs.existsSync(sessionFile)) {
    updateSessionFile(sessionFile, context);
  } else {
    createSessionFile(sessionFile, context);
  }

  process.exit(0);
}

function buildSummarySection(summary) {
  let section = '## Session Summary\n\n';

  // Tasks (from user messages — collapse newlines and escape backticks to prevent markdown breaks)
  section += '### Tasks\n';
  for (const msg of summary.userMessages) {
    section += `- ${msg.replace(/\n/g, ' ').replace(/`/g, '\\`')}\n`;
  }
  section += '\n';

  // Files modified
  if (summary.filesModified.length > 0) {
    section += '### Files Modified\n';
    for (const f of summary.filesModified) {
      section += `- ${f}\n`;
    }
    section += '\n';
  }

  // Tools used
  if (summary.toolsUsed.length > 0) {
    section += `### Tools Used\n${summary.toolsUsed.join(', ')}\n\n`;
  }

  section += `### Stats\n- Total user messages: ${summary.totalMessages}\n`;

  return section;
}

function buildSummaryBlock(summary) {
  return `${SUMMARY_START_MARKER}\n${buildSummarySection(summary).trim()}\n${SUMMARY_END_MARKER}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
