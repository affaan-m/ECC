/**
 * Tests for scripts/codex/ecc-usage-bar-codex.js
 *
 * Run with: node tests/codex/ecc-usage-bar-codex.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findNewestSession,
  readLastTokenCount,
  windowLabel,
  renderBar,
} = require('../../scripts/codex/ecc-usage-bar-codex');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed += 1;
  }
}

console.log('\n=== Testing ecc-usage-bar-codex.js ===\n');

console.log('windowLabel:');
test('weekly window renders 7d', () => {
  assert.strictEqual(windowLabel(10080), '7d');
});
test('5-hour window renders 5h', () => {
  assert.strictEqual(windowLabel(300), '5h');
});
test('daily window renders 1d', () => {
  assert.strictEqual(windowLabel(1440), '1d');
});
test('missing window renders empty', () => {
  assert.strictEqual(windowLabel(undefined), '');
});

console.log('\nrenderBar:');
test('no data renders placeholder', () => {
  const bar = renderBar(null);
  assert.ok(bar.includes('no session data'), `got: ${bar}`);
});
test('renders primary window, context, and token total', () => {
  const bar = renderBar({
    info: {
      total_token_usage: { total_tokens: 1500000 },
      last_token_usage: { total_tokens: 100000 },
      model_context_window: 200000,
    },
    rate_limits: {
      primary: { used_percent: 42, window_minutes: 10080, resets_at: Date.now() / 1000 + 86400 },
      secondary: null,
    },
  });
  assert.ok(bar.includes('7d'), 'expected 7d label');
  assert.ok(bar.includes('42%'), 'expected usage percentage');
  assert.ok(bar.includes('50%'), 'expected context percentage');
  assert.ok(bar.includes('1.5M tok'), 'expected token total');
  assert.ok(bar.includes('↻'), 'expected reset countdown');
});
test('plain mode strips all color codes', () => {
  const bar = renderBar({
    info: {},
    rate_limits: { primary: { used_percent: 95, window_minutes: 300 } },
  }, { plain: true });
  assert.ok(bar.includes('5h'), 'expected window label');
  assert.ok(bar.includes('95%'), 'expected percentage');
  assert.ok(!bar.includes('\x1b['), 'no ANSI in plain mode');
  assert.ok(!bar.includes('#[fg'), 'no tmux codes in plain mode');
});
test('tmux mode uses tmux color format', () => {
  const bar = renderBar({
    info: {},
    rate_limits: { primary: { used_percent: 10, window_minutes: 300 } },
  }, { tmux: true });
  assert.ok(bar.includes('#[fg=colour214]'), 'expected tmux color codes');
  assert.ok(!bar.includes('\x1b['), 'no raw ANSI in tmux mode');
});

console.log('\nbuildFullLines:');
test('renders three Claude-style lines in tmux mode without ANSI', () => {
  const { buildFullLines } = require('../../scripts/codex/ecc-usage-bar-codex');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-bar-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'config.toml'), 'model = "gpt-5.6"\n');
    const lines = buildFullLines({
      info: {
        total_token_usage: { total_tokens: 2000000 },
        last_token_usage: { total_tokens: 50000, input_tokens: 40000, cached_input_tokens: 30000 },
        model_context_window: 200000,
      },
      rate_limits: { primary: { used_percent: 42, window_minutes: 10080 } },
    }, tmpDir, 'tmux');
    assert.strictEqual(lines.length, 3);
    assert.ok(lines[0].includes('7d') && lines[0].includes('cache'), 'line 1 usage + cache');
    assert.ok(lines[1].includes('gpt-5.6') && lines[1].includes('ctx'), 'line 2 model + ctx');
    assert.ok(lines[2].includes('ECC'), 'line 3 ECC identity');
    assert.ok(!lines.join('').includes('\x1b['), 'no raw ANSI in tmux mode');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

console.log('\nreadCodexPlugins:');
test('parses enabled plugins from config.toml, ecc first', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-bar-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'config.toml'), [
      '[tui]',
      'status_line = ["model-with-reasoning"]',
      '[plugins."zeta@market"]',
      'enabled = true',
      '[plugins."ecc@ecc"]',
      'enabled = true',
      '[plugins."off@market"]',
      'enabled = false',
    ].join('\n'));
    const { readCodexPlugins } = require('../../scripts/codex/ecc-usage-bar-codex');
    const plugins = readCodexPlugins(tmpDir);
    assert.strictEqual(plugins.length, 2);
    assert.strictEqual(plugins[0].name, 'ecc');
    assert.strictEqual(plugins[1].name, 'zeta');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

console.log('\nsession file parsing:');
test('finds newest session and reads last token_count', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-bar-'));
  try {
    const dayDir = path.join(tmpDir, 'sessions', '2026', '08', '06');
    fs.mkdirSync(dayDir, { recursive: true });
    const older = path.join(dayDir, 'rollout-2026-08-06T01-00-00-aaa.jsonl');
    const newer = path.join(dayDir, 'rollout-2026-08-06T02-00-00-bbb.jsonl');
    const tokenEvent = pct => JSON.stringify({
      timestamp: '2026-08-06T02:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { total_tokens: 1000 }, model_context_window: 200000 },
        rate_limits: { primary: { used_percent: pct, window_minutes: 10080 } },
      },
    });
    fs.writeFileSync(older, `${tokenEvent(5)}\n`);
    fs.writeFileSync(newer, `{"type":"session_meta"}\n${tokenEvent(11)}\n${tokenEvent(23)}\n`);

    const found = findNewestSession(tmpDir);
    assert.strictEqual(found, newer);
    const tokenCount = readLastTokenCount(found);
    assert.strictEqual(tokenCount.rate_limits.primary.used_percent, 23);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
test('missing sessions directory returns null', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-bar-'));
  try {
    assert.strictEqual(findNewestSession(tmpDir), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
