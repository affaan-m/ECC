/**
 * Tests for scripts/lib/statusline-render.js
 *
 * Run with: node tests/lib/statusline-render.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  C,
  pctColor,
  buildBar,
  formatCountdown,
  formatMs,
  computeCacheStats,
  buildUsageLine,
  buildSessionLine,
  buildEccLine,
  readInstalledPlugins,
  getHooksSummary,
} = require('../../scripts/lib/statusline-render');

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

function runTests() {
  console.log('\n=== Testing statusline-render.js ===\n');

  let passed = 0;
  let failed = 0;
  const t = (name, fn) => (test(name, fn) ? passed++ : failed++);

  console.log('buildBar:');
  t('0% renders all empty blocks', () => {
    assert.strictEqual(buildBar(0, 8), '░'.repeat(8));
  });
  t('100% renders all full blocks', () => {
    assert.strictEqual(buildBar(100, 8), '█'.repeat(8));
  });
  t('50% renders half full', () => {
    assert.strictEqual(buildBar(50, 8), '████░░░░');
  });
  t('clamps values beyond 100', () => {
    assert.strictEqual(buildBar(250, 4), '████');
  });
  t('clamps negative values', () => {
    assert.strictEqual(buildBar(-10, 4), '░░░░');
  });

  console.log('\nglyphSet:');
  t('non-UTF-8 locale falls back to ASCII glyphs', () => {
    const { glyphSet, ASCII_GLYPHS } = require('../../scripts/lib/statusline-render');
    assert.strictEqual(glyphSet({ LANG: 'C' }), ASCII_GLYPHS);
    assert.strictEqual(glyphSet({}), ASCII_GLYPHS);
  });
  t('UTF-8 locale uses unicode glyphs', () => {
    const { glyphSet, UNICODE_GLYPHS } = require('../../scripts/lib/statusline-render');
    assert.strictEqual(glyphSet({ LANG: 'en_US.UTF-8' }), UNICODE_GLYPHS);
    assert.strictEqual(glyphSet({ LC_ALL: 'C.utf8' }), UNICODE_GLYPHS);
  });
  t('ECC_BAR_GLYPHS forces either set', () => {
    const { glyphSet, ASCII_GLYPHS, UNICODE_GLYPHS } = require('../../scripts/lib/statusline-render');
    assert.strictEqual(glyphSet({ LANG: 'en_US.UTF-8', ECC_BAR_GLYPHS: 'ascii' }), ASCII_GLYPHS);
    assert.strictEqual(glyphSet({ LANG: 'C', ECC_BAR_GLYPHS: 'unicode' }), UNICODE_GLYPHS);
  });

  console.log('\npctColor:');
  t('below 60 uses brand color', () => {
    assert.strictEqual(pctColor(59, C.amber), C.amber);
  });
  t('60-79 is yellow', () => {
    assert.strictEqual(pctColor(60), C.yellow);
  });
  t('80-89 is orange', () => {
    assert.strictEqual(pctColor(80), C.orange);
  });
  t('90+ is red', () => {
    assert.strictEqual(pctColor(95), C.red);
  });

  console.log('\nformatCountdown:');
  t('past timestamp returns empty', () => {
    assert.strictEqual(formatCountdown(Date.now() / 1000 - 60), '');
  });
  t('invalid input returns empty', () => {
    assert.strictEqual(formatCountdown(null), '');
    assert.strictEqual(formatCountdown('soon'), '');
  });
  t('minutes-scale countdown ends with m', () => {
    const result = formatCountdown(Date.now() / 1000 + 42 * 60);
    assert.ok(/^\d+m$/.test(result), `got: ${result}`);
  });
  t('hours-scale countdown contains h', () => {
    const result = formatCountdown(Date.now() / 1000 + 90 * 60);
    assert.ok(result.includes('h'), `got: ${result}`);
  });
  t('days-scale countdown ends with d', () => {
    const result = formatCountdown(Date.now() / 1000 + 3 * 24 * 3600 + 60);
    assert.ok(/^\d+d$/.test(result), `got: ${result}`);
  });

  console.log('\nformatMs:');
  t('zero returns empty', () => {
    assert.strictEqual(formatMs(0), '');
  });
  t('seconds scale', () => {
    assert.strictEqual(formatMs(30 * 1000), '30s');
  });
  t('minutes scale', () => {
    assert.strictEqual(formatMs(5 * 60 * 1000), '5m');
  });
  t('hours scale with remainder', () => {
    assert.strictEqual(formatMs((3 * 60 + 11) * 60 * 1000), '3h11m');
  });

  console.log('\ncomputeCacheStats:');
  t('null usage returns null', () => {
    assert.strictEqual(computeCacheStats(null), null);
  });
  t('zero tokens returns null', () => {
    assert.strictEqual(computeCacheStats({ input_tokens: 0 }), null);
  });
  t('computes hit percentage from cache reads', () => {
    const stats = computeCacheStats({
      input_tokens: 10,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 80,
    });
    assert.strictEqual(stats.hitPct, 80);
  });

  console.log('\nbuildUsageLine:');
  t('no rate limits returns empty string', () => {
    assert.strictEqual(buildUsageLine(undefined, { hitPct: 90 }), '');
    assert.strictEqual(buildUsageLine({}, null), '');
  });
  t('renders both windows with percentages', () => {
    const line = buildUsageLine({
      five_hour: { used_percentage: 71, resets_at: Date.now() / 1000 + 3600 },
      seven_day: { used_percentage: 23, resets_at: Date.now() / 1000 + 86400 * 3 },
    }, null);
    assert.ok(line.includes('5h'), 'expected 5h label');
    assert.ok(line.includes('7d'), 'expected 7d label');
    assert.ok(line.includes('71%'), 'expected 5h percentage');
    assert.ok(line.includes('23%'), 'expected 7d percentage');
    assert.ok(line.includes('↻'), 'expected reset countdown');
  });
  t('renders a single window when only one exists', () => {
    const line = buildUsageLine({ five_hour: { used_percentage: 5 } }, null);
    assert.ok(line.includes('5h'), 'expected 5h label');
    assert.ok(!line.includes('7d'), 'no 7d label expected');
  });
  t('appends cache hit rate when bars exist', () => {
    const line = buildUsageLine({ five_hour: { used_percentage: 5 } }, { hitPct: 98 });
    assert.ok(line.includes('cache'), 'expected cache segment');
    assert.ok(line.includes('98%'), 'expected cache percentage');
  });

  console.log('\nbuildSessionLine:');
  t('shows model with effort badge', () => {
    const line = buildSessionLine({ model: 'Opus 5', effort: 'xhigh' });
    assert.ok(line.includes('Opus 5'), 'expected model name');
    assert.ok(line.includes('xhigh'), 'expected effort badge');
  });
  t('default effort high shows no badge', () => {
    const line = buildSessionLine({ model: 'Opus 5', effort: 'high' });
    assert.ok(!line.includes('high'), 'no badge expected for default effort');
  });
  t('shows cost, diff, and task', () => {
    const line = buildSessionLine({
      model: 'Opus 5',
      costUsd: 1.234,
      linesAdded: 11,
      linesRemoved: 4,
      durationMs: 60 * 1000,
      task: 'Fixing auth bug',
    });
    assert.ok(line.includes('$1.23'), 'expected cost');
    assert.ok(line.includes('+11/-4'), 'expected diff stats');
    assert.ok(line.includes('1m'), 'expected duration');
    assert.ok(line.includes('Fixing auth bug'), 'expected task');
  });
  t('shows 1M context window size', () => {
    const line = buildSessionLine({ model: 'Opus 5', ctxBar: ' bar 10%', ctxWindowSize: 1000000 });
    assert.ok(line.includes('1M'), 'expected 1M badge');
  });

  console.log('\nbuildEccLine:');
  t('shows version, hooks profile, plugins, dirname', () => {
    const line = buildEccLine({
      eccVersion: '2.2.0',
      hooks: { enabled: true, profile: 'standard', disabledCount: 0 },
      plugins: [{ name: 'ecc', version: '2.2.0' }, { name: 'swift-lsp', version: '1.0.0' }],
      dirname: 'myproject',
    });
    assert.ok(line.includes('ECC 2.2.0'), 'expected ECC version');
    assert.ok(line.includes('hooks standard'), 'expected hooks profile');
    assert.ok(line.includes('swift-lsp'), 'expected plugin name');
    assert.ok(line.includes('1.0.0'), 'expected plugin version');
    assert.ok(line.includes('myproject'), 'expected dirname');
  });
  t('disabled hooks render hooks off', () => {
    const line = buildEccLine({ hooks: { enabled: false, profile: 'standard', disabledCount: 0 } });
    assert.ok(line.includes('hooks off'), 'expected hooks off');
  });
  t('disabled hook count is shown', () => {
    const line = buildEccLine({ hooks: { enabled: true, profile: 'minimal', disabledCount: 2 } });
    assert.ok(line.includes('(2 off)'), 'expected disabled count');
  });
  t('caps plugin list at 4 with overflow count', () => {
    const plugins = ['a', 'b', 'c', 'd', 'e', 'f'].map(name => ({ name, version: '1.0.0' }));
    const line = buildEccLine({ plugins });
    assert.ok(line.includes('+2'), 'expected +2 overflow');
  });

  console.log('\nreadInstalledPlugins:');
  t('reads v2 plugin file and filters disabled plugins, ecc first', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-render-test-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'plugins'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'plugins', 'installed_plugins.json'), JSON.stringify({
        version: 2,
        plugins: {
          'zeta@market': [{ version: '0.5.0', scope: 'user' }],
          'ecc@ecc': [{ version: '2.2.0', scope: 'user' }],
          'off-plugin@market': [{ version: '9.9.9', scope: 'user' }],
        },
      }));
      fs.writeFileSync(path.join(tmpDir, 'settings.json'), JSON.stringify({
        enabledPlugins: { 'zeta@market': true, 'ecc@ecc': true, 'off-plugin@market': false },
      }));

      const plugins = readInstalledPlugins(tmpDir);
      assert.strictEqual(plugins.length, 2);
      assert.strictEqual(plugins[0].name, 'ecc');
      assert.strictEqual(plugins[0].version, '2.2.0');
      assert.strictEqual(plugins[1].name, 'zeta');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
  t('missing plugin file returns empty array', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-render-test-'));
    try {
      assert.deepStrictEqual(readInstalledPlugins(tmpDir), []);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  console.log('\ngetHooksSummary:');
  t('defaults to enabled standard profile', () => {
    const summary = getHooksSummary({});
    assert.strictEqual(summary.enabled, true);
    assert.strictEqual(summary.profile, 'standard');
    assert.strictEqual(summary.disabledCount, 0);
  });
  t('respects ECC_HOOKS_ENABLED=false', () => {
    assert.strictEqual(getHooksSummary({ ECC_HOOKS_ENABLED: 'false' }).enabled, false);
  });
  t('reports profile and disabled hook count', () => {
    const summary = getHooksSummary({
      ECC_HOOK_PROFILE: 'minimal',
      ECC_DISABLED_HOOKS: 'a,b',
    });
    assert.strictEqual(summary.profile, 'minimal');
    assert.strictEqual(summary.disabledCount, 2);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

const { failed } = runTests();
process.exit(failed > 0 ? 1 : 0);
