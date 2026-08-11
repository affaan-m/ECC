/**
 * Tests for scripts/lib/github-coordination/policy.js — loadPolicy branch coverage
 *
 * Run with: node tests/lib/github-coordination-policy.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  loadPolicy,
  DEFAULT_POLICY,
  DEFAULT_LABELS,
  DEFAULT_SCHEMA_VERSION,
  DEFAULT_SECTION_MARKER,
} = require('../../scripts/lib/github-coordination/policy');

const { test, banner, section, summary } = require('./helpers/mini-test-runner');

function withTempDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-policy-test-'));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function writeConfig(tmpDir, content) {
  const configDir = path.join(tmpDir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'github-native-coordination.json');
  fs.writeFileSync(configPath, typeof content === 'string' ? content : JSON.stringify(content));
  return configPath;
}

let passed = 0;
let failed = 0;

banner('Testing github-coordination/policy.js');

section('loadPolicy — no config file:');

if (test('returns default policy when no config file exists in rootDir', () => {
  withTempDir(tmpDir => {
    const result = loadPolicy(tmpDir);
    assert.strictEqual(result.sourcePath, null);
    assert.strictEqual(result.schemaVersion, DEFAULT_SCHEMA_VERSION);
    assert.strictEqual(result.sectionMarker, DEFAULT_SECTION_MARKER);
    assert.deepStrictEqual(result.labels, DEFAULT_LABELS);
    assert.deepStrictEqual(result.review, DEFAULT_POLICY.review);
  });
})) passed++; else failed++;

if (test('returns default policy when custom configPath does not exist', () => {
  withTempDir(tmpDir => {
    const result = loadPolicy(tmpDir, path.join(tmpDir, 'nonexistent.json'));
    assert.strictEqual(result.sourcePath, null);
    assert.deepStrictEqual(result.review, DEFAULT_POLICY.review);
  });
})) passed++; else failed++;

section('loadPolicy — configPath argument:');

if (test('uses configPath when explicitly provided', () => {
  withTempDir(tmpDir => {
    const configPath = path.join(tmpDir, 'my-policy.json');
    fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 'custom-v1' }));
    const result = loadPolicy(tmpDir, configPath);
    assert.strictEqual(result.sourcePath, configPath);
    assert.strictEqual(result.schemaVersion, 'custom-v1');
  });
})) passed++; else failed++;

if (test('falls back to rootDir config file when configPath is null', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { schemaVersion: 'root-v1' });
    const result = loadPolicy(tmpDir, null);
    assert.strictEqual(result.schemaVersion, 'root-v1');
    assert.ok(result.sourcePath !== null);
  });
})) passed++; else failed++;

section('loadPolicy — invalid JSON:');

if (test('throws on invalid JSON', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, '{ bad json !!!! }');
    assert.throws(() => loadPolicy(tmpDir), /Failed to load policy/);
  });
})) passed++; else failed++;

section('loadPolicy — non-object JSON:');

if (test('throws when top-level JSON is null', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, 'null');
    assert.throws(() => loadPolicy(tmpDir), /must contain a JSON object/);
  });
})) passed++; else failed++;

if (test('throws when top-level JSON is an array', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, '[]');
    assert.throws(() => loadPolicy(tmpDir), /must contain a JSON object/);
  });
})) passed++; else failed++;

if (test('throws when top-level JSON is a string', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, '"just a string"');
    assert.throws(() => loadPolicy(tmpDir), /must contain a JSON object/);
  });
})) passed++; else failed++;

section('loadPolicy — labels merging:');

if (test('merges labels when parsed.labels is a plain object', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { labels: { epic: 'my-epic' } });
    const result = loadPolicy(tmpDir);
    assert.strictEqual(result.labels.epic, 'my-epic');
    assert.strictEqual(result.labels.available, DEFAULT_LABELS.available);
  });
})) passed++; else failed++;

if (test('falls back to empty labels when parsed.labels is null', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { labels: null });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.labels, DEFAULT_LABELS);
  });
})) passed++; else failed++;

if (test('falls back to empty labels when parsed.labels is an array', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { labels: ['a', 'b'] });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.labels, DEFAULT_LABELS);
  });
})) passed++; else failed++;

if (test('falls back to empty labels when parsed.labels is a string', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { labels: 'bad' });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.labels, DEFAULT_LABELS);
  });
})) passed++; else failed++;

section('loadPolicy — review merging:');

if (test('merges review when parsed.review is a plain object', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { review: { required: false } });
    const result = loadPolicy(tmpDir);
    assert.strictEqual(result.review.required, false);
    assert.strictEqual(result.review.defaultMode, DEFAULT_POLICY.review.defaultMode);
  });
})) passed++; else failed++;

if (test('falls back when parsed.review is not an object', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { review: 'string' });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.review, DEFAULT_POLICY.review);
  });
})) passed++; else failed++;

if (test('falls back when parsed.review is null', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { review: null });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.review, DEFAULT_POLICY.review);
  });
})) passed++; else failed++;

if (test('falls back when parsed.review is an array', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { review: [] });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.review, DEFAULT_POLICY.review);
  });
})) passed++; else failed++;

section('loadPolicy — validation merging:');

if (test('merges validation when parsed.validation is a plain object', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { validation: { required: false } });
    const result = loadPolicy(tmpDir);
    assert.strictEqual(result.validation.required, false);
  });
})) passed++; else failed++;

if (test('falls back when parsed.validation is not an object', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { validation: 42 });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.validation, DEFAULT_POLICY.validation);
  });
})) passed++; else failed++;

section('loadPolicy — branchModel merging:');

if (test('merges branchModel when parsed.branchModel is a plain object', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { branchModel: { epicOnly: false, taskBranches: true } });
    const result = loadPolicy(tmpDir);
    assert.strictEqual(result.branchModel.epicOnly, false);
    assert.strictEqual(result.branchModel.taskBranches, true);
  });
})) passed++; else failed++;

if (test('falls back when parsed.branchModel is not an object', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { branchModel: true });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.branchModel, DEFAULT_POLICY.branchModel);
  });
})) passed++; else failed++;

section('loadPolicy — project merging:');

if (test('merges project when parsed.project is a plain object', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { project: { enabled: true } });
    const result = loadPolicy(tmpDir);
    assert.strictEqual(result.project.enabled, true);
    assert.deepStrictEqual(result.project.fieldNames, DEFAULT_POLICY.project.fieldNames);
  });
})) passed++; else failed++;

if (test('falls back when parsed.project is not an object', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { project: 'invalid' });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.project, DEFAULT_POLICY.project);
  });
})) passed++; else failed++;

if (test('falls back when parsed.project is null', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { project: null });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.project, DEFAULT_POLICY.project);
  });
})) passed++; else failed++;

section('loadPolicy — project.fieldNames merging:');

if (test('merges fieldNames when project.fieldNames is a plain object', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { project: { enabled: true, fieldNames: { status: 'MyStatus' } } });
    const result = loadPolicy(tmpDir);
    assert.strictEqual(result.project.fieldNames.status, 'MyStatus');
    assert.strictEqual(result.project.fieldNames.owner, DEFAULT_POLICY.project.fieldNames.owner);
  });
})) passed++; else failed++;

if (test('falls back when project.fieldNames is not an object', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { project: { fieldNames: 'bad' } });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.project.fieldNames, DEFAULT_POLICY.project.fieldNames);
  });
})) passed++; else failed++;

if (test('falls back when project.fieldNames is null', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { project: { fieldNames: null } });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.project.fieldNames, DEFAULT_POLICY.project.fieldNames);
  });
})) passed++; else failed++;

if (test('falls back when project.fieldNames is an array', () => {
  withTempDir(tmpDir => {
    writeConfig(tmpDir, { project: { fieldNames: [] } });
    const result = loadPolicy(tmpDir);
    assert.deepStrictEqual(result.project.fieldNames, DEFAULT_POLICY.project.fieldNames);
  });
})) passed++; else failed++;

section('loadPolicy — sourcePath:');

if (test('sets sourcePath to the resolved config file path', () => {
  withTempDir(tmpDir => {
    const configPath = writeConfig(tmpDir, {});
    const result = loadPolicy(tmpDir);
    assert.strictEqual(result.sourcePath, configPath);
  });
})) passed++; else failed++;

summary(passed, failed);
