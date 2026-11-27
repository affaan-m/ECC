'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ensureDir } = require('../utils');

const PROVENANCE_FILE_NAME = '.provenance.json';
const SKILL_TYPES = Object.freeze({
  CURATED: 'curated',
  LEARNED: 'learned',
  IMPORTED: 'imported',
  UNKNOWN: 'unknown',
});

function resolveRepoRoot(repoRoot) {
  if (repoRoot) {
    return path.resolve(repoRoot);
  }

  return path.resolve(__dirname, '..', '..', '..');
}

function resolveHomeDir(homeDir) {
  return homeDir ? path.resolve(homeDir) : os.homedir();
}

function normalizeSkillDir(skillPath) {
  if (!skillPath || typeof skillPath !== 'string') {
    throw new Error('skillPath is required');
  }

  const resolvedPath = path.resolve(skillPath);
  if (path.basename(resolvedPath) === 'SKILL.md') {
    return path.dirname(resolvedPath);
  }

  return resolvedPath;
}

function isWithinRoot(targetPath, rootPath) {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === '' || (
    !relativePath.startsWith('..')
    && !path.isAbsolute(relativePath)
  );
}

function getSkillRoots(options = {}) {
  const repoRoot = resolveRepoRoot(options.repoRoot);
  const homeDir = resolveHomeDir(options.homeDir);

  return {
    curated: path.join(repoRoot, 'skills'),
    learned: path.join(homeDir, '.claude', 'skills', 'learned'),
    imported: path.join(homeDir, '.claude', 'skills', 'imported'),
  };
}

function classifySkillPath(skillPath, options = {}) {
  const skillDir = normalizeSkillDir(skillPath);
  const roots = getSkillRoots(options);

  if (isWithinRoot(skillDir, roots.curated)) {
    return SKILL_TYPES.CURATED;
  }

  if (isWithinRoot(skillDir, roots.learned)) {
    return SKILL_TYPES.LEARNED;
  }

  if (isWithinRoot(skillDir, roots.imported)) {
    return SKILL_TYPES.IMPORTED;
  }

  return SKILL_TYPES.UNKNOWN;
}

function requiresProvenance(skillPath, options = {}) {
  const skillType = classifySkillPath(skillPath, options);
  return skillType === SKILL_TYPES.LEARNED || skillType === SKILL_TYPES.IMPORTED;
}

function getProvenancePath(skillPath) {
  return path.join(normalizeSkillDir(skillPath), PROVENANCE_FILE_NAME);
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }

  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
}

function validateProvenance(record) {
  const errors = [];

  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    errors.push('provenance record must be an object');
    return {
      valid: false,
      errors,
    };
  }

  if (typeof record.source !== 'string' || record.source.trim().length === 0) {
    errors.push('source is required');
  }

  if (!isIsoTimestamp(record.created_at)) {
    errors.push('created_at must be an ISO timestamp');
  }

  if (typeof record.confidence !== 'number' || Number.isNaN(record.confidence)) {
    errors.push('confidence must be a number');
  } else if (record.confidence < 0 || record.confidence > 1) {
    errors.push('confidence must be between 0 and 1');
  }

  if (typeof record.author !== 'string' || record.author.trim().length === 0) {
    errors.push('author is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function assertValidProvenance(record) {
  const validation = validateProvenance(record);
  if (!validation.valid) {
    throw new Error(`Invalid provenance metadata: ${validation.errors.join('; ')}`);
  }
}

function readProvenance(skillPath, options = {}) {
  const skillDir = normalizeSkillDir(skillPath);
  const provenancePath = getProvenancePath(skillDir);
  const provenanceRequired = options.required === true || requiresProvenance(skillDir, options);

  if (!fs.existsSync(provenancePath)) {
    if (provenanceRequired) {
      throw new Error(`Missing provenance metadata for ${skillDir}`);
    }

    return null;
  }

  const record = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  assertValidProvenance(record);
  return record;
}

function writeProvenance(skillPath, record, options = {}) {
  const skillDir = normalizeSkillDir(skillPath);

  if (!requiresProvenance(skillDir, options)) {
    throw new Error(`Provenance metadata is only required for learned or imported skills: ${skillDir}`);
  }

  assertValidProvenance(record);

  const provenancePath = getProvenancePath(skillDir);
  ensureDir(skillDir);
  fs.writeFileSync(provenancePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  return {
    path: provenancePath,
    record: { ...record },
  };
}

module.exports = {
  PROVENANCE_FILE_NAME,
  SKILL_TYPES,
  classifySkillPath,
  getProvenancePath,
  getSkillRoots,
  readProvenance,
  requiresProvenance,
  validateProvenance,
  writeProvenance,
};
