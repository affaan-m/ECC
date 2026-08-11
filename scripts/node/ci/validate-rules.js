#!/usr/bin/env node
/**
 * Validate rule markdown files
 */

const fs = require('fs');
const path = require('path');

const RULES_DIR = path.join(__dirname, '../../../content/rules');

function validateRules() {
  if (!fs.existsSync(RULES_DIR)) {
    console.log('No rules directory found, skipping validation');
    process.exit(0);
  }

  const files = fs.readdirSync(RULES_DIR, { recursive: true })
    .filter(f => f.endsWith('.md'));
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
