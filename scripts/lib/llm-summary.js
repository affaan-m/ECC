#!/usr/bin/env node
/**
 * LLM-powered session summary generator
 *
 * Uses `claude -p` (Claude Code CLI) to generate rich, contextual session
 * summaries from JSONL transcripts. Requires no API key — reuses Claude Code's
 * own authentication.
 *
 * Recursion guard: sets ECC_SKIP_LLM_SUMMARY=1 in subprocess env so any Stop
 * hooks fired by the subprocess do NOT re-enter LLM summarization.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');

const MAX_TRANSCRIPT_CHARS = 7000;
const MAX_TURNS = 25;
const LLM_TIMEOUT_MS = 90000;

function getLLMModel() {
  return process.env.ECC_LLM_SUMMARY_MODEL || 'haiku';
}

function getContextThreshold() {
  const raw = parseInt(process.env.ECC_LLM_SUMMARY_CONTEXT_THRESHOLD || '20', 10);
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : 20;
}

/**
 * Extract the last MAX_TURNS user+assistant turns from a JSONL transcript.
 * Returns null when the transcript is missing or has no parseable turns.
 */
function extractConversationText(transcriptPath) {
  let content;
  try {
    content = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  const lines = content.split('\n').filter(Boolean);
  const turns = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const isUser = entry.type === 'user' || entry.message?.role === 'user';
      const isAssistant = entry.type === 'assistant';

      if (isUser) {
        const rawContent = entry.message?.content ?? entry.content;
        const text =
          typeof rawContent === 'string'
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent
                  .filter(c => c?.type === 'text')
                  .map(c => c.text)
                  .join(' ')
              : '';
        const cleaned = text.replace(/\n+/g, ' ').trim();
        if (cleaned) {
          turns.push({ role: 'User', text: cleaned.slice(0, 400) });
        }
      }

      if (isAssistant && Array.isArray(entry.message?.content)) {
        const textParts = entry.message.content
          .filter(b => b?.type === 'text')
          .map(b => b.text)
          .join(' ')
          .replace(/\n+/g, ' ')
          .trim();
        if (textParts) {
          turns.push({ role: 'Claude', text: textParts.slice(0, 600) });
        }
      }
    } catch {
      // Skip unparseable lines
    }
  }

  if (turns.length === 0) return null;

  const recent = turns.slice(-MAX_TURNS);
  const formatted = recent.map(t => `**${t.role}:** ${t.text}`).join('\n\n');
  return formatted.length > MAX_TRANSCRIPT_CHARS ? '...(前略)\n\n' + formatted.slice(-MAX_TRANSCRIPT_CHARS) : formatted;
}

/**
 * Read the context remaining percentage from a transcript's latest usage record.
 * Returns null when unavailable.
 */
function getContextRemainingPct(transcriptPath) {
  try {
    const { readLatestContextTokens, resolveContextWindowTokens } = require('./transcript-context');
    const usage = readLatestContextTokens(transcriptPath);
    if (!usage) return null;
    const windowTokens = resolveContextWindowTokens(usage.tokens, usage.model);
    return Math.round((1 - usage.tokens / windowTokens) * 100);
  } catch {
    return null;
  }
}

/**
 * Generate a session summary using `claude -p`.
 * Returns the summary string, or null on failure or when recursion guard is active.
 */
function generateSessionSummary(transcriptPath) {
  if (process.env.ECC_SKIP_LLM_SUMMARY) return null;

  const conversation = extractConversationText(transcriptPath);
  if (!conversation) return null;

  const prompt = [
    'Below is a conversation log from a Claude Code coding session.',
    'Create a summary to help the next session quickly understand the context.',
    '',
    '## Prioritize including',
    '- Design decisions and technology choices made this session',
    '- Bugs and problems solved',
    '- Files changed or created, with a brief description of changes',
    '- Unfinished tasks and work to continue in the next session',
    '- Important context the next session needs to know',
    '',
    '## Conversation log',
    conversation,
    '',
    '## Output format (Markdown only, no preamble)',
    '',
    '## Session Summary',
    '',
    '### Tasks',
    '(main tasks worked on this session)',
    '',
    '### Decisions Made',
    '(design decisions and technology choices)',
    '',
    '### Files Modified',
    '(files changed or created)',
    '',
    '### Unresolved Issues',
    '(unfinished tasks and work to continue)',
    '',
    '### Next Session Context',
    '(important context for the next session)'
  ].join('\n');

  try {
    const result = spawnSync('claude', ['--model', getLLMModel(), '-p'], {
      input: prompt,
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDECODE: '',
        ECC_SKIP_LLM_SUMMARY: '1'
      },
      timeout: LLM_TIMEOUT_MS,
      shell: process.platform === 'win32'
    });

    if (result.error || result.status !== 0) {
      return null;
    }

    const output = (result.stdout || '').trim();
    return output || null;
  } catch {
    return null;
  }
}

module.exports = { generateSessionSummary, extractConversationText, getContextRemainingPct, getContextThreshold, getLLMModel };
