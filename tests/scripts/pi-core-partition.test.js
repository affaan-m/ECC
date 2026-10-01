'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/build-pi-core.js'));
const cases = [
  { name: 'valid partition', valid: true, mutate: () => {} },
  { name: 'skill include/exclude overlap', mutate: m => { m.skills.exclude.sample = 'excluded'; } },
  { name: 'command include/exclude overlap', mutate: m => { m.commands.exclude['sample.md'] = 'excluded'; } },
  { name: 'duplicate included command', mutate: m => { m.commands.include.push('sample.md'); } },
  { name: 'duplicate included skill', mutate: m => { m.skills.include.push('sample'); } },
];
let passed = 0;
let failed = 0;

for (const fixture of cases) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-pi-partition-'));
  try {
    for (const dir of ['scripts', 'manifests', 'skills/sample', 'commands', 'pi/core']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    const script = path.join(root, 'scripts/build-pi-core.js');
    fs.writeFileSync(script, source);
    fs.writeFileSync(path.join(root, 'skills/sample/SKILL.md'), '---\nname: sample\ndescription: Sample local workflow.\n---\n# Sample\n');
    fs.writeFileSync(path.join(root, 'commands/sample.md'), '# Sample prompt\n');
    fs.writeFileSync(path.join(root, 'LICENSE'), 'Fixture license\n');
    fs.writeFileSync(path.join(root, 'VERSION'), '1.0.0\n');
    const marker = path.join(root, 'pi/core/existing.txt');
    fs.writeFileSync(marker, 'existing profile');
    const manifest = {
      profile: { dir: 'pi/core', packageName: 'ecc-pi-core', license: 'MIT', keywords: ['pi-package'] },
      skills: { include: ['sample'], exclude: {}, rename: {} },
      commands: { include: ['sample.md'], exclude: {} },
      safety: {}, curationRules: { include: [], exclude: [] },
    };
    fixture.mutate(manifest);
    fs.writeFileSync(path.join(root, 'manifests/pi-core.json'), JSON.stringify(manifest));
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: root });
    assert.strictEqual(r.status, fixture.valid ? 0 : 1, `${r.stdout}\n${r.stderr}`);
    if (fixture.valid) {
      assert.ok(fs.existsSync(path.join(root, 'pi/core/skills/sample/SKILL.md')));
      assert.ok(fs.existsSync(path.join(root, 'pi/core/commands/sample.md')));
      assert.match(fs.readFileSync(path.join(root, 'pi/core/CURATION.md'), 'utf8'), /includes 1 of 1 skills and 1 of 1 commands/);
    } else {
      assert.match(r.stderr, /classified more than once|duplicate skill name/);
      assert.strictEqual(fs.readFileSync(marker, 'utf8'), 'existing profile');
    }
    passed += 1;
    console.log(`PASS ${fixture.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${fixture.name}: ${error.message}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
