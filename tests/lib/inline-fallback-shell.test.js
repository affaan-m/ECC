'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const env = { PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter), HOME: os.tmpdir() };
if (process.platform === 'win32' || spawnSync('bash', ['--version'], { env }).status !== 0) {
  console.log('SKIP helper-unavailable serialized command requires POSIX Bash');
} else {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-inline-fallback-'));
  let failed = 0;
  try {
    const standalone = path.join(folder, 'resolve-ecc-root.js');
    fs.copyFileSync(path.resolve(__dirname, '../../scripts/lib/resolve-ecc-root.js'), standalone);
    assert.ok(!fs.existsSync(path.join(folder, 'install-targets')), 'Helper must be absent');
    const expression = require(standalone).INLINE_RESOLVE;
    const command = 'node -e "const root=' + expression + ';process.stdout.write(String(root))"';
    const result = spawnSync('bash', ['-c', command], {
      cwd: folder, timeout: 10000, encoding: 'utf8',
      env: { ...env, HOME: folder, CLAUDE_PLUGIN_ROOT: folder },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, folder);
    console.log('PASS helper-unavailable expression survives Bash quoting and returns explicit root');
  } catch (error) {
    failed++; console.error(error.stack);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
  console.log('Passed: ' + (failed ? 0 : 1));
  console.log('Failed: ' + failed);
  process.exitCode = failed ? 1 : 0;
}
