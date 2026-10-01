'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/ci/validate-commands.js'));
const cases = [
  { name: 'valid', lines: ['---', 'description: "Useful command"', '---', '# Command'], status: 0 },
  { name: 'sequence', lines: ['---', 'description: [unfinished', '---', '# Command'], status: 1, error: /not a closed YAML sequence/ },
  { name: 'mapping', lines: ['---', 'description: {unfinished', '---', '# Command'], status: 1, error: /not a closed YAML mapping/ },
  { name: 'delimiter', lines: ['---', 'description: useful', '# Command'], status: 1, error: /missing a closing --- delimiter/ },
  { name: 'invalid-line', lines: ['---', 'not a key value pair', '---', '# Command'], status: 1, error: /invalid frontmatter line/ },
];
let passed = 0;
let failed = 0;

for (const newline of ['\n', '\r\n']) {
  for (const bom of ['', '\uFEFF']) {
    for (const fixture of cases) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-command-fm-'));
      try {
        const scriptDir = path.join(root, 'scripts', 'ci');
        const commandsDir = path.join(root, 'commands');
        fs.mkdirSync(scriptDir, { recursive: true });
        fs.mkdirSync(commandsDir);
        const script = path.join(scriptDir, 'validate-commands.js');
        fs.writeFileSync(script, source);
        const file = path.join(commandsDir, 'fixture.md');
        const original = bom + fixture.lines.join(newline) + newline;
        fs.writeFileSync(file, original);
        const result = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: root });
        assert.strictEqual(result.status, fixture.status, `${result.stdout}\n${result.stderr}`);
        if (fixture.error) assert.match(result.stderr, fixture.error);
        assert.strictEqual(fs.readFileSync(file, 'utf8'), original);
        passed += 1;
        console.log(`PASS ${fixture.name} / ${newline === '\n' ? 'LF' : 'CRLF'} / ${bom ? 'BOM' : 'no BOM'}`);
      } catch (error) {
        failed += 1;
        console.error(`FAIL ${fixture.name}: ${error.message}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
}

console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
