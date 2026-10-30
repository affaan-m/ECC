'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readInstalledPlugins } = require('../../scripts/lib/statusline-render');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-plugin-project-'));
const config = path.join(root, 'profile');const a = path.join(root, 'A');const b = path.join(root, 'B');
for (const dir of [config, a, b]) fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
fs.mkdirSync(path.join(config, 'plugins'));
const records = { 'a-only@fixture': [{ scope: 'local', projectPath: a, version: '9.9.9' }],
  'shared@fixture': [{ scope: 'project', projectPath: a, version: '1.1.0' }, { scope: 'project', projectPath: b, version: '2.2.0' }, { scope: 'user', version: '0.0.1' }],
  'global@fixture': [{ scope: 'user', version: '3.3.3' }] };
const write = value => fs.writeFileSync(path.join(config, 'plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: value }));
const settings = (dir, name, value) => fs.writeFileSync(path.join(dir, '.claude', name), JSON.stringify({ enabledPlugins: value }));
function cli(project) {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/hooks/ecc-statusline.js')], {
    input: JSON.stringify({ model: { display_name: 'Fixture' }, workspace: { current_dir: project } }), encoding: 'utf8', timeout: 5000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: config, ECC_STATUSLINE_USAGE: '1', ECC_STATUSLINE_COMPACT: '0' },
  });assert.equal(result.status, 0, result.stderr);return result.stdout;
}
const tests = [
  ['actual B statusline excludes A-only plugins and selects B shared version independent of record order', () => {
    write(records);const first = cli(b);assert.doesNotMatch(first, /a-only|1\.1\.0/);assert.match(first, /shared.*2\.2\.0/);
    write({ ...records, 'shared@fixture': [...records['shared@fixture']].reverse() });assert.equal(cli(b), first);
  }],
  ['project A gets its applicable local and shared records', () => { write(records);const output = cli(a);assert.match(output, /a-only.*9\.9\.9/);assert.match(output, /shared.*1\.1\.0/); }],
  ['project settings disable a user-enabled plugin in the real statusline', () => {
    write(records);fs.writeFileSync(path.join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { 'global@fixture': true } }));
    settings(b, 'settings.json', { 'global@fixture': false });assert.doesNotMatch(cli(b), /global/);
  }],
  ['local settings override shared project settings without changing their bytes', () => {
    settings(b, 'settings.local.json', { 'global@fixture': true });const file = path.join(b, '.claude/settings.json');const before = fs.readFileSync(file);assert.match(cli(b), /global/);assert.deepEqual(fs.readFileSync(file), before);
  }],
  ['applicable local version overrides project and user records', () => {
    write({ ...records, 'shared@fixture': [...records['shared@fixture'], { scope: 'local', projectPath: b, version: '4.4.4' }] });
    assert.equal(readInstalledPlugins(config, b).find(x => x.name === 'shared').version, '4.4.4');
  }],
  ['nested Git workspaces use the project inventory and local settings', () => {
    require('node:child_process').execFileSync('git', ['init', '-q', b]);
    const nested = path.join(b, 'src');fs.mkdirSync(nested);
    write(records);settings(b, 'settings.local.json', { 'global@fixture': false });
    const output = cli(nested);assert.match(output, /shared.*2\.2\.0/);assert.doesNotMatch(output, /global|a-only/);
  }],
  ['a similarly named sibling path does not inherit B-scoped installations', () => {
    const sibling = path.join(root, 'B-other');fs.mkdirSync(sibling);write(records);
    const plugins = readInstalledPlugins(config, sibling);assert.equal(plugins.find(x => x.name === 'shared').version, '0.0.1');assert.ok(!plugins.some(x => x.name === 'a-only'));
  }],
];
let passed = 0;let failed = 0;
try {
  for (const [name, test] of tests) { try { test();console.log(`PASS ${name}`);passed++; } catch (error) { console.log(`FAIL ${name}: ${error.stack}`);failed++; } }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log(`Passed: ${passed}\nFailed: ${failed}`);process.exitCode = failed ? 1 : 0;
