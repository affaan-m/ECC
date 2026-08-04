#!/usr/bin/env node
/**
 * Validate curated skill directories (skills/ in repo).
 *
 * Checks:
 *   1. Each sub-directory of skills/ contains a SKILL.md file.
 *   2. SKILL.md is non-empty.
 *   3. SKILL.md frontmatter (if present) declares a `name:` field.
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
 * Scope: curated only. Learned/imported/evolved roots are out of scope.
 * If skills/ does not exist, exit 0 (no curated skills to validate).
 */

const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname, '../../skills');

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
function inspectFrontmatter(lines) {
  const values = Object.create(null);
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
    // Strip unquoted comments for value/indicator inspection. Handles both
    // trailing comments (`foo: bar # note`) and comment-only values
    // (`foo: # todo`) so the latter is treated as empty.
    const valueNoComment = rawValue
      .replace(/^\s*#.*$/, '')
      .replace(/\s+#.*$/, '')
      .trim();
    values[key] = valueNoComment;

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

  return { values, descriptionIndicator };
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
 * @param {string} dir
 * @param {string} skillsDir
 * @param {(msg: string) => void} reportFrontmatterFinding
 * @returns {{fatal: boolean}}
 */
function validateSkillDir(dir, skillsDir, reportFrontmatterFinding) {
  const skillMd = path.join(skillsDir, dir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) {
    console.error(`ERROR: ${dir}/ - Missing SKILL.md`);
    return { fatal: true };
  }

  let content;
  try {
    content = fs.readFileSync(skillMd, 'utf-8');
  } catch (err) {
    console.error(`ERROR: ${dir}/SKILL.md - ${err.message}`);
    return { fatal: true };
  }
  if (content.trim().length === 0) {
    console.error(`ERROR: ${dir}/SKILL.md - Empty file`);
    return { fatal: true };
  }

  const fm = extractFrontmatter(content);
  if (fm.present) {
    const { values, descriptionIndicator } = inspectFrontmatter(fm.lines);

    if (!Object.prototype.hasOwnProperty.call(values, 'name')) {
      reportFrontmatterFinding(`${dir}/SKILL.md - frontmatter missing required field: name`);
    } else if (values.name === '') {
      reportFrontmatterFinding(`${dir}/SKILL.md - frontmatter 'name' is empty`);
    }

    if (descriptionIndicator && descriptionIndicator.startsWith('|')) {
      reportFrontmatterFinding(
        `${dir}/SKILL.md - frontmatter description uses literal block scalar ` + `'${descriptionIndicator}' which preserves internal newlines; ` + `use an inline string or folded '>' scalar instead`
      );
    }
  }

  return { fatal: false };
}

function validateSkills() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.log('No curated skills directory (skills/), skipping');
    process.exit(0);
  }

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);

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

  for (const dir of dirs) {
    const { fatal } = validateSkillDir(dir, SKILLS_DIR, reportFrontmatterFinding);
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

validateSkills();
