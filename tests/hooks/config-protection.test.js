/**
 * Tests for scripts/hooks/config-protection.js via run-with-flags.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runHook(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [runner, 'pre:config-protection', 'scripts/hooks/config-protection.js', 'standard,strict'], {
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
  const result = spawnSync('node', [runner, hookId, relScriptPath, 'standard,strict'], {
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

  let passed = 0;
  let failed = 0;

  if (
    test('blocks protected config file edits through run-with-flags', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-'));
      try {
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
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('passes through safe file edits unchanged', () => {
      const input = {
        tool_name: 'Write',
        tool_input: {
          file_path: 'src/index.js',
          content: 'console.log("ok");'
        }
      };

      const rawInput = JSON.stringify(input);
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'Expected safe file edit to pass');
      assert.strictEqual(result.stdout, rawInput, 'Expected exact raw JSON passthrough');
      assert.strictEqual(result.stderr, '', 'Expected no stderr for safe edits');
    })
  )
    passed++;
  else failed++;

  if (
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
  )
    passed++;
  else failed++;

  if (
    test('allows first-time creation of a protected config file', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-'));
      try {
        const absPath = path.join(tmpDir, 'eslint.config.mjs');
        const input = {
          tool_name: 'Write',
          tool_input: {
            file_path: absPath,
            content: 'export default [];'
          }
        };

        const rawInput = JSON.stringify(input);
        const result = runHook(input);
        assert.strictEqual(result.code, 0, `Expected exit 0 for first-time creation, got ${result.code}; stderr: ${result.stderr}`);
        assert.strictEqual(result.stdout, rawInput, 'Expected raw passthrough when creation is allowed');
        assert.strictEqual(result.stderr, '', `Expected no stderr for first-time creation, got: ${result.stderr}`);
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('allows first-time creation when the parent directory does not exist yet', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-'));
      try {
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

        const rawInput = JSON.stringify(input);
        const result = runHook(input);
        assert.strictEqual(result.code, 0, `Expected exit 0 for ENOENT path, got ${result.code}; stderr: ${result.stderr}`);
        assert.strictEqual(result.stdout, rawInput, 'Expected raw passthrough when path does not exist');
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('blocks protected paths that exist as a dangling symlink', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-'));
      try {
        const missingTarget = path.join(tmpDir, 'nowhere.js');
        const linkPath = path.join(tmpDir, '.eslintrc.js');
        try {
          fs.symlinkSync(missingTarget, linkPath);
        } catch (err) {
          // Windows without Developer Mode or certain sandboxes disallow
          // symlinks. Skip cleanly rather than fail the suite.
          if (err.code === 'EPERM' || err.code === 'EACCES') {
            console.log('    (skipped: symlink creation not permitted here)');
            return;
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
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('blocks case-variant writes that resolve to an existing protected config', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-'));
      try {
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
          return;
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
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('still blocks writes to an existing protected config file', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-'));
      try {
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
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('blocks edits to an existing linter ignore file', () => {
      // Adding one path to .eslintignore silences a failing file without
      // touching the code or the config — the exact move this hook exists to
      // stop, and it was allowed. Measured before the fix: .eslintignore,
      // .prettierignore, .stylelintignore and .markdownlintignore all
      // returned exit 0.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-'));
      try {
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
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('blocks the current stylelint and markdownlint config spellings', () => {
      // Only the legacy `.stylelintrc*` / `.markdownlint.json` names were
      // listed, so a project on the documented `stylelint.config.js` or
      // markdownlint-cli2 had no protection at all.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-'));
      try {
        for (const name of [
          'stylelint.config.js',
          'stylelint.config.mjs',
          '.stylelintrc.js',
          '.markdownlint.jsonc',
          '.markdownlint-cli2.jsonc'
        ]) {
          const absPath = path.join(tmpDir, name);
          fs.writeFileSync(absPath, '{}');

          const result = runHook({
            tool_name: 'Edit',
            tool_input: { file_path: absPath, content: '{"rules": {}}' }
          });

          assert.strictEqual(result.code, 2, `Expected exit 2 for ${name}, got ${result.code}`);
        }
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('a first-time ignore file and a lookalike name are still allowed', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-config-protect-'));
      try {
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
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('legacy hooks do not echo raw input when they fail without stdout', () => {
      const pluginRoot = path.join(__dirname, '..', `tmp-runner-plugin-${Date.now()}`);
      const scriptDir = path.join(pluginRoot, 'scripts', 'hooks');
      const scriptPath = path.join(scriptDir, 'legacy-block.js');

      try {
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
      } finally {
        try {
          fs.rmSync(pluginRoot, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    })
  )
    passed++;
  else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
