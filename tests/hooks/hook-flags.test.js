/**
 * Tests for scripts/lib/hook-flags.js
 *
 * Run with: node tests/hooks/hook-flags.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Import the module
const {
  VALID_PROFILES,
  normalizeId,
  parseBoolean,
  readManagedHookConfig,
  areHooksEnabled,
  getHookProfile,
  getDisabledHookIds,
  parseProfiles,
  isHookEnabled,
} = require('../../scripts/lib/hook-flags');

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

// Helper to save and restore env vars
function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

// Test suite
function runTests() {
  console.log('\n=== Testing hook-flags.js ===\n');

  let passed = 0;
  let failed = 0;

  // VALID_PROFILES tests
  console.log('VALID_PROFILES:');

  if (test('is a Set', () => {
    assert.ok(VALID_PROFILES instanceof Set);
  })) passed++; else failed++;

  if (test('contains minimal, standard, strict', () => {
    assert.ok(VALID_PROFILES.has('minimal'));
    assert.ok(VALID_PROFILES.has('standard'));
    assert.ok(VALID_PROFILES.has('strict'));
  })) passed++; else failed++;

  if (test('contains exactly 3 profiles', () => {
    assert.strictEqual(VALID_PROFILES.size, 3);
  })) passed++; else failed++;

  console.log('\nHook preference sources:');

  if (test('hooks default enabled when no preference source exists', () => {
    withEnv({
      ECC_HOOKS_ENABLED: undefined,
      CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: undefined,
      ECC_HOOK_CONFIG: undefined,
      CLAUDE_PLUGIN_ROOT: undefined,
      ECC_PLUGIN_ROOT: undefined,
    }, () => {
      assert.strictEqual(areHooksEnabled(), true);
    });
  })) passed++; else failed++;

  if (test('Claude plugin options control enabled state and profile', () => {
    withEnv({
      ECC_HOOKS_ENABLED: undefined,
      ECC_HOOK_PROFILE: undefined,
      CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'false',
      CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal',
      ECC_HOOK_CONFIG: undefined,
    }, () => {
      assert.strictEqual(areHooksEnabled(), false);
      assert.strictEqual(getHookProfile(), 'minimal');
      assert.strictEqual(
        isHookEnabled('pre:test', { profiles: 'minimal,standard,strict' }),
        false
      );
    });
  })) passed++; else failed++;

  if (test('explicit ECC environment overrides Claude plugin options', () => {
    withEnv({
      ECC_HOOKS_ENABLED: 'true',
      ECC_HOOK_PROFILE: 'strict',
      CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'false',
      CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal',
    }, () => {
      assert.strictEqual(areHooksEnabled(), true);
      assert.strictEqual(getHookProfile(), 'strict');
    });
    assert.strictEqual(
      getHookProfile({
        ECC_HOOK_PROFILE: '',
        CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'minimal',
      }),
      'standard',
      'an explicit empty ECC profile must not fall through to plugin config'
    );
  })) passed++; else failed++;

  if (test('managed hook config is used after explicit and plugin preferences', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hook-flags-'));
    const configPath = path.join(root, 'ecc', 'setup.json');
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({
        hooks: { enabled: false, profile: 'minimal' },
      }));
      withEnv({
        ECC_HOOKS_ENABLED: undefined,
        ECC_HOOK_PROFILE: undefined,
        CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: undefined,
        CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: undefined,
        ECC_HOOK_CONFIG: configPath,
      }, () => {
        assert.deepStrictEqual(readManagedHookConfig(), {
          enabled: false,
          profile: 'minimal',
        });
        assert.strictEqual(areHooksEnabled(), false);
        assert.strictEqual(getHookProfile(), 'minimal');
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('a hook evaluation reads managed config only once', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hook-flags-read-once-'));
    const configPath = path.join(root, 'setup.json');
    const originalReadFileSync = fs.readFileSync;
    let configReadCount = 0;
    try {
      fs.writeFileSync(configPath, JSON.stringify({
        hooks: { enabled: true, profile: 'minimal' },
      }));
      fs.readFileSync = (...args) => {
        if (args[0] === configPath) configReadCount += 1;
        return originalReadFileSync(...args);
      };
      assert.strictEqual(isHookEnabled('pre:test', {
        env: { ECC_HOOK_CONFIG: configPath },
        profiles: ['minimal'],
      }), true);
      assert.strictEqual(configReadCount, 1);
    } finally {
      fs.readFileSync = originalReadFileSync;
      fs.rmSync(root, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('malformed managed config emits one sanitized diagnostic', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hook-flags-invalid-'));
    const configPath = path.join(root, 'setup.json');
    const originalWrite = process.stderr.write;
    const diagnostics = [];
    try {
      fs.writeFileSync(configPath, '{"hooks":\u001b[31m');
      process.stderr.write = value => {
        diagnostics.push(String(value));
        return true;
      };
      assert.deepStrictEqual(readManagedHookConfig({ ECC_HOOK_CONFIG: configPath }), {});
      assert.strictEqual(diagnostics.length, 1);
      assert.match(diagnostics[0], /Warning: unable to read managed ECC hook config/);
      assert.strictEqual(diagnostics[0].includes('\u001b'), false);
      assert.match(diagnostics[0], /setup\.json/);
    } finally {
      process.stderr.write = originalWrite;
      fs.rmSync(root, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('boolean parsing recognizes supported values and uses its fallback', () => {
    for (const value of ['1', 'true', 'yes', 'on']) {
      assert.strictEqual(parseBoolean(value, false), true);
    }
    for (const value of ['0', 'false', 'no', 'off']) {
      assert.strictEqual(parseBoolean(value, true), false);
    }
    assert.strictEqual(parseBoolean('invalid', false), false);
  })) passed++; else failed++;

  if (test('run-with-flags suppresses wrapper hooks when plugin hooks are off', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hook-wrapper-'));
    const markerPath = path.join(root, 'ran.txt');
    const hookPath = path.join(root, 'marker.js');
    const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
    const raw = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write' });
    try {
      fs.writeFileSync(
        hookPath,
        `'use strict';\nconst fs=require('fs');\nmodule.exports.run=function(raw){fs.writeFileSync(${JSON.stringify(markerPath)},'ran');return raw;};\n`
      );
      const env = {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: root,
        CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'false',
      };
      delete env.ECC_HOOKS_ENABLED;
      const result = spawnSync(process.execPath, [
        runner,
        'pre:test:marker',
        'marker.js',
        'minimal,standard,strict',
      ], {
        cwd: root,
        env,
        input: raw,
        encoding: 'utf8',
      });
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, '', 'disabled wrapper hook must not echo stdin');
      assert.ok(!fs.existsSync(markerPath), 'disabled wrapper hook must not execute');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // normalizeId tests
  console.log('\nnormalizeId:');

  if (test('returns empty string for null', () => {
    assert.strictEqual(normalizeId(null), '');
  })) passed++; else failed++;

  if (test('returns empty string for undefined', () => {
    assert.strictEqual(normalizeId(undefined), '');
  })) passed++; else failed++;

  if (test('returns empty string for empty string', () => {
    assert.strictEqual(normalizeId(''), '');
  })) passed++; else failed++;

  if (test('trims whitespace', () => {
    assert.strictEqual(normalizeId('  hello  '), 'hello');
  })) passed++; else failed++;

  if (test('converts to lowercase', () => {
    assert.strictEqual(normalizeId('MyHook'), 'myhook');
  })) passed++; else failed++;

  if (test('handles mixed case with whitespace', () => {
    assert.strictEqual(normalizeId('  My-Hook-ID  '), 'my-hook-id');
  })) passed++; else failed++;

  if (test('converts numbers to string', () => {
    assert.strictEqual(normalizeId(123), '123');
  })) passed++; else failed++;

  if (test('returns empty string for whitespace-only input', () => {
    assert.strictEqual(normalizeId('   '), '');
  })) passed++; else failed++;

  // getHookProfile tests
  console.log('\ngetHookProfile:');

  if (test('defaults to standard when env var not set', () => {
    withEnv({
      ECC_HOOK_PROFILE: undefined,
      CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: undefined,
      ECC_HOOK_CONFIG: undefined,
      CLAUDE_PLUGIN_ROOT: undefined,
      ECC_PLUGIN_ROOT: undefined,
    }, () => {
      assert.strictEqual(getHookProfile(), 'standard');
    });
  })) passed++; else failed++;

  if (test('returns minimal when set to minimal', () => {
    withEnv({ ECC_HOOK_PROFILE: 'minimal' }, () => {
      assert.strictEqual(getHookProfile(), 'minimal');
    });
  })) passed++; else failed++;

  if (test('returns standard when set to standard', () => {
    withEnv({ ECC_HOOK_PROFILE: 'standard' }, () => {
      assert.strictEqual(getHookProfile(), 'standard');
    });
  })) passed++; else failed++;

  if (test('returns strict when set to strict', () => {
    withEnv({ ECC_HOOK_PROFILE: 'strict' }, () => {
      assert.strictEqual(getHookProfile(), 'strict');
    });
  })) passed++; else failed++;

  if (test('is case-insensitive', () => {
    withEnv({ ECC_HOOK_PROFILE: 'STRICT' }, () => {
      assert.strictEqual(getHookProfile(), 'strict');
    });
  })) passed++; else failed++;

  if (test('trims whitespace from env var', () => {
    withEnv({ ECC_HOOK_PROFILE: '  minimal  ' }, () => {
      assert.strictEqual(getHookProfile(), 'minimal');
    });
  })) passed++; else failed++;

  if (test('defaults to standard for invalid value', () => {
    withEnv({ ECC_HOOK_PROFILE: 'invalid' }, () => {
      assert.strictEqual(getHookProfile(), 'standard');
    });
  })) passed++; else failed++;

  if (test('defaults to standard for empty string', () => {
    withEnv({ ECC_HOOK_PROFILE: '' }, () => {
      assert.strictEqual(getHookProfile(), 'standard');
    });
  })) passed++; else failed++;

  // getDisabledHookIds tests
  console.log('\ngetDisabledHookIds:');

  if (test('returns empty Set when env var not set', () => {
    withEnv({ ECC_DISABLED_HOOKS: undefined }, () => {
      const result = getDisabledHookIds();
      assert.ok(result instanceof Set);
      assert.strictEqual(result.size, 0);
    });
  })) passed++; else failed++;

  if (test('returns empty Set for empty string', () => {
    withEnv({ ECC_DISABLED_HOOKS: '' }, () => {
      assert.strictEqual(getDisabledHookIds().size, 0);
    });
  })) passed++; else failed++;

  if (test('returns empty Set for whitespace-only string', () => {
    withEnv({ ECC_DISABLED_HOOKS: '   ' }, () => {
      assert.strictEqual(getDisabledHookIds().size, 0);
    });
  })) passed++; else failed++;

  if (test('parses single hook id', () => {
    withEnv({ ECC_DISABLED_HOOKS: 'my-hook' }, () => {
      const result = getDisabledHookIds();
      assert.strictEqual(result.size, 1);
      assert.ok(result.has('my-hook'));
    });
  })) passed++; else failed++;

  if (test('parses multiple comma-separated hook ids', () => {
    withEnv({ ECC_DISABLED_HOOKS: 'hook-a,hook-b,hook-c' }, () => {
      const result = getDisabledHookIds();
      assert.strictEqual(result.size, 3);
      assert.ok(result.has('hook-a'));
      assert.ok(result.has('hook-b'));
      assert.ok(result.has('hook-c'));
    });
  })) passed++; else failed++;

  if (test('trims whitespace around hook ids', () => {
    withEnv({ ECC_DISABLED_HOOKS: ' hook-a , hook-b ' }, () => {
      const result = getDisabledHookIds();
      assert.strictEqual(result.size, 2);
      assert.ok(result.has('hook-a'));
      assert.ok(result.has('hook-b'));
    });
  })) passed++; else failed++;

  if (test('normalizes hook ids to lowercase', () => {
    withEnv({ ECC_DISABLED_HOOKS: 'MyHook,ANOTHER' }, () => {
      const result = getDisabledHookIds();
      assert.ok(result.has('myhook'));
      assert.ok(result.has('another'));
    });
  })) passed++; else failed++;

  if (test('filters out empty entries from trailing commas', () => {
    withEnv({ ECC_DISABLED_HOOKS: 'hook-a,,hook-b,' }, () => {
      const result = getDisabledHookIds();
      assert.strictEqual(result.size, 2);
      assert.ok(result.has('hook-a'));
      assert.ok(result.has('hook-b'));
    });
  })) passed++; else failed++;

  // parseProfiles tests
  console.log('\nparseProfiles:');

  if (test('returns fallback for null input', () => {
    const result = parseProfiles(null);
    assert.deepStrictEqual(result, ['standard', 'strict']);
  })) passed++; else failed++;

  if (test('returns fallback for undefined input', () => {
    const result = parseProfiles(undefined);
    assert.deepStrictEqual(result, ['standard', 'strict']);
  })) passed++; else failed++;

  if (test('uses custom fallback when provided', () => {
    const result = parseProfiles(null, ['minimal']);
    assert.deepStrictEqual(result, ['minimal']);
  })) passed++; else failed++;

  if (test('parses comma-separated string', () => {
    const result = parseProfiles('minimal,strict');
    assert.deepStrictEqual(result, ['minimal', 'strict']);
  })) passed++; else failed++;

  if (test('parses single string value', () => {
    const result = parseProfiles('strict');
    assert.deepStrictEqual(result, ['strict']);
  })) passed++; else failed++;

  if (test('parses array of profiles', () => {
    const result = parseProfiles(['minimal', 'standard']);
    assert.deepStrictEqual(result, ['minimal', 'standard']);
  })) passed++; else failed++;

  if (test('filters invalid profiles from string', () => {
    const result = parseProfiles('minimal,invalid,strict');
    assert.deepStrictEqual(result, ['minimal', 'strict']);
  })) passed++; else failed++;

  if (test('filters invalid profiles from array', () => {
    const result = parseProfiles(['minimal', 'bogus', 'strict']);
    assert.deepStrictEqual(result, ['minimal', 'strict']);
  })) passed++; else failed++;

  if (test('returns fallback when all string values are invalid', () => {
    const result = parseProfiles('invalid,bogus');
    assert.deepStrictEqual(result, ['standard', 'strict']);
  })) passed++; else failed++;

  if (test('returns fallback when all array values are invalid', () => {
    const result = parseProfiles(['invalid', 'bogus']);
    assert.deepStrictEqual(result, ['standard', 'strict']);
  })) passed++; else failed++;

  if (test('is case-insensitive for string input', () => {
    const result = parseProfiles('MINIMAL,STRICT');
    assert.deepStrictEqual(result, ['minimal', 'strict']);
  })) passed++; else failed++;

  if (test('is case-insensitive for array input', () => {
    const result = parseProfiles(['MINIMAL', 'STRICT']);
    assert.deepStrictEqual(result, ['minimal', 'strict']);
  })) passed++; else failed++;

  if (test('trims whitespace in string input', () => {
    const result = parseProfiles(' minimal , strict ');
    assert.deepStrictEqual(result, ['minimal', 'strict']);
  })) passed++; else failed++;

  if (test('handles null values in array', () => {
    const result = parseProfiles([null, 'strict']);
    assert.deepStrictEqual(result, ['strict']);
  })) passed++; else failed++;

  // isHookEnabled tests
  console.log('\nisHookEnabled:');

  if (test('returns true by default for a hook (standard profile)', () => {
    withEnv({ ECC_HOOK_PROFILE: undefined, ECC_DISABLED_HOOKS: undefined }, () => {
      assert.strictEqual(isHookEnabled('my-hook'), true);
    });
  })) passed++; else failed++;

  if (test('returns true for empty hookId', () => {
    withEnv({ ECC_HOOK_PROFILE: undefined, ECC_DISABLED_HOOKS: undefined }, () => {
      assert.strictEqual(isHookEnabled(''), true);
    });
  })) passed++; else failed++;

  if (test('returns true for null hookId', () => {
    withEnv({ ECC_HOOK_PROFILE: undefined, ECC_DISABLED_HOOKS: undefined }, () => {
      assert.strictEqual(isHookEnabled(null), true);
    });
  })) passed++; else failed++;

  if (test('returns false when hook is in disabled list', () => {
    withEnv({ ECC_HOOK_PROFILE: undefined, ECC_DISABLED_HOOKS: 'my-hook' }, () => {
      assert.strictEqual(isHookEnabled('my-hook'), false);
    });
  })) passed++; else failed++;

  if (test('disabled check is case-insensitive', () => {
    withEnv({ ECC_HOOK_PROFILE: undefined, ECC_DISABLED_HOOKS: 'MY-HOOK' }, () => {
      assert.strictEqual(isHookEnabled('my-hook'), false);
    });
  })) passed++; else failed++;

  if (test('returns true when hook is not in disabled list', () => {
    withEnv({ ECC_HOOK_PROFILE: undefined, ECC_DISABLED_HOOKS: 'other-hook' }, () => {
      assert.strictEqual(isHookEnabled('my-hook'), true);
    });
  })) passed++; else failed++;

  if (test('returns false when current profile is not in allowed profiles', () => {
    withEnv({ ECC_HOOK_PROFILE: 'minimal', ECC_DISABLED_HOOKS: undefined }, () => {
      assert.strictEqual(isHookEnabled('my-hook', { profiles: 'strict' }), false);
    });
  })) passed++; else failed++;

  if (test('returns true when current profile is in allowed profiles', () => {
    withEnv({ ECC_HOOK_PROFILE: 'strict', ECC_DISABLED_HOOKS: undefined }, () => {
      assert.strictEqual(isHookEnabled('my-hook', { profiles: 'standard,strict' }), true);
    });
  })) passed++; else failed++;

  if (test('returns true when current profile matches single allowed profile', () => {
    withEnv({ ECC_HOOK_PROFILE: 'minimal', ECC_DISABLED_HOOKS: undefined }, () => {
      assert.strictEqual(isHookEnabled('my-hook', { profiles: 'minimal' }), true);
    });
  })) passed++; else failed++;

  if (test('disabled hooks take precedence over profile match', () => {
    withEnv({ ECC_HOOK_PROFILE: 'strict', ECC_DISABLED_HOOKS: 'my-hook' }, () => {
      assert.strictEqual(isHookEnabled('my-hook', { profiles: 'strict' }), false);
    });
  })) passed++; else failed++;

  if (test('uses default profiles (standard, strict) when none specified', () => {
    withEnv({ ECC_HOOK_PROFILE: 'minimal', ECC_DISABLED_HOOKS: undefined }, () => {
      assert.strictEqual(isHookEnabled('my-hook'), false);
    });
  })) passed++; else failed++;

  if (test('allows standard profile by default', () => {
    withEnv({ ECC_HOOK_PROFILE: 'standard', ECC_DISABLED_HOOKS: undefined }, () => {
      assert.strictEqual(isHookEnabled('my-hook'), true);
    });
  })) passed++; else failed++;

  if (test('allows strict profile by default', () => {
    withEnv({ ECC_HOOK_PROFILE: 'strict', ECC_DISABLED_HOOKS: undefined }, () => {
      assert.strictEqual(isHookEnabled('my-hook'), true);
    });
  })) passed++; else failed++;

  if (test('accepts array profiles option', () => {
    withEnv({ ECC_HOOK_PROFILE: 'minimal', ECC_DISABLED_HOOKS: undefined }, () => {
      assert.strictEqual(isHookEnabled('my-hook', { profiles: ['minimal', 'standard'] }), true);
    });
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
