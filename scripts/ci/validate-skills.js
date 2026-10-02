#!/usr/bin/env node
/**
 * Validate curated skill directories (skills/ in repo) and their
 * translated mirrors (docs/{locale}/skills/ in repo).
 *
 * Checks:
 *   1. Each sub-directory of skills/ contains a SKILL.md file.
 *   2. SKILL.md is non-empty.
 *   3. SKILL.md frontmatter is present and declares both `name:` and
 *      `description:` fields.
 *   4. SKILL.md frontmatter `description:` uses an inline scalar — not a
 *      literal block scalar (`|` / `|-` / `|+`), which preserves internal
 *      newlines and breaks flat-table renderers keyed off `description`.
 *
 * Frontmatter findings default to WARN so CI does not break while
 * pre-existing data defects are being cleaned up out of band (see #1663).
 * Pass `--strict` or set `CI_STRICT_SKILLS=1` to promote frontmatter
 * findings to errors (exit 1).
 *
 * Structural findings (missing/empty SKILL.md) are always errors.
 *
 * Scope: curated skills/ plus translated docs/{locale}/skills/ mirrors.
 * Learned/imported/evolved roots are out of scope. If neither root
 * exists, exit 0 (nothing to validate).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SKILLS_DIR = path.join(__dirname, '../../skills');
const DOCS_DIR = path.join(__dirname, '../../docs');

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
 * Validate a single skill directory.
 *
 * Returns `{ fatal }` where `fatal` indicates a structural error that
 * should be surfaced via `console.error` and abort CI (missing/empty
 * SKILL.md). Frontmatter findings are routed through
 * `reportFrontmatterFinding`, which owns the WARN/ERROR decision based
 * on strict mode.
 *
 * Curated skills/ tolerates a SKILL.md with no frontmatter block at all
 * (frontmatter checks only apply when a block is present) — this mirrors
 * pre-existing behavior and is covered by an explicit regression test.
 *
 * @param {string} dir
 * @param {string} skillsDir
 * @param {(msg: string) => void} reportFrontmatterFinding
 * @returns {{fatal: boolean}}
 */
function validateSkillDir(dir, skillsDir, reportFrontmatterFinding) {
  const skillMd = path.join(skillsDir, dir, 'SKILL.md');
  return validateSkillFile(skillMd, `${dir}/SKILL.md`, reportFrontmatterFinding, { requireFrontmatter: false });
}

/**
 * Validate a single SKILL.md file at an arbitrary path.
 *
 * Shared by the curated skills/ scan and the translated
 * docs/{locale}/skills/ scan — same checks apply to both, since a
 * translated mirror's frontmatter must be just as parseable as the
 * English original (see #2630).
 *
 * `requireFrontmatter: true` (used for docs/{locale}/skills/ mirrors)
 * flags a completely missing frontmatter block as a finding — the
 * translated mirror must carry the same `name`/`description` as its
 * English original. Curated skills/ (requireFrontmatter: false) keeps
 * the pre-existing tolerant behavior of skipping checks entirely when no
 * block is present.
 *
 * @param {string} skillMd
 * @param {string} label
 * @param {(msg: string) => void} reportFrontmatterFinding
 * @param {{requireFrontmatter?: boolean}} [opts]
 * @returns {{fatal: boolean}}
 */
function validateSkillFile(skillMd, label, reportFrontmatterFinding, opts = {}) {
  const { requireFrontmatter = false } = opts;

  if (!fs.existsSync(skillMd)) {
    console.error(`ERROR: ${label} - Missing SKILL.md`);
    return { fatal: true };
  }

  let content;
  try {
    content = fs.readFileSync(skillMd, 'utf-8');
  } catch (err) {
    console.error(`ERROR: ${label} - ${err.message}`);
    return { fatal: true };
  }
  if (content.trim().length === 0) {
    console.error(`ERROR: ${label} - Empty file`);
    return { fatal: true };
  }

  const fm = extractFrontmatter(content);
  if (!fm.present) {
    if (requireFrontmatter) {
      reportFrontmatterFinding(`${label} - no frontmatter block found (missing name/description)`);
    }
    return { fatal: false };
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

  return { fatal: false };
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

function validateSkills() {
  const curatedExists = fs.existsSync(SKILLS_DIR);
  const docsSkillFiles = findDocsSkillFiles(DOCS_DIR);

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

  if (curatedExists) {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);

    for (const dir of dirs) {
      const { fatal } = validateSkillDir(dir, SKILLS_DIR, reportFrontmatterFinding);
      if (fatal) {
        hasErrors = true;
        continue;
      }
      validCount++;
    }
  }

  for (const { skillMd, label } of docsSkillFiles) {
    const { fatal } = validateSkillFile(skillMd, label, reportFrontmatterFinding, { requireFrontmatter: true });
    if (fatal) {
      hasErrors = true;
      continue;
    }
    validCount++;
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
