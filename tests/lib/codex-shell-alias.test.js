/**
 * Tests for scripts/lib/codex-shell-alias.js
 *
 * Run with: node tests/lib/codex-shell-alias.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BEGIN_MARKER,
  END_MARKER,
  aliasBlock,
  stripBlock,
  resolveRcFiles,
  ensureCodexAliasDefault,
  removeCodexAlias,
  aliasStatus,
} = require('../../scripts/lib/codex-shell-alias');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed += 1;
  }
}

function withHome(fn) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-alias-'));
  try {
    fn(homeDir);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

console.log('\n=== Testing codex-shell-alias.js ===\n');

if (process.platform === 'win32') {
  console.log('  (skipped on Windows — shell alias management is POSIX-only)\n');
  process.exit(0);
}

console.log('aliasBlock:');
test('block is marker-delimited and gated on env + wrapper existence', () => {
  const block = aliasBlock('/opt/ecc/scripts/codex/ecc-codex');
  assert.ok(block.startsWith(BEGIN_MARKER), 'starts with begin marker');
  assert.ok(block.endsWith(END_MARKER), 'ends with end marker');
  assert.ok(block.includes('ECC_CODEX_ALIAS:-on'), 'gated on ECC_CODEX_ALIAS');
  assert.ok(block.includes('[ -f "/opt/ecc/scripts/codex/ecc-codex" ]'), 'gated on wrapper existence');
  assert.ok(block.includes(`alias codex='bash "/opt/ecc/scripts/codex/ecc-codex"'`), 'aliases codex');
});

test('block exports a UTF-8 locale only when one was detected', () => {
  const withLocale = aliasBlock('/w/ecc-codex', 'C.UTF-8');
  assert.ok(withLocale.includes('export LANG="C.UTF-8"'), 'exports detected locale');
  assert.ok(withLocale.includes('*[Uu][Tt][Ff]*'), 'skips when already UTF-8');
  assert.ok(!aliasBlock('/w/ecc-codex').includes('export LANG'), 'omitted when none detected');
});

test('detectUtf8Locale prefers portable locales and tolerates failure', () => {
  const { detectUtf8Locale } = require('../../scripts/lib/codex-shell-alias');
  const fake = out => () => ({ status: 0, stdout: out });
  assert.strictEqual(
    detectUtf8Locale({ spawnSync: fake('C\nen_US.UTF-8\nC.UTF-8\nfr_FR.UTF-8\n') }),
    'C.UTF-8'
  );
  assert.strictEqual(
    detectUtf8Locale({ spawnSync: fake('C\nPOSIX\nfr_FR.utf8\n') }),
    'fr_FR.utf8'
  );
  assert.strictEqual(detectUtf8Locale({ spawnSync: fake('C\nPOSIX\n') }), '');
  assert.strictEqual(detectUtf8Locale({ spawnSync: () => ({ status: 1 }) }), '');
});

console.log('\nstripBlock:');
test('removes the managed block and preserves other content', () => {
  const content = `export PATH=/x\n\n${aliasBlock('/w')}\nexport EDITOR=vi\n`;
  const stripped = stripBlock(content);
  assert.ok(!stripped.includes(BEGIN_MARKER), 'marker removed');
  assert.ok(stripped.includes('export PATH=/x'), 'head preserved');
  assert.ok(stripped.includes('export EDITOR=vi'), 'tail preserved');
});
test('content without a block is returned unchanged', () => {
  assert.strictEqual(stripBlock('export PATH=/x\n'), 'export PATH=/x\n');
});

console.log('\nresolveRcFiles:');
test('uses every existing rc file', () => {
  withHome(homeDir => {
    fs.writeFileSync(path.join(homeDir, '.zshrc'), '# z\n');
    fs.writeFileSync(path.join(homeDir, '.bashrc'), '# b\n');
    const files = resolveRcFiles({}, homeDir);
    assert.strictEqual(files.length, 2);
  });
});
test('always covers the login shell rc even when another rc exists', () => {
  withHome(homeDir => {
    fs.writeFileSync(path.join(homeDir, '.bashrc'), '# b\n');
    const files = resolveRcFiles({ SHELL: '/bin/zsh' }, homeDir);
    assert.ok(files.includes(path.join(homeDir, '.zshrc')), 'zsh login rc included');
    assert.ok(files.includes(path.join(homeDir, '.bashrc')), 'existing rc kept');
  });
});
test('falls back to the SHELL-matching rc when none exist', () => {
  withHome(homeDir => {
    const bash = resolveRcFiles({ SHELL: '/bin/bash' }, homeDir);
    assert.deepStrictEqual(bash, [path.join(homeDir, '.bashrc')]);
    const zsh = resolveRcFiles({ SHELL: '/bin/zsh' }, homeDir);
    assert.deepStrictEqual(zsh, [path.join(homeDir, '.zshrc')]);
  });
});

console.log('\nensureCodexAliasDefault:');
test('appends the block to an existing rc file', () => {
  withHome(homeDir => {
    const rcPath = path.join(homeDir, '.zshrc');
    fs.writeFileSync(rcPath, 'export PATH=/x\n');
    const result = ensureCodexAliasDefault({ env: {}, homeDir, wrapperPath: '/w/ecc-codex' });
    assert.strictEqual(result.action, 'configured');
    assert.strictEqual(result.files[0].action, 'configured');
    const content = fs.readFileSync(rcPath, 'utf8');
    assert.ok(content.startsWith('export PATH=/x\n'), 'original content kept');
    assert.ok(content.includes(BEGIN_MARKER), 'block appended');
  });
});
test('reinstall is idempotent — exactly one block', () => {
  withHome(homeDir => {
    const rcPath = path.join(homeDir, '.zshrc');
    fs.writeFileSync(rcPath, '# base\n');
    ensureCodexAliasDefault({ env: {}, homeDir, wrapperPath: '/old/ecc-codex' });
    const result = ensureCodexAliasDefault({ env: {}, homeDir, wrapperPath: '/new/ecc-codex' });
    assert.strictEqual(result.files[0].action, 'updated');
    const content = fs.readFileSync(rcPath, 'utf8');
    assert.strictEqual(content.split(BEGIN_MARKER).length, 2, 'single block');
    assert.ok(content.includes('/new/ecc-codex'), 'path refreshed');
    assert.ok(!content.includes('/old/ecc-codex'), 'stale path gone');
  });
});
test('creates the rc file when none exists', () => {
  withHome(homeDir => {
    const result = ensureCodexAliasDefault({
      env: { SHELL: '/bin/zsh' },
      homeDir,
      wrapperPath: '/w/ecc-codex',
    });
    assert.strictEqual(result.action, 'configured');
    assert.ok(fs.existsSync(path.join(homeDir, '.zshrc')), '.zshrc created');
  });
});

test('a user-authored codex alias is never overridden', () => {
  withHome(homeDir => {
    const rcPath = path.join(homeDir, '.zshrc');
    fs.writeFileSync(rcPath, 'alias codex="codex --yolo"\n');
    const result = ensureCodexAliasDefault({ env: {}, homeDir, wrapperPath: '/w/ecc-codex' });
    assert.strictEqual(result.action, 'kept-existing');
    assert.strictEqual(result.files[0].action, 'kept-existing');
    assert.strictEqual(fs.readFileSync(rcPath, 'utf8'), 'alias codex="codex --yolo"\n');
  });
});
test('a user-authored codex function is never overridden', () => {
  withHome(homeDir => {
    const rcPath = path.join(homeDir, '.bashrc');
    fs.writeFileSync(rcPath, 'codex() {\n  command codex --profile work "$@"\n}\n');
    const result = ensureCodexAliasDefault({ env: {}, homeDir, wrapperPath: '/w/ecc-codex' });
    assert.strictEqual(result.action, 'kept-existing');
  });
});
test('our own managed block does not count as a foreign alias', () => {
  withHome(homeDir => {
    const rcPath = path.join(homeDir, '.zshrc');
    fs.writeFileSync(rcPath, '# base\n');
    ensureCodexAliasDefault({ env: {}, homeDir, wrapperPath: '/w/ecc-codex' });
    const rerun = ensureCodexAliasDefault({ env: {}, homeDir, wrapperPath: '/w/ecc-codex' });
    assert.strictEqual(rerun.action, 'configured');
    assert.strictEqual(rerun.files[0].action, 'updated');
  });
});

console.log('\nremoveCodexAlias + aliasStatus:');
test('remove strips the block and status reflects each state', () => {
  withHome(homeDir => {
    const rcPath = path.join(homeDir, '.zshrc');
    fs.writeFileSync(rcPath, 'export A=1\n');
    assert.strictEqual(aliasStatus({ env: {}, homeDir }).installed, false);

    ensureCodexAliasDefault({ env: {}, homeDir, wrapperPath: '/w/ecc-codex' });
    assert.strictEqual(aliasStatus({ env: {}, homeDir }).installed, true);

    const removed = removeCodexAlias({ env: {}, homeDir });
    assert.strictEqual(removed.action, 'removed');
    assert.strictEqual(aliasStatus({ env: {}, homeDir }).installed, false);
    assert.ok(fs.readFileSync(rcPath, 'utf8').includes('export A=1'), 'other content kept');
  });
});
test('remove without an installed block reports not-installed', () => {
  withHome(homeDir => {
    assert.strictEqual(removeCodexAlias({ env: {}, homeDir }).action, 'not-installed');
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
