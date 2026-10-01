'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const TOML = require('@iarna/toml');

const script = path.resolve(__dirname, '../../scripts/codex/merge-mcp-config.js');
let passed = 0;
let failed = 0;

for (const [indent, newline] of [['  ', '\n'], ['\t', '\r\n']]) {
  const multiline = (newline === '\n' ? '"' : "'").repeat(3);
  for (const mode of ['refresh', 'disable', 'repair', 'dry-run']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-indent-'));
    const config = path.join(dir, 'config.toml');
    const server = mode === 'repair' ? 'exa' : 'chrome-devtools';
    const managed = mode === 'repair'
      ? ['url = "https://mcp.exa.ai/mcp"']
      : ['command = "custom-launcher"', 'args = ["custom-package"]'];
    const userBlock = [
      `${indent}[mcp_servers.user-server] # keep user config`,
      'command = "user-launcher"',
      'args = ["keep-me"]',
      `${indent}[mcp_servers.user-server.env]`,
      `NOTE = ${multiline}`,
      `${indent}[mcp_servers.${server}]`,
      'This is user data, not a section to remove.',
      multiline,
      '',
    ].join(newline);
    const original = [
      'model = "user-model"',
      `${indent}[mcp_servers.${server}] # managed config`,
      ...managed,
      `${indent}[mcp_servers.${server}.env]`,
      `OLD_ENV = ${multiline}`,
      `${indent}[example text]`,
      `${indent}[mcp_servers.user-server]`,
      multiline,
      '',
    ].join(newline) + userBlock;
    try {
      fs.writeFileSync(config, original);
      const before = TOML.parse(original);
      const args = mode === 'refresh' || mode === 'dry-run' ? ['--update-mcp'] : [];
      if (mode === 'dry-run') args.push('--dry-run');
      const result = spawnSync(process.execPath, [script, config, ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          CLAUDE_PACKAGE_MANAGER: 'npm',
          CLAUDE_CODE_PACKAGE_MANAGER: 'npm',
          ECC_DISABLED_MCPS: mode === 'disable' || mode === 'repair' ? 'chrome-devtools' : '',
        },
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const output = fs.readFileSync(config, 'utf8');
      const after = TOML.parse(output);
      assert.deepStrictEqual(after.mcp_servers['user-server'], before.mcp_servers['user-server']);
      assert.ok(output.includes(userBlock), 'unrelated indented table bytes are preserved');
      assert.strictEqual(after.model, before.model);
      if (mode === 'dry-run') {
        assert.strictEqual(output, original);
        assert.match(result.stdout, /Dry run — would remove:/);
        assert.match(result.stdout, /\[remove\] mcp_servers\.chrome-devtools/);
        assert.match(result.stdout, /Dry run — would append:/);
      } else if (mode === 'refresh') {
        assert.strictEqual(after.mcp_servers[server].command, 'npx');
        assert.deepStrictEqual(after.mcp_servers[server].args, ['chrome-devtools-mcp@1.10.1']);
        assert.strictEqual(after.mcp_servers[server].env, undefined);
      } else {
        assert.strictEqual(after.mcp_servers?.[server], undefined);
      }
      passed += 1;
      console.log(`PASS ${mode} with ${newline === '\n' ? 'spaces/LF' : 'tabs/CRLF'} headers`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${mode}: ${error.message}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
