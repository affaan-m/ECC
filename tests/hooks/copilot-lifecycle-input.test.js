'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('Copilot lifecycle rejects oversized input before the writer closes stdin', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-lifecycle-input-'));
  const config = path.join(cwd, 'copilot');
  const runtime = path.resolve(__dirname, '../../scripts/hooks/copilot-lifecycle.js');
  const child = spawn(process.execPath, [runtime, 'sessionStart'], {
    cwd,
    env: {
      ...process.env,
      COPILOT_HOME: config,
      ECC_HOOKS_ENABLED: 'true',
      ECC_HOOK_PROFILE: 'standard',
      ECC_DISABLED_HOOKS: '',
    },
  });
  const closed = once(child, 'close');
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  // The hook may close the read end while the pipe is still open here.
  child.stdin.on('error', () => {});
  child.stdin.write(Buffer.alloc(1024 * 1024 + 1, 32));
  const deadline = setTimeout(() => child.kill(), 5000);

  try {
    const [code, signal] = await closed;
    assert.equal(code, 1, `The hook must exit before stdin closes (signal: ${signal})`);
    assert.deepEqual(JSON.parse(stdout), {});
    assert.equal(fs.existsSync(config), false);
  } finally {
    clearTimeout(deadline);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
