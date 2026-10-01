'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readFrontmatter, readSkill } = require('../../scripts/dashboard-web');

let passed = 0;
let failed = 0;
for (const newline of ['\n', '\r\n']) {
  for (const bom of ['', '\uFEFF']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-dashboard-fm-'));
    try {
      const file = path.join(root, 'SKILL.md');
      const body = ['# Sample', 'Body with --- inline.', 'Second line.'].join(newline);
      const source = bom + ['---', 'name: sample', 'description: Sample description', 'model: opus', 'tools: ["Read", "Grep"]', '---', body].join(newline);
      fs.writeFileSync(file, source);
      const parsed = readFrontmatter(file);
      assert.strictEqual(parsed.name, 'sample');
      assert.strictEqual(parsed.description, 'Sample description');
      assert.strictEqual(parsed.model, 'opus');
      assert.deepStrictEqual(parsed.tools, ['Read', 'Grep']);
      assert.strictEqual(parsed._body, body);
      assert.deepStrictEqual(readSkill(file), { d: 'Sample description', b: body });
      assert.strictEqual(fs.readFileSync(file, 'utf8'), source);
      passed += 1;
      console.log(`PASS ${newline === '\n' ? 'LF' : 'CRLF'}${bom ? ' with BOM' : ''}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL: ${error.message}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
