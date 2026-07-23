'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG_FILE = 'github-native-coordination.json';
const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'config', DEFAULT_CONFIG_FILE);
const DEFAULT_SECTION_MARKER = 'ecc-coordination';
const DEFAULT_SCHEMA_VERSION = 'ecc.github.coordination.v1';
const DEFAULT_LABELS = Object.freeze({
  epic: 'epic',
  available: 'coordination:available',
  claimed: 'coordination:claimed',
  ready: 'coordination:ready',
  blocked: 'coordination:blocked',
  validated: 'coordination:validated',
  reviewRequested: 'coordination:review-requested',
  reviewApproved: 'coordination:review-approved',
  reviewChangesRequested: 'coordination:review-changes-requested',
  published: 'coordination:published',
  synced: 'coordination:synced',
});
const DEFAULT_POLICY = Object.freeze({
  schemaVersion: DEFAULT_SCHEMA_VERSION,
  sectionMarker: DEFAULT_SECTION_MARKER,
  labels: DEFAULT_LABELS,
  review: {
    required: true,
    defaultMode: 'required',
  },
  validation: {
    required: true,
  },
  branchModel: {
    epicOnly: true,
    taskBranches: false,
  },
  project: {
    enabled: false,
    fieldNames: {
      status: 'Status',
      owner: 'Owner',
      branch: 'Branch',
      validation: 'Validation',
      review: 'Review',
    },
  },
});

function loadPolicy(rootDir = process.cwd(), configPath = null) {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : path.join(rootDir, 'config', DEFAULT_CONFIG_FILE);

  if (!fs.existsSync(resolvedPath)) {
    return {
      ...DEFAULT_POLICY,
      sourcePath: null,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to load policy from ${resolvedPath}: ${error.message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Policy file ${resolvedPath} must contain a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`);
  }
  const labels = typeof parsed.labels === 'object' && parsed.labels !== null && !Array.isArray(parsed.labels) ? parsed.labels : {};
  const review = typeof parsed.review === 'object' && parsed.review !== null && !Array.isArray(parsed.review) ? parsed.review : {};
  const validation = typeof parsed.validation === 'object' && parsed.validation !== null && !Array.isArray(parsed.validation) ? parsed.validation : {};
  const branchModel = typeof parsed.branchModel === 'object' && parsed.branchModel !== null && !Array.isArray(parsed.branchModel) ? parsed.branchModel : {};
  const project = typeof parsed.project === 'object' && parsed.project !== null && !Array.isArray(parsed.project) ? parsed.project : {};
  const fieldNames = typeof project.fieldNames === 'object' && project.fieldNames !== null && !Array.isArray(project.fieldNames) ? project.fieldNames : {};
  return {
    ...DEFAULT_POLICY,
    ...parsed,
    labels: { ...DEFAULT_LABELS, ...labels },
    review: { ...DEFAULT_POLICY.review, ...review },
    validation: { ...DEFAULT_POLICY.validation, ...validation },
    branchModel: { ...DEFAULT_POLICY.branchModel, ...branchModel },
    project: {
      ...DEFAULT_POLICY.project,
      ...project,
      fieldNames: { ...DEFAULT_POLICY.project.fieldNames, ...fieldNames },
    },
    sourcePath: resolvedPath,
  };
}

module.exports = {
  DEFAULT_CONFIG_FILE,
  DEFAULT_CONFIG_PATH,
  DEFAULT_LABELS,
  DEFAULT_POLICY,
  DEFAULT_SCHEMA_VERSION,
  DEFAULT_SECTION_MARKER,
  loadPolicy,
};
