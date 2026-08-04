/**
 * Tests for scripts/lib/install/request.js
 */

const assert = require('assert');

const {
  normalizeInstallRequest,
  parseInstallArgs,
} = require('../../scripts/lib/install/request');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing install/request.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('parses manifest-mode CLI arguments', () => {
    const parsed = parseInstallArgs([
      'node',
      'scripts/install-apply.js',
      '--target', 'cursor',
      '--profile', 'developer',
      '--modules', 'platform-configs, workflow-quality ,platform-configs',
      '--with', 'lang:typescript',
      '--without', 'capability:media',
      '--config', 'ecc-install.json',
      '--dry-run',
      '--json'
    ]);

    assert.strictEqual(parsed.target, 'cursor');
    assert.strictEqual(parsed.profileId, 'developer');
    assert.strictEqual(parsed.configPath, 'ecc-install.json');
    assert.deepStrictEqual(parsed.moduleIds, ['platform-configs', 'workflow-quality']);
    assert.deepStrictEqual(parsed.includeComponentIds, ['lang:typescript']);
    assert.deepStrictEqual(parsed.excludeComponentIds, ['capability:media']);
    assert.strictEqual(parsed.dryRun, true);
    assert.strictEqual(parsed.json, true);
    assert.deepStrictEqual(parsed.languages, []);
  })) passed++; else failed++;

  if (test('parses --locale argument', () => {
    const parsed = parseInstallArgs([
      'node',
      'scripts/install-apply.js',
      '--locale', 'ja'
    ]);

    assert.strictEqual(parsed.locale, 'ja');
    assert.deepStrictEqual(parsed.languages, []);
  })) passed++; else failed++;

  if (test('requires a --locale value', () => {
    assert.throws(
      () => parseInstallArgs([
        'node',
        'scripts/install-apply.js',
        '--locale',
        '--dry-run'
      ]),
      /Missing value for --locale/
    );
  })) passed++; else failed++;

  if (test('normalizes legacy language installs into a canonical request', () => {
    const request = normalizeInstallRequest({
      target: 'claude',
      profileId: null,
      moduleIds: [],
      languages: ['typescript', 'python']
    });

    assert.strictEqual(request.mode, 'legacy-compat');
    assert.strictEqual(request.target, 'claude');
    assert.deepStrictEqual(request.legacyLanguages, ['typescript', 'python']);
    assert.deepStrictEqual(request.moduleIds, []);
    assert.strictEqual(request.profileId, null);
  })) passed++; else failed++;

  if (test('normalizes locale-only installs as manifest component requests', () => {
    const request = normalizeInstallRequest({
      target: 'claude',
      profileId: null,
      moduleIds: [],
      includeComponentIds: [],
      excludeComponentIds: [],
      languages: [],
      locale: 'ja',
    });

    assert.strictEqual(request.mode, 'manifest');
    assert.strictEqual(request.target, 'claude');
    assert.deepStrictEqual(request.includeComponentIds, ['locale:ja']);
    assert.deepStrictEqual(request.legacyLanguages, []);
  })) passed++; else failed++;

  if (test('allows legacy language installs to include a locale component', () => {
    const request = normalizeInstallRequest({
      target: 'claude',
      profileId: null,
      moduleIds: [],
      includeComponentIds: [],
      excludeComponentIds: [],
      languages: ['typescript'],
      locale: 'ja-JP',
    });

    assert.strictEqual(request.mode, 'legacy-compat');
    assert.deepStrictEqual(request.legacyLanguages, ['typescript']);
    assert.deepStrictEqual(request.includeComponentIds, ['locale:ja']);
  })) passed++; else failed++;

  if (test('rejects unsupported locale codes', () => {
    assert.throws(
      () => normalizeInstallRequest({
        target: 'claude',
        profileId: null,
        moduleIds: [],
        includeComponentIds: [],
        excludeComponentIds: [],
        languages: [],
        locale: 'fr',
      }),
      /Unsupported locale/
    );
  })) passed++; else failed++;

  if (test('rejects --locale for non-Claude targets', () => {
    assert.throws(
      () => normalizeInstallRequest({
        target: 'cursor',
        profileId: null,
        moduleIds: [],
        includeComponentIds: [],
        excludeComponentIds: [],
        languages: [],
        locale: 'ja',
      }),
      /--locale can only be used with --target claude/
    );
  })) passed++; else failed++;

  if (test('normalizes manifest installs into a canonical request', () => {
    const request = normalizeInstallRequest({
      target: 'cursor',
      profileId: 'developer',
      moduleIds: [],
      includeComponentIds: ['lang:typescript'],
      excludeComponentIds: ['capability:media'],
      languages: []
    });

    assert.strictEqual(request.mode, 'manifest');
    assert.strictEqual(request.target, 'cursor');
    assert.strictEqual(request.profileId, 'developer');
    assert.deepStrictEqual(request.includeComponentIds, ['lang:typescript']);
    assert.deepStrictEqual(request.excludeComponentIds, ['capability:media']);
    assert.deepStrictEqual(request.legacyLanguages, []);
  })) passed++; else failed++;

  if (test('merges config-backed component selections with CLI overrides', () => {
    const request = normalizeInstallRequest({
      target: 'cursor',
      profileId: null,
      moduleIds: ['platform-configs'],
      includeComponentIds: ['framework:nextjs'],
      excludeComponentIds: ['capability:media'],
      languages: [],
      configPath: '/workspace/app/ecc-install.json',
      config: {
        path: '/workspace/app/ecc-install.json',
        target: 'claude',
        profileId: 'developer',
        moduleIds: ['workflow-quality'],
        includeComponentIds: ['lang:typescript'],
        excludeComponentIds: ['capability:orchestration'],
      },
    });

    assert.strictEqual(request.mode, 'manifest');
    assert.strictEqual(request.target, 'cursor');
    assert.strictEqual(request.profileId, 'developer');
    assert.deepStrictEqual(request.moduleIds, ['workflow-quality', 'platform-configs']);
    assert.deepStrictEqual(request.includeComponentIds, ['lang:typescript', 'framework:nextjs']);
    assert.deepStrictEqual(request.excludeComponentIds, ['capability:orchestration', 'capability:media']);
    assert.strictEqual(request.configPath, '/workspace/app/ecc-install.json');
  })) passed++; else failed++;

  if (test('validates explicit module IDs against the manifest catalog', () => {
    assert.throws(
      () => normalizeInstallRequest({
        target: 'cursor',
        profileId: null,
        moduleIds: ['ghost-module'],
        includeComponentIds: [],
        excludeComponentIds: [],
        languages: [],
      }),
      /Unknown install module: ghost-module/
    );
  })) passed++; else failed++;

  if (test('rejects mixing legacy languages with manifest flags', () => {
    assert.throws(
      () => normalizeInstallRequest({
        target: 'claude',
        profileId: 'core',
        moduleIds: [],
        includeComponentIds: [],
        excludeComponentIds: [],
        languages: ['typescript']
      }),
      /cannot be combined/
    );
  })) passed++; else failed++;

  if (test('rejects empty install requests when not asking for help', () => {
    assert.throws(
      () => normalizeInstallRequest({
        target: 'claude',
        profileId: null,
        moduleIds: [],
        includeComponentIds: [],
        excludeComponentIds: [],
        languages: [],
        help: false
      }),
      /No install profile, module IDs, included components, or legacy languages/
    );
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
