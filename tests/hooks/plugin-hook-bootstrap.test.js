/**
 * Direct subprocess tests for scripts/hooks/plugin-hook-bootstrap.js.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'plugin-hook-bootstrap.js');
const { normalizePluginRootForPlatform } = require(SCRIPT);

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-hook-bootstrap-'));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function run(args = [], options = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    input: options.input || '',
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: options.root || '',
      ECC_PLUGIN_ROOT: options.eccRoot || '',
      ...(options.env || {}),
    },
    cwd: options.cwd || process.cwd(),
    timeout: 10000,
  });
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing plugin-hook-bootstrap.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('passes stdin through when required bootstrap inputs are missing', () => {
    const result = run([], { input: '{"ok":true}' });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '{"ok":true}');
    assert.strictEqual(result.stderr, '');
  })) passed++; else failed++;

  if (test('normalizes Windows Git Bash POSIX drive roots', () => {
    assert.strictEqual(
      normalizePluginRootForPlatform('/c/Users/x/.claude/plugins/ecc', 'win32'),
      'C:/Users/x/.claude/plugins/ecc'
    );
    assert.strictEqual(
      normalizePluginRootForPlatform('/z/Work/ECC/scripts/hooks/check-console-log.js', 'win32'),
      'Z:/Work/ECC/scripts/hooks/check-console-log.js'
    );
  })) passed++; else failed++;

  if (test('leaves already-Windows roots unchanged', () => {
    assert.strictEqual(
      normalizePluginRootForPlatform('C:/Users/x/.claude/plugins/ecc', 'win32'),
      'C:/Users/x/.claude/plugins/ecc'
    );
    assert.strictEqual(
      normalizePluginRootForPlatform('D:\\Users\\x\\.claude\\plugins\\ecc', 'win32'),
      'D:\\Users\\x\\.claude\\plugins\\ecc'
    );
  })) passed++; else failed++;

  if (test('leaves POSIX-looking roots unchanged off Windows', () => {
    assert.strictEqual(
      normalizePluginRootForPlatform('/c/Users/x/.claude/plugins/ecc', 'darwin'),
      '/c/Users/x/.claude/plugins/ecc'
    );
    assert.strictEqual(
      normalizePluginRootForPlatform('/c/Users/x/.claude/plugins/ecc', 'linux'),
      '/c/Users/x/.claude/plugins/ecc'
    );
  })) passed++; else failed++;

  if (test('does not mangle UNC or non-drive absolute paths on Windows', () => {
    assert.strictEqual(
      normalizePluginRootForPlatform('\\\\server\\share\\ecc', 'win32'),
      '\\\\server\\share\\ecc'
    );
    assert.strictEqual(
      normalizePluginRootForPlatform('/workspace/ecc', 'win32'),
      '/workspace/ecc'
    );
  })) passed++; else failed++;

  if (test('node mode runs target script with plugin root environment', () => {
    const root = createTempDir();
    try {
      writeFile(root, path.join('scripts', 'hook.js'), `
const fs = require('fs');
const raw = fs.readFileSync(0, 'utf8');
process.stdout.write(JSON.stringify({
  raw,
  args: process.argv.slice(2),
  claudeRoot: process.env.CLAUDE_PLUGIN_ROOT,
  eccRoot: process.env.ECC_PLUGIN_ROOT,
}));
`);

      const result = run(['node', path.join('scripts', 'hook.js'), 'one', 'two'], {
        root,
        input: 'payload',
      });
      const parsed = JSON.parse(result.stdout);

      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(parsed.raw, 'payload');
      assert.deepStrictEqual(parsed.args, ['one', 'two']);
      assert.strictEqual(parsed.claudeRoot, root);
      assert.strictEqual(parsed.eccRoot, root);
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('node mode passes original stdin when child exits cleanly without stdout', () => {
    const root = createTempDir();
    try {
      writeFile(root, path.join('scripts', 'silent.js'), 'process.exit(0);\n');

      const result = run(['node', path.join('scripts', 'silent.js')], {
        root,
        input: 'raw-input',
      });

      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stdout, 'raw-input');
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('node mode forwards child stdout and exit status for blocking hooks', () => {
    const root = createTempDir();
    try {
      writeFile(root, path.join('scripts', 'block.js'), `
process.stdout.write('blocked output');
process.stderr.write('blocked stderr\\n');
process.exit(2);
`);

      const result = run(['node', path.join('scripts', 'block.js')], {
        root,
        input: 'raw-input',
      });

      assert.strictEqual(result.status, 2);
      assert.strictEqual(result.stdout, 'blocked output');
      assert.strictEqual(result.stderr, 'blocked stderr\n');
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('node mode leaves stdout empty for nonzero child without stdout', () => {
    const root = createTempDir();
    try {
      writeFile(root, path.join('scripts', 'fail.js'), `
process.stderr.write('failure stderr\\n');
process.exit(7);
`);

      const result = run(['node', path.join('scripts', 'fail.js')], {
        root,
        input: 'raw-input',
      });

      assert.strictEqual(result.status, 7);
      assert.strictEqual(result.stdout, '');
      assert.strictEqual(result.stderr, 'failure stderr\n');
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('shell mode runs target script through an available shell', () => {
    const root = createTempDir();
    try {
      writeFile(root, path.join('scripts', 'hook.sh'), [
        'input=$(cat)',
        'printf "shell:%s:%s" "$1" "$input"',
        '',
      ].join('\n'));

      const result = run(['shell', path.join('scripts', 'hook.sh'), 'arg'], {
        root,
        input: 'payload',
        env: fs.existsSync('/bin/sh') ? { BASH: '/bin/sh' } : {},
      });

      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, 'shell:arg:payload');
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('shell mode fails open when no shell runtime is available', () => {
    const root = createTempDir();
    try {
      writeFile(root, path.join('scripts', 'hook.sh'), 'printf unreachable\n');

      const result = run(['shell', path.join('scripts', 'hook.sh')], {
        root,
        input: 'raw-input',
        env: { PATH: '', BASH: '' },
      });

      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stdout, 'raw-input');
      assert.ok(result.stderr.includes('shell runtime unavailable'));
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('rejects target paths that escape the plugin root', () => {
    const root = createTempDir();
    try {
      const result = run(['node', path.join('..', 'outside.js')], {
        root,
        input: 'raw-input',
      });

      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stdout, 'raw-input');
      assert.ok(result.stderr.includes('Path traversal rejected'));
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('unknown mode fails open with stderr warning', () => {
    const root = createTempDir();
    try {
      const result = run(['python', 'hook.py'], {
        root,
        input: 'raw-input',
      });

      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stdout, 'raw-input');
      assert.ok(result.stderr.includes('unknown bootstrap mode: python'));
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  if (test('missing node target returns child failure diagnostics', () => {
    const root = createTempDir();
    try {
      const result = run(['node', path.join('scripts', 'missing.js')], {
        root,
        input: 'raw-input',
      });

      assert.strictEqual(result.status, 1);
      assert.strictEqual(result.stdout, '');
      assert.ok(result.stderr.includes('Cannot find module'));
    } finally {
      cleanup(root);
    }
  })) passed++; else failed++;

  // Windows-only: PowerShell preference and .sh fallback behaviour.
  if (process.platform === 'win32') {
    if (test('shell mode selects PowerShell when BASH is unset on Windows', () => {
      // Skip if no PowerShell is available.
      const psProbe = spawnSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'ignore', timeout: 5000 });
      const ps = psProbe.error
        ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'ignore', timeout: 5000 }).error
          ? null : 'powershell.exe'
        : 'pwsh.exe';
      if (!ps) {
        console.log('    SKIP: no PowerShell found');
        return;
      }

      const root = createTempDir();
      try {
        // UTF8 encoding set explicitly — PowerShell 5.1 defaults to UTF-16LE.
        writeFile(root, path.join('scripts', 'hook.ps1'), [
          '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
          '$OutputEncoding = [System.Text.Encoding]::UTF8',
          '$input_data = [Console]::In.ReadToEnd()',
          'Write-Host -NoNewline ("ps1:" + $args[0] + ":" + $input_data)',
        ].join('\n'));

        const result = run(['shell', path.join('scripts', 'hook.ps1'), 'arg'], {
          root,
          input: 'payload',
          env: { BASH: '' },
        });

        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(result.stdout, 'ps1:arg:payload');
      } finally {
        cleanup(root);
      }
    })) passed++; else failed++;

    if (test('shell mode falls back to bash for .sh scripts when PowerShell is the resolved shell', () => {
      // Skip if no bash is available (headless CI without Git for Windows).
      const bashProbe = spawnSync('bash.exe', ['-c', ':'], { stdio: 'ignore', timeout: 5000 });
      if (bashProbe.error) {
        console.log('    SKIP: bash.exe not found');
        return;
      }

      const root = createTempDir();
      try {
        writeFile(root, path.join('scripts', 'hook.sh'), [
          'input=$(cat)',
          'printf "sh:%s:%s" "$1" "$input"',
          '',
        ].join('\n'));

        // Clear BASH so PowerShell is resolved first, but script is .sh.
        const result = run(['shell', path.join('scripts', 'hook.sh'), 'arg'], {
          root,
          input: 'payload',
          env: { BASH: '' },
        });

        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(result.stdout, 'sh:arg:payload');
      } finally {
        cleanup(root);
      }
    })) passed++; else failed++;

    if (test('shell mode emits skip warning for .sh script when no bash found on Windows', () => {
      const root = createTempDir();
      try {
        writeFile(root, path.join('scripts', 'hook.sh'), 'printf unreachable\n');

        // Keep PowerShell on PATH so it is resolved as the shell, then strip
        // bash candidates so the .sh fallback path hits the skip-warning branch.
        const result = run(['shell', path.join('scripts', 'hook.sh')], {
          root,
          input: 'raw-input',
          env: { BASH: '', PATH: process.env.SystemRoot
            ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0;${process.env.SystemRoot}\\System32`
            : '' },
        });

        assert.strictEqual(result.status, 0);
        assert.strictEqual(result.stdout, 'raw-input');
        assert.ok(
          result.stderr.includes('no bash binary found') ||
          result.stderr.includes('shell runtime unavailable'),
          `unexpected stderr: ${result.stderr}`
        );
      } finally {
        cleanup(root);
      }
    })) passed++; else failed++;
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
