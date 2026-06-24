'use strict';

const { countTokens, countMessages } = require('./token-counter');

// ── Optimization techniques ────────────────────────────────────────────────

// 1. Remove excessive whitespace & redundant punctuation
function compressWhitespace(text) {
  return text
    .replace(/[ \t]+/g, ' ')           // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')        // max 2 consecutive newlines
    .replace(/\n +/g, '\n')            // strip leading spaces after newline
    .trim();
}

// 2. Remove filler phrases that add tokens but no information
const FILLER_PATTERNS = [
  /\bplease\s+(?:note\s+that\s+)?/gi,
  /\bit\s+is\s+(?:important|crucial|essential|critical)\s+(?:to\s+note\s+)?that\s+/gi,
  /\bas\s+(?:an?\s+)?(?:AI|language\s+model|LLM)[^.]*,\s*/gi,
  /\bI\s+would\s+like\s+you\s+to\s+/gi,
  /\bcould\s+you\s+(?:please\s+)?/gi,
  /\bkindly\s+/gi,
  /\bfeel\s+free\s+to\s+/gi,
  /\bin\s+order\s+to\s+/gi,   // → "to"
  /\bdue\s+to\s+the\s+fact\s+that\s+/gi, // → "because"
  /\bat\s+this\s+(?:point\s+in\s+time|moment)\s+/gi, // → "now"
];

function removeFiller(text) {
  let out = text;
  out = out.replace(/\bin\s+order\s+to\s+/gi, 'to ');
  out = out.replace(/\bdue\s+to\s+the\s+fact\s+that\s+/gi, 'because ');
  out = out.replace(/\bat\s+this\s+(?:point\s+in\s+time|moment)\s+/gi, 'now ');
  for (const pat of FILLER_PATTERNS) out = out.replace(pat, '');
  return out;
}

// 3. Deduplicate repeated system-prompt content
function deduplicateSystemContent(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return messages;
  const seen = new Set();
  return messages.map(msg => {
    if (msg.role !== 'system') return msg;
    const lines = (msg.content || '').split('\n');
    const unique = lines.filter(l => {
      const key = l.trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...msg, content: unique.join('\n') };
  });
}

// 4. Truncate very long user messages to a budget (preserve start + end)
function truncateToTokenBudget(text, maxTokens = 2000) {
  const tokens = countTokens(text);
  if (tokens <= maxTokens) return text;
  // Keep first 60% and last 40% — preserve context + recent instruction
  const chars = maxTokens * 4;
  const head = Math.floor(chars * 0.6);
  const tail = chars - head;
  const middle = '\n[...content truncated by TokenGuard to reduce cost...]\n';
  return text.slice(0, head) + middle + text.slice(-tail);
}

// 5. Strip XML/HTML tags that carry no semantic value in LLM prompts
function stripRedundantMarkup(text) {
  // Remove empty tags and excessive nesting noise
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(span|div|p|font)[^>]*>/gi, ' ')
    .replace(/\s{2,}/g, ' ');
}

// ── Main optimizer ─────────────────────────────────────────────────────────

/**
 * Optimize a request payload for a given provider.
 * Returns { optimizedBody, originalTokens, optimizedTokens, techniques }
 */
function optimizeRequest(body, options = {}) {
  const {
    aggressive = false,
    maxUserTokens = 4000,
  } = options;

  const techniques = [];
  let messages = body.messages ? [...body.messages] : [];
  let systemPrompt = body.system || '';

  const originalTokens = countMessages(messages) + countTokens(systemPrompt);

  // Apply system prompt compression
  if (systemPrompt) {
    const before = systemPrompt;
    systemPrompt = compressWhitespace(removeFiller(systemPrompt));
    if (systemPrompt !== before) techniques.push('system-prompt-compression');
  }

  // Deduplicate system messages
  const deduped = deduplicateSystemContent(messages);
  if (JSON.stringify(deduped) !== JSON.stringify(messages)) {
    messages = deduped;
    techniques.push('system-deduplication');
  }

  // Compress all message content
  messages = messages.map(msg => {
    if (typeof msg.content !== 'string') return msg;
    let content = compressWhitespace(msg.content);
    if (aggressive) content = removeFiller(content);
    if (msg.role === 'user' && countTokens(content) > maxUserTokens) {
      content = truncateToTokenBudget(content, maxUserTokens);
      techniques.push('user-message-truncation');
    }
    return content !== msg.content ? { ...msg, content } : msg;
  });

  if (messages.some((m, i) => m.content !== (body.messages || [])[i]?.content)) {
    techniques.push('whitespace-compression');
  }

  if (aggressive) {
    messages = messages.map(msg => {
      if (typeof msg.content !== 'string') return msg;
      const stripped = stripRedundantMarkup(msg.content);
      return stripped !== msg.content ? { ...msg, content: stripped } : msg;
    });
    if (systemPrompt) {
      const before = systemPrompt;
      systemPrompt = stripRedundantMarkup(systemPrompt);
      if (systemPrompt !== before) techniques.push('markup-stripping');
    }
  }

  const optimizedBody = { ...body, messages };
  if (body.system !== undefined) optimizedBody.system = systemPrompt;

  const optimizedTokens = countMessages(messages) + countTokens(systemPrompt);
  const savedTokens = Math.max(0, originalTokens - optimizedTokens);
  const savingPct = originalTokens > 0 ? (savedTokens / originalTokens * 100).toFixed(1) : '0.0';

  return {
    optimizedBody,
    originalTokens,
    optimizedTokens,
    savedTokens,
    savingPct: parseFloat(savingPct),
    techniques: [...new Set(techniques)],
  };
}

module.exports = { optimizeRequest, compressWhitespace, removeFiller };
