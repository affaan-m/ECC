'use strict';

/**
 * Shared instinct file parser and PreToolUse matcher.
 *
 * SessionStart and instinct-enforce both read the same project + global
 * store. Parse behavior is the SessionStart original: quoted values, a
 * float `confidence`, and missing/unparseable confidence -> 0.5.
 */

const fs = require('fs');
const path = require('path');
const { getHomunculusDir } = require('./observer-sessions');

const DEFAULT_INSTINCT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_MATCH_LIMIT = 3;
const QUOTED_IDENTIFIER_MIN_LENGTH = 4;
const MATCH_STOPWORDS = new Set(['when', 'always', 'never', 'the', 'and']);
const QUOTED_IDENTIFIER_RE = /(["'`])([^"'`]+)\1/g;
const PROHIBITION_MARKER_RE = /\b(?:never|do not|don't|dont)\b/i;
// The trailing words stop before another marker, so "NEVER foo and NEVER bar"
// leaves "NEVER bar" for the next match instead of swallowing it.
const NEVER_TOKEN_RE = /\b(?:never|do not|don't|dont)\s+([A-Za-z0-9_-]+(?:\s+(?!(?:never|do\s+not|don't|dont)\b)[A-Za-z0-9_-]+){0,2})/gi;
// Generic words after "never" ("NEVER use hardcoded secrets") say nothing
// about what is forbidden, and as substrings they hit `user` or `useState`.
// The never token is the first word after them.
const NEVER_TOKEN_STOPWORDS = new Set([
  ...MATCH_STOPWORDS,
  'a', 'an', 'any', 'be', 'call', 'do', 'ever', 'get', 'have', 'include',
  'let', 'make', 'put', 'set', 'use', 'write',
]);
// Words that end the prohibited part of a sentence: in "Never use `foo`,
// always prefer `bar`" only `foo` is forbidden.
const AFFIRMATIVE_MARKER_RE = /\b(?:always|prefer|preferring|instead|rather|but)\b/i;

/**
 * Resolve the minimum confidence an instinct needs to be injected at
 * SessionStart or matched at PreToolUse. Overridable via
 * `ECC_INSTINCT_CONFIDENCE_THRESHOLD` (a number in [0, 1]); falsy or
 * out-of-range values fall back to
 * {@link DEFAULT_INSTINCT_CONFIDENCE_THRESHOLD}.
 *
 * @returns {number} The confidence floor.
 */
function getInstinctConfidenceThreshold() {
  const raw = process.env.ECC_INSTINCT_CONFIDENCE_THRESHOLD;
  if (!raw) return DEFAULT_INSTINCT_CONFIDENCE_THRESHOLD;

  // Require a plain decimal (e.g. "0.7", "1", "0.95") so trailing junk
  // ("0.7x") and non-decimal numeric syntax like "0x1" (hex) or "1e2"
  // (exponent) are rejected whole rather than silently accepted by Number().
  const normalized = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return DEFAULT_INSTINCT_CONFIDENCE_THRESHOLD;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : DEFAULT_INSTINCT_CONFIDENCE_THRESHOLD;
}

function finishInstinct(current, contentLines) {
  if (!current || !current.id) return null;
  const instinct = {
    ...current,
    content: contentLines.join('\n').trim(),
  };
  if (!Number.isFinite(instinct.confidence)) {
    instinct.confidence = 0.5;
  }
  return instinct;
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
        const finished = finishInstinct(current, contentLines);
        if (finished) instincts.push(finished);
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

  const finished = finishInstinct(current, contentLines);
  if (finished) instincts.push(finished);

  return instincts;
}

function readInstinctsFromDir(directory, scope, onWarn) {
  if (!directory || !fs.existsSync(directory)) return [];

  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(ya?ml|md)$/i.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (typeof onWarn === 'function') {
      onWarn(directory, error);
    }
    return [];
  }

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
      if (typeof onWarn === 'function') {
        onWarn(filePath, error);
      }
    }
  }

  return instincts;
}

// Picks the same copy of an id as SessionStart: the first one at or above the
// confidence threshold, project before global and personal before inherited.
function mergeProjectOverGlobal(project, global) {
  const threshold = getInstinctConfidenceThreshold();
  const merged = new Map();
  for (const instinct of [...project, ...global]) {
    if (!instinct || !instinct.id) continue;
    const existing = merged.get(instinct.id);
    if (!existing || (existing.confidence < threshold && instinct.confidence >= threshold)) {
      merged.set(instinct.id, instinct);
    }
  }
  return Array.from(merged.values());
}

/**
 * Load project + global instincts from the same roots SessionStart uses.
 *
 * @param {object} observerContext
 * @param {object} [options]
 * @param {function} [options.onWarn]
 * @returns {{ project: object[], global: object[], merged: object[] }}
 */
function loadInstincts(observerContext, options = {}) {
  const onWarn = options.onWarn;
  const homunculusDir = getHomunculusDir();
  const globalDirs = [
    { dir: path.join(homunculusDir, 'instincts', 'personal'), scope: 'global' },
    { dir: path.join(homunculusDir, 'instincts', 'inherited'), scope: 'global' },
  ];
  const projectDirs = observerContext && observerContext.isGlobal === false && observerContext.projectDir
    ? [
      { dir: path.join(observerContext.projectDir, 'instincts', 'personal'), scope: 'project' },
      { dir: path.join(observerContext.projectDir, 'instincts', 'inherited'), scope: 'project' },
    ]
    : [];

  const project = projectDirs.flatMap(({ dir, scope }) => readInstinctsFromDir(dir, scope, onWarn));
  const global = globalDirs.flatMap(({ dir, scope }) => readInstinctsFromDir(dir, scope, onWarn));

  return {
    project,
    global,
    merged: mergeProjectOverGlobal(project, global),
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectToolStrings(toolInput) {
  const values = [];
  const push = (value) => {
    if (typeof value === 'string' && value) values.push(value);
  };

  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  push(input.file_path);
  push(input.filePath);
  push(input.command);
  push(input.contents);
  push(input.content);
  push(input.new_string);
  push(input.newString);
  // Text an edit removes is not matched: an edit that corrects a violation
  // must not be blocked by the very text it takes out.

  if (Array.isArray(input.edits)) {
    for (const edit of input.edits) {
      if (!edit || typeof edit !== 'object') continue;
      push(edit.file_path);
      push(edit.filePath);
      push(edit.contents);
      push(edit.content);
      push(edit.new_string);
      push(edit.newString);
    }
  }

  return values;
}

function extractQuotedIdentifiers(text) {
  const identifiers = [];
  const source = String(text || '');
  QUOTED_IDENTIFIER_RE.lastIndex = 0;
  let match;
  while ((match = QUOTED_IDENTIFIER_RE.exec(source)) !== null) {
    const identifier = match[2].trim();
    if (identifier.length < QUOTED_IDENTIFIER_MIN_LENGTH) continue;
    if (MATCH_STOPWORDS.has(identifier.toLowerCase())) continue;
    identifiers.push(identifier);
  }
  return identifiers;
}

// Clause boundaries are sentence punctuation or a newline outside a quoted
// span, so "NEVER run `git clean -fd; git reset --hard`." stays one clause.
function splitClauses(text) {
  const clauses = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      else if (ch === '\n') quote = null;
      continue;
    }
    if (ch === '\n' || ('.;!?'.includes(ch) && (i + 1 === text.length || /\s/.test(text[i + 1])))) {
      clauses.push(current);
      current = '';
      continue;
    }
    // An apostrophe inside a word (don't, it's) never opens a quote.
    const opens = '"\'`'.includes(ch) && text.indexOf(ch, i + 1) !== -1
      && !(ch === "'" && /\w/.test(text[i - 1] || ''));
    if (opens) quote = ch;
    current += ch;
  }
  clauses.push(current);
  return clauses;
}

// Quoted spans are blanked to the same length so marker positions found in
// the mask line up with the clause itself.
function maskQuotedSpans(text) {
  return text.replace(QUOTED_IDENTIFIER_RE, match => ' '.repeat(match.length));
}

// The forbidden part of a clause runs from its start through the prohibition
// and stops at the first affirmative marker after it. A later prohibition
// opens another forbidden part, so "never a, prefer b and never c" forbids
// both a and c.
function prohibitedPart(clause) {
  const masked = maskQuotedSpans(clause);
  const parts = [];
  let start = 0;
  while (start < clause.length) {
    const marker = PROHIBITION_MARKER_RE.exec(masked.slice(start));
    if (!marker) break;
    const afterMarker = start + marker.index + marker[0].length;
    const affirmative = AFFIRMATIVE_MARKER_RE.exec(masked.slice(afterMarker));
    const end = affirmative ? afterMarker + affirmative.index : clause.length;
    parts.push(clause.slice(parts.length === 0 ? 0 : start + marker.index, end));
    if (!affirmative) break;
    start = end + affirmative[0].length;
  }
  return parts.join(' ');
}

function extractProhibitedClauses(text) {
  return splitClauses(String(text || ''))
    .map(prohibitedPart)
    .filter(Boolean);
}

function extractNeverTokens(text) {
  const tokens = [];
  const source = String(text || '');
  NEVER_TOKEN_RE.lastIndex = 0;
  let match;
  while ((match = NEVER_TOKEN_RE.exec(source)) !== null) {
    // Words right before a quoted span only introduce it ("NEVER run
    // `git reset --hard`"); the quoted span is what is forbidden, and it is
    // matched as a quoted identifier.
    if (/^\s*["'`]/.test(source.slice(match.index + match[0].length))) continue;
    const token = match[1].split(/\s+/)
      .find((word) => !NEVER_TOKEN_STOPWORDS.has(word.toLowerCase()));
    if (token) tokens.push(token);
  }
  return tokens;
}

/**
 * How an instinct matches a tool payload: `'prohibition'` when the payload
 * hits something the instinct forbids (a "never X" token, or a quoted
 * identifier in an instinct that states a prohibition), `'guidance'` for a
 * domain or affirmative match, or `null` for no match.
 *
 * @param {object} instinct
 * @param {object} toolInput
 * @returns {'prohibition'|'guidance'|null}
 */
function instinctMatchKind(instinct, toolInput) {
  const strings = collectToolStrings(toolInput);
  const filePath = strings.length > 0
    ? String((toolInput && (toolInput.file_path || toolInput.filePath)) || '')
    : '';
  const command = String((toolInput && toolInput.command) || '');
  const basename = filePath ? path.basename(filePath) : '';
  const payload = strings.join('\n');
  const pathOrCommand = `${filePath}\n${command}`;
  const quotedHaystack = [payload, command, basename].join('\n');

  const neverTokens = extractNeverTokens(instinct.content);
  const neverHaystack = payload.toLowerCase();
  for (const token of neverTokens) {
    if (neverHaystack.includes(token.toLowerCase())) {
      return 'prohibition';
    }
  }

  // A quoted name is a prohibition only when it sits in the clause that
  // forbids something; a quoted file in the trigger stays guidance even when
  // the content forbids something unrelated.
  const prohibited = new Set(extractProhibitedClauses(instinct.content)
    .flatMap(clause => extractQuotedIdentifiers(clause))
    .map(identifier => identifier.toLowerCase()));
  const quotedSource = `${instinct.trigger || ''}\n${instinct.content || ''}`;
  // Every quoted hit is checked before settling on guidance, so a matching
  // file name in the trigger cannot hide a forbidden name in the content.
  let quotedGuidance = false;
  for (const identifier of extractQuotedIdentifiers(quotedSource)) {
    const key = identifier.toLowerCase();
    if (quotedHaystack.toLowerCase().includes(key)) {
      if (prohibited.has(key)) return 'prohibition';
      quotedGuidance = true;
    }
  }
  if (quotedGuidance) return 'guidance';

  const domain = String(instinct.domain || '').trim();
  if (domain) {
    const domainPattern = new RegExp(`\\b${escapeRegExp(domain)}\\b`, 'i');
    if (domainPattern.test(pathOrCommand)) {
      return 'guidance';
    }
  }

  return null;
}

function instinctMatchesToolInput(instinct, toolInput) {
  return instinctMatchKind(instinct, toolInput) !== null;
}

/**
 * Deterministic instinct matcher for a tool payload.
 *
 * @param {object[]} instincts
 * @param {object} toolInput
 * @param {object} [options]
 * @param {number} [options.minConfidence]
 * @param {number} [options.limit]
 * @returns {object[]} matching instincts, highest confidence first, capped
 */
function matchInstincts(instincts, toolInput, options = {}) {
  const minConfidence = Number.isFinite(options.minConfidence)
    ? options.minConfidence
    : getInstinctConfidenceThreshold();
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? options.limit
    : DEFAULT_MATCH_LIMIT;

  const matches = (Array.isArray(instincts) ? instincts : [])
    .filter(instinct => instinct && instinct.id && Number(instinct.confidence) >= minConfidence)
    .filter(instinct => instinctMatchesToolInput(instinct, toolInput))
    .sort((left, right) => {
      if (right.confidence !== left.confidence) return right.confidence - left.confidence;
      return String(left.id).localeCompare(String(right.id));
    });

  return matches.slice(0, limit);
}

module.exports = {
  DEFAULT_INSTINCT_CONFIDENCE_THRESHOLD,
  DEFAULT_MATCH_LIMIT,
  MATCH_STOPWORDS,
  getInstinctConfidenceThreshold,
  instinctMatchKind,
  parseInstinctFile,
  loadInstincts,
  matchInstincts,
  mergeProjectOverGlobal,
};
