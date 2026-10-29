'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { resolveWindowsBashCandidates } = require('../../scripts/lib/windows-bash');
const { INLINE_RESOLVE } = require('../../scripts/lib/resolve-ecc-root');

// Sentinel ECC skill that resolveEccRoot() requires alongside the script tree
// before accepting a root; kept in sync with the module's DEFAULT_SKILL_PROBE.
const ECC_SKILL_SENTINEL = path.join('skills', 'continuous-learning-v2');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message || String(error));
    failed += 1;
  }
}

const sessionsDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'sessions.md'), 'utf8');
const skillHealthDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'skill-health.md'), 'utf8');
const instinctStatusDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'instinct-status.md'), 'utf8');
const instinctEnforceDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'instinct-enforce.md'), 'utf8');

test('sessions command uses shared inline resolver in all node scripts', () => {
  assert.strictEqual((sessionsDoc.match(/const _r = /g) || []).length, 6);
  assert.strictEqual((sessionsDoc.match(/scripts','lib','resolve-ecc-root/g) || []).length, 6);
});

test('skill-health command uses shared inline resolver in all shell snippets', () => {
  assert.strictEqual((skillHealthDoc.match(/var r=\(function/g) || []).length, 3);
  assert.strictEqual((skillHealthDoc.match(/scripts','lib','resolve-ecc-root/g) || []).length, 3);
});

test('instinct-status command uses shared inline resolver (no stale legacy fallback) (#2037)', () => {
  assert.strictEqual((instinctStatusDoc.match(/var r=\(function/g) || []).length, 1);
  assert.strictEqual((instinctStatusDoc.match(/scripts','lib','resolve-ecc-root/g) || []).length, 1);
  // The pre-fix template hard-coded the legacy path as a fallback when
  // CLAUDE_PLUGIN_ROOT was unset. Asserting its absence prevents regression.
  assert.ok(
    !instinctStatusDoc.includes('python3 ~/.claude/skills/continuous-learning-v2/scripts/instinct-cli.py'),
    'instinct-status should not hard-code the legacy ~/.claude install path as a fallback'
  );
});

test('instinct-enforce command uses shared inline resolver (#2037)', () => {
  assert.strictEqual((instinctEnforceDoc.match(/var r=\(function/g) || []).length, 1);
  assert.strictEqual((instinctEnforceDoc.match(/scripts','lib','resolve-ecc-root/g) || []).length, 1);
  assert.ok(
    /scripts\/hooks\/instinct-enforce\.js" --check /.test(instinctEnforceDoc),
    'instinct-enforce should invoke the PreToolUse hook in --check mode'
  );
});

test('auto-update command probes for the script it runs, not just scripts/lib', () => {
  // A partial install can carry full resolver evidence (script tree plus
  // sentinel ECC skill, per #2544/#2577) yet still lack scripts/auto-update.js.
  // The command's inline resolver must probe for the script it actually
  // executes so such roots don't shadow the complete plugin root.
  const autoUpdateDocs = [
    path.join(__dirname, '..', '..', 'commands', 'auto-update.md'),
    path.join(__dirname, '..', '..', 'docs', 'ja-JP', 'commands', 'auto-update.md'),
    path.join(__dirname, '..', '..', 'docs', 'zh-CN', 'commands', 'auto-update.md'),
  ];
  for (const docPath of autoUpdateDocs) {
    const doc = fs.readFileSync(docPath, 'utf8');
    assert.strictEqual(
      (doc.match(/scripts','lib','resolve-ecc-root/g) || []).length, 1,
      `${docPath} should embed the shared inline resolver`
    );
    assert.ok(
      doc.includes("resolveEccRoot({probe:p.join('scripts','auto-update.js')})"),
      `${docPath} should probe for scripts/auto-update.js`
    );
  }
});

test('resolveEccRoot module covers current and legacy marketplace plugin roots', () => {
  const { resolveEccRoot } = require('../../scripts/lib/resolve-ecc-root');
  assert.ok(typeof resolveEccRoot === 'function');

  const legacyHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-marketplace-legacy-'));
  try {
    const legacyRoot = path.join(legacyHomeDir, '.claude', 'plugins', 'marketplaces', 'ecc');
    fs.mkdirSync(path.join(legacyRoot, 'scripts', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, 'scripts', 'lib', 'utils.js'), '// stub');
    fs.mkdirSync(path.join(legacyRoot, ECC_SKILL_SENTINEL), { recursive: true });
    assert.strictEqual(resolveEccRoot({ envRoot: '', homeDir: legacyHomeDir }), legacyRoot);
  } finally {
    fs.rmSync(legacyHomeDir, { recursive: true, force: true });
  }

  const cacheHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-marketplace-cache-'));
  try {
    const cacheRoot = path.join(cacheHomeDir, '.claude', 'plugins', 'cache', 'ecc', 'affaan-m', '1.0.0');
    fs.mkdirSync(path.join(cacheRoot, 'scripts', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(cacheRoot, 'scripts', 'lib', 'utils.js'), '// stub');
    fs.mkdirSync(path.join(cacheRoot, ECC_SKILL_SENTINEL), { recursive: true });
    assert.strictEqual(resolveEccRoot({ envRoot: '', homeDir: cacheHomeDir }), cacheRoot);
  } finally {
    fs.rmSync(cacheHomeDir, { recursive: true, force: true });
  }

  assert.ok(!INLINE_RESOLVE.includes('\\"'), 'Inline resolver should not require escaped double quotes');
  assert.ok(INLINE_RESOLVE.includes("scripts','lib','resolve-ecc-root"));
});

for (const name of ['auto-update', 'instinct-status', 'skill-health', 'skill-host-compat']) {
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', `${name}.md`), 'utf8');
  const assignments = doc.split('\n').filter(line => line.startsWith('ECC_ROOT='));
  for (const [index, assignment] of assignments.entries()) {
    test(`${name} declared resolver ${index + 1} executes selected and explicit roots`, () => {
      const root = path.resolve(__dirname, '../..');
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-command-profile-'));
      try {
        const selected = { ...process.env, HOME: temp, USERPROFILE: temp, CLAUDE_CONFIG_DIR: root };
        delete selected.CLAUDE_PLUGIN_ROOT;
        for (const env of [selected, { ...selected, CLAUDE_PLUGIN_ROOT: root }, { ...selected, CLAUDE_PLUGIN_ROOT: ' \t ' }, { ...selected, CLAUDE_PLUGIN_ROOT: ` ${root} ` }]) {
          const [bash] = resolveWindowsBashCandidates(['bash.exe', 'bash'], { env });
          const shell = process.platform === 'win32' ? bash : 'bash';
          assert.ok(shell, 'A native Git Bash executable is required');
          const result = spawnSync(shell, ['-s'],
            { input: assignment + '\nprintf "%s" "$ECC_ROOT"\n', env, cwd: temp, encoding: 'utf8' });
          assert.strictEqual(result.status, 0, result.stderr);
          assert.strictEqual(result.stderr, '');
          assert.strictEqual(result.stdout, root);
        }
      } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    });
  }
}
for (const broken of [false, true]) {
  test(`auto-update legacy-only cache ${broken ? 'rejects corrupt current cache before follow-up' : 'runs the actual selected updater'}`, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-legacy-update-'));
    try {
      const root = path.join(temp, 'plugins/cache/everything-claude-code/vendor/1.0.0');
      fs.mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
      fs.mkdirSync(path.join(root, ECC_SKILL_SENTINEL), { recursive: true });
      fs.copyFileSync(path.join(__dirname, '../../scripts/lib/resolve-ecc-root.js'), path.join(root, 'scripts/lib/resolve-ecc-root.js'));
      fs.writeFileSync(path.join(root, 'scripts/lib/utils.js'), '// fixture');
      fs.writeFileSync(path.join(root, 'scripts/auto-update.js'), "console.log('UPDATER:'+__dirname+':'+process.argv.slice(2).join(','))");
      if (broken) fs.writeFileSync(path.join(temp, 'plugins/cache/ecc'), 'occupied non-directory');
      const env = { ...process.env, HOME: temp, USERPROFILE: temp, CLAUDE_CONFIG_DIR: temp };
      delete env.CLAUDE_PLUGIN_ROOT;
      const [bash] = resolveWindowsBashCandidates(['bash.exe', 'bash'], { env });
      const shell = process.platform === 'win32' ? bash : 'bash';
      const doc = fs.readFileSync(path.join(__dirname, '../../commands/auto-update.md'), 'utf8');
      const assignment = doc.split('\n').find(line => line.startsWith('ECC_ROOT='));
      const followup = broken ? 'node -e "console.log(\'FOLLOWUP_INVOKED\')"' : 'node "$ECC_ROOT/scripts/auto-update.js" --dry-run';
      const result = spawnSync(shell, ['-s'], { input: assignment + '\n' + followup + '\n', env, cwd: temp, encoding: 'utf8' });
      const { resolveEccRoot } = require('../../scripts/lib/resolve-ecc-root');
      const options = { envRoot: '', configDir: temp, probe: path.join('scripts', 'auto-update.js') };
      if (broken) {
        assert.equal(result.status, 1);assert.match(result.stderr, /ENOTDIR/);assert.equal(result.stdout, '');
        assert.throws(() => resolveEccRoot(options), error => error.code === 'ENOTDIR');
      } else {
        assert.equal(result.status, 0, result.stderr);assert.equal(result.stdout.trim(), `UPDATER:${fs.realpathSync(path.join(root, 'scripts'))}:--dry-run`);
        assert.equal(resolveEccRoot(options), root);
      }
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
}
for (const level of ['slug', 'org']) {
  test(`actual command skips non-directory cache children at ${level} level`, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-stray-cache-'));
    try {
      const root = path.join(temp, 'plugins/cache/everything-claude-code/vendor/1.0.0');
      fs.mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
      fs.mkdirSync(path.join(root, ECC_SKILL_SENTINEL), { recursive: true });
      fs.copyFileSync(path.join(__dirname, '../../scripts/lib/resolve-ecc-root.js'), path.join(root, 'scripts/lib/resolve-ecc-root.js'));
      fs.writeFileSync(path.join(root, 'scripts/lib/utils.js'), '// fixture');
      fs.writeFileSync(path.join(root, 'scripts/auto-update.js'), "console.log('UPDATER:'+__dirname)");
      const cache = path.join(temp, 'plugins/cache/ecc');
      const strayDir = level === 'slug' ? cache : path.join(cache, 'vendor');
      fs.mkdirSync(strayDir, { recursive: true });
      fs.writeFileSync(path.join(strayDir, 'stray.txt'), 'preserve');
      const env = { ...process.env, HOME: temp, USERPROFILE: temp, CLAUDE_CONFIG_DIR: temp };
      delete env.CLAUDE_PLUGIN_ROOT;
      const [bash] = resolveWindowsBashCandidates(['bash.exe', 'bash'], { env });
      const shell = process.platform === 'win32' ? bash : 'bash';
      const assignment = fs.readFileSync(path.join(__dirname, '../../commands/auto-update.md'), 'utf8').split('\n').find(line => line.startsWith('ECC_ROOT='));
      const result = spawnSync(shell, ['-s'], { input: assignment + '\nnode "$ECC_ROOT/scripts/auto-update.js"\n', env, cwd: temp, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), `UPDATER:${fs.realpathSync(path.join(root, 'scripts'))}`);
      assert.equal(fs.readFileSync(path.join(strayDir, 'stray.txt'), 'utf8'), 'preserve');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
}
// Regression: on WSL, CLAUDE_CONFIG_DIR may carry a Windows path (e.g.
// C:\Users\name\.claude). Every inline resolver that reads CLAUDE_CONFIG_DIR
// must include the /proc/version → /mnt/… conversion so hooks and commands
// resolve to the correct mount instead of treating the Windows path as
// relative. The source INLINE_RESOLVE, command .md files, and hooks.json /
// codex-hooks.json must all carry the same conversion block.
function countHooksWithWslConversion(filePath) {
  const allowedFilePaths = new Set([
    path.resolve(__dirname, '..', '..', 'hooks', 'hooks.json'),
    path.resolve(__dirname, '..', '..', 'hooks', 'codex-hooks.json'),
  ]);
  const resolvedPath = path.resolve(filePath);
  assert.ok(allowedFilePaths.has(resolvedPath), `Unexpected hook file path: ${filePath}`);
  const config = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  const events = config.hooks || {};
  let checked = 0;
  for (const entries of Object.values(events)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry.hooks) continue;
      for (const hook of entry.hooks) {
        if (typeof hook.command !== 'string') continue;
        if (hook.command.includes('CLAUDE_CONFIG_DIR')) {
          assert.ok(
            hook.command.includes('proc/version') && hook.command.includes('microsoft'),
            `${path.basename(filePath)} hook command with CLAUDE_CONFIG_DIR must include WSL path conversion`
          );
          checked++;
        }
      }
    }
  }
  return checked;
}

test('hooks.json inline resolvers include WSL path conversion for CLAUDE_CONFIG_DIR', () => {
  const checked = countHooksWithWslConversion(path.join(__dirname, '..', '..', 'hooks', 'hooks.json'));
  assert.ok(checked > 0, 'Expected at least one hooks.json resolver with CLAUDE_CONFIG_DIR');
});

test('codex-hooks.json inline resolver includes WSL path conversion for CLAUDE_CONFIG_DIR', () => {
  const checked = countHooksWithWslConversion(path.join(__dirname, '..', '..', 'hooks', 'codex-hooks.json'));
  // Assert at least one resolver with WSL conversion exists. An exact count would break
  // when a second hook with CLAUDE_CONFIG_DIR is added; checking the required behavior
  // (all such hooks carry the conversion block) is enforced by countHooksWithWslConversion.
  assert.ok(checked >= 1, 'Expected at least one codex-hooks.json resolver with CLAUDE_CONFIG_DIR WSL conversion');
});

test('inline resolver copies in commands and hooks match canonical buildInlineResolve', () => {
  const { INLINE_RESOLVE, buildInlineResolve } = require('../../scripts/lib/resolve-ecc-root');
  const { INLINE_WSL_CONVERSION } = require('../../scripts/lib/install-targets/helpers');
  assert.ok(
    INLINE_RESOLVE.includes(INLINE_WSL_CONVERSION),
    'INLINE_RESOLVE must embed canonical INLINE_WSL_CONVERSION from helpers.js'
  );

  for (const cmdName of ['instinct-status', 'sessions', 'skill-health', 'skill-host-compat']) {
    const cmdDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', `${cmdName}.md`), 'utf8');
    const matches = cmdDoc.match(/\(function\(\)\{var p=require\(.+?return d\}\)\(\)/g) || [];
    assert.ok(matches.length > 0, `Expected inline resolver in commands/${cmdName}.md`);
    for (const match of matches) {
      assert.strictEqual(match, INLINE_RESOLVE, `commands/${cmdName}.md inline resolver drifted from canonical INLINE_RESOLVE`);
    }
  }

  const autoUpdateDoc = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'auto-update.md'), 'utf8');
  const autoUpdateMatches = autoUpdateDoc.match(/\(function\(\)\{var p=require\(.+?return d\}\)\(\)/g) || [];
  assert.strictEqual(autoUpdateMatches.length, 1, 'Expected 1 inline resolver in commands/auto-update.md');
  assert.strictEqual(
    autoUpdateMatches[0],
    buildInlineResolve({ probe: 'scripts/auto-update.js' }),
    'commands/auto-update.md inline resolver drifted from canonical buildInlineResolve'
  );

  for (const hookFile of ['hooks.json', 'codex-hooks.json']) {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', hookFile), 'utf8'));
    let verified = 0;
    for (const entries of Object.values(config.hooks || {})) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        for (const hook of entry.hooks || []) {
          if (typeof hook.command === 'string' && hook.command.includes('CLAUDE_CONFIG_DIR')) {
            const m = hook.command.match(/const r=(\(function\(\)\{.*?\}\)\(\))/);
            assert.ok(m, `Could not extract inline resolver from ${hookFile}`);
            assert.strictEqual(m[1], INLINE_RESOLVE, `${hookFile} inline resolver drifted from canonical INLINE_RESOLVE`);
            verified++;
          }
        }
      }
    }
    assert.ok(verified > 0, `Expected at least one verified resolver in ${hookFile}`);
  }
});

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
