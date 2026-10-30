'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('Pi generation stays byte-identical after local Python execution creates caches', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-pi-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, content) => {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  };
  write('scripts/build-pi-core.js', fs.readFileSync(path.join(__dirname, '../../scripts/build-pi-core.js')));
  write('VERSION', '2.2.3\n');
  write('LICENSE', 'Fixture license\n');
  fs.mkdirSync(path.join(root, 'commands'));
  write('skills/demo/SKILL.md', '---\nname: demo\ndescription: Review local code.\n---\n\n# Demo\n');
  write('skills/demo/scripts/main.py', 'print("fixture")\n');
  write('manifests/pi-core.json', JSON.stringify({
    profile: { dir: 'pi/core', packageName: 'ecc-pi-core', license: 'MIT', keywords: ['pi-package'] },
    curationRules: { include: ['local'], exclude: [] },
    skills: { include: ['demo'], exclude: {} },
    commands: { include: [], exclude: {} },
    safety: {},
  }));
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/build-pi-core.js'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 10000,
  });
  const built = run();
  assert.equal(built.status, 0, built.stderr);
  const profile = path.join(root, 'pi/core/skills/demo');
  const original = fs.readFileSync(path.join(profile, 'scripts/main.py'));
  write('skills/demo/scripts/__pycache__/main.cpython-312.pyc', Buffer.from([0, 255, 1]));
  write('skills/demo/.pytest_cache/README.md', 'Derived test state\n');
  write('skills/demo/scripts/main.pyo', Buffer.from([0, 1]));
  write('skills/demo/scripts/main.pyd', Buffer.from([0, 2]));
  const check = run('--check');
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(fs.readFileSync(path.join(profile, 'scripts/main.py')), original);
  assert.deepEqual(fs.readdirSync(path.join(profile, 'scripts')), ['main.py']);
});
