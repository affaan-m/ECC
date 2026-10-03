'use strict';

const BLOCK_SCALAR_PATTERN = /^[|>][+-]?$/;

function stripInlineComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === '"' && char === '\\') {
      index += 1;
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && char === '#' && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index);
    }
  }
  return value;
}

function parseScalar(rawValue) {
  const value = stripInlineComment(String(rawValue || '')).trim();
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error('invalid double-quoted scalar');
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('"') || value.endsWith('"')
    || value.startsWith("'") || value.endsWith("'")) {
    throw new Error('unterminated quoted scalar');
  }
  if (value.startsWith('[') || value.startsWith('{')) {
    throw new Error('flow collections are not supported in Hookify frontmatter');
  }
  return value;
}

function foldBlockScalar(lines) {
  if (lines.length === 0) return '';
  let value = lines[0];
  let blankLines = 0;
  let previous = lines[0];
  for (const line of lines.slice(1)) {
    if (line === '') {
      blankLines += 1;
      continue;
    }
    const preservesBreak = /^\s/.test(previous) || /^\s/.test(line);
    value += blankLines > 0
      ? '\n'.repeat(blankLines)
      : preservesBreak ? '\n' : ' ';
    value += line;
    blankLines = 0;
    previous = line;
  }
  return value + '\n'.repeat(blankLines);
}

function parseBlockScalar(lines, startIndex, parentIndent, marker) {
  const collected = [];
  let index = startIndex;
  let minimumIndent = Infinity;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (trimmed && indent <= parentIndent) break;
    if (trimmed && Number.isFinite(minimumIndent) && indent < minimumIndent) break;
    if (trimmed) minimumIndent = Math.min(minimumIndent, indent);
    collected.push(line);
    index += 1;
  }
  const contentIndent = Number.isFinite(minimumIndent) ? minimumIndent : parentIndent + 1;
  const values = collected.map(line => line.slice(Math.min(contentIndent, line.length)));
  const literal = marker.startsWith('|');
  let value = literal ? values.join('\n') : foldBlockScalar(values);
  if (marker.endsWith('-')) value = value.replace(/\n+$/, '');
  else if (!marker.endsWith('+')) value = value.replace(/\n*$/, '\n');
  return { value, nextIndex: index };
}

function parseValue(lines, index, indent, rawValue) {
  const marker = stripInlineComment(rawValue).trim();
  if (!BLOCK_SCALAR_PATTERN.test(marker)) {
    return { value: parseScalar(rawValue), nextIndex: index };
  }
  const parsed = parseBlockScalar(lines, index + 1, indent, marker);
  return { value: parsed.value, nextIndex: parsed.nextIndex - 1 };
}

function immutableMapping(value = {}) {
  return Object.assign(Object.create(null), value);
}

function parseRuleFrontmatter(source) {
  let result = immutableMapping();
  const seenTopLevel = new Set();
  let conditions = null;
  let currentConditionIndex = -1;

  const lines = String(source || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;

    if (indent === 0) {
      currentConditionIndex = -1;
      const separator = rawLine.indexOf(':');
      if (separator <= 0) throw new Error('invalid top-level frontmatter line');
      const key = rawLine.slice(0, separator).trim();
      const rawValue = rawLine.slice(separator + 1);
      if (seenTopLevel.has(key)) throw new Error('duplicate frontmatter key: ' + key);
      seenTopLevel.add(key);
      if (key === 'conditions') {
        if (stripInlineComment(rawValue).trim()) throw new Error('conditions must be a YAML list');
        conditions = [];
        result = immutableMapping({ ...result, conditions });
      } else {
        const parsed = parseValue(lines, index, indent, rawValue);
        result = immutableMapping({ ...result, [key]: parsed.value });
        index = parsed.nextIndex;
      }
      continue;
    }

    if (!conditions) throw new Error('nested values are only supported under conditions');
    if (trimmed.startsWith('- ')) {
      const item = trimmed.slice(2);
      const separator = item.indexOf(':');
      if (separator <= 0) throw new Error('invalid condition list item');
      const key = item.slice(0, separator).trim();
      const parsed = parseValue(lines, index, indent, item.slice(separator + 1));
      conditions = [...conditions, immutableMapping({ [key]: parsed.value })];
      currentConditionIndex = conditions.length - 1;
      result = immutableMapping({ ...result, conditions });
      index = parsed.nextIndex;
      continue;
    }
    if (currentConditionIndex < 0) {
      throw new Error('condition property is missing a list item');
    }
    const separator = trimmed.indexOf(':');
    if (separator <= 0) throw new Error('invalid condition property');
    const key = trimmed.slice(0, separator).trim();
    const currentCondition = conditions[currentConditionIndex];
    if (Object.prototype.hasOwnProperty.call(currentCondition, key)) {
      throw new Error('duplicate condition key: ' + key);
    }
    const parsed = parseValue(lines, index, indent, trimmed.slice(separator + 1));
    const nextCondition = immutableMapping({ ...currentCondition, [key]: parsed.value });
    conditions = conditions.map((condition, conditionIndex) => (
      conditionIndex === currentConditionIndex ? nextCondition : condition
    ));
    result = immutableMapping({ ...result, conditions });
    index = parsed.nextIndex;
  }

  return result;
}

function extractFrontmatter(source) {
  const normalized = String(source || '').replace(/^\uFEFF/, '');
  const match = normalized.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return null;
  return { yaml: match[1], message: normalized.slice(match[0].length) };
}

module.exports = {
  extractFrontmatter,
  parseRuleFrontmatter,
};
