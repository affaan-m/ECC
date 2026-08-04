#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = process.env.ECC_UNICODE_SCAN_ROOT
  ? path.resolve(process.env.ECC_UNICODE_SCAN_ROOT)
  : path.resolve(__dirname, '..', '..');

const writeMode = process.argv.includes('--write');

const ignoredDirs = new Set([
  '.git',
  'node_modules',
  '.dmux',
  '.next',
  '.venv',
  'coverage',
  'venv',
]);

const textExtensions = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.toml',
  '.yml',
  '.yaml',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.py',
  '.rs',
]);

const writableExtensions = new Set([
  '.md',
  '.mdx',
  '.txt',
]);

const writeModeSkip = new Set([
  path.normalize('scripts/ci/check-unicode-safety.js'),
  path.normalize('tests/scripts/check-unicode-safety.test.js'),
]);

const emojiRe = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/gu;
const allowedSymbolCodePoints = new Set([
  0x00A9,
  0x00AE,
  0x2122,
]);

const targetedReplacements = [
  [new RegExp(`${String.fromCodePoint(0x26A0)}(?:\\uFE0F)?`, 'gu'), 'WARNING:'],
  [new RegExp(`${String.fromCodePoint(0x23ED)}(?:\\uFE0F)?`, 'gu'), 'SKIPPED:'],
  [new RegExp(String.fromCodePoint(0x2705), 'gu'), 'PASS:'],
  [new RegExp(String.fromCodePoint(0x274C), 'gu'), 'FAIL:'],
  [new RegExp(String.fromCodePoint(0x2728), 'gu'), ''],
];

function shouldSkip(entryPath) {
  return entryPath.split(path.sep).some(part => ignoredDirs.has(part));
}

function isTextFile(filePath) {
  return textExtensions.has(path.extname(filePath).toLowerCase());
}

function canAutoWrite(relativePath) {
  return writableExtensions.has(path.extname(relativePath).toLowerCase());
}

function listFiles(dirPath) {
  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (shouldSkip(entryPath)) continue;
    if (entry.isDirectory()) {
      results.push(...listFiles(entryPath));
      continue;
    }
    if (entry.isFile() && isTextFile(entryPath)) {
      results.push(entryPath);
    }
  }
  return results;
}

function lineAndColumn(text, index) {
  const line = text.slice(0, index).split('\n').length;
  const lastNewline = text.lastIndexOf('\n', index - 1);
  const column = index - lastNewline;
  return { line, column };
}

function isAllowedEmojiLikeSymbol(char) {
  return allowedSymbolCodePoints.has(char.codePointAt(0));
}

function isDangerousInvisibleCodePoint(codePoint) {
  return (
    (codePoint >= 0x200B && codePoint <= 0x200D) ||
    codePoint === 0x2060 ||
    codePoint === 0xFEFF ||
    (codePoint >= 0x202A && codePoint <= 0x202E) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    (codePoint >= 0xFE00 && codePoint <= 0xFE0F) ||
    (codePoint >= 0xE0100 && codePoint <= 0xE01EF) ||
    // Unicode Tag block (U+E0000–U+E007F). Tag characters were proposed
    // for language tagging in Unicode 3.1 and have been deprecated since
    // Unicode 5.1, so no legitimate text uses them. They are the canonical
    // vector for "ASCII smuggling" / "Tag smuggling" prompt injection:
    // an attacker hides instructions inside ASCII-looking strings (PR
    // bodies, SKILL.md, frontmatter), the LLM consumes the tag bytes,
    // and the human reviewer sees nothing.
    (codePoint >= 0xE0000 && codePoint <= 0xE007F) ||
    // U+180E MONGOLIAN VOWEL SEPARATOR — formerly classified as a space
    // separator, reclassified as a format control in Unicode 6.3; renders
    // as zero-width and routinely abused for homograph / smuggling.
    codePoint === 0x180E ||
    // U+115F / U+1160 HANGUL CHOSEONG/JUNGSEONG FILLER — zero-width fillers
    // used in Korean text shaping; abused as invisible characters.
    codePoint === 0x115F ||
    codePoint === 0x1160 ||
    // U+2061–U+2064 invisible math operators (FUNCTION APPLICATION,
    // INVISIBLE TIMES, INVISIBLE SEPARATOR, INVISIBLE PLUS). Zero-width
    // and not used outside math typesetting; legitimate Markdown / source
    // does not contain them.
    (codePoint >= 0x2061 && codePoint <= 0x2064) ||
    // U+3164 HANGUL FILLER — zero-width filler reportedly used in Discord
    // / Twitter smuggling attacks; not used in legitimate Korean text.
    codePoint === 0x3164
  );
}

function stripDangerousInvisibleChars(text) {
  let next = '';
  for (const char of text) {
    if (!isDangerousInvisibleCodePoint(char.codePointAt(0))) {
      next += char;
    }
  }
  return next;
}

function sanitizeText(text) {
  let next = text;
  next = stripDangerousInvisibleChars(next);

  for (const [pattern, replacement] of targetedReplacements) {
    next = next.replace(pattern, replacement);
  }

  next = next.replace(emojiRe, match => (isAllowedEmojiLikeSymbol(match) ? match : ''));
  next = next.replace(/^ +(?=\*\*)/gm, '');
  next = next.replace(/^(\*\*)\s+/gm, '$1');
  next = next.replace(/^(#+)\s{2,}/gm, '$1 ');
  next = next.replace(/^>\s{2,}/gm, '> ');
  next = next.replace(/^-\s{2,}/gm, '- ');
  next = next.replace(/^(\d+\.)\s{2,}/gm, '$1 ');
  next = next.replace(/[ \t]+$/gm, '');

  return next;
}

function collectMatches(text, regex, kind) {
  const matches = [];
  for (const match of text.matchAll(regex)) {
    const char = match[0];
    if (kind === 'emoji' && isAllowedEmojiLikeSymbol(char)) {
      continue;
    }
    const index = match.index ?? 0;
    const { line, column } = lineAndColumn(text, index);
    matches.push({
      kind,
      char,
      codePoint: `U+${char.codePointAt(0).toString(16).toUpperCase()}`,
      line,
      column,
    });
  }
  return matches;
}

function collectDangerousInvisibleMatches(text) {
  const matches = [];
  let index = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (isDangerousInvisibleCodePoint(codePoint)) {
      const { line, column } = lineAndColumn(text, index);
      matches.push({
        kind: 'dangerous-invisible',
        char,
        codePoint: `U+${codePoint.toString(16).toUpperCase()}`,
        line,
        column,
      });
    }
    index += char.length;
  }

  return matches;
}

const changedFiles = [];
const violations = [];

for (const filePath of listFiles(repoRoot)) {
  const relativePath = path.relative(repoRoot, filePath);
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    continue;
  }

  if (
    writeMode &&
    !writeModeSkip.has(path.normalize(relativePath)) &&
    canAutoWrite(relativePath)
  ) {
    const sanitized = sanitizeText(text);
    if (sanitized !== text) {
      fs.writeFileSync(filePath, sanitized, 'utf8');
      changedFiles.push(relativePath);
      text = sanitized;
    }
  }

  const fileViolations = [
    ...collectDangerousInvisibleMatches(text),
    ...collectMatches(text, emojiRe, 'emoji'),
  ];

  for (const violation of fileViolations) {
    violations.push({
      file: relativePath,
      ...violation,
    });
  }
}

if (changedFiles.length > 0) {
  console.log(`Sanitized ${changedFiles.length} files:`);
  for (const file of changedFiles) {
    console.log(`- ${file}`);
  }
}

if (violations.length > 0) {
  console.error('Unicode safety violations detected:');
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}:${violation.column} ${violation.kind} ${violation.codePoint}`
    );
  }
  process.exit(1);
}

console.log('Unicode safety check passed.');
