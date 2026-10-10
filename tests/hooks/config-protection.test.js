/**
 * Tests for scripts/hooks/config-protection.js via run-with-flags.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');

const SKIPPED = Symbol('skipped');

function describeError(error) {
  try {
    return String(error && error.message ? error.message : error);
  } catch {
    return 'Unprintable thrown value';
  }
}

function withOwnedDirectory(directory, action) {
  let value;
  let failed = false;
  let primary;
  try {
    value = action(directory);
  } catch (error) {
    failed = true;
    primary = error;
  }
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch (error) {
    if (!failed) {
      failed = true;
      primary = error;
    } else {
      console.error(`    Cleanup error: ${describeError(error)}`);
    }
  }
  if (failed) throw primary;
  return value;
}

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
    console.log(`    Error: ${describeError(error)}`);
    return 'failed';
  }
}

function runHook(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync(process.execPath, [runner, 'pre:config-protection', 'scripts/hooks/config-protection.js', 'standard,strict'], {
    input: rawInput,
    encoding: 'utf8',
    env: {
      ...process.env,
      ECC_HOOK_PROFILE: 'standard',
      ...env
    },
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runCustomHook(pluginRoot, hookId, relScriptPath, input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync(process.execPath, [runner, hookId, relScriptPath, 'standard,strict'], {
    input: rawInput,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginRoot,
      ECC_HOOK_PROFILE: 'standard',
      ...env
    },
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runTests() {
  console.log('\n=== Testing config-protection ===\n');

  const results = [];

  results.push(
    test('blocks protected config file edits through run-with-flags', () => {
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-')), tmpDir => {
        const absPath = path.join(tmpDir, '.eslintrc.js');
        fs.writeFileSync(absPath, 'module.exports = {};');

        const input = {
          tool_name: 'Write',
          tool_input: {
            file_path: absPath,
            content: 'module.exports = {};'
          }
        };

        const result = runHook(input);
        assert.strictEqual(result.code, 2, 'Expected protected config edit to be blocked');
        assert.strictEqual(result.stdout, '', 'Blocked hook should not echo raw input');
        assert.ok(result.stderr.includes('BLOCKED: Modifying .eslintrc.js is not allowed.'), `Expected block message, got: ${result.stderr}`);
      });
    })
  );

  results.push(
    test('passes through safe file edits unchanged', () => {
      const input = {
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/index.js',
          content: 'console.log("ok");'
        }
      };

      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'Expected safe file edit to pass');
      assert.strictEqual(result.stdout, '', 'Allowed edits should not echo raw hook input');
      assert.strictEqual(result.stderr, '', 'Expected no stderr for safe edits');
    })
  );

  results.push(
    test('blocks truncated protected config payloads instead of failing open', () => {
      const rawInput = JSON.stringify({
        tool_name: 'Write',
        tool_input: {
          file_path: '.eslintrc.js',
          content: 'x'.repeat(1024 * 1024 + 2048)
        }
      });

      const result = runHook(rawInput);
      assert.strictEqual(result.code, 2, 'Expected truncated protected payload to be blocked');
      assert.strictEqual(result.stdout, '', 'Blocked truncated payload should not echo raw input');
      assert.ok(result.stderr.includes('Hook input exceeded 1048576 bytes'), `Expected size warning, got: ${result.stderr}`);
      assert.ok(result.stderr.includes('truncated payload'), `Expected truncated payload warning, got: ${result.stderr}`);
    })
  );

  results.push(
    test('allows first-time creation of a protected config file', () => {
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-')), tmpDir => {
        const absPath = path.join(tmpDir, 'eslint.config.mjs');
        const input = {
          tool_name: 'Write',
          tool_input: {
            file_path: absPath,
            content: 'export default [];'
          }
        };

        const result = runHook(input);
        assert.strictEqual(result.code, 0, `Expected exit 0 for first-time creation, got ${result.code}; stderr: ${result.stderr}`);
        assert.strictEqual(result.stdout, '', 'Allowed creation should not echo raw hook input');
        assert.strictEqual(result.stderr, '', `Expected no stderr for first-time creation, got: ${result.stderr}`);
      });
    })
  );

  results.push(
    test('allows first-time creation when the parent directory does not exist yet', () => {
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-')), tmpDir => {
        // Path under a non-existent subdirectory — statSync returns ENOENT
        // on the final segment, which should be treated as "does not exist"
        // and allow the write. (Agent or CLI is expected to create parents
        // during the Write itself; this hook does not need to.)
        const absPath = path.join(tmpDir, 'no-such-parent', '.prettierrc');
        const input = {
          tool_name: 'Write',
          tool_input: {
            file_path: absPath,
            content: '{}'
          }
        };

        const result = runHook(input);
        assert.strictEqual(result.code, 0, `Expected exit 0 for ENOENT path, got ${result.code}; stderr: ${result.stderr}`);
        assert.strictEqual(result.stdout, '', 'Allowed missing paths should not echo raw hook input');
      });
    })
  );

  results.push(
    test('blocks protected paths that exist as a dangling symlink', () => {
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-')), tmpDir => {
        const missingTarget = path.join(tmpDir, 'nowhere.js');
        const linkPath = path.join(tmpDir, '.eslintrc.js');
        try {
          fs.symlinkSync(missingTarget, linkPath);
        } catch (err) {
          // Windows without Developer Mode or certain sandboxes disallow
          // symlinks. Skip cleanly rather than fail the suite.
          if (err.code === 'EPERM' || err.code === 'EACCES') {
            console.log('    (skipped: symlink creation not permitted here)');
            return SKIPPED;
          }
          throw err;
        }

        const input = {
          tool_name: 'Write',
          tool_input: {
            file_path: linkPath,
            content: 'module.exports = {};'
          }
        };

        const result = runHook(input);
        assert.strictEqual(result.code, 2, `Expected exit 2 for dangling symlink, got ${result.code}; stderr: ${result.stderr}`);
        assert.strictEqual(result.stdout, '', 'Blocked hook should not echo raw input');
        assert.ok(result.stderr.includes('BLOCKED: Modifying .eslintrc.js is not allowed.'), `Expected block message, got: ${result.stderr}`);
      });
    })
  );

  results.push(
    test('blocks case-variant writes that resolve to an existing protected config', () => {
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-')), tmpDir => {
        const realPath = path.join(tmpDir, '.eslintrc.js');
        const variantPath = path.join(tmpDir, '.ESLINTRC.JS');
        fs.writeFileSync(realPath, 'module.exports = { rules: { "no-explicit-any": "error" } };');

        // Only meaningful on a case-insensitive filesystem (macOS APFS/HFS+,
        // Windows NTFS), where the uppercase path is the SAME inode. On a
        // case-sensitive filesystem the variant is a genuinely different file
        // and the write is harmless, so skip rather than assert.
        let sameFile = false;
        try {
          sameFile = fs.lstatSync(variantPath).ino === fs.lstatSync(realPath).ino;
        } catch {
          sameFile = false;
        }
        if (!sameFile) {
          console.log('    (skipped: case-sensitive filesystem)');
          return SKIPPED;
        }

        const result = runHook({
          tool_name: 'Write',
          tool_input: {
            file_path: variantPath,
            content: 'module.exports = { rules: {} }; // WEAKENED'
          }
        });

        assert.strictEqual(result.code, 2, `Case-variant write must be blocked: it overwrites ${path.basename(realPath)} on this filesystem. Got ${result.code}; stderr: ${result.stderr}`);
        assert.strictEqual(result.stdout, '', 'Blocked hook should not echo raw input');
      });
    })
  );

  results.push(
    test('still blocks writes to an existing protected config file', () => {
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-')), tmpDir => {
        const absPath = path.join(tmpDir, '.eslintrc.js');
        fs.writeFileSync(absPath, 'module.exports = { rules: {} };');

        const input = {
          tool_name: 'Edit',
          tool_input: {
            file_path: absPath,
            content: 'module.exports = { rules: { "no-console": "off" } };'
          }
        };

        const result = runHook(input);
        assert.strictEqual(result.code, 2, 'Expected exit 2 when modifying an existing protected config');
        assert.strictEqual(result.stdout, '', 'Blocked hook should not echo raw input');
        assert.ok(result.stderr.includes('BLOCKED: Modifying .eslintrc.js is not allowed.'), `Expected block message, got: ${result.stderr}`);
      });
    })
  );

  results.push(
    test('blocks edits to an existing linter ignore file', () => {
      // Adding one path to .eslintignore silences a failing file without
      // touching the code or the config — the exact move this hook exists to
      // stop, and it was allowed. Measured before the fix: .eslintignore,
      // .prettierignore, .stylelintignore and .markdownlintignore all
      // returned exit 0.
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-')), tmpDir => {
        for (const name of [
          '.eslintignore',
          '.prettierignore',
          '.stylelintignore',
          '.markdownlintignore'
        ]) {
          const absPath = path.join(tmpDir, name);
          fs.writeFileSync(absPath, 'dist/\n');

          const result = runHook({
            tool_name: 'Edit',
            tool_input: { file_path: absPath, content: 'dist/\nsrc/failing-file.ts\n' }
          });

          assert.strictEqual(result.code, 2, `Expected exit 2 for ${name}, got ${result.code}`);
          assert.ok(
            result.stderr.includes(`BLOCKED: Modifying ${name} is not allowed.`),
            `Expected block message for ${name}, got: ${result.stderr}`
          );
        }
      });
    })
  );

  results.push(
    test('blocks the current stylelint and markdownlint config spellings', () => {
      // Only the legacy `.stylelintrc*` / `.markdownlint.json` names were
      // listed, so a project on the documented `stylelint.config.js` or
      // markdownlint-cli2 had no protection at all.
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-')), tmpDir => {
        for (const name of [
          'stylelint.config.js',
          'stylelint.config.cjs',
          'stylelint.config.mjs',
          'stylelint.config.ts',
          'stylelint.config.mts',
          'stylelint.config.cts',
          '.stylelintrc.yaml',
          '.stylelintrc.js',
          '.stylelintrc.cjs',
          '.stylelintrc.mjs',
          '.markdownlint.jsonc',
          '.markdownlint.yml',
          '.markdownlint.cjs',
          '.markdownlint.mjs',
          '.markdownlint-cli2.jsonc',
          '.markdownlint-cli2.yaml',
          '.markdownlint-cli2.cjs',
          '.markdownlint-cli2.mjs',
          '.ESLINTIGNORE'
        ]) {
          const absPath = path.join(tmpDir, name);
          fs.writeFileSync(absPath, '{}');

          const result = runHook({
            tool_name: 'Edit',
            tool_input: { file_path: absPath, content: '{"rules": {}}' }
          });

          assert.strictEqual(result.code, 2, `Expected exit 2 for ${name}, got ${result.code}`);
        }
      });
    })
  );

  results.push(
    test('a first-time ignore file and a lookalike name are still allowed', () => {
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-')), tmpDir => {
        // Scaffolding a brand-new ignore file is the same legitimate bootstrap
        // path the hook already allows for configs.
        const fresh = runHook({
          tool_name: 'Write',
          tool_input: { file_path: path.join(tmpDir, '.prettierignore'), content: 'dist/\n' }
        });
        assert.strictEqual(fresh.code, 0, `Expected exit 0 for a new ignore file, got ${fresh.code}`);

        // A file that merely looks like one must not be swept up.
        const lookalike = path.join(tmpDir, '.eslintignore.bak');
        fs.writeFileSync(lookalike, 'dist/\n');
        const result = runHook({
          tool_name: 'Edit',
          tool_input: { file_path: lookalike, content: 'dist/\nsrc/\n' }
        });
        assert.strictEqual(result.code, 0, `Expected exit 0 for ${path.basename(lookalike)}`);
      });
    })
  );

  results.push(
    test('legacy hooks do not echo raw input when they fail without stdout', () => {
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-legacy-')), pluginRoot => {
        const scriptDir = path.join(pluginRoot, 'scripts', 'hooks');
        const scriptPath = path.join(scriptDir, 'legacy-block.js');
        fs.mkdirSync(scriptDir, { recursive: true });
        fs.writeFileSync(scriptPath, '#!/usr/bin/env node\nprocess.stderr.write("blocked by legacy hook\\n");\nprocess.exit(2);\n');

        const rawInput = JSON.stringify({
          tool_name: 'Write',
          tool_input: {
            file_path: '.eslintrc.js',
            content: 'module.exports = {};'
          }
        });

        const result = runCustomHook(pluginRoot, 'pre:legacy-block', 'scripts/hooks/legacy-block.js', rawInput);
        assert.strictEqual(result.code, 2, 'Expected failing legacy hook exit code to propagate');
        assert.strictEqual(result.stdout, '', 'Expected failing legacy hook to avoid raw passthrough');
        assert.ok(result.stderr.includes('blocked by legacy hook'), `Expected legacy hook stderr, got: ${result.stderr}`);
      });
    })
  );

  results.push(
    test('blocks shared/base flat configs, not just the canonical entry point', () => {
      // Monorepos split flat config: a shared `eslint.config.base.mjs` holding
      // the ignore list and rule severities, imported by per-workspace
      // `eslint.config.mjs` files. Matching basenames alone protected the
      // leaves and left the trunk -- the file that carries the rules -- editable.
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-base-')), tmpDir => {
        const names = [
          'eslint.config.base.mjs', 'prettier.config.shared.cjs', '.eslintrc.base.json', 'ESLint.Config.Base.MJS',
          'stylelint.config.local.ts', 'commitlint.config.shared.cts', 'oxlint.config.base.mts',
          '.prettierrc.shared.yml', '.stylelintrc.team.toml',
          '.markdownlintrc.team.jsonc'
        ];
        for (const name of names) {
          const absPath = path.join(tmpDir, name);
          fs.writeFileSync(absPath, '{}');

          const result = runHook({ tool_name: 'Edit', tool_input: { file_path: absPath } });

          assert.strictEqual(result.code, 2, 'Expected ' + name + ' to be blocked');
          assert.ok(
            result.stderr.includes('BLOCKED: Modifying ' + name + ' is not allowed.'),
            'Expected block message for ' + name + ', got: ' + result.stderr
          );
        }
      });
    })
  );

  results.push(
    test('does not block build or test tooling configs', () => {
      // Pins the boundary: this hook guards LINTER configs. A future widening
      // of the patterns must not quietly start blocking ordinary work.
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-allow-')), tmpDir => {
        const names = [
          'vite.config.ts', 'vitest.config.ts', 'jest.config.js', 'playwright.config.ts', 'tsconfig.json',
          'pyproject.toml', 'package.json', '.eslintignore.bak', 'not-eslint.config.base.mjs',
          'eslint.config..mjs', 'eslint.config.base.mjs.bak'
        ];
        for (const name of names) {
          const absPath = path.join(tmpDir, name);
          fs.writeFileSync(absPath, '{}');

          const result = runHook({ tool_name: 'Edit', tool_input: { file_path: absPath } });

          assert.strictEqual(result.code, 0, 'Expected ' + name + ' to be allowed, stderr: ' + result.stderr);
        }

        const fresh = runHook({
          tool_name: 'Write',
          tool_input: { file_path: path.join(tmpDir, 'eslint.config.new.mjs'), content: 'export default [];' }
        });
        assert.strictEqual(fresh.code, 0, 'Expected first-time qualified config creation to be allowed');
        assert.strictEqual(fresh.stdout, '', 'Allowed qualified creation should not echo raw hook input');
      });
    })
  );

  results.push(
    test('Biome filenames protect discovered configs without blocking ordinary result files', () => {
      return withOwnedDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-biome-')), tmpDir => {
        // Arbitrary --config-path/extends targets need reference context; their
        // basename alone does not prove that a file is Biome configuration.
        const cases = [
          ['biome.results.json', 0], ['biome.report.jsonc', 0],
          ['biome.json', 2], ['biome.jsonc', 2], ['.biome.json', 2], ['.biome.jsonc', 2],
          ['BIOME.JSON', 2], ['.BIOME.JSONC', 2],
          ['biome.shared.jsonc', 0],
          ['BIOME.Team.Base.JSON', 0], ['biome.config.shared.js', 0], ['biome.json.bak', 0],
        ];
        for (const [name, expected] of cases) {
          const absPath = path.join(tmpDir, name);
          const input = { tool_name: 'Write', tool_input: { file_path: absPath, content: '{}' } };
          // Start each spelling independently on case-insensitive filesystems.
          fs.rmSync(absPath, { force: true });
          assert.strictEqual(runHook(input).code, 0, 'First creation should be allowed: ' + name);
          fs.writeFileSync(absPath, '{}');
          const result = runHook(input);
          assert.strictEqual(result.code, expected, 'Unexpected filename classification: ' + name);
          assert.strictEqual(result.stdout, '', 'No raw input should be echoed: ' + name);
          assert.strictEqual(fs.readFileSync(absPath, 'utf8'), '{}', 'Hook must not modify the fixture');
        }
      });
    })
  );

  const passed = results.filter(result => result === 'passed').length;
  const failed = results.filter(result => result === 'failed').length;
  const skipped = results.filter(result => result === 'skipped').length;
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

runTests();
