#!/usr/bin/env node
/**
 * Validate rule markdown files
 */

const fs = require('fs');
const path = require('path');

const RULES_DIR = path.join(__dirname, '../../rules');

/**
 * Recursively collect markdown rule files.
 * Uses explicit traversal for portability across Node versions.
 * @param {string} dir - Directory to scan
 * @returns {string[]} Relative file paths from RULES_DIR
 */
function collectRuleFiles(dir) {
  const files = [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectRuleFiles(absolute));
      continue;
    }

    if (entry.name.endsWith('.md')) {
      files.push(path.relative(RULES_DIR, absolute));
    }

    // Non-markdown files are ignored.
  }

  return files;
}

function validateRules() {
  if (!fs.existsSync(RULES_DIR)) {
    console.log('No rules directory found, skipping validation');
    process.exit(0);
  }

  const files = collectRuleFiles(RULES_DIR);
  let hasErrors = false;
  let validatedCount = 0;

  for (const file of files) {
    const filePath = path.join(RULES_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.trim().length === 0) {
        console.error(`ERROR: ${file} - Empty rule file`);
        hasErrors = true;
        continue;
      }
      validatedCount++;
    } catch (err) {
      console.error(`ERROR: ${file} - ${err.message}`);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  console.log(`Validated ${validatedCount} rule files`);
}

validateRules();
