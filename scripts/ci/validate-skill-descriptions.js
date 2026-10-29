#!/usr/bin/env node
/**
 * Validate the always-on cost of skill discovery.
 *
 * Every skill's `name` + `description` is injected into every session so the
 * model knows the skill exists. That metadata is a fixed cost paid on every
 * request, and nothing currently fails when it grows: skills simply stop being
 * listed once the harness budget is exhausted.
 *
 * `manifests/context-profiles/full@1.json` declares an 8,000 token budget for
 * that surface, but the shipped skills need far more. `full@1` runs in
 * `report-only` mode, so the breach is invisible in CI.
 *
 * This validator makes the trend a failing check without breaking the repo:
 *
 *   - total listing tokens may never exceed the ceiling in
 *     manifests/skill-description-budget.json (a ratchet: lower it when you trim)
 *   - a single description may not exceed maxDescriptionChars
 *   - the gap to targetListingTokens is reported as progress, not an error
 *
 * Token estimate is the repo's own `utf8-bytes-div-4@1` method, matching
 * scripts/lib/context-profiles.js so both numbers are comparable.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SKILLS_DIR = path.join(ROOT, 'skills');

/**
 * Read a SKILL.md frontmatter block.
 * Handles inline scalars and `>` / `|` block scalars without a YAML dependency
 * so the check runs from an installed plugin copy as well as from a checkout.
 * @param {string} content - Raw SKILL.md contents
 * @returns {{name: string, description: string}|null}
 */
function readFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return null;

  const lines = match[1].split(/\r?\n/);
  const values = {};

  for (let index = 0; index < lines.length; index += 1) {
    const entry = /^(name|description):\s*(.*)$/.exec(lines[index]);
    if (!entry) continue;

    const [, key, raw] = entry;
    const value = raw.trim();

    if (/^[>|][+-]?$/.test(value)) {
      const block = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (next.trim() === '') {
          block.push('');
          index += 1;
          continue;
        }
        if (!/^\s+\S/.test(next)) break;
        block.push(next.trim());
        index += 1;
      }
      while (block.length > 0 && block[block.length - 1] === '') block.pop();
      values[key] = block.join(' ');
      continue;
    }

    values[key] = value.replace(/^['"]|['"]$/g, '');
  }

  if (!values.description) return null;
  return { name: values.name || '', description: values.description };
}

/**
 * Render cost of one skill's listing metadata, using the repo estimator.
 * @param {string} name - Skill name
 * @param {string} description - Skill description
 * @returns {number} Estimated tokens
 */
function estimateTokens(name, description) {
  const payload = JSON.stringify(
    { harness: 'claude', type: 'skill', name, description },
    null,
    2,
  );
  return Math.ceil((Buffer.byteLength(`${payload}\n`, 'utf8')) / 4);
}

/**
 * Collect every skill's listing cost.
 * @returns {Array<{skill: string, name: string, chars: number, tokens: number}>}
 */
function collectSkills(skillsDir = SKILLS_DIR) {
  if (!fs.existsSync(skillsDir)) return [];

  const rows = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;

    const frontmatter = readFrontmatter(fs.readFileSync(skillPath, 'utf8'));
    if (!frontmatter) continue;

    const name = frontmatter.name || entry.name;
    rows.push({
      skill: entry.name,
      name,
      chars: frontmatter.description.length,
      tokens: estimateTokens(name, frontmatter.description),
    });
  }
  return rows;
}

/**
 * Check every skill description against the committed budget.
 * @param {string} root - Repo root to check
 * @returns {{errors: string[], count: number, totalTokens: number, target: number|null}}
 */
function checkDescriptions(root = ROOT) {
  const errors = [];
  const budgetPath = path.join(root, 'manifests/skill-description-budget.json');
  const skillsDir = path.join(root, 'skills');

  if (!fs.existsSync(budgetPath)) {
    return {
      errors: [`missing ${path.relative(root, budgetPath)}`],
      count: 0,
      totalTokens: 0,
      target: null,
    };
  }
  const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
  const { maxDescriptionChars, maxListingTokens, targetListingTokens } = budget;

  if (typeof maxDescriptionChars !== 'number' || typeof maxListingTokens !== 'number') {
    return {
      errors: ['skill-description-budget.json is missing numeric limits'],
      count: 0,
      totalTokens: 0,
      target: null,
    };
  }

  const rows = collectSkills(skillsDir);
  if (rows.length === 0) {
    return { errors: ['no skills found to validate'], count: 0, totalTokens: 0, target: null };
  }

  for (const row of rows) {
    if (row.chars > maxDescriptionChars) {
      errors.push(
        `${row.skill} - description is ${row.chars} chars (max ${maxDescriptionChars})`,
      );
    }
  }

  const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  if (totalTokens > maxListingTokens) {
    errors.push(
      `skill listing is ${totalTokens} tokens, ceiling is ${maxListingTokens} `
      + `(+${totalTokens - maxListingTokens}). Trim descriptions until the total fits `
      + 'the committed ceiling.',
    );
  }

  return {
    errors,
    count: rows.length,
    totalTokens,
    target: typeof targetListingTokens === 'number' ? targetListingTokens : null,
  };
}

function main() {
  const { errors, count, totalTokens, target } = checkDescriptions();
  if (errors.length > 0) {
    errors.forEach(line => console.error(`ERROR: ${line}`));
    process.exit(1);
  }
  const progress = target
    ? ` (${Math.round((totalTokens / target) * 100)}% of the ${target} token profile budget)`
    : '';
  console.log(`Validated ${count} skill descriptions - `
    + `${totalTokens} listing tokens${progress}`);
}

module.exports = { checkDescriptions, readFrontmatter, estimateTokens };

if (require.main === module) {
  main();
}
