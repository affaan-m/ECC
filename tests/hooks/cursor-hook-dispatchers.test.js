/**
 * Contract tests for Cursor's event-level hook dispatchers.
 *
 * Issue #2419: Cursor installs must expose one command per event, preserve
 * blocking exit codes while dispatching multiple checks, and resolve shared
 * runtime modules from the installed .cursor/ tree.
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HOOKS_CONFIG = path.join(REPO_ROOT, '.cursor', 'hooks.json');
const BEFORE_SHELL = path.join(REPO_ROOT, '.cursor', 'hooks', 'before-shell-execution.js');
const STOP = path.join(REPO_ROOT, '.cursor', 'hooks', 'stop.js');
const BEFORE_MCP = path.join(REPO_ROOT, '.cursor', 'hooks', 'before-mcp-execution.js');
const AFTER_MCP = path.join(REPO_ROOT, '.cursor', 'hooks', 'after-mcp-execution.js');
const AFTER_SHELL = path.join(REPO_ROOT, '.cursor', 'hooks', 'after-shell-execution.js');
const AFTER_TAB_EDIT = path.join(REPO_ROOT, '.cursor', 'hooks', 'after-tab-file-edit.js');
const BEFORE_READ = path.join(REPO_ROOT, '.cursor', 'hooks', 'before-read-file.js');
const BEFORE_PROMPT = path.join(REPO_ROOT, '.cursor', 'hooks', 'before-submit-prompt.js');
const BEFORE_TAB_READ = path.join(REPO_ROOT, '.cursor', 'hooks', 'before-tab-file-read.js');
const PRE_COMPACT = path.join(REPO_ROOT, '.cursor', 'hooks', 'pre-compact.js');
const SUBAGENT_START = path.join(REPO_ROOT, '.cursor', 'hooks', 'subagent-start.js');
const SUBAGENT_STOP = path.join(REPO_ROOT, '.cursor', 'hooks', 'subagent-stop.js');
const AFTER_FILE_EDIT = path.join(REPO_ROOT, '.cursor', 'hooks', 'after-file-edit.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    return false;
  }
}

function runHook(scriptPath, input, env = {}, cwd = REPO_ROOT) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  const childEnv = {
    ...process.env,
    ECC_HOOK_PROFILE: 'standard',
    ...env,
  };
  if (!Object.hasOwn(env, 'ECC_HOOKS_ENABLED')) {
    delete childEnv.ECC_HOOKS_ENABLED;
  }
  if (!Object.hasOwn(env, 'ECC_DISABLED_HOOKS')) {
    delete childEnv.ECC_DISABLED_HOOKS;
  }
  if (!Object.hasOwn(env, 'CLAUDE_SESSION_ID')) {
    delete childEnv.CLAUDE_SESSION_ID;
  }
  if (!Object.hasOwn(env, 'ECC_SESSION_ID')) {
    delete childEnv.ECC_SESSION_ID;
  }
  for (const key of [
    'CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED',
    'CLAUDE_PLUGIN_OPTION_HOOK_PROFILE',
    'ECC_HOOK_CONFIG',
    'CLAUDE_PLUGIN_ROOT',
    'ECC_PLUGIN_ROOT',
  ]) {
    if (!Object.hasOwn(env, key)) {
      delete childEnv[key];
    }
  }
  return spawnSync(process.execPath, [scriptPath], {
    cwd,
    env: childEnv,
    input: raw,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function accumulatorPath(sessionId, cwd) {
  const raw = sessionId
    || crypto.createHash('sha1').update(cwd).digest('hex').slice(0, 12);
  const safeId = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return path.join(os.tmpdir(), `ecc-edited-${safeId}.txt`);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createInstalledCursorFixture(options = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-cursor-dispatcher-'));
  const cursorRoot = path.join(projectRoot, '.cursor');
  const hooksRoot = path.join(cursorRoot, 'hooks');
  const scriptsRoot = path.join(cursorRoot, 'scripts');

  fs.mkdirSync(hooksRoot, { recursive: true });
  for (const fileName of [
    'adapter.js',
    'after-file-edit.js',
    'before-shell-execution.js',
    'session-start.js',
    'stop.js',
  ]) {
    fs.copyFileSync(
      path.join(REPO_ROOT, '.cursor', 'hooks', fileName),
      path.join(hooksRoot, fileName)
    );
  }

  fs.mkdirSync(path.join(scriptsRoot, 'lib'), { recursive: true });
  if (options.includeHookFlags !== false) {
    fs.copyFileSync(
      path.join(REPO_ROOT, 'scripts', 'lib', 'hook-flags.js'),
      path.join(scriptsRoot, 'lib', 'hook-flags.js')
    );
  }
  writeFile(
    path.join(scriptsRoot, 'lib', 'shell-split.js'),
    "module.exports = { splitShellSegments(value) { return [value]; } };\n"
  );
  writeFile(
    path.join(scriptsRoot, 'hooks', 'block-no-verify.js'),
    [
      "'use strict';",
      "const fs = require('fs');",
      "const command = JSON.parse(fs.readFileSync(0, 'utf8')).tool_input.command;",
      "if (command.includes('--no-verify')) {",
      "  process.stderr.write('BLOCKED: installed runtime\\n');",
      '  process.exit(2);',
      '}',
      '',
    ].join('\n')
  );
  writeFile(
    path.join(scriptsRoot, 'hooks', 'pre-bash-dev-server-block.js'),
    "process.stdout.write(require('fs').readFileSync(0, 'utf8'));\n"
  );
  writeFile(
    path.join(scriptsRoot, 'hooks', 'stop-format-typecheck.js'),
    [
      "'use strict';",
      "const fs = require('fs');",
      "fs.appendFileSync(process.env.CURSOR_HOOK_LOG, 'stop-format-typecheck\\n');",
      "process.stdout.write(require('fs').readFileSync(0, 'utf8'));",
      '',
    ].join('\n')
  );
  writeFile(
    path.join(scriptsRoot, 'hooks', 'post-edit-accumulator.js'),
    [
      "'use strict';",
      "const fs = require('fs');",
      "fs.appendFileSync(process.env.CURSOR_HOOK_LOG, 'post-edit-accumulator\\n');",
      "process.stdout.write(require('fs').readFileSync(0, 'utf8'));",
      '',
    ].join('\n')
  );
  writeFile(
    path.join(scriptsRoot, 'hooks', 'post-edit-console-warn.js'),
    "process.stdout.write(require('fs').readFileSync(0, 'utf8'));\n"
  );
  writeFile(
    path.join(scriptsRoot, 'hooks', 'design-quality-check.js'),
    "process.stdout.write(require('fs').readFileSync(0, 'utf8'));\n"
  );
  writeFile(
    path.join(scriptsRoot, 'hooks', 'cursor-session-env.js'),
    "process.stdout.write(JSON.stringify({ env: { ECC_AGENT_DATA_HOME: '/tmp/cursor-ecc' }, additional_context: 'cursor env' }));\n"
  );
  writeFile(
    path.join(scriptsRoot, 'hooks', 'session-start.js'),
    [
      "const fs = require('fs');",
      "const input = JSON.parse(fs.readFileSync(0, 'utf8'));",
      "if (input.hook_event_name !== 'SessionStart' || input.source !== 'startup') process.exit(3);",
      "if (process.env.ECC_AGENT_DATA_HOME !== '/tmp/cursor-ecc') process.exit(4);",
      "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'shared context' } }));",
      '',
    ].join('\n')
  );

  return {
    projectRoot,
    beforeShell: path.join(hooksRoot, 'before-shell-execution.js'),
    afterFileEdit: path.join(hooksRoot, 'after-file-edit.js'),
    sessionStart: path.join(hooksRoot, 'session-start.js'),
    stop: path.join(hooksRoot, 'stop.js'),
    logPath: path.join(projectRoot, 'hook.log'),
  };
}

let passed = 0;
let failed = 0;

console.log('\nCursor hook dispatcher contract');
console.log('-'.repeat(55));

if (test('registers at most one command for every Cursor event', () => {
  const config = JSON.parse(fs.readFileSync(HOOKS_CONFIG, 'utf8'));
  for (const [eventName, entries] of Object.entries(config.hooks)) {
    assert.strictEqual(
      entries.length,
      1,
      `${eventName} must use one event-level dispatcher`
    );
  }
  assert.strictEqual(
    config.hooks.beforeShellExecution[0].command,
    'node .cursor/hooks/before-shell-execution.js'
  );
})) passed++; else failed++;

if (test('Cursor sessionStart scaffold points at the event dispatcher', () => {
  const scaffold = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'scaffolds', 'cursor', 'hooks.json'),
    'utf8'
  ));
  assert.deepStrictEqual(scaffold.hooks.sessionStart, [{
    command: 'node .cursor/hooks/session-start.js',
  }]);
})) passed++; else failed++;

if (test('beforeShellExecution dispatcher blocks git hook bypass attempts', () => {
  const result = runHook(BEFORE_SHELL, { command: 'git commit --no-verify -m test' });
  assert.strictEqual(result.status, 2, result.stderr);
  assert.match(result.stderr, /BLOCKED/);
})) passed++; else failed++;

if (test('beforeShellExecution dispatcher honors the master hook switch', () => {
  const result = runHook(
    BEFORE_SHELL,
    { command: 'git commit --no-verify -m test' },
    { ECC_HOOKS_ENABLED: 'false' }
  );
  assert.strictEqual(result.status, 0, result.stderr);
})) passed++; else failed++;

if (test('beforeShellExecution dispatcher preserves the dev-server guard', () => {
  if (process.platform === 'win32') {
    console.log('    (tmux guard is not supported on Windows; skipping)');
    return;
  }
  const result = runHook(BEFORE_SHELL, { command: 'npm run dev' });
  assert.strictEqual(result.status, 2, result.stderr);
  assert.match(result.stderr, /Dev server must run in tmux/);
})) passed++; else failed++;

if (test('Cursor-native security hooks honor the master hook switch', () => {
  const disabledEnv = { ECC_HOOKS_ENABLED: 'false' };
  const cases = [
    [BEFORE_READ, { path: '.env' }],
    [BEFORE_PROMPT, { prompt: 'token sk-123456789012345678901234' }],
    [BEFORE_TAB_READ, { path: 'credentials.pem' }],
  ];
  for (const [scriptPath, input] of cases) {
    const result = runHook(scriptPath, input, disabledEnv);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stderr, '', `${path.basename(scriptPath)} should be disabled`);
  }
})) passed++; else failed++;

if (test('Cursor-native audit hooks stay disabled in the minimal profile', () => {
  const cases = [
    [BEFORE_MCP, { server: 'example', tool: 'read' }],
    [AFTER_MCP, { server: 'example', tool: 'read' }],
    [AFTER_SHELL, { command: 'gh pr create', output: 'https://github.com/a/b/pull/1' }],
    [AFTER_TAB_EDIT, { path: 'src/app.js' }],
    [PRE_COMPACT, {}],
    [SUBAGENT_START, { agent_name: 'explore' }],
    [SUBAGENT_STOP, { agent_name: 'explore' }],
  ];
  for (const [scriptPath, input] of cases) {
    const result = runHook(scriptPath, input, { ECC_HOOK_PROFILE: 'minimal' });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stderr, '', `${path.basename(scriptPath)} should be disabled`);
  }
})) passed++; else failed++;

if (test('disabled preCompact preserves malformed input unchanged', () => {
  const raw = '{not-json';
  const result = runHook(PRE_COMPACT, raw, { ECC_HOOK_PROFILE: 'minimal' });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, raw);
})) passed++; else failed++;

if (test('Stop dispatcher runs batch format/typecheck in standard profile', () => {
  const sessionId = `cursor-stop-standard-${process.pid}`;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-cursor-stop-'));
  const editedFile = path.join(tempRoot, 'edited.js');
  const accumFile = accumulatorPath(sessionId, tempRoot);
  writeFile(editedFile, 'const answer = 42;\n');
  writeFile(accumFile, `${editedFile}\n`);

  try {
    const result = runHook(STOP, { conversation_id: sessionId }, {
      CLAUDE_SESSION_ID: sessionId,
      ECC_DISABLED_HOOKS: [
        'stop:check-console-log',
        'stop:session-end',
        'stop:evaluate-session',
        'stop:cost-tracker',
      ].join(','),
    }, tempRoot);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(accumFile), 'Stop should consume the edit accumulator');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(accumFile, { force: true });
  }
})) passed++; else failed++;

if (test('afterFileEdit maps Cursor file_path and conversation_id', () => {
  const conversationId = `cursor-edit-${process.pid}`;
  const accumFile = accumulatorPath(conversationId, REPO_ROOT);
  fs.rmSync(accumFile, { force: true });

  try {
    const editedFile = path.join(REPO_ROOT, 'src', 'cursor-edit.js');
    const result = runHook(AFTER_FILE_EDIT, {
      conversation_id: conversationId,
      file_path: editedFile,
    }, {
      ECC_DISABLED_HOOKS: [
        'post:edit:console-warn',
        'post:edit:design-quality-check',
      ].join(','),
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.readFileSync(accumFile, 'utf8'), `${editedFile}\n`);
  } finally {
    fs.rmSync(accumFile, { force: true });
  }
})) passed++; else failed++;

if (test('parallel Cursor conversations keep separate edit accumulators', () => {
  const firstId = `cursor-first-${process.pid}`;
  const secondId = `cursor-second-${process.pid}`;
  const firstAccum = accumulatorPath(firstId, REPO_ROOT);
  const secondAccum = accumulatorPath(secondId, REPO_ROOT);
  fs.rmSync(firstAccum, { force: true });
  fs.rmSync(secondAccum, { force: true });

  try {
    const env = {
      ECC_DISABLED_HOOKS: [
        'post:edit:console-warn',
        'post:edit:design-quality-check',
      ].join(','),
    };
    assert.strictEqual(runHook(AFTER_FILE_EDIT, {
      conversation_id: firstId,
      file_path: path.join(REPO_ROOT, 'src', 'first.js'),
    }, env).status, 0);
    assert.strictEqual(runHook(AFTER_FILE_EDIT, {
      conversation_id: secondId,
      file_path: path.join(REPO_ROOT, 'src', 'second.js'),
    }, env).status, 0);

    assert.ok(fs.existsSync(firstAccum), 'First conversation should own an accumulator');
    assert.ok(fs.existsSync(secondAccum), 'Second conversation should own an accumulator');

    const stopped = runHook(STOP, { conversation_id: firstId }, {
      ECC_DISABLED_HOOKS: [
        'stop:check-console-log',
        'stop:session-end',
        'stop:evaluate-session',
        'stop:cost-tracker',
      ].join(','),
    });
    assert.strictEqual(stopped.status, 0, stopped.stderr);
    assert.ok(!fs.existsSync(firstAccum), 'First Stop should consume only its accumulator');
    assert.ok(fs.existsSync(secondAccum), 'Second conversation accumulator must remain');
  } finally {
    fs.rmSync(firstAccum, { force: true });
    fs.rmSync(secondAccum, { force: true });
  }
})) passed++; else failed++;

if (test('afterFileEdit forwards user-visible console warnings', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-cursor-warning-'));
  const editedFile = path.join(tempRoot, 'warning.js');
  writeFile(editedFile, 'console.log("debug");\n');

  try {
    const result = runHook(AFTER_FILE_EDIT, { file_path: editedFile }, {
      ECC_DISABLED_HOOKS: [
        'post:edit:accumulator',
        'post:edit:design-quality-check',
      ].join(','),
    }, tempRoot);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stderr, /console\.log found/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('Stop reserves time for lifecycle hooks before the format batch', () => {
  const source = fs.readFileSync(STOP, 'utf8');
  assert.ok(
    source.indexOf("runExistingHook('session-end.js'")
      < source.indexOf("runExistingHook('stop-format-typecheck.js'"),
    'Session persistence should run before the long format/typecheck batch'
  );
  assert.match(source, /timeout:\s*225000/);
  assert.match(source, /ECC_STOP_FORMAT_TYPECHECK_BUDGET_MS:\s*'210000'/);
})) passed++; else failed++;

if (test('Stop dispatcher leaves batch format/typecheck disabled in minimal profile', () => {
  const sessionId = `cursor-stop-minimal-${process.pid}`;
  const accumFile = accumulatorPath(sessionId, REPO_ROOT);
  writeFile(accumFile, `${path.join(REPO_ROOT, 'README.md')}\n`);

  try {
    const result = runHook(STOP, { conversation_id: sessionId }, {
      CLAUDE_SESSION_ID: sessionId,
      ECC_HOOK_PROFILE: 'minimal',
      ECC_DISABLED_HOOKS: [
        'stop:session-end',
        'stop:evaluate-session',
        'stop:cost-tracker',
      ].join(','),
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(accumFile), 'Minimal profile must not run format/typecheck');
  } finally {
    fs.rmSync(accumFile, { force: true });
  }
})) passed++; else failed++;

if (test('afterFileEdit does not accumulate files in the minimal profile', () => {
  const sessionId = `cursor-edit-minimal-${process.pid}`;
  const accumFile = accumulatorPath(sessionId, REPO_ROOT);
  fs.rmSync(accumFile, { force: true });

  try {
    const result = runHook(
      AFTER_FILE_EDIT,
      { path: path.join(REPO_ROOT, 'example.js') },
      { CLAUDE_SESSION_ID: sessionId, ECC_HOOK_PROFILE: 'minimal' }
    );
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(accumFile), 'Minimal profile must not accumulate edit paths');
  } finally {
    fs.rmSync(accumFile, { force: true });
  }
})) passed++; else failed++;

if (test('installed Cursor dispatchers resolve shared hooks inside .cursor/scripts', () => {
  const fixture = createInstalledCursorFixture();
  try {
    const blocked = runHook(
      fixture.beforeShell,
      { command: 'git commit --no-verify -m test' },
      {},
      fixture.projectRoot
    );
    assert.strictEqual(blocked.status, 2, blocked.stderr);
    assert.match(blocked.stderr, /installed runtime/);

    const edited = runHook(
      fixture.afterFileEdit,
      { path: path.join(fixture.projectRoot, 'src', 'app.js') },
      { CURSOR_HOOK_LOG: fixture.logPath },
      fixture.projectRoot
    );
    assert.strictEqual(edited.status, 0, edited.stderr);
    assert.strictEqual(fs.readFileSync(fixture.logPath, 'utf8'), 'post-edit-accumulator\n');
  } finally {
    fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('installed Cursor hooks keep profile controls without the shared helper', () => {
  const fixture = createInstalledCursorFixture({ includeHookFlags: false });
  try {
    const disabled = runHook(
      fixture.beforeShell,
      { command: 'git commit --no-verify -m test' },
      { ECC_HOOKS_ENABLED: 'false' },
      fixture.projectRoot
    );
    assert.strictEqual(disabled.status, 0, disabled.stderr);

    const enabled = runHook(
      fixture.beforeShell,
      { command: 'git commit --no-verify -m test' },
      { ECC_HOOKS_ENABLED: 'true' },
      fixture.projectRoot
    );
    assert.strictEqual(enabled.status, 2, enabled.stderr);
  } finally {
    fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('installed Stop dispatcher resolves hooks inside .cursor/scripts', () => {
  const fixture = createInstalledCursorFixture();
  try {
    const result = runHook(
      fixture.stop,
      { conversation_id: 'installed-stop' },
      {
        CURSOR_HOOK_LOG: fixture.logPath,
        ECC_DISABLED_HOOKS: [
          'stop:check-console-log',
          'stop:session-end',
          'stop:evaluate-session',
          'stop:cost-tracker',
        ].join(','),
      },
      fixture.projectRoot
    );
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.readFileSync(fixture.logPath, 'utf8'), 'stop-format-typecheck\n');
  } finally {
    fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('installed sessionStart dispatcher combines env and shared context', () => {
  const fixture = createInstalledCursorFixture();
  try {
    const result = runHook(
      fixture.sessionStart,
      { conversation_id: 'installed-session' },
      {},
      fixture.projectRoot
    );
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), {
      env: { ECC_AGENT_DATA_HOME: '/tmp/cursor-ecc' },
      additional_context: 'cursor env\n\nshared context',
    });
  } finally {
    fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('installed sessionStart keeps environment fallback for malformed input', () => {
  const fixture = createInstalledCursorFixture();
  try {
    for (const raw of ['{not-json', 'null']) {
      const result = runHook(fixture.sessionStart, raw, {}, fixture.projectRoot);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(JSON.parse(result.stdout).env.ECC_AGENT_DATA_HOME, '/tmp/cursor-ecc');
    }
  } finally {
    fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('sessionStart dispatcher honors the master hook switch', () => {
  const result = runHook(
    path.join(REPO_ROOT, '.cursor', 'hooks', 'session-start.js'),
    { conversation_id: 'disabled-session' },
    { ECC_HOOKS_ENABLED: 'false' }
  );
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), {});
})) passed++; else failed++;

if (test('oversized Cursor input is never echoed as truncated JSON', () => {
  const oversized = JSON.stringify({
    command: 'echo safe',
    padding: 'x'.repeat(1024 * 1024),
  });
  const result = runHook(BEFORE_SHELL, oversized);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '');
  assert.match(result.stderr, /stdin exceeded/);
})) passed++; else failed++;

console.log('-'.repeat(55));
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
