'use strict';
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { run } = require('../../scripts/hooks/copilot-native-telemetry');
assert.deepEqual(run('agentStop', 'not JSON', {}), {});
assert.deepEqual(run('agentStop', 'not JSON', { ECC_COPILOT_TELEMETRY: '1', ECC_HOOK_PROFILE: 'minimal' }), {});
assert.throws(() => run('unknown', '{}'));
assert.throws(() => run('agentStop', ' '.repeat(1024 * 1024 + 1), { ECC_COPILOT_TELEMETRY: '1' }));
const entry = path.resolve(__dirname, '../../scripts/hooks/copilot-native-telemetry.js');
for (const input of ['{invalid', '{}']) {
  const result = spawnSync(process.execPath, [entry, 'agentStop'], { input, encoding: 'utf8',
    env: { ...process.env, ECC_COPILOT_TELEMETRY: '1', ECC_HOOK_PROFILE: 'standard', ECC_HOOKS_ENABLED: 'true' }, timeout: 10000 });
  assert.ifError(result.error); assert.equal(result.status, 0); assert.deepEqual(JSON.parse(result.stdout), {});
  assert.match(result.stderr, /unavailable/);
}
console.log('Passed: 3, Failed: 0');
