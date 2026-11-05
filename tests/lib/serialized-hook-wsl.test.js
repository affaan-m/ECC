'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
if (process.platform === 'win32') {
  console.log('SKIP serialized WSL command requires POSIX Node and Bash; portable extracted resolver tests cover conversion');
} else {
const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../hooks/hooks.json'), 'utf8'));
const command = config.hooks.SessionStart.flatMap(entry => entry.hooks || [])
  .map(hook => hook.command).find(value => typeof value === 'string' && value.includes('CLAUDE_CONFIG_DIR') && value.endsWith('node scripts/hooks/session-start-bootstrap.js'));
assert.ok(command, 'Expected the shipped SessionStart bootstrap command');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-shell-wsl-'));
const preload = path.join(folder, 'preload.cjs');
fs.writeFileSync(preload, `
const Module = require('module');
const fs = require('fs');
const os = require('os');
const originalLoad = Module._load;
const simulatedFs = new Proxy(fs, { get(target, key) {
  if (key === 'readFileSync') return (file, ...args) => file === '/proc/version'
    ? 'Linux microsoft-standard-WSL2' : target.readFileSync(file, ...args);
  if (key === 'readdirSync') return (file, ...args) => {
    if (String(file).startsWith('/mnt/c')) {
      const error = new Error('Isolated fixture has no plugin cache'); error.code = 'ENOENT'; throw error;
    }
    return target.readdirSync(file, ...args);
  };
  return target[key];
}});
const simulatedOs = new Proxy(os, { get(target, key) {
  if (key === 'platform') return () => 'linux';
  if (key === 'homedir') return () => '/home/wsluser';
  return target[key];
}});
Module._load = function(request, parent, isMain) {
  if (request === 'fs') return simulatedFs;
  if (request === 'os') return simulatedOs;
  if (request.startsWith('/mnt/c') && request.endsWith('/scripts/lib/resolve-ecc-root')) {
    const error = new Error('Isolated fixture has no installed resolver'); error.code = 'MODULE_NOT_FOUND'; throw error;
  }
  // Observe the resolved bootstrap and forwarded arguments without running host hooks.
  if (request.endsWith('/scripts/hooks/plugin-hook-bootstrap.js')) {
    process.stdout.write(JSON.stringify({root: process.env.CLAUDE_PLUGIN_ROOT,
      bootstrap: request, args: process.argv.slice(2)}) + '\\n');
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};
`);
function execute(serializedCommand) {
  const result = spawnSync('bash', ['-c', serializedCommand], {
    cwd: folder, timeout: 10000, encoding: 'utf8',
    env: { PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter),
      NODE_OPTIONS: `--require=${JSON.stringify(preload)}`, HOME: folder, USERPROFILE: folder,
      CLAUDE_CONFIG_DIR: 'C:\\Users\\test\\.claude', CLAUDE_PLUGIN_ROOT: '', PLUGIN_ROOT: '' },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}
let failed = 0;
try {
  const expected = '/mnt/c/Users/test/.claude';
  const actual = execute(command);
  assert.strictEqual(actual.root, expected);
  assert.strictEqual(actual.bootstrap, expected + '/scripts/hooks/plugin-hook-bootstrap.js');
  assert.deepStrictEqual(actual.args, ['node', 'scripts/hooks/session-start-bootstrap.js']);
  console.log('PASS full JSON-decoded SessionStart hook resolves exact WSL path through Bash and forwards continuation');
  // Native Windows runs hooks as `bash.exe -c "<command>"` through the Windows command line;
  // that extra argv/MSYS layer collapses each `\\` pair to `\` before Bash sees it (#3746).
  const windowsCollapsed = command.replace(/\\\\/g, '\\');
  const collapsed = execute(windowsCollapsed);
  assert.strictEqual(collapsed.root, expected);
  console.log('PASS SessionStart hook still parses and resolves after Windows backslash collapsing');
  const mutation = command.replace(".join('/')", ".join('_')");
  assert.notStrictEqual(mutation, command, 'Mutation must modify the shipped replacement');
  const broken = execute(mutation);
  assert.notStrictEqual(broken.root, expected, 'Mutation must be detected by exact expected-path assertion');
  console.log('PASS exact path assertion detects a mutated slash replacement');
} catch (error) { failed++; console.error(error.stack); }
finally { fs.rmSync(folder, { recursive: true, force: true }); }
console.log('Passed: ' + (failed ? 0 : 3));
console.log('Failed: ' + failed);
process.exitCode = failed ? 1 : 0;

}
