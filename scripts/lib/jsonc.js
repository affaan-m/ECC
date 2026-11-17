'use strict';

/**
 * Parse a JSONC configuration object, allowing comments and trailing commas
 * without interpreting comment-like characters inside JSON strings.
 */
function parseJsoncConfig(content, sourceRelativePath) {
  let config;
  try {
    config = JSON.parse(stripJsonc(content));
  } catch (error) {
    throw new Error(`Failed to parse ${sourceRelativePath}: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Invalid ${sourceRelativePath}: expected a JSON object`);
  }
  return config;
}

function isLineBreak(ch) {
  return ch === '\n' || ch === '\r';
}

/**
 * Advance past whitespace and // or /* *\/ comments; returns the index of
 * the next significant character.
 */
function skipJsoncTrivia(input, start) {
  let j = start;
  for (;;) {
    while (j < input.length && /\s/.test(input[j])) j += 1;
    if (input[j] === '/' && input[j + 1] === '/') {
      while (j < input.length && !isLineBreak(input[j])) j += 1;
      continue;
    }
    if (input[j] === '/' && input[j + 1] === '*') {
      j += 2;
      while (j < input.length && !(input[j] === '*' && input[j + 1] === '/')) j += 1;
      if (j >= input.length) throw new Error('Unterminated block comment');
      j += 2;
      continue;
    }
    return j;
  }
}

function isJsoncTrailingComma(input, index, previousSignificant) {
  const next = skipJsoncTrivia(input, index + 1);
  // Preserve commas in empty containers or after another separator so
  // JSON.parse rejects them; it validates the remaining value syntax.
  return (input[next] === '}' || input[next] === ']')
    && previousSignificant !== null && !'[{,:'.includes(previousSignificant);
}

/**
 * Strip // and /* *\/ comments and the trailing commas they hide, without
 * touching string contents (URLs like "https://..." must survive intact).
 */
function stripJsonc(input) {
  let out = '';
  let inString = false;
  let escaped = false;
  let previousSignificant = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      previousSignificant = '"';
      continue;
    }
    if (ch === '/' && input[i + 1] === '/') {
      while (i < input.length && !isLineBreak(input[i])) i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && input[i + 1] === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      if (i >= input.length) throw new Error('Unterminated block comment');
      i += 1; // consume the closing '/'
      out += ' ';
      continue;
    }
    if (ch === ',') {
      if (isJsoncTrailingComma(input, i, previousSignificant)) continue;
    }
    out += ch;
    if (!/\s/.test(ch)) previousSignificant = ch;
  }
  return out;
}

module.exports = { parseJsoncConfig };
