'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ts = require('typescript');

const source = fs.readFileSync(path.resolve(__dirname, '../../scripts/codemaps/generate.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const areas = { frontend: 'app', backend: 'api', database: 'db', integrations: 'adapters', workers: 'workers' };
let passed = 0;
let failed = 0;

for (const fixture of [
  { name: 'root directories', prefix: '', expected: 1 },
  { name: 'nested directories', prefix: 'src/', expected: 1 },
  { name: 'similar directory names', prefix: 'my', expected: 0 },
  { name: 'root framework API routes', prefix: '', expected: 1, apiRoutes: true },
  { name: 'nested framework API routes', prefix: 'src/', expected: 1, apiRoutes: true },
  { name: 'ordinary backend error module', prefix: 'src/', expected: 1, backendError: true },
  { name: 'Next declared as a development dependency', prefix: '', expected: 1, apiRoutes: true, devNext: true },
  { name: 'nested non-Next package owns its error module', prefix: 'src/', expected: 1, backendError: true, nestedPackage: true },
]) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codemap-'));
  const root = path.join(temp, 'project');
  try {
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      dependencies: (fixture.apiRoutes && !fixture.devNext) || fixture.nestedPackage ? { next: '15.0.0' } : { express: '5.0.0' },
      devDependencies: fixture.devNext ? { next: '15.0.0' } : {},
    }));
    const script = path.join(temp, 'generate.cjs');
    fs.writeFileSync(script, compiled);
    for (const dir of Object.values(areas)) {
      const directory = path.join(root, fixture.prefix + dir);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'index.js'), 'module.exports = {};\n');
    }
    const apiFiles = ['app/api/route.ts', 'app/api/users/route.ts', 'pages/api/users.ts'];
    if (fixture.apiRoutes) {
      for (const file of [...apiFiles, 'app/page.tsx', 'pages/home.tsx', 'app/api/users/page.tsx']) {
        const fullPath = path.join(root, fixture.prefix + file);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, 'export default function handler() {}\n');
      }
    }
    if (fixture.backendError) {
      const directory = path.join(root, fixture.prefix + 'app/api');
      fs.mkdirSync(directory, { recursive: true });
      if (fixture.nestedPackage) {
        fs.writeFileSync(path.join(root, fixture.prefix, 'package.json'), JSON.stringify({ dependencies: { express: '5.0.0' } }));
      }
      fs.writeFileSync(path.join(directory, 'error.ts'), 'export function errorHandler() {}\n');
    }
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    for (const [area, dir] of Object.entries(areas)) {
      const doc = fs.readFileSync(path.join(root, 'docs/CODEMAPS', area + '.md'), 'utf8');
      const expected = fixture.expected + (fixture.apiRoutes ? (area === 'backend' ? 3 : area === 'frontend' ? 3 : 0) : 0)
        + (fixture.backendError && area === 'backend' ? 1 : 0);
      assert.ok(doc.includes(`**Total Files:** ${expected}`), `${area}: wrong file count`);
      if (fixture.expected) assert.ok(doc.includes(`${fixture.prefix}${dir}/index.js`), `${area}: missing module`);
      if (fixture.backendError && ['frontend', 'backend'].includes(area)) {
        assert.strictEqual(doc.includes(fixture.prefix + 'app/api/error.ts'), area === 'backend');
      }
      if (fixture.apiRoutes && ['frontend', 'backend'].includes(area)) {
        assert.strictEqual(doc.includes(fixture.prefix + 'app/api/users/page.tsx'), area === 'frontend');
        for (const file of apiFiles) {
          assert.strictEqual(doc.includes(`${fixture.prefix}${file}`), area === 'backend', `${file}: wrong area`);
        }
      }
    }
    passed += 1;
    console.log(`PASS ${fixture.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${fixture.name}: ${error.message}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
