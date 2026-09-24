'use strict';

function stripSurroundingQuotes(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function splitTopLevelToolList(value) {
  const items = [];
  const delimiters = [];
  let quote = null;
  let escaped = false;
  let itemStart = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === '(' || character === '[' || character === '{') {
      delimiters.push(character);
      continue;
    }

    const expectedOpener = {
      ')': '(',
      ']': '[',
      '}': '{',
    }[character];
    if (expectedOpener && delimiters.at(-1) === expectedOpener) {
      delimiters.pop();
      continue;
    }

    if (character === ',' && delimiters.length === 0) {
      items.push(value.slice(itemStart, index));
      itemStart = index + 1;
    }
  }

  items.push(value.slice(itemStart));
  return items;
}

/**
 * Normalize Claude agent frontmatter tools to the array shape used internally.
 *
 * Claude Code expects tools to be a comma-separated scalar. Flow sequences are
 * still accepted here so ECC can read legacy or harness-adapted agent files.
 */
function normalizeAgentTools(value) {
  if (Array.isArray(value)) {
    return value
      .filter(item => typeof item === 'string')
      .map(stripSurroundingQuotes)
      .filter(Boolean);
  }

  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  const listValue = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : stripSurroundingQuotes(trimmed);

  if (!listValue.trim()) {
    return [];
  }

  return splitTopLevelToolList(listValue)
    .map(stripSurroundingQuotes)
    .filter(Boolean);
}

module.exports = {
  normalizeAgentTools,
};
