'use strict';

// Approximate token counting without requiring tiktoken binary at runtime.
// Uses the ~4 chars per token heuristic (GPT-2/GPT-4 empirical average).
// For production, swap countTokens() with tiktoken cl100k_base encode().

function countTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  // cl100k heuristic: 1 token ≈ 4 chars for English
  return Math.ceil(text.length / 4);
}

function countMessages(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, msg) => {
    const content = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map(c => c.text || c.content || '').join(' ')
        : '';
    return sum + countTokens(content) + countTokens(msg.role || '') + 4; // per-message overhead
  }, 3); // base overhead
}

module.exports = { countTokens, countMessages };
