#!/usr/bin/env node
/**
 * Validate curated skill directories (skills/ in repo) and their
 * translated mirrors (docs/{locale}/skills/ in repo).
 *
 * Structural checks (always errors):
 *   1. Each sub-directory of skills/ contains a SKILL.md file.
 *   2. SKILL.md is non-empty.
 *
 * Quality checks (defined in RULES table below):
 *   - Frontmatter: name, description, block-scalar detection
 *   - Content: required sections, depth, secret patterns
 *
 * Frontmatter findings default to WARN so CI does not break while
 * pre-existing data defects are being cleaned up out of band (see #1663).
 * Pass `--strict` or set `CI_STRICT_SKILLS=1` to promote frontmatter
 * findings to errors (exit 1).
 *
 * Quality findings (required sections, etc.) promote to errors in strict
 * mode or when a secret pattern is detected.
 *
 * Scope: curated skills/ plus translated docs/{locale}/skills/ mirrors.
 * Learned/imported/evolved roots are out of scope. If neither root
 * exists, exit 0 (nothing to validate).
 *
 * Rules are evidence-backed from analysis of 100+ skills and evolve via
 * regression gates in the test suite.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Allow optional custom target directory via first non-flag argument
// Defaults to repo's skills/ and docs/{locale}/skills/ if not provided
let SKILLS_DIR = path.join(__dirname, '../../skills');
let DOCS_DIR = path.join(__dirname, '../../docs');

// Parse first non-flag argument as optional target directory for testing
const targetArg = process.argv.find((arg, i) => i >= 2 && !arg.startsWith('--'));
if (targetArg) {
  // If a target directory is provided, only validate that directory
  // (used for testing and isolated validation runs)
  SKILLS_DIR = targetArg;
  DOCS_DIR = null; // Skip translated docs when a custom target is provided
}

const STRICT = process.argv.includes('--strict') || process.env.CI_STRICT_SKILLS === '1';

/**
 * Parse the leading YAML frontmatter of a markdown document.
 *
 * Returns `{ present, lines }` so callers can inspect raw lines
 * (needed to detect block-scalar `description:` values).
 *
 * Tolerant of UTF-8 BOM and CRLF line endings, matching the other
 * validators in this directory.
 *
 * @param {string} content
 * @returns {{present: boolean, lines: string[]}}
 */
function extractFrontmatter(content) {
  // Strip BOM if present (UTF-8 BOM: U+FEFF).
  const clean = content.replace(/^\uFEFF/, '');
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { present: false, lines: [] };
  return {
    present: true,
    lines: match[1].split(/\r?\n/)
  };
}

/**
 * Extract top-level keys (with trimmed values) and flag block-scalar
 * `description:` values.
 *
 * Lines that continue a block scalar (`|` or `>`) are skipped — we only
 * care about the top-level key set and the raw indicator on the
 * `description:` line. Block-scalar indicators accept YAML chomp and
 * indent modifiers and trailing comments, e.g. `|`, `|-`, `|+`, `|2`,
 * `|-2`, `>-  # note`.
 *
 * @param {string[]} lines
 * @returns {{values: Record<string,string>, descriptionIndicator: string|null}}
 */
function stripUnquotedYamlComment(rawValue) {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < rawValue.length; index++) {
    const character = rawValue[index];

    if (inDoubleQuote && character === '\\') {
      index += 1;
      continue;
    }
    if (!inDoubleQuote && character === "'") {
      if (inSingleQuote && rawValue[index + 1] === "'") {
        index += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }
    if (!inSingleQuote && character === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote && character === '#'
      && (index === 0 || /\s/.test(rawValue[index - 1]))) {
      return rawValue.slice(0, index).trim();
    }
  }

  return rawValue.trim();
}

function inspectFrontmatter(lines) {
  let values = Object.create(null);
  let syntaxErrors = [];
  let descriptionIndicator = null;
  let inBlockScalar = false;
  let blockScalarIndent = -1;

  for (const rawLine of lines) {
    if (inBlockScalar) {
      // Stay inside the block until a line with indent <= the opener's
      // indent (or an empty continuation).
      const leadingSpaces = rawLine.match(/^(\s*)/)[1].length;
      if (rawLine.trim() === '' || leadingSpaces > blockScalarIndent) {
        continue;
      }
      inBlockScalar = false;
      blockScalarIndent = -1;
    }

    const match = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    const rawValue = match[2];
    // Strip YAML comments only when # appears outside a quoted scalar.
    const valueNoComment = stripUnquotedYamlComment(rawValue);
    values = Object.assign(Object.create(null), values, { [key]: valueNoComment });

    const isQuoted = /^"(?:[^"\\]|\\.)*"$/.test(valueNoComment) || /^'(?:[^']|'')*'$/.test(valueNoComment);

    if (!isQuoted && valueNoComment !== '') {
      // A plain (unquoted) YAML scalar can never contain ": " — that
      // sequence starts a new mapping key. When the translation pass
      // drops a value's quoting, or glues the next frontmatter key onto
      // the end of a value, this is exactly what shows up (see #2630).
      if (valueNoComment.includes(': ')) {
        syntaxErrors = [...syntaxErrors,
          `${key}: unquoted value contains ': ' — invalid YAML; ` + `quote the value or the next key was likely glued onto this line`
        ];
      }

      // '@' and '`' are reserved YAML indicators and cannot start a
      // plain scalar (see #2630 — a reordering during translation moved
      // '@' into the first column of an unquoted description).
      if (/^[@`]/.test(valueNoComment)) {
        syntaxErrors = [
          ...syntaxErrors,
          `${key}: unquoted value starts with reserved character '${valueNoComment[0]}' — quote the value`
        ];
      }
    }

    // Detect literal / folded block-scalar indicators. Accept chomp
    // modifiers (`-` / `+`) and optional indent-indicator digits in
    // either order, per YAML 1.2.
    if (/^[|>](?:[+-]?\d+|\d+[+-]?|[+-])?$/.test(valueNoComment)) {
      if (key === 'description') {
        descriptionIndicator = valueNoComment;
      }
      inBlockScalar = true;
      blockScalarIndent = rawLine.match(/^(\s*)/)[1].length;
    }
  }

  try {
    const parsed = yaml.load(lines.join('\n'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      syntaxErrors = [...syntaxErrors, 'must be a top-level YAML mapping'];
    } else {
      for (const key of ['name', 'description']) {
        if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
        if (typeof parsed[key] !== 'string') {
          syntaxErrors = [...syntaxErrors, `${key}: value must be a string`];
          continue;
        }
        values = Object.assign(Object.create(null), values, { [key]: parsed[key] });
      }
    }
  } catch (error) {
    syntaxErrors = [...syntaxErrors, `invalid YAML: ${error.reason || error.message}`];
  }

  return { values, descriptionIndicator, syntaxErrors };
}


/**
 * Find every SKILL.md under docs/{locale}/skills/*, mirroring the
 * curated skills/ layout one locale directory deeper.
 *
 * @param {string} docsDir
 * @returns {Array<{skillMd: string, label: string}>}
 */
function findDocsSkillFiles(docsDir) {
  if (!fs.existsSync(docsDir)) return [];

  const readDirectories = (directory, label) => {
    try {
      return fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      throw new Error(`unable to read ${label}`);
    }
  };

  const locales = readDirectories(docsDir, 'docs directory')
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name);

  return locales.flatMap(locale => {
    const localeSkillsDir = path.join(docsDir, locale, 'skills');
    if (!fs.existsSync(localeSkillsDir)) return [];

    const skillDirs = readDirectories(localeSkillsDir, `docs/${locale}/skills directory`)
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);

    return skillDirs.map(skillDir => ({
      skillMd: path.join(localeSkillsDir, skillDir, 'SKILL.md'),
      label: `docs/${locale}/skills/${skillDir}/SKILL.md`
    }));
  });
}

/**
 * Quality Validation Rules Table
 *
 * Each rule is evidence-backed from analysis of 100+ skills and includes
 * actionable fix hints. Rules evolve via regression tests.
 */
const QUALITY_RULES = [
  {
    name: 'required-sections',
    description: 'Skill must contain all required sections with content',
    check(content, label, isStrict) {
      const REQUIRED_SECTIONS = ['When to Activate', 'Core Concepts', 'Examples', 'Anti-Patterns', 'Best Practices'];
      const lines = content.split(/\r?\n/);

      const findings = REQUIRED_SECTIONS.reduce((acc, section) => {
        const headingPattern = new RegExp(`^#{1,3}\\s*${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
        const lineNum = lines.findIndex(line => headingPattern.test(line.trim()));

        if (lineNum === -1) {
          return [...acc, {
            label,
            line: 1,
            severity: isStrict ? 'error' : 'warning',
            message: `Missing required section: "${section}"`,
            hint: `Add a level 2 heading "## ${section}" with content below it`
          }];
        }
        return acc;
      }, []);

      return findings;
    }
  },
  {
    name: 'section-depth',
    description: 'Each required section must have meaningful content (200+ chars)',
    check(content, label, isStrict) {
      if (!isStrict) return [];

      const REQUIRED_SECTIONS = ['When to Activate', 'Core Concepts', 'Examples', 'Anti-Patterns', 'Best Practices'];

      const extractSectionBody = (markdown, sectionTitle) => {
        // Match section heading case-insensitively to prevent uppercase or mixed-case headings from being missed
        const headingPattern = new RegExp(`^#{1,3}\\s*${sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
        const sectionHeadingsNormalized = new Map(REQUIRED_SECTIONS.map(t => [t.toLowerCase(), t]));
        const lines = markdown.split(/\r?\n/);
        let inTargetSection = false;
        let sectionStartLine = -1;
        let bodyLines = [];

        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (!inTargetSection) {
            if (headingPattern.test(trimmed)) {
              inTargetSection = true;
              sectionStartLine = i;
            }
            continue;
          }

          // Normalize heading text to lowercase for comparison to catch UPPERCASE or MixedCase headings
          const nextHeadingMatch = trimmed.match(/^#{1,3}\s*(.+?)\s*$/);
          if (nextHeadingMatch && sectionHeadingsNormalized.has(nextHeadingMatch[1].trim().toLowerCase())) {
            break;
          }

          bodyLines = [...bodyLines, lines[i]];
        }

        return { body: bodyLines.join('\n').trim(), startLine: sectionStartLine };
      };

      const findings = REQUIRED_SECTIONS.reduce((acc, section) => {
        const { body, startLine } = extractSectionBody(content, section);
        const normalized = body.replace(/[`*_~>#\-\s]/g, '').toLowerCase();
        const isEmpty = !normalized || ['todo', 'tbd', 'n/a', 'na', 'placeholder'].includes(normalized);
        const isTooShort = body.length < 200;

        if (isEmpty || isTooShort) {
          return [...acc, {
            label,
            line: startLine + 2,
            severity: 'error',
            message: `Section "${section}" is ${isEmpty ? 'empty or placeholder-only' : 'too short'} (${body.length} chars)`,
            hint: `Expand "${section}" with meaningful content (aim for 200+ characters describing practical use and patterns)`
          }];
        }
        return acc;
      }, []);

      return findings;
    }
  },
  {
    name: 'secret-patterns',
    description: 'Detect hardcoded API keys, tokens, and credentials',
    check(content, label) {
      const SECRET_PATTERNS = [
        // Only match hardcoded credential values in quotes, not variable assignments or function calls
        // Matches: api_key = "sk_live_..." or password = "secretpass123..." (with quotes)
        // Rejects: token = generateTestJWT(...), api_key = PropertyMock(...), password = hashedPassword
        // Minimum 8 characters for quoted assignments to catch realistic short credentials like "Passw0rd1234!"
        // Character class includes alphanumeric, underscore, special chars: - : / . ! @ # $ % ^ & * ( ) = + [ ] { } | ; ' < > ? , ~
        /(?:api[_-]?key|token|secret|passwd|password|access[_-]?key)\s*[:=]\s*["']([A-Za-z0-9_\-:/.!@#$%^&*()=+[\]{}|;'<>?,~]{8,})["']/gi,
        /sk_(?:live|test)_[A-Za-z0-9]{32,}/g,  // Require longer suffix for actual SK keys
        /ghp_[A-Za-z0-9]{20,}(?![a-z])/g,  // Negative lookahead to avoid partial matches
        /xox[baprs]-[A-Za-z0-9-]{32,}/g,  // Require longer OAuth tokens
      ];

      const lines = content.split(/\r?\n/);

      const findings = lines.reduce((acc, line, index) => {
        // Skip lines that are clearly documentation examples or narrowly-defined placeholders
        // Do NOT skip lines based on code block boundaries — scan all content for real secrets
        const isDocExample = line.match(/^\s*\/\//) || 
                           line.includes('EXAMPLE') || line.includes('example:') ||
                           line.includes('<YOUR_') || line.includes('[YOUR_') ||
                           line.includes('placeholder') || line.match(/^\s*-\s+/);
        if (isDocExample) return acc;
        
        let updatedAcc = acc;
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.test(line)) {
            const matchCount = (line.match(pattern) || []).length;
            updatedAcc = [...updatedAcc, {
              label,
              line: index + 1,
              severity: 'error',
              message: `Detected ${matchCount} secret-like pattern(s) (API key, token, etc.)`,
              hint: `Replace with placeholder like '<YOUR_API_KEY>' or reference to documentation on obtaining credentials`
            }];
            pattern.lastIndex = 0; // Reset global regex
          }
        }
        return updatedAcc;
      }, []);

      return findings;
    }
  }
];

/**
 * Run quality checks on skill content, returning findings with line numbers
 * and fix hints for actionable feedback.
 *
 * @param {string} content
 * @param {string} label
 * @param {boolean} isStrict
 * @returns {Array<{label: string, line: number, severity: string, message: string, hint: string}>}
 */
function checkQualityRules(content, label, isStrict) {
  const findings = QUALITY_RULES.reduce((acc, rule) => {
    const ruleFinding = rule.check(content, label, isStrict);
    return [...acc, ...ruleFinding];
  }, []);

  return findings;
}

function validateSkills() {
  const curatedExists = fs.existsSync(SKILLS_DIR);
  const docsSkillFiles = DOCS_DIR ? findDocsSkillFiles(DOCS_DIR) : [];

  if (!curatedExists && docsSkillFiles.length === 0) {
    console.log('No skills directory (skills/ or docs/*/skills/), skipping');
    process.exit(0);
  }

  let hasErrors = false;
  let warnCount = 0;
  let validCount = 0;

  const reportFrontmatterFinding = msg => {
    if (STRICT) {
      console.error(`ERROR: ${msg}`);
      hasErrors = true;
    } else {
      console.warn(`WARN: ${msg}`);
      warnCount++;
    }
  };

  const reportQualityFinding = (finding) => {
    if (finding.severity === 'error') {
      console.error(`ERROR: ${finding.label}:${finding.line} - ${finding.message}`);
      console.error(`       Fix: ${finding.hint}`);
      hasErrors = true;
    } else if (finding.severity === 'warning' && STRICT) {
      console.error(`ERROR: ${finding.label}:${finding.line} - ${finding.message}`);
      console.error(`       Fix: ${finding.hint}`);
      hasErrors = true;
    } else if (finding.severity === 'warning') {
      console.warn(`WARN: ${finding.label}:${finding.line} - ${finding.message}`);
      console.warn(`      Fix: ${finding.hint}`);
      warnCount++;
    }
  };

  const processSkillFile = (skillMd, label, requireFrontmatter) => {
    if (!fs.existsSync(skillMd)) {
      console.error(`ERROR: ${label} - Missing SKILL.md`);
      return false;
    }

    let content;
    try {
      content = fs.readFileSync(skillMd, 'utf-8');
    } catch (err) {
      console.error(`ERROR: ${label} - ${err.message}`);
      return false;
    }
    if (content.trim().length === 0) {
      console.error(`ERROR: ${label} - Empty file`);
      return false;
    }

    const fm = extractFrontmatter(content);
    if (!fm.present) {
      if (requireFrontmatter) {
        reportFrontmatterFinding(`${label} - no frontmatter block found (missing name/description)`);
      }
      // IMPORTANT: Always run quality checks even without frontmatter to catch secrets and content issues
      // in curated skills that skip frontmatter validation
      const qualityFindings = checkQualityRules(content, label, STRICT);
      for (const finding of qualityFindings) {
        reportQualityFinding(finding);
      }
      return true;
    }

    const { values, descriptionIndicator, syntaxErrors } = inspectFrontmatter(fm.lines);

    if (!Object.prototype.hasOwnProperty.call(values, 'name')) {
      reportFrontmatterFinding(`${label} - frontmatter missing required field: name`);
    } else if (values.name === '') {
      reportFrontmatterFinding(`${label} - frontmatter 'name' is empty`);
    }

    if (!Object.prototype.hasOwnProperty.call(values, 'description')) {
      reportFrontmatterFinding(`${label} - frontmatter missing required field: description`);
    } else if (values.description === '') {
      reportFrontmatterFinding(`${label} - frontmatter 'description' is empty`);
    }

    if (descriptionIndicator && descriptionIndicator.startsWith('|')) {
      reportFrontmatterFinding(
        `${label} - frontmatter description uses literal block scalar ` + `'${descriptionIndicator}' which preserves internal newlines; ` + `use an inline string or folded '>' scalar instead`
      );
    }

    for (const syntaxError of syntaxErrors) {
      reportFrontmatterFinding(`${label} - frontmatter ${syntaxError}`);
    }

    // Run quality checks
    const qualityFindings = checkQualityRules(content, label, STRICT);
    for (const finding of qualityFindings) {
      reportQualityFinding(finding);
    }

    return true;
  };

  if (curatedExists) {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);

    for (const dir of dirs) {
      const skillMd = path.join(SKILLS_DIR, dir, 'SKILL.md');
      if (processSkillFile(skillMd, `${dir}/SKILL.md`, false)) {
        validCount++;
      } else {
        hasErrors = true;
      }
    }
  }

  for (const { skillMd, label } of docsSkillFiles) {
    if (processSkillFile(skillMd, label, true)) {
      validCount++;
    } else {
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  let msg = `Validated ${validCount} skill directories`;
  if (warnCount > 0) {
    msg += ` (${warnCount} warning${warnCount === 1 ? '' : 's'})`;
  }
  console.log(msg);
}

try {
  validateSkills();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
