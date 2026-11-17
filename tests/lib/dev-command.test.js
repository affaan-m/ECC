/**
 * Tests for scripts/lib/dev-command.js, the dev-server classifier shared by
 * pre-bash-dev-server-block.js and auto-tmux-dev.js.
 */

const assert = require('assert');
const { isDevServerCommand, isDevServerSegment } = require('../../scripts/lib/dev-command');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

console.log('\n=== Testing dev-command.js ===\n');

// Each row was compared with real npm 11 / Yarn 4 runs of a scratch project
// whose `dev` script writes a marker: blocked exactly when the dev script ran.
for (const [command, expected] of [
  ['npm run dev', true],
  ['npm run "dev"', true],
  ['npm run de"v"', true],
  ['npm -d run dev', true],
  ['npm -s run dev', true],
  ['npm --userconfig /dev/null run dev', true],
  ['npm --prefix app run dev', true],
  ['npm -w app run dev', true],
  ['npm run-script dev', true],
  ['npm run dev:ssr', true],
  ['npm run build dev', false],
  ['npm run run dev', false],
  ['npm run dev-setup', false],
  ['npm test -- --grep dev', false],
  ['npm run build -- dev', false],
  ['yarn dev', true],
  ['yarn "dev"', true],
  ['yarn --cwd app dev', true],
  ['yarn run build dev', false],
  ['yarn build dev', false],
  ['yarn test -- dev', false],
  ['yarn --cwd app run build', false]
]) {
  test(`${expected ? 'detects' : 'ignores'}: ${command}`, () => {
    assert.strictEqual(isDevServerCommand(command), expected);
  });
}

// Grammar-derived rows for managers not installed in the verification run.
for (const [command, expected] of [
  ['pnpm -d dev', true],
  ['pnpm -w dev', true],
  ['pnpm -C app dev', true],
  ['pnpm --filter dev run build', false],
  ['bun -d K:V dev', true],
  ['bun -c dev', true],
  ['bun -c bunfig.toml dev', true],
  ['bun -d dev:1 build', false]
]) {
  test(`${expected ? 'detects' : 'ignores'} by documented grammar: ${command}`, () => {
    assert.strictEqual(isDevServerCommand(command), expected);
  });
}

test('tmux pane launches are exempt, run-shell is not', () => {
  assert.strictEqual(isDevServerCommand('tmux new-session -d -s dev "npm run dev"'), false);
  assert.strictEqual(isDevServerCommand('tmux run-shell \'npm run "dev"\''), true);
});

test('quoted documentation of a dev command is not a dev server', () => {
  assert.strictEqual(isDevServerCommand('echo "npm run dev"'), false);
  assert.strictEqual(isDevServerCommand('npm run lint -- "npm run dev"'), false);
});

test('substitutions and subshells are scanned', () => {
  assert.strictEqual(isDevServerCommand('echo $(npm run dev)'), true);
  assert.strictEqual(isDevServerCommand('(pnpm dev)'), true);
});

test('isDevServerSegment reads one segment', () => {
  assert.strictEqual(isDevServerSegment('sudo -u me pnpm --dir app dev'), true);
  assert.strictEqual(isDevServerSegment('npx eslint .'), false);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
