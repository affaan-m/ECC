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
  fingerprintHookEntry,
  metadataPathFor,
  readHooksConfig,
  withRefreshedFingerprints,
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
  const merged = applyHooksMetadata(hooksConfig, { entries: { PreToolUse: [{ id: 'from-sidecar' }] } });
  assert.strictEqual(merged.hooks.PreToolUse[0].id, 'existing');
});

test('applyHooksMetadata returns a new config and leaves its inputs untouched', () => {
  const entry = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node a.js' }] };
  const hooksConfig = { hooks: { PreToolUse: [entry] } };
  const metadata = { entries: { PreToolUse: [{ id: 'a', description: 'A' }] } };

  const merged = applyHooksMetadata(hooksConfig, metadata);

  assert.notStrictEqual(merged, hooksConfig);
  assert.notStrictEqual(merged.hooks.PreToolUse[0], entry);
  assert.deepStrictEqual(merged.hooks.PreToolUse[0], { ...entry, id: 'a', description: 'A' });
  assert.deepStrictEqual(hooksConfig, { hooks: { PreToolUse: [entry] } });
  assert.ok(!('id' in entry) && !('description' in entry), 'input entry must not be mutated');
  assert.strictEqual(merged.hooks.PreToolUse[0].hooks, entry.hooks, 'untouched nested data is shared');
});

const alpha = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node alpha.js' }] };
const beta = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node beta.js' }] };
const alphaMeta = { id: 'a', fingerprint: fingerprintHookEntry(alpha) };
const betaMeta = { id: 'b', fingerprint: fingerprintHookEntry(beta) };

test('findMetadataMismatches reports length and coverage problems', () => {
  const hooksConfig = { hooks: { PreToolUse: [alpha, beta] } };

  assert.strictEqual(findMetadataMismatches(hooksConfig, { entries: {} }).length, 1);
  assert.strictEqual(
    findMetadataMismatches(hooksConfig, { entries: { PreToolUse: [alphaMeta] } }).length,
    1
  );
  assert.strictEqual(
    findMetadataMismatches(hooksConfig, {
      entries: { PreToolUse: [alphaMeta, { ...betaMeta, id: '' }] },
    }).length,
    1
  );
  assert.strictEqual(
    findMetadataMismatches(hooksConfig, {
      entries: { PreToolUse: [alphaMeta, { ...betaMeta, description: 1 }] },
    }).length,
    1
  );
  assert.strictEqual(
    findMetadataMismatches(hooksConfig, {
      entries: { PreToolUse: [alphaMeta, betaMeta], Stop: [] },
    }).length,
    1
  );
  assert.deepStrictEqual(
    findMetadataMismatches(hooksConfig, { entries: { PreToolUse: [alphaMeta, betaMeta] } }),
    []
  );
});

test('findMetadataMismatches detects reordered entries and missing fingerprints', () => {
  const hooksConfig = { hooks: { PreToolUse: [alpha, beta] } };

  const reordered = findMetadataMismatches(hooksConfig, { entries: { PreToolUse: [betaMeta, alphaMeta] } });
  assert.strictEqual(reordered.length, 2, 'each swapped entry is reported');
  assert.match(reordered[0], /PreToolUse\[0\] \(id "b"\) fingerprint .* does not match/);

  const changed = findMetadataMismatches(
    { hooks: { PreToolUse: [alpha, { ...beta, matcher: 'Write' }] } },
    { entries: { PreToolUse: [alphaMeta, betaMeta] } }
  );
  assert.strictEqual(changed.length, 1, 'a changed matcher invalidates the fingerprint');

  const missing = findMetadataMismatches(hooksConfig, {
    entries: { PreToolUse: [{ id: 'a' }, { id: 'b', fingerprint: 'nope' }] },
  });
  assert.strictEqual(missing.length, 2);
  assert.match(missing[0], /missing a valid "fingerprint"/);
});

test('fingerprintHookEntry ignores id, description, and key order', () => {
  const base = fingerprintHookEntry(alpha);
  assert.match(base, /^[0-9a-f]{12}$/);
  assert.strictEqual(fingerprintHookEntry({ ...alpha, id: 'x', description: 'y' }), base);
  assert.strictEqual(
    fingerprintHookEntry({ hooks: [{ command: 'node alpha.js', type: 'command' }], matcher: 'Bash' }),
    base
  );
  assert.notStrictEqual(fingerprintHookEntry(beta), base);
});

test('withRefreshedFingerprints rewrites fingerprints without touching ids', () => {
  const hooksConfig = { hooks: { PreToolUse: [alpha, beta] } };
  const stale = {
    $schema: 's',
    entries: { PreToolUse: [{ id: 'a', fingerprint: '000000000000' }, { id: 'b' }] },
  };

  const refreshed = withRefreshedFingerprints(hooksConfig, stale);

  assert.deepStrictEqual(refreshed, { $schema: 's', entries: { PreToolUse: [alphaMeta, betaMeta] } });
  assert.deepStrictEqual(findMetadataMismatches(hooksConfig, refreshed), []);
  assert.strictEqual(stale.entries.PreToolUse[0].fingerprint, '000000000000', 'input is not mutated');
});

test('readHooksConfig rejects a sidecar that does not line up', () => {
  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ecc-hooks-'));
  const tempHooks = path.join(tempDir, 'hooks.json');
  fs.writeFileSync(tempHooks, JSON.stringify({ hooks: { PreToolUse: [alpha, beta] } }));
  fs.writeFileSync(
    metadataPathFor(tempHooks),
    JSON.stringify({ entries: { PreToolUse: [betaMeta, alphaMeta] } })
  );

  try {
    assert.throws(() => readHooksConfig(tempHooks), /does not line up with .*hooks\.json[\s\S]*fingerprint/);

    fs.writeFileSync(
      metadataPathFor(tempHooks),
      JSON.stringify({ entries: { PreToolUse: [alphaMeta, betaMeta] } })
    );
    const merged = readHooksConfig(tempHooks);
    assert.deepStrictEqual(merged.hooks.PreToolUse.map(entry => entry.id), ['a', 'b']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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

test('failed refresh validation preserves the original sidecar bytes', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ecc-metadata-refresh-'));
  try {
    for (const relative of ['scripts/ci/validate-hooks.js', 'scripts/lib/hooks-config.js',
      'schemas/hooks.schema.json', 'schemas/hooks-metadata.schema.json']) {
      const destination = path.join(root, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(REPO_ROOT, relative), destination);
    }
    fs.mkdirSync(path.join(root, 'hooks'));
    fs.writeFileSync(path.join(root, 'hooks/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [alpha] } }));
    const sidecar = path.join(root, 'hooks/hooks.metadata.json');
    const original = JSON.stringify({ entries: { PreToolUse: [{ ...alphaMeta, id: '', fingerprint: '000000000000' }] } });
    fs.writeFileSync(sidecar, original);
    const result = require('child_process').spawnSync(process.execPath,
      [path.join(root, 'scripts/ci/validate-hooks.js'), '--update-fingerprints'], {
        encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(REPO_ROOT, 'node_modules') },
      });
    assert.strictEqual(result.status, 1, result.stderr);
    assert.match(result.stderr, /id|non-empty/);
    assert.strictEqual(fs.readFileSync(sidecar, 'utf8'), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refresh refuses reordered hooks instead of rebinding stable ids', () => {
  const config = { hooks: { PreToolUse: [beta, alpha] } };
  const metadata = { entries: { PreToolUse: [alphaMeta, betaMeta] } };
  assert.throws(() => withRefreshedFingerprints(config, metadata), /reorder/i);
  assert.deepStrictEqual(metadata.entries.PreToolUse, [alphaMeta, betaMeta]);
});

test('alignment rejects duplicate ids across events', () => {
  const config = { hooks: { PreToolUse: [alpha], PostToolUse: [beta] } };
  const metadata = { entries: {
    PreToolUse: [alphaMeta], PostToolUse: [{ ...betaMeta, id: alphaMeta.id }],
  } };
  assert.ok(findMetadataMismatches(config, metadata).some(problem =>
    /duplicate/.test(problem) && /PreToolUse/.test(problem) && /PostToolUse/.test(problem)));
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

console.log(`\nResults: Passed: ${tests.length - failures}, Failed: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
