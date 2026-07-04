#!/usr/bin/env node
/**
 * Validate OpenSpec syntax and metadata consistency.
 *
 * Checks:
 *   - All Requirement blocks have at least one Scenario
 *   - Scenario headings use exactly 4 hashtags (####)
 *   - HTML comment metadata keys are valid
 *   - id anchors are unique across all specs
 *   - enforced references are present on Requirements
 *   - Invariants do not have Scenarios
 *   - Delta files have valid section structure
 *
 * Exit codes:
 *   0 — all specs valid (or no specs to check)
 *   1 — validation errors found
 *   3 — CLI usage error
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SPECS_DIR = path.join(ROOT, 'openspec', 'specs');
const DELTAS_DIR = path.join(ROOT, 'openspec', 'deltas');

const VALID_META_KEYS = new Set([
  'id', 'entities', 'enforced', 'test', 'verified_by',
  'depends_on', 'triggers', 'uncertainty', 'deferred',
  'delta', 'removal-reason', 'replacement',
]);

function collectSpecs(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSpecs(full));
    } else if (entry.isFile() && entry.name === 'spec.md') {
      results.push(full);
    }
  }
  return results;
}

function collectDeltas(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectDeltas(full));
    } else if (entry.isFile() && entry.name === 'delta.md') {
      results.push(full);
    }
  }
  return results;
}

function parseBlocks(content) {
  const blocks = [];
  const lines = content.split('\n');
  let currentBlock = null;
  let currentType = null;
  let seenScenario = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Requirement or Invariant header
    const reqMatch = line.match(/^###\s+Requirement:\s*(.+)$/);
    const invMatch = line.match(/^###\s+Invariant:\s*(.+)$/);

    if (reqMatch || invMatch) {
      if (currentBlock) {
        blocks.push({ ...currentBlock, hasScenario: seenScenario });
      }
      currentType = reqMatch ? 'Requirement' : 'Invariant';
      currentBlock = {
        type: currentType,
        name: (reqMatch || invMatch)[1].trim(),
        line: i + 1,
        metadata: {},
        scenarios: [],
      };
      seenScenario = false;
      continue;
    }

    if (!currentBlock) continue;

    // Scenario header — must be #### (4 hashtags)
    const scenarioMatch = line.match(/^(#{1,6})\s*Scenario:\s*(.+)$/);
    if (scenarioMatch) {
      const depth = scenarioMatch[1].length;
      if (depth !== 4) {
        currentBlock.scenarioDepthError = { line: i + 1, actual: depth };
      }
      currentBlock.scenarios.push({
        name: scenarioMatch[2].trim(),
        line: i + 1,
      });
      seenScenario = true;
      continue;
    }

    // HTML comment metadata
    const commentMatch = line.match(/<!--\s*([a-z_]+):\s*(.*?)\s*-->/);
    if (commentMatch) {
      const key = commentMatch[1];
      const value = commentMatch[2];
      if (!VALID_META_KEYS.has(key)) {
        if (!currentBlock.unknownKeys) currentBlock.unknownKeys = [];
        currentBlock.unknownKeys.push({ line: i + 1, key });
      }
      currentBlock.metadata[key] = value;
    }
  }

  if (currentBlock) {
    blocks.push({ ...currentBlock, hasScenario: seenScenario });
  }

  return blocks;
}

function validateSpec(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return [{ file: path.relative(ROOT, filePath), error: `Failed to read file: ${err.message}` }];
  }

  const errors = [];
  const blocks = parseBlocks(content);
  const relativePath = path.relative(ROOT, filePath);

  for (const block of blocks) {
    // Requirements must have at least one Scenario
    if (block.type === 'Requirement' && !block.hasScenario && block.scenarios.length === 0) {
      errors.push({ file: relativePath, line: block.line, error: `Requirement "${block.name}" has no Scenarios` });
    }

    // Requirements and Invariants must have an enforcement point
    if (!block.metadata.enforced) {
      errors.push({ file: relativePath, line: block.line, error: `${block.type} "${block.name}" is missing <!-- enforced: --> — required for freshness traceability` });
    }

    // Invariants must NOT have Scenarios
    if (block.type === 'Invariant' && block.hasScenario) {
      errors.push({ file: relativePath, line: block.line, error: `Invariant "${block.name}" has Scenarios — Invariants describe always-true constraints` });
    }

    // Scenario depth must be exactly 4
    if (block.scenarioDepthError) {
      errors.push({
        file: relativePath,
        line: block.scenarioDepthError.line,
        error: `Scenario in "${block.name}" uses ${block.scenarioDepthError.actual} hashtags — must use exactly 4 (####)`,
      });
    }

    // Unknown metadata keys
    if (block.unknownKeys) {
      for (const uk of block.unknownKeys) {
        errors.push({
          file: relativePath,
          line: uk.line,
          error: `Unknown metadata key "<!-- ${uk.key}: -->" in "${block.name}". Valid keys: ${[...VALID_META_KEYS].join(', ')}`,
        });
      }
    }
  }

  return errors;
}

function checkIdUniqueness(specFiles) {
  const idMap = new Map();
  const errors = [];

  for (const filePath of specFiles) {
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      errors.push({
        file: path.relative(ROOT, filePath),
        error: `Failed to read file for ID scan: ${err.message}`,
      });
      continue;
    }

    const relativePath = path.relative(ROOT, filePath);
    const idRe = /<!--\s*id:\s*([^\s>]+)/g;
    let m;
    while ((m = idRe.exec(content)) !== null) {
      const id = m[1];
      if (idMap.has(id)) {
        errors.push({
          file: relativePath,
          error: `Duplicate id "${id}" — also found in ${idMap.get(id)}`,
        });
      } else {
        idMap.set(id, relativePath);
      }
    }
  }

  return errors;
}

function validateDelta(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return [{ file: path.relative(ROOT, filePath), error: `Failed to read delta file: ${err.message}` }];
  }

  const errors = [];
  const relativePath = path.relative(ROOT, filePath);

  const validSections = [
    'ADDED Requirements', 'MODIFIED Requirements', 'REMOVED Requirements',
    'ADDED Invariants', 'MODIFIED Invariants', 'REMOVED Invariants',
  ];

  const sectionRe = /^##\s+(.+)$/gm;
  let m;
  while ((m = sectionRe.exec(content)) !== null) {
    const sectionName = m[1];
    if (!validSections.includes(sectionName)) {
      errors.push({
        file: relativePath,
        line: content.substring(0, m.index).split('\n').length,
        error: `Invalid delta section "## ${sectionName}". Valid sections: ${validSections.join(', ')}`,
      });
    }
  }

  return errors;
}

function main() {
  const specFiles = collectSpecs(SPECS_DIR);
  const deltaFiles = collectDeltas(DELTAS_DIR);
  const allErrors = [];

  if (specFiles.length === 0 && deltaFiles.length === 0) {
    console.log('No OpenSpec files found — nothing to validate.');
    process.exit(0);
  }

  // Validate each spec file
  for (const file of specFiles) {
    const errors = validateSpec(file);
    allErrors.push(...errors);
  }

  // Check id uniqueness across all specs
  if (specFiles.length > 0) {
    const idErrors = checkIdUniqueness(specFiles);
    allErrors.push(...idErrors);
  }

  // Validate each delta file
  for (const file of deltaFiles) {
    const errors = validateDelta(file);
    allErrors.push(...errors);
  }

  if (allErrors.length === 0) {
    console.log(`Validated ${specFiles.length} spec file(s) and ${deltaFiles.length} delta file(s) — all valid.`);
    process.exit(0);
  }

  console.error(`${allErrors.length} OpenSpec validation error(s):\n`);
  for (const e of allErrors) {
    const loc = e.line ? `:${e.line}` : '';
    console.error(`  ${e.file}${loc} — ${e.error}`);
  }

  process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(3);
  }
}

module.exports = { parseBlocks, validateSpec, checkIdUniqueness, validateDelta, collectSpecs, collectDeltas };
