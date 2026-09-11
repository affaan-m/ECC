/**
 * Tests for the hooks.json / hooks.metadata.json split.
 *
 * Claude Code validates a plugin's hooks.json against its own schema and prints
 * every key it does not recognise when the plugin loads. These tests keep the
 * unknown keys out of hooks.json and keep the sidecar aligned with it.
 *
 * Run with: node tests/hooks/hooks-metadata.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  applyHooksMetadata,
  findMetadataMismatches,
  metadataPathFor,
  readHooksConfig,
} = require('../../scripts/lib/hooks-config');

const REPO_ROOT = path.resolve(__dirname, '../..');
const HOOKS_PATH = path.join(REPO_ROOT, 'hooks', 'hooks.json');
const METADATA_PATH = metadataPathFor(HOOKS_PATH);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function eachMatcher(hooksConfig, visit) {
  for (const [event, entries] of Object.entries(hooksConfig.hooks || {})) {
    (entries || []).forEach((entry, index) => visit(entry, `${event}[${index}]`));
  }
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('hooks.json does not declare $schema', () => {
  const hooksConfig = readJson(HOOKS_PATH);
  assert.ok(
    !('$schema' in hooksConfig),
    'hooks.json must not define "$schema" - Claude Code reports it as an unknown key'
  );
});

test('hooks.json matcher entries carry no id or description', () => {
  const hooksConfig = readJson(HOOKS_PATH);
  eachMatcher(hooksConfig, (entry, label) => {
    assert.ok(!('id' in entry), `${label} must not define "id" - it belongs in hooks.metadata.json`);
    assert.ok(
      !('description' in entry),
      `${label} must not define "description" - it belongs in hooks.metadata.json`
    );
  });
});

test('metadata sidecar exists and lines up with hooks.json', () => {
  assert.ok(fs.existsSync(METADATA_PATH), 'hooks/hooks.metadata.json is missing');
  const mismatches = findMetadataMismatches(readJson(HOOKS_PATH), readJson(METADATA_PATH));
  assert.deepStrictEqual(mismatches, [], `metadata is misaligned:\n${mismatches.join('\n')}`);
});

test('every matcher entry has a unique id after merging', () => {
  const merged = readHooksConfig(HOOKS_PATH);
  const seen = new Map();
  let count = 0;

  eachMatcher(merged, (entry, label) => {
    count += 1;
    assert.ok(
      typeof entry.id === 'string' && entry.id.trim() !== '',
      `${label} has no id after merging metadata`
    );
    assert.ok(!seen.has(entry.id), `duplicate id "${entry.id}" at ${label} and ${seen.get(entry.id)}`);
    seen.set(entry.id, label);
  });

  assert.ok(count > 0, 'expected at least one matcher entry');
});

test('merging leaves hook commands untouched', () => {
  const raw = readJson(HOOKS_PATH);
  const merged = readHooksConfig(HOOKS_PATH);

  const commandsOf = config => Object.entries(config.hooks || {}).flatMap(([event, entries]) => (
    (entries || []).flatMap((entry, index) => (entry.hooks || []).map(
      (hook, hookIndex) => `${event}[${index}].hooks[${hookIndex}]:${JSON.stringify(hook)}`
    ))
  ));

  assert.deepStrictEqual(commandsOf(merged), commandsOf(raw));
});

test('applyHooksMetadata does not overwrite an id already present', () => {
  const hooksConfig = { hooks: { PreToolUse: [{ id: 'existing', matcher: 'Bash', hooks: [] }] } };
  applyHooksMetadata(hooksConfig, { entries: { PreToolUse: [{ id: 'from-sidecar' }] } });
  assert.strictEqual(hooksConfig.hooks.PreToolUse[0].id, 'existing');
});

test('findMetadataMismatches reports length and coverage problems', () => {
  const hooksConfig = { hooks: { PreToolUse: [{ hooks: [] }, { hooks: [] }] } };

  assert.strictEqual(findMetadataMismatches(hooksConfig, { entries: {} }).length, 1);
  assert.strictEqual(
    findMetadataMismatches(hooksConfig, { entries: { PreToolUse: [{ id: 'a' }] } }).length,
    1
  );
  assert.strictEqual(
    findMetadataMismatches(hooksConfig, { entries: { PreToolUse: [{ id: 'a' }, { id: '' }] } }).length,
    1
  );
  assert.strictEqual(
    findMetadataMismatches(hooksConfig, {
      entries: { PreToolUse: [{ id: 'a' }, { id: 'b' }], Stop: [] },
    }).length,
    1
  );
  assert.deepStrictEqual(
    findMetadataMismatches(hooksConfig, { entries: { PreToolUse: [{ id: 'a' }, { id: 'b' }] } }),
    []
  );
});

test('readHooksConfig returns raw config when the sidecar is absent', () => {
  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ecc-hooks-'));
  const tempHooks = path.join(tempDir, 'hooks.json');
  fs.writeFileSync(tempHooks, JSON.stringify({ hooks: { Stop: [{ hooks: [] }] } }));

  try {
    const config = readHooksConfig(tempHooks);
    assert.deepStrictEqual(config, { hooks: { Stop: [{ hooks: [] }] } });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} hooks metadata tests passed`);
process.exit(failures === 0 ? 0 : 1);
