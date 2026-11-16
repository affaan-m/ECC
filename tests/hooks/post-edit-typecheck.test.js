/**
 * Tests for scripts/hooks/post-edit-typecheck.js
 *
 * Run with: node tests/hooks/post-edit-typecheck.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { diagnosticMatchesFile } = require('../../scripts/hooks/post-edit-typecheck');

const SCRIPT = path.resolve(__dirname, '../../scripts/hooks/post-edit-typecheck.js');
const SKIPPED = Symbol('skipped');

function test(name, fn) {
  try {
    if (fn() === SKIPPED) {
      console.log(`  SKIP ${name}`);
      return 'skipped';
    }
    console.log(`  PASS ${name}`);
    return 'passed';
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error && error.message ? error.message : error}`);
    return 'failed';
  }
}

const results = [];

results.push(
  test('matches forward-slash tsc paths against Windows edited paths', () => {
    const candidates = new Set(['C:\\project\\src\\index.ts', 'src\\index.ts']);
    assert.strictEqual(diagnosticMatchesFile('src/index.ts(1,14): error TS2322: Type', candidates), true);
    assert.strictEqual(diagnosticMatchesFile('src/other.ts(1,14): error TS2322: Type', candidates), false);
  })
);

results.push(
  test('matches a diagnostic by the file it names, not by a substring of the line', () => {
    const rootIndex = new Set(['/project/index.ts', 'index.ts']);
    assert.strictEqual(diagnosticMatchesFile('index.ts(1,14): error TS2322: Type', rootIndex), true);
    assert.strictEqual(diagnosticMatchesFile('src/index.ts(1,14): error TS2322: Type', rootIndex), false);
    assert.strictEqual(diagnosticMatchesFile('other-index.ts(1,14): error TS2322: Type', rootIndex), false);
    const utils = new Set(['/project/src/utils.ts', 'src/utils.ts']);
    assert.strictEqual(diagnosticMatchesFile("app.ts(3,1): error TS2307: Cannot find module './src/utils.ts'", utils), false);
    assert.strictEqual(diagnosticMatchesFile("  Type 'string' is not assignable to type 'number'.", utils), false);
    assert.strictEqual(diagnosticMatchesFile('src/utils.ts(1,14): error TS2345: call(1,2): bad', utils), true);
    assert.strictEqual(diagnosticMatchesFile('app/(auth)/[...slug]/page.tsx(3,5): error TS2322', new Set(['app/(auth)/[...slug]/page.tsx'])), true);
  })
);

results.push(
  test('requiring the hook does not attach stdin listeners or echo stdin', () => {
    const script = [
      'const beforeData = process.stdin.listenerCount("data");',
      'const beforeEnd = process.stdin.listenerCount("end");',
      `const mod = require(${JSON.stringify(SCRIPT)});`,
      'if (typeof mod.diagnosticMatchesFile !== "function") process.exit(3);',
      'if (process.stdin.listenerCount("data") !== beforeData || process.stdin.listenerCount("end") !== beforeEnd) process.exit(4);'
    ].join('');
    const result = spawnSync(process.execPath, ['-e', script], {
      input: JSON.stringify({ tool_input: { file_path: path.join(os.tmpdir(), 'missing.ts') } }),
      encoding: 'utf8',
      timeout: 5000
    });
    assert.strictEqual(result.status, 0, `require() should not attach stdin listeners (exit ${result.status}): ${result.stderr}`);
    assert.strictEqual(result.stdout, '', 'require() must not echo stdin');
    assert.strictEqual(result.stderr, '', 'require() must not run the stdin handler');
  })
);

results.push(
  test('hook reports a tsc diagnostic only under the file it names', () => {
    // On Windows the hook runs npx.cmd through execFileSync without a shell,
    // and Node cannot launch a .cmd file that way, so a stubbed npx never
    // runs there. The matcher cases above cover Windows paths.
    if (process.platform === 'win32') return SKIPPED;

    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-post-edit-typecheck-'));
    try {
      const binDir = path.join(projectDir, 'bin');
      fs.mkdirSync(path.join(projectDir, 'src'));
      fs.mkdirSync(binDir);
      fs.writeFileSync(path.join(projectDir, 'tsconfig.json'), '{}');
      fs.writeFileSync(path.join(projectDir, 'index.ts'), 'export const ok = 1;\n');
      fs.writeFileSync(path.join(projectDir, 'src', 'index.ts'), 'export const bad: number = "x";\n');
      const diagnostic = "src/index.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.";
      const fakeTsc = path.join(binDir, 'fake-tsc.js');
      fs.writeFileSync(fakeTsc, `process.stdout.write(${JSON.stringify(`${diagnostic}\n`)});\nprocess.exitCode = 2;\n`);
      fs.writeFileSync(path.join(binDir, 'npx'), `#!/usr/bin/env node\nrequire(${JSON.stringify(fakeTsc)});\n`);
      fs.chmodSync(path.join(binDir, 'npx'), 0o755);

      const runHook = editedFile =>
        spawnSync(process.execPath, [SCRIPT], {
          input: JSON.stringify({ tool_input: { file_path: editedFile } }),
          env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}` },
          encoding: 'utf8',
          timeout: 10000
        });

      const rootResult = runHook(path.join(projectDir, 'index.ts'));
      assert.strictEqual(rootResult.status, 0, rootResult.stderr);
      assert.ok(!rootResult.stderr.includes('TypeScript errors'), `root index.ts must not get src/index.ts errors:\n${rootResult.stderr}`);

      const nestedResult = runHook(path.join(projectDir, 'src', 'index.ts'));
      assert.strictEqual(nestedResult.status, 0, nestedResult.stderr);
      assert.ok(nestedResult.stderr.includes(`TypeScript errors in index.ts:\n${diagnostic}`), nestedResult.stderr);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    return undefined;
  })
);

const passed = results.filter(result => result === 'passed').length;
const failed = results.filter(result => result === 'failed').length;
const skipped = results.filter(result => result === 'skipped').length;
console.log(`\nResults: Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}`);
process.exitCode = failed > 0 ? 1 : 0;
