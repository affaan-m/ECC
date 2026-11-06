/**
 * config-health tests for shell parsing, finding accounting, and the install
 * lifecycle.
 *
 * Run with: node tests/hooks/config-health-parser.test.js
 * (also picked up by `node tests/run-all.js`)
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  PYTHON,
  test,
  makeFixture,
  run,
  writeSettings,
  makeInstallFixture,
  installEnv,
  runNode,
  runInstalled,
  runInstalledWithInput,
  HOOKS_JSON,
  ONE_HOOK,
  PLUGIN_HOOKS_JSON,
} = require('./config-health-helpers');

function runTests() {
  console.log('\n=== Testing config-health.py parser, accounting, and install lifecycle ===\n');
  let passed = 0;
  let total = 0;

  const t = (name, fn) => { total += 1; if (test(name, fn)) passed += 1; };

  // --- a blind spot nobody can see is not a health check -------------------

  t('--check reports how many hook paths it did not audit', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('python3 "${CLAUDE_ENV_FILE}/hooks/x.py"'));
    const r = run('--check', fx, '', { CLAUDE_ENV_FILE: '' });
    assert.ok(r.stdout.includes('not audited'),
      `the blind spot must be visible, got: ${r.stdout.trim()}`);
  });

  t('--check names the plugin root it judged against', () => {
    const fx = makeFixture();
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(pluginRoot, { recursive: true });
    const r = run('--check', fx, '', { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.ok(r.stdout.includes(pluginRoot),
      `a wrong-root false positive must be diagnosable, got: ${r.stdout.trim()}`);
  });

  // --- program bodies, quoting, and the backslash -------------------------
  // A second adversarial pass found that the first fix of these introduced a
  // Windows regression: treating every backslash as a shell escape turned
  // C:\Users\me\guard.py into C:Usersmeguard.py, a false alarm on the
  // platform this script is developed on. These pin the corrected rules.

  t('an unquoted Windows path keeps its backslashes', () => {
    const fx = makeFixture();
    const dir = path.join(fx.home, 'back', 'slash');
    fs.mkdirSync(dir, { recursive: true });
    const present = path.join(dir, 'win.py');
    fs.writeFileSync(present, '', 'utf8');
    writeSettings(fx.home, ONE_HOOK(`python3 ${present}`));
    const ok = run('--startup', fx);
    assert.ok(!ok.stdout.includes('missing script'),
      `a Windows path must not be unescaped into nonsense, got: ${ok.stdout.trim()}`);

    writeSettings(fx.home, ONE_HOOK(`python3 ${path.join(dir, 'gone.py')}`));
    const missing = run('--startup', fx);
    assert.ok(missing.stdout.includes('gone.py'),
      `and the missing case must still be reported, got: ${missing.stdout.trim()}`);
  });

  t('a shell -c body is scanned as a command line again', () => {
    const fx = makeFixture();
    const cmd = `sh -c "python3 ${path.join(fx.root, 'nowhere', 'ghost.py')}"`;
    writeSettings(fx.home, ONE_HOOK(cmd));
    const r = run('--startup', fx);
    assert.ok(r.stdout.includes('ghost.py'),
      `the shell will open that file, so it must be reported, got: ${r.stdout.trim()}`);
  });

  t('bundled and long-form program flags are recognised', () => {
    const fx = makeFixture();
    for (const flag of ['-c', '-lc', '--command']) {
      writeSettings(fx.home, ONE_HOOK(`bash ${flag} "python3 .claude/scripts/ghost.py"`));
      const r = run('--startup', fx);
      assert.ok(r.stdout.includes('ghost.py'),
        `${flag} takes a command body and must not hide the reference, got: ${r.stdout.trim()}`);
    }
  });

  t('a node -e body is skipped, and the argument after it is not', () => {
    const fx = makeFixture();
    for (const cmd of [
      'node -e "const s=p.join(r,\'scripts/hooks/never-created.js\')" node scripts/hooks/ghost.js',
      'node --eval "const s=1" node scripts/hooks/ghost.js',
      'node -e const s = p.join(r, "scripts/hooks/never-created.js") ; node scripts/hooks/ghost.js',
    ]) {
      writeSettings(fx.home, ONE_HOOK(cmd));
      const r = run('--startup', fx);
      assert.ok(r.stdout.includes('ghost.js'),
        `the real argument must survive the body, got: ${r.stdout.trim()}`);
      assert.ok(!r.stdout.includes('never-created.js'),
        `a string inside the body is not a file, got: ${r.stdout.trim()}`);
    }
  });

  t('an unclosed quote is skipped, counted, and reported by --check', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('python3 ".claude/scripts/ghost.py --start'));
    const r = run('--check', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!r.stdout.includes('missing script'),
      `an unparseable command must not produce a guess, got: ${r.stdout.trim()}`);
    assert.ok(/unclosed quote/.test(r.stdout),
      `but it must not be invisible either, got: ${r.stdout.trim()}`);
  });

  t('a relative hook satisfied only outside the project is disclosed', () => {
    const fx = makeFixture();
    fs.mkdirSync(path.join(fx.home, '.claude', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fx.home, '.claude', 'scripts', 'home-only.py'), '', 'utf8');
    writeSettings(fx.home, HOOKS_JSON('.claude/scripts/home-only.py'));
    const r = run('--check', fx);
    assert.ok(r.stdout.includes('satisfied by the user home or plugin root'),
      `the cross-root trade must be visible, got: ${r.stdout.trim()}`);
  });

  t('an option between the interpreter and -c does not orphan the body', () => {
    const fx = makeFixture();
    // The payload is chosen per interpreter: a shell body is a command line
    // and is rescanned, a python body is source and is not a file reference.
    const cases = [
      ['bash -x -c "python3 .claude/scripts/ghost.py"', 'ghost.py'],
      ['bash -o pipefail -c "python3 .claude/scripts/ghost.py"', 'ghost.py'],
      ['sh -lc "python3 .claude/scripts/ghost.py"', 'ghost.py'],
      ['bash -x -lc "python3 .claude/scripts/ghost.py"', 'ghost.py'],
      ['python3 -u -c "print(1)" .claude/scripts/ghost.py', 'ghost.py'],
    ];
    for (const [cmd, expected] of cases) {
      writeSettings(fx.home, ONE_HOOK(cmd));
      const r = run('--startup', fx);
      assert.ok(r.stdout.includes(expected),
        `${cmd} must still reach the reference, got: ${r.stdout.trim()}`);
      assert.ok(!r.stdout.includes('python3 .claude/scripts/ghost.py'),
        `a whole payload must never be printed as a path, got: ${r.stdout.trim()}`);
    }
  });

  t('a separator inside quotes is part of the name, not a separator', () => {
    const fx = makeFixture();
    for (const name of ['weird;name.py', 'a|b.py', 'a&b.py']) {
      writeSettings(fx.home, ONE_HOOK(`python3 ".claude/scripts/${name}"`));
      const r = run('--startup', fx);
      assert.ok(r.stdout.includes(name),
        `${name} is a legal filename, got: ${r.stdout.trim()}`);
    }
  });

  t('an unquoted separator attached to a script path does not hide it', () => {
    const fx = makeFixture();
    // Greptile's 2 October case: `python3 ~/.claude/scripts/guard.py;` used to
    // be discarded as one separator-bearing word, so a missing guard looked
    // healthy. The separator ends the word; the path is still audited.
    for (const cmd of [
      'python3 .claude/scripts/ghost.py;',
      'python3 .claude/scripts/ghost.py&&echo ok',
      'python3 .claude/scripts/ghost.py|cat',
    ]) {
      writeSettings(fx.home, ONE_HOOK(cmd));
      const r = run('--startup', fx);
      assert.ok(r.stdout.includes('ghost.py'),
        `${cmd} must still be audited, got: ${r.stdout.trim()}`);
    }
  });

  t('an unclosed quote inside a payload is counted, not dropped', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('sh -c "python3 .claude/scripts/ghost.py && echo \\"oops"'));
    const r = run('--check', fx);
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(!r.stdout.includes('missing script'),
      `an unparseable payload must not produce a guess, got: ${r.stdout.trim()}`);
    assert.ok(/unclosed quote/.test(r.stdout),
      `and the outer command must be reported as unparsed, got: ${r.stdout.trim()}`);
  });

  t('Windows paths a POSIX escaper would mangle survive intact', () => {
    const fx = makeFixture();
    // A UNC prefix is two backslashes, not an escaped one. Collapsing it to
    // \server\share invents a rooted path that was never written.
    writeSettings(fx.home, ONE_HOOK(String.raw`python3 \\server\share\ghost.py`));
    const unc = run('--startup', fx);
    assert.ok(unc.stdout.includes(String.raw`\\server\share\ghost.py`),
      `a UNC path must be reported whole, got: ${unc.stdout.trim()}`);

    // C:\$Recycle.Bin: the $ reads as a shell placeholder, so the token is
    // skipped — but skipped and counted, not escaped into C:Recycle.Bin.
    writeSettings(fx.home, ONE_HOOK(String.raw`python3 C:\$Recycle.Bin\ghost.py`));
    const dollar = run('--check', fx);
    assert.ok(!dollar.stdout.includes('C:Recycle.Bin'),
      `a backslash must not escape the dollar, got: ${dollar.stdout.trim()}`);
    assert.ok(/not audited/.test(dollar.stdout),
      `and the skip must be counted, got: ${dollar.stdout.trim()}`);
  });

  t('a skipped program body is counted, not dropped silently', () => {
    const fx = makeFixture();
    // A file named inside a node -e body is a string in another language and
    // cannot be checked. Silence is right; silence with no count is not.
    writeSettings(fx.home, ONE_HOOK(
      'node -e "const s=p.join(r,\'.claude/scripts/ghost.js\')" node .claude/scripts/real.py'));
    const r = run('--check', fx);
    assert.ok(!r.stdout.includes('ghost.js'),
      `a string inside a JS body is not a file, got: ${r.stdout.trim()}`);
    assert.ok(/program body/.test(r.stdout),
      `but the unjudged body must be visible, got: ${r.stdout.trim()}`);
  });

  t('the repo\'s own hook wiring is fully accounted for', () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const real = fs.readFileSync(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8');
    const fx = makeFixture();
    writeSettings(fx.home, real);
    const r = run('--check', fx, '', { CLAUDE_PLUGIN_ROOT: repoRoot });
    assert.ok(r.stdout.includes('[ok] normal'),
      `a healthy install must be healthy, got: ${r.stdout.trim()}`);
    // Every one of the 23 commands hides a program body, and every relative
    // reference resolves through the plugin root. If those two counts ever go
    // to zero, the numbers below are no longer describing anything.
    const bodies = Number((r.stdout.match(/(\d+) interpreter program body/) || [])[1]);
    const other = Number((r.stdout.match(/(\d+) relative hook path/) || [])[1]);
    assert.ok(bodies >= 20, `expected ~23 skipped bodies, got ${bodies}`);
    assert.ok(other >= 10, `expected plugin-root-satisfied paths, got ${other}`);
  });

  t('a longer name whose prefix is a script name is not truncated to it', () => {
    const fx = makeFixture();
    const dir = path.join(fx.proj, 'scripts', 'hooks');
    fs.mkdirSync(dir, { recursive: true });
    // The shell opens these files. A regex without an end guard matches the
    // prefix and warns about a file that does not exist.
    for (const name of ['archive.js.bak', 'buf.py.map', 'guard.pyc', 'ok.py~']) {
      fs.writeFileSync(path.join(dir, name), '', 'utf8');
      writeSettings(fx.home, ONE_HOOK(`python3 scripts/hooks/${name}`));
      const r = run('--startup', fx);
      assert.ok(!r.stdout.includes('missing script'),
        `${name} exists; a prefix match would warn about a different file, got: ${r.stdout.trim()}`);
    }
    fs.writeFileSync(path.join(dir, 'gone.js.bak'), '', 'utf8');
    writeSettings(fx.home, ONE_HOOK('python3 scripts/hooks/absent.js.bak'));
    const missing = run('--startup', fx);
    assert.ok(!missing.stdout.includes('missing script'),
      `and an absent one is not a script reference either, got: ${missing.stdout.trim()}`);
  });

  t('sh -e is errexit, not a program body', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('sh -e .claude/scripts/ghost.py'));
    const r = run('--startup', fx);
    assert.ok(r.stdout.includes('ghost.py'),
      `sh -e runs the next word as a script, got: ${r.stdout.trim()}`);
  });

  t('a one-word quoted command is not reported as one long path', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('"python3 .claude/scripts/ghost.js"'));
    const r = run('--startup', fx);
    assert.ok(r.stdout.includes('missing script: .claude/scripts/ghost.js'),
      `the interpreter must be stripped, got: ${r.stdout.trim()}`);
    assert.ok(!r.stdout.includes('missing script: python3'),
      `a finding must never quote a whole command, got: ${r.stdout.trim()}`);
  });

  t('a very long token is clipped rather than printed in full', () => {
    const fx = makeFixture();
    const long = 'a'.repeat(5000) + '.py';
    writeSettings(fx.home, ONE_HOOK(`python3 ${long}`));
    const r = run('--startup', fx);
    const line = (r.stdout.split('\n').find((l) => l.includes('missing script')) || '');
    assert.ok(line.length > 0, 'expected a finding');
    assert.ok(line.length < 300, `a finding must stay readable, got ${line.length} chars`);
    assert.ok(/chars total/.test(line), 'clipping must say it clipped');
  });

  t('a settings file that cannot be read is not reported as healthy', () => {
    const fx = makeFixture();
    for (const junk of ['{ not valid json', '[1,2,3]', '{"hooks": 42}', '']) {
      writeSettings(fx.home, junk);
      const r = run('--check', fx);
      assert.strictEqual(r.status, 0, `expected exit 0 for ${JSON.stringify(junk)}`);
      assert.ok(!r.stdout.includes('[ok] normal'),
        `an unreadable settings file must not read as healthy, got: ${r.stdout.trim()}`);
      assert.ok(/could not be read/.test(r.stdout),
        `and it must say which file, got: ${r.stdout.trim()}`);
    }
  });

  t('a settings file that is simply absent is not a finding', () => {
    const fx = makeFixture();
    const r = run('--check', fx);
    assert.ok(r.stdout.includes('[ok] normal'),
      `no settings file means nothing to audit, got: ${r.stdout.trim()}`);
  });

  t('deep sh -c nesting is counted without losing the outer findings', () => {
    const fx = makeFixture();
    // MAX_PAYLOAD_DEPTH is 3, so four levels is the first that runs out. The
    // flag has to survive the recursion, not just the level that trips it.
    const payload = 'sh -c '.repeat(6) + 'true';
    writeSettings(fx.home, ONE_HOOK(`python3 .claude/scripts/early.py && ${payload}`));
    const r = run('--check', fx);
    assert.ok(r.stdout.includes('early.py'),
      `a missing script before the deep part is still missing, got: ${r.stdout.trim()}`);
    assert.ok(/nested sh -c deeper/.test(r.stdout),
      `and the depth limit must be disclosed, got: ${r.stdout.trim()}`);
    assert.ok(!/unclosed quote/.test(r.stdout),
      `balanced quotes are not a typo, got: ${r.stdout.trim()}`);
  });

  t('nesting inside the limit is not reported as too deep', () => {
    const fx = makeFixture();
    writeSettings(fx.home, ONE_HOOK('python3 .claude/scripts/early.py && sh -c sh -c true'));
    const r = run('--check', fx);
    assert.ok(!/nested sh -c deeper/.test(r.stdout),
      `two levels is ordinary, got: ${r.stdout.trim()}`);
  });

  // --- unchanged vs changed settings --------------------------------------

  t('an unchanged settings file yields the same finding on repeat runs', () => {
    const fx = makeFixture();
    writeSettings(fx.home, HOOKS_JSON('~/.claude/scripts/missing-again.py'));
    const first = run('--startup', fx);
    const second = run('--startup', fx);
    assert.strictEqual(first.stdout, second.stdout,
      'deterministic: same config must give byte-identical output');
  });

  t('changing settings changes the finding', () => {
    const fx = makeFixture();
    writeSettings(fx.home, HOOKS_JSON('~/.claude/scripts/missing-again.py'));
    const before = run('--startup', fx);
    assert.ok(before.stdout.includes('missing-again.py'), 'expected the first finding');
    fs.mkdirSync(path.join(fx.home, '.claude', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(fx.home, '.claude', 'scripts', 'missing-again.py'), '', 'utf8');
    const after = run('--startup', fx);
    assert.ok(!after.stdout.includes('missing script'),
      `repairing the file must clear the finding, got: ${after.stdout.trim()}`);
  });

  t('a duplicate reference is reported once per event', () => {
    const fx = makeFixture();
    writeSettings(fx.home, JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [
          { type: 'command', command: 'python3 ~/.claude/scripts/dup.py --a' },
          { type: 'command', command: 'python3 ~/.claude/scripts/dup.py --b' },
        ] }],
      },
    }));
    const r = run('--startup', fx);
    const hits = (r.stdout.match(/dup\.py/g) || []).length;
    assert.strictEqual(hits, 1, `expected one finding for a repeated token, got ${hits}`);
  });

  t('CLAUDE_CONFIG_DIR moves the audited user settings file', () => {
    const fx = makeFixture();
    const configDir = path.join(fx.root, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      ONE_HOOK('python3 ~/.claude/scripts/from-config.py'),
      'utf8'
    );
    writeSettings(fx.home, ONE_HOOK('python3 ~/.claude/scripts/from-home.py'));

    const r = run('--startup', fx, '', { CLAUDE_CONFIG_DIR: configDir });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('from-config.py'),
      `expected the settings in $CLAUDE_CONFIG_DIR to be audited, got: ${r.stdout.trim()}`);
    assert.ok(!r.stdout.includes('from-home.py'),
      'settings under ~/.claude must not be audited when CLAUDE_CONFIG_DIR is set');

    const check = run('--check', fx, '', { CLAUDE_CONFIG_DIR: configDir });
    assert.ok(check.stdout.includes('$CLAUDE_CONFIG_DIR resolved to'),
      '--check must name the non-default data root it resolved');
  });

  t('CLAUDE_CONFIG_DIR moves the rule-health log', () => {
    const fx = makeFixture();
    const configDir = path.join(fx.root, 'config');
    const dataDir = path.join(configDir, 'session-data');
    fs.mkdirSync(dataDir, { recursive: true });
    const records = Array.from({ length: 5 }, (_, index) => JSON.stringify({
      ts: `2026-10-2${index}T00:00:00Z`,
      tool_calls: 6,
      configured_rule: 0,
    }));
    fs.writeFileSync(path.join(dataDir, 'rule-health.jsonl'), records.join('\n') + '\n', 'utf8');

    const homeData = path.join(fx.home, '.claude', 'session-data');
    fs.mkdirSync(homeData, { recursive: true });
    fs.writeFileSync(
      path.join(homeData, 'rule-health.jsonl'),
      records.map(line => line.replace('configured_rule', 'home_rule')).join('\n') + '\n',
      'utf8'
    );

    const r = run('--startup', fx, '', { CLAUDE_CONFIG_DIR: configDir });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}`);
    assert.ok(r.stdout.includes('configured_rule'),
      `expected staleness to be read from $CLAUDE_CONFIG_DIR, got: ${r.stdout.trim()}`);
    assert.ok(!r.stdout.includes('home_rule'),
      'the rule-health log under ~/.claude must not be read when CLAUDE_CONFIG_DIR is set');
  });

  t('installed module survives install, startup, repair, and uninstall in a disposable home', () => {
    const fx = makeInstallFixture();
    const env = installEnv(fx);
    const installedScript = path.join(fx.config, 'scripts', 'config-health.py');
    const installedSkill = path.join(fx.config, 'skills', 'config-health', 'SKILL.md');
    const settingsPath = path.join(fx.config, 'settings.json');

    const install = runNode('scripts/install-apply.js',
      ['--target', 'claude', '--modules', 'config-health', '--enable-hooks', '--json'], env);
    assert.strictEqual(install.status, 0,
      `install failed: ${(install.stderr || install.stdout).trim()}`);
    assert.ok(fs.existsSync(installedScript),
      `installed script missing at ${installedScript}`);
    assert.ok(fs.existsSync(installedSkill),
      `installed skill missing at ${installedSkill}`);

    const installedSettings = fs.readFileSync(settingsPath, 'utf8');
    // Copying the script is not the SessionStart promise the skill makes: the
    // installed monitor only runs if the installer also registers it.
    const parsedSettings = JSON.parse(installedSettings);
    const sessionEntries = parsedSettings.hooks && parsedSettings.hooks.SessionStart;
    assert.ok(Array.isArray(sessionEntries) && sessionEntries.length > 0,
      `the default install must register a SessionStart hook, got: ${installedSettings}`);
    const sessionCommands = sessionEntries
      .flatMap(entry => (entry.hooks || []).map(hook => hook.command));
    assert.ok(sessionCommands.some(command => (
      command.includes('config-health.py') && command.includes('--startup')
    )), `the SessionStart hook must run the installed monitor: ${sessionCommands.join(' | ')}`);
    assert.ok(!installedSettings.includes('config-health.py --pretool'),
      'the default install must not add a per-tool hook');

    // The opt-in pre-tool path must work from the disposable project install,
    // not only from the in-repo fixture.
    fs.writeFileSync(settingsPath,
      ONE_HOOK(`python3 "${installedScript}" --pretool`), 'utf8');
    const pretoolProject = runInstalledWithInput('--pretool', fx, '{"tool_name":"Edit"}');
    assert.strictEqual(pretoolProject.status, 0,
      `installed project pre-tool must exit 0, got ${pretoolProject.status}`);
    assert.strictEqual(pretoolProject.stdout, '',
      `installed project pre-tool stdout must stay clean: ${pretoolProject.stdout.trim()}`);
    assert.ok(!pretoolProject.stderr.includes('references missing script'),
      `installed project pre-tool must not warn: ${pretoolProject.stderr.trim()}`);

    // The same pre-tool path with a plugin-root command, from the same
    // disposable install.
    const pluginRoot = path.join(fx.root, 'plugin');
    fs.mkdirSync(path.join(pluginRoot, 'scripts', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, 'scripts', 'hooks', 'guard.py'), '', 'utf8');
    fs.writeFileSync(settingsPath, PLUGIN_HOOKS_JSON('scripts/hooks/guard.py'), 'utf8');
    const pretoolPlugin = runInstalledWithInput('--pretool', fx, '{"tool_name":"Edit"}',
      { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.strictEqual(pretoolPlugin.status, 0,
      `installed plugin pre-tool must exit 0, got ${pretoolPlugin.status}`);
    assert.strictEqual(pretoolPlugin.stdout, '',
      `installed plugin pre-tool stdout must stay clean: ${pretoolPlugin.stdout.trim()}`);
    assert.ok(!pretoolPlugin.stderr.includes('references missing script'),
      `installed plugin pre-tool must not warn: ${pretoolPlugin.stderr.trim()}`);

    fs.writeFileSync(settingsPath, PLUGIN_HOOKS_JSON('scripts/ghost.py'), 'utf8');
    const startup = runInstalled('--startup', fx, { CLAUDE_PLUGIN_ROOT: pluginRoot });
    assert.strictEqual(startup.status, 0,
      `startup must stay non-blocking, got ${startup.status}`);
    assert.ok(startup.stdout.includes('references missing script'),
      `a real missing plugin script must warn, got: ${startup.stdout.trim()}`);
    assert.ok(startup.stdout.includes('ghost.py'),
      'the warning must name the missing plugin script');

    fs.writeFileSync(settingsPath,
      ONE_HOOK('python3 "${CONFIG_HEALTH_TEST_UNSET_ROOT}/scripts/x.py"'), 'utf8');
    const check = runInstalled('--check', fx);
    assert.strictEqual(check.status, 0, `--check exits 0, got ${check.status}`);
    assert.ok(check.stdout.includes('hook path(s) not audited'),
      `an unresolved provider root must be reported as unjudged, got: ${check.stdout.trim()}`);
    assert.ok(!check.stdout.includes('references missing script'),
      'an unresolved provider root must not be reported as a missing script');

    fs.unlinkSync(installedScript);
    const repair = runNode('scripts/repair.js', ['--target', 'claude', '--json'], env);
    assert.strictEqual(repair.status, 0,
      `repair failed: ${(repair.stderr || repair.stdout).trim()}`);
    assert.ok(fs.existsSync(installedScript), 'repair must restore the installed script');

    const uninstall = runNode('scripts/uninstall.js', ['--target', 'claude', '--json'], env);
    assert.strictEqual(uninstall.status, 0,
      `uninstall failed: ${(uninstall.stderr || uninstall.stdout).trim()}`);
    assert.ok(!fs.existsSync(installedScript), 'uninstall must remove the installed script');
    assert.ok(!fs.existsSync(installedSkill), 'uninstall must remove the installed skill');
    const remainingSettings = fs.existsSync(settingsPath)
      ? fs.readFileSync(settingsPath, 'utf8')
      : '';
    assert.ok(!remainingSettings.includes('config-health.py'),
      'uninstall must remove the SessionStart hook it registered');
  });

  t('--no-hooks installs the payload without registering the monitor', () => {
    const fx = makeInstallFixture();
    const env = installEnv(fx);
    const installedScript = path.join(fx.config, 'scripts', 'config-health.py');
    const settingsPath = path.join(fx.config, 'settings.json');

    const install = runNode('scripts/install-apply.js',
      ['--target', 'claude', '--modules', 'config-health', '--no-hooks', '--json'], env);
    assert.strictEqual(install.status, 0,
      `install failed: ${(install.stderr || install.stdout).trim()}`);
    assert.ok(fs.existsSync(installedScript),
      `--no-hooks must still install the script at ${installedScript}`);
    const installedSettings = fs.existsSync(settingsPath)
      ? fs.readFileSync(settingsPath, 'utf8')
      : '';
    assert.ok(!installedSettings.includes('config-health.py'),
      '--no-hooks must not wire a hook the user declined');
  });

  t('project install runs the pre-tool workflow from a disposable project', () => {
    const fx = makeInstallFixture();
    const env = installEnv(fx);
    const installScript = path.join(__dirname, '..', '..', 'scripts', 'install-apply.js');

    const install = spawnSync(process.execPath,
      [installScript, '--target', 'claude-project', '--modules', 'config-health', '--enable-hooks', '--json'],
      { cwd: fx.proj, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120000 });
    assert.strictEqual(install.status, 0,
      `project install failed: ${(install.stderr || install.stdout).trim()}`);

    const installedScript = path.join(fx.proj, '.claude', 'scripts', 'config-health.py');
    const settingsPath = path.join(fx.proj, '.claude', 'settings.json');
    assert.ok(fs.existsSync(installedScript),
      `project install must place the script at ${installedScript}`);

    const projectSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const sessionCommands = (projectSettings.hooks && projectSettings.hooks.SessionStart || [])
      .flatMap(entry => (entry.hooks || []).map(hook => hook.command));
    assert.ok(sessionCommands.some(command => (
      command.includes('config-health.py') && command.includes('--startup')
    )), `project install must register the monitor at project scope: ${sessionCommands.join(' | ')}`);

    fs.writeFileSync(settingsPath,
      ONE_HOOK('python3 .claude/scripts/config-health.py --pretool'), 'utf8');
    const pretool = spawnSync(PYTHON, [installedScript, '--pretool'], {
      cwd: fx.proj,
      env: { ...process.env, ...env, CLAUDE_PROJECT_DIR: fx.proj },
      input: '{"tool_name":"Edit"}',
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.strictEqual(pretool.status, 0,
      `project pre-tool must exit 0, got ${pretool.status}`);
    assert.strictEqual(pretool.stdout, '',
      `project pre-tool stdout must stay clean: ${pretool.stdout.trim()}`);
    assert.ok(!pretool.stderr.includes('references missing script'),
      `project pre-tool must not warn: ${pretool.stderr.trim()}`);
  });

  console.log(`\n  ${passed}/${total} passed`);
  if (passed !== total) process.exit(1);
}

runTests();
