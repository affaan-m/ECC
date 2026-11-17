'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { resolveWindowsBashCandidates } = require('../../scripts/lib/windows-bash');
const { buildUsageLines } = require('../../scripts/hooks/ecc-statusline');
const { buildUsageLine } = require('../../scripts/lib/statusline-render');
const shellQuote = value => {
  const portable = process.platform === 'win32' ? value.split('\\').join('/') : value;
  return "'" + portable.replace(/'/g, "'\\''") + "'";
};
const repoRoot = path.resolve(__dirname, '../..');
// eslint-disable-next-line no-control-regex -- Statusline ANSI output is the fixture boundary.
const stripAnsi = value => value.replace(/\x1b\[[0-9;]*m/g, '');

function registeredDisplay(t, payload, options = {}, bridge) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-statusline-late-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const configDir = path.join(home, 'selected profile');
  fs.mkdirSync(configDir);
  const temporaryDir = path.join(home, 'tmp');
  fs.mkdirSync(temporaryDir);
  if (bridge) fs.writeFileSync(path.join(temporaryDir, `ecc-metrics-${payload.session_id}.json`), JSON.stringify(bridge));
  const example = JSON.parse(fs.readFileSync(path.join(repoRoot, 'examples/statusline.json'), 'utf8'));
  const command = example.statusLine.command.replace(/^node /, `${shellQuote(process.execPath)} `)
    .replace('"<plugin-root>/scripts/hooks/ecc-statusline.js"',
      shellQuote(path.join(repoRoot, 'scripts/hooks/ecc-statusline.js')));
  const settingsPath = path.join(configDir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { ...example.statusLine, command } }));
  const before = fs.readFileSync(settingsPath);
  const settings = JSON.parse(before);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: configDir, TMPDIR: temporaryDir, TEMP: temporaryDir, TMP: temporaryDir,
    ECC_STATUSLINE_USAGE: '1', ECC_STATUSLINE_COMPACT: '0', ECC_BAR_GLYPHS: 'ascii', ...options };
  if (env.ECC_STATUSLINE_USAGE === undefined) delete env.ECC_STATUSLINE_USAGE;
  const shell = process.platform === 'win32' ? resolveWindowsBashCandidates(['bash.exe', 'bash'], { env })[0] : '/bin/sh';
  assert.ok(shell, 'A native Git Bash executable is required for the Windows registration check');
  const result = spawnSync(shell, ['-c', settings.statusLine.command], {
    input: JSON.stringify(payload), encoding: 'utf8', env, timeout: 5000, cwd: home,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(settingsPath), before, 'display must not rewrite its registration');
  return stripAnsi(result.stdout);
}

for (const [window, label] of [['five_hour', '5h'], ['seven_day', '7d'], ['spend_limit', 'spend']]) {
  test(`registered compact display preserves independently supplied ${window}`, t => {
    const output = registeredDisplay(t, { model: { display_name: 'Fixture' }, workspace: { current_dir: '/fixture/project' },
      rate_limits: { [window]: { used_percentage: 23.5 } } }, { ECC_STATUSLINE_COMPACT: '1' });
    assert.match(output, new RegExp(`${label} 24%`));
    assert.equal(output.split('\n').length, 1);
    assert.doesNotMatch(output, /[_\u2588\u2591]/, 'abbreviated usage has no bar');
  });
}

for (const compact of ['0', '1']) {
  test(`registered opt-in display honors ASCII context glyphs, compact=${compact}`, t => {
    const output = registeredDisplay(t, { context_window: { remaining_percentage: 80 } },
      { ECC_STATUSLINE_COMPACT: compact });
    assert.match(output, /[|_]{10} 24%/);
    assert.doesNotMatch(output, /[\u2588\u2591]/);
  });
}

test('registered default display keeps its original exact output despite optional settings/data', t => {
  const payload = { model: { display_name: 'Fixture' }, workspace: { current_dir: '/fixture/project' },
    context_window: { remaining_percentage: 80 }, cost: { total_duration_ms: 125000 },
    rate_limits: { spend_limit: { used_percentage: 50 }, five_hour: { used_percentage: 30 } } };
  const expected = `Fixture \u2502 project ${'\u2588'.repeat(2)}${'\u2591'.repeat(8)} 24%`;
  assert.equal(registeredDisplay(t, payload, { ECC_STATUSLINE_USAGE: undefined, ECC_STATUSLINE_COMPACT: '1' }), expected);
  assert.equal(registeredDisplay(t, payload, { ECC_STATUSLINE_USAGE: '0' }), expected);
});

test('registered opt-in display uses stdin session duration without bridge metrics', t => {
  assert.match(registeredDisplay(t, { cost: { total_duration_ms: 125000 } }), /2m/);
});

test('stdin duration takes precedence over bridge elapsed time, including explicit zero', () => {
  const bridge = { first_timestamp: new Date(Date.now() - 600000).toISOString() };
  assert.match(stripAnsi(buildUsageLines({ cost: { total_duration_ms: 125000 } }, bridge, '').join('\n')), /2m/);
  assert.doesNotMatch(stripAnsi(buildUsageLines({ cost: { total_duration_ms: 0 } }, bridge, '').join('\n')), /10m/);
});

test('invalid stdin duration falls back to a finite nonnegative bridge duration', () => {
  const bridge = { first_timestamp: new Date(Date.now() - 600000).toISOString() };
  for (const duration of [undefined, null, -1, '125000', NaN, Infinity]) {
    const output = stripAnsi(buildUsageLines({ cost: { total_duration_ms: duration } }, bridge, '').join('\n'));
    assert.match(output, /10m/);
    assert.doesNotMatch(output, /NaN|Infinity/);
  }
  for (const firstTimestamp of ['invalid', new Date(Date.now() + 600000).toISOString()]) {
    const output = stripAnsi(buildUsageLines({}, { first_timestamp: firstTimestamp }, '').join('\n'));
    assert.doesNotMatch(output, /NaN|Infinity|10m/);
  }
});

test('gateway spend limit renders independently and malformed windows stay absent', () => {
  assert.match(stripAnsi(buildUsageLine({ spend_limit: { used_percentage: 62.8,
    resets_at: Math.floor(Date.now() / 1000) + 3600 } })), /spend.*63%.*1h/);
  for (const percentage of [undefined, null, -1, '25', true, NaN, Infinity]) {
    assert.equal(buildUsageLine({ spend_limit: { used_percentage: percentage } }), '');
  }
  assert.match(stripAnsi(buildUsageLine({ spend_limit: { used_percentage: 125 } })), /125%/);
});


test('registered command prefers stdin duration over bridge and preserves legacy bridge output', t => {
  const bridge = { first_timestamp: new Date(Date.now() - 600000).toISOString(),
    total_cost_usd: 1.23, tool_count: 2, files_modified_count: 1 };
  const data = { session_id: 'duration-fixture', model: { display_name: 'Fixture' },
    workspace: { current_dir: '/fixture/project' }, cost: { total_duration_ms: 125000 } };
  const enabled = registeredDisplay(t, data, {}, bridge);
  assert.match(enabled, /2m/);
  assert.doesNotMatch(enabled, /10m/);
  assert.doesNotMatch(registeredDisplay(t, { ...data, cost: { total_duration_ms: 0 } }, {}, bridge), /10m/);
  assert.match(registeredDisplay(t, data, { ECC_STATUSLINE_USAGE: '0' }, bridge), /\$1\.23 2t 1f 10m/);
  assert.match(registeredDisplay(t, { ...data, cost: { total_duration_ms: -1 } }, {}, bridge), /10m/);
});
