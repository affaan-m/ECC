'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');

const {
  isUserCursorHooksJsonDestination,
  rewriteCursorUserHooksJson,
  rewriteCursorUserHooksJsonIfNeeded,
} = require('../../scripts/lib/install/cursor-hooks-json');

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

let passed = 0;
let failed = 0;

console.log('\ncursor user hooks.json rewrite tests');
console.log('─'.repeat(50));

if (test('rewrites project-style commands to user-style', () => {
  const input = JSON.stringify({
    hooks: {
      sessionStart: [{ command: 'node .cursor/hooks/session-start.js' }],
    },
  }, null, 2);
  const out = rewriteCursorUserHooksJson(input);
  assert.ok(out.includes('node ./hooks/session-start.js'));
  assert.ok(!out.includes('node .cursor/hooks/'));
})) passed++; else failed++;

if (test('only rewrites when destination is ~/.cursor/hooks.json', () => {
  const home = '/tmp/ecc-home-test';
  const content = 'node .cursor/hooks/session-start.js';
  const projectDest = path.join(home, 'Workspace', 'app', '.cursor', 'hooks.json');
  const userDest = path.join(home, '.cursor', 'hooks.json');

  assert.strictEqual(
    rewriteCursorUserHooksJsonIfNeeded({ destinationPath: projectDest }, content, home),
    content
  );
  assert.strictEqual(
    rewriteCursorUserHooksJsonIfNeeded({ destinationPath: userDest }, content, home),
    'node ./hooks/session-start.js'
  );
  assert.strictEqual(isUserCursorHooksJsonDestination(userDest, home), true);
  assert.strictEqual(isUserCursorHooksJsonDestination(projectDest, home), false);
})) passed++; else failed++;

if (test('detects real homedir destination', () => {
  const dest = path.join(os.homedir(), '.cursor', 'hooks.json');
  assert.strictEqual(isUserCursorHooksJsonDestination(dest), true);
})) passed++; else failed++;

console.log('─'.repeat(50));
console.log(`passed=${passed} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
