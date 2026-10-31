'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('actual statusline usage display is opt-in and leaves provider settings alone', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-statusline-usage-'));
  try {
    const payload = { model: { display_name: 'Claude fixture' }, context_window: { remaining_percentage: 80 },
      rate_limits: { five_hour: { used_percentage: 20, resets_at: Math.floor(Date.now() / 1000) + 3600 } } };
    const render = value => {
      const child = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/hooks/ecc-statusline.js')], {
        input: JSON.stringify(payload), encoding: 'utf8', timeout: 5000,
        env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: home,
          ECC_STATUSLINE_USAGE: value, ECC_BAR_GLYPHS: 'ascii' },
      });
      assert.equal(child.status, 0, child.stderr);
      return child.stdout;
    };
    assert.equal(render('0').split('\n').length, 1);
    assert.ok(render('1').split('\n').length >= 2);
    assert.match(render('1'), /5h/);
    assert.deepEqual(fs.readdirSync(home), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

for (const hasSelectedPlugins of [true, false]) {
  test(`selected Claude profile plugin metadata ${hasSelectedPlugins ? 'is displayed' : 'never borrows the default'}`, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-statusline-profile-'));
    try {
      const selected = path.join(home, 'selected-profile');
      const writePlugins = (directory, id) => {
        fs.mkdirSync(path.join(directory, 'plugins'), { recursive: true });
        fs.writeFileSync(path.join(directory, 'plugins', 'installed_plugins.json'),
          JSON.stringify({ version: 2, plugins: { [id]: [{ version: '7.8.9' }] } }));
        fs.writeFileSync(path.join(directory, 'settings.json'),
          JSON.stringify({ enabledPlugins: { [id]: true } }));
      };
      writePlugins(path.join(home, '.claude'), 'default-profile-marker@fixture');
      if (hasSelectedPlugins) writePlugins(selected, 'selected-profile-marker@fixture');
      const child = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/hooks/ecc-statusline.js')], {
        input: JSON.stringify({ model: { display_name: 'Claude fixture' } }),
        encoding: 'utf8', timeout: 5000,
        env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: selected,
          ECC_STATUSLINE_USAGE: '1', ECC_BAR_GLYPHS: 'ascii' },
      });
      assert.equal(child.status, 0, child.stderr);
      assert.doesNotMatch(child.stdout, /default-profile-marker/);
      if (hasSelectedPlugins) assert.match(child.stdout, /selected-profile-marker/);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
}
