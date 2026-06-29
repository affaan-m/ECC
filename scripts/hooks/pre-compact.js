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
const { getSessionsDir, getDateTimeString, getTimeString, findFiles, ensureDir, appendFile, readFile, writeFile, log } = require('../lib/utils');
const { generateSessionSummary } = require('../lib/llm-summary');

const SUMMARY_START_MARKER = '<!-- ECC:SUMMARY:START -->';
const SUMMARY_END_MARKER = '<!-- ECC:SUMMARY:END -->';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const MAX_STDIN = 1024 * 1024;
let stdinData = '';
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

  const activeSession = sessions[0].path;
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
