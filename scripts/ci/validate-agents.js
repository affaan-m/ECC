#!/usr/bin/env node
/**
 * Validate agent markdown files have required frontmatter
 */

const fs = require('fs');
const path = require('path');

const AGENTS_DIR = path.join(__dirname, '../../agents');
const REQUIRED_FIELDS = ['model', 'tools'];
const VALID_MODELS = ['haiku', 'sonnet', 'opus'];

function extractFrontmatter(content) {
  // Strip BOM if present (UTF-8 BOM: \uFEFF)
  const cleanContent = content.replace(/^\uFEFF/, '');
  // Support both LF and CRLF line endings
  const match = cleanContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const frontmatter = {};
  const duplicates = [];
  const sequenceFields = [];
  let currentTopLevelKey = null;
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    if (/^\s*-\s+/.test(line)) {
      if (currentTopLevelKey) {
        sequenceFields.push(currentTopLevelKey);
      }
      continue;
    }

    // Only top-level keys are unique. Indented YAML belongs to nested values.
    if (/^\s/.test(line)) continue;
    if (!line.trim() || line.trim().startsWith('#')) continue;

    currentTopLevelKey = null;
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      currentTopLevelKey = key;
      if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
        duplicates.push(key);
      }
      frontmatter[key] = value;
      if (value && '[!&*{|>'.includes(value[0])) {
        sequenceFields.push(key);
      }
    }
  }
  Object.defineProperty(frontmatter, '__duplicates__', {
    value: duplicates,
    enumerable: false,
  });
  Object.defineProperty(frontmatter, '__sequenceFields__', {
    value: sequenceFields,
    enumerable: false,
  });
  return frontmatter;
}

function validateAgents() {
  if (!fs.existsSync(AGENTS_DIR)) {
    console.log('No agents directory found, skipping validation');
    process.exit(0);
  }

  const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'));
  let hasErrors = false;

  for (const file of files) {
    const filePath = path.join(AGENTS_DIR, file);
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      console.error(`ERROR: ${file} - ${err.message}`);
      hasErrors = true;
      continue;
    }
    const frontmatter = extractFrontmatter(content);

    if (!frontmatter) {
      console.error(`ERROR: ${file} - Missing frontmatter`);
      hasErrors = true;
      continue;
    }

    if (frontmatter.__duplicates__.length > 0) {
      console.error(`ERROR: ${file} - Duplicate frontmatter keys: ${[...new Set(frontmatter.__duplicates__)].join(', ')}`);
      hasErrors = true;
    }

    for (const field of REQUIRED_FIELDS) {
      if (!frontmatter[field] || (typeof frontmatter[field] === 'string' && !frontmatter[field].trim())) {
        console.error(`ERROR: ${file} - Missing required field: ${field}`);
        hasErrors = true;
      }
    }

    if (frontmatter.__sequenceFields__.includes('tools')) {
      console.error(`ERROR: ${file} - Agent tools must be a comma-separated scalar, not a YAML sequence`);
      hasErrors = true;
    }

    // Validate model is a known value
    if (frontmatter.model && !VALID_MODELS.includes(frontmatter.model)) {
      console.error(`ERROR: ${file} - Invalid model '${frontmatter.model}'. Must be one of: ${VALID_MODELS.join(', ')}`);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }

  console.log(`Validated ${files.length} agent files`);
}

validateAgents();
