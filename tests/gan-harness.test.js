/**
 * Regression tests for the standalone GAN harness helpers.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const harnessPath = path.join(repoRoot, 'scripts', 'gan-harness.sh');
const evaluatorPath = path.join(repoRoot, 'agents', 'gan-evaluator.md');
const harnessSource = fs.readFileSync(harnessPath, 'utf8');
const evaluatorSource = fs.readFileSync(evaluatorPath, 'utf8');

if (process.platform === 'win32') {
  console.log('\n=== GAN harness helpers ===\n');
  console.log('  - skipped on Windows; GAN harness shell helpers are Unix-only');
  console.log('\nPassed: 0');
  console.log('Failed: 0');
  process.exit(0);
}

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

function withShellFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-gan-shell-'));
  try {
    const bin = path.join(root, 'bin');
    const home = path.join(root, 'home');
    const project = path.join(root, 'project');
    for (const directory of [bin, home, project]) fs.mkdirSync(directory);
    // Only inert system utilities and the explicit fake CLI are reachable.
    for (const command of ['awk', 'date', 'mkdir', 'cat', 'tee', 'wc']) {
      const executable = ['/usr/bin', '/bin'].map(dir => path.join(dir, command)).find(fs.existsSync);
      assert.ok(executable, `missing system utility: ${command}`);
      fs.symlinkSync(executable, path.join(bin, command));
    }
    return fn({ root, bin, project, env: { PATH: bin, HOME: home, TMPDIR: root, LC_ALL: 'C' } });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runHarnessScript(script, args = [], env = {}) {
  return withShellFixture(fixture => {
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', script, 'gan-harness-test', ...args], {
      encoding: 'utf8',
      cwd: fixture.project,
      env: { ...fixture.env, ...env },
      timeout: 5000,
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr || 'GAN harness script failed');
    return result.stdout.trim();
  });
}

const fakeClaude = `#!/bin/bash
set -euo pipefail
printf '%s\\0' "$@" >> "$GAN_TEST_CALLS"
printf '\\0' >> "$GAN_TEST_CALLS"
if [ "$#" -eq 3 ] && [ "$1" = mcp ] && [ "$2" = get ] && [ "$3" = playwright ]; then
  [ "$NO_COLOR" = 1 ] || exit 65
  count=0
  if [ -f "$GAN_TEST_PROBES" ]; then read -r count < "$GAN_TEST_PROBES"; fi
  printf '%s\\n' "$((count + 1))" > "$GAN_TEST_PROBES"
  if [ "$count" -eq 0 ]; then
    printf '%s\\n' "$GAN_TEST_FIRST_STATUS"
    exit "$GAN_TEST_FIRST_EXIT"
  fi
  printf '%s\\n' "$GAN_TEST_SECOND_STATUS"
  exit "$GAN_TEST_SECOND_EXIT"
fi
[ "$1" = -p ] && [ "$2" = --model ] && [ "$3" = fixture-model ] || exit 66
for prompt in "$@"; do :; done
case "$prompt" in
  'You are the Planner'*)
    printf 'Inert spec\\n' > gan-harness/spec.md
    printf 'Inert rubric\\n' > gan-harness/eval-rubric.md
    ;;
  'You are the Generator'*) ;;
  'You are the Evaluator'*)
    printf '| **TOTAL** | | | **9.0** |\\n' > gan-harness/feedback/feedback-001.md
    ;;
  *) exit 67 ;;
esac
`;

function withHarnessRun(options, check) {
  return withShellFixture(fixture => {
    const callsPath = path.join(fixture.root, 'calls');
    const gitCallsPath = path.join(fixture.root, 'git-calls');
    fs.writeFileSync(path.join(fixture.bin, 'claude'), fakeClaude, { mode: 0o700 });
    fs.writeFileSync(path.join(fixture.bin, 'git'), '#!/bin/bash\nprintf unexpected > "$GAN_TEST_GIT_CALLS"\nexit 68\n', { mode: 0o700 });
    // A directory is sufficient to bypass initialization; no real Git command runs.
    fs.mkdirSync(path.join(fixture.project, '.git'));
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', harnessPath, 'Inert fixture brief'], {
      encoding: 'utf8',
      cwd: fixture.project,
      timeout: 5000,
      env: {
        ...fixture.env,
        GAN_PROJECT_DIR: fixture.project,
        GAN_MAX_ITERATIONS: '1',
        GAN_PLANNER_MODEL: 'fixture-model',
        GAN_GENERATOR_MODEL: 'fixture-model',
        GAN_EVALUATOR_MODEL: 'fixture-model',
        GAN_EVAL_MODE: options.mode || 'playwright',
        GAN_TEST_CALLS: callsPath,
        GAN_TEST_GIT_CALLS: gitCallsPath,
        GAN_TEST_PROBES: path.join(fixture.root, 'probes'),
        GAN_TEST_FIRST_STATUS: options.firstStatus ?? 'Status: \u2713 Connected',
        GAN_TEST_FIRST_EXIT: String(options.firstExit || 0),
        GAN_TEST_SECOND_STATUS: options.secondStatus ?? 'Status: \u2713 Connected',
        GAN_TEST_SECOND_EXIT: String(options.secondExit || 0),
      },
    });
    assert.ifError(result.error);
    assert.strictEqual(result.signal, null);
    assert.strictEqual(fs.existsSync(gitCallsPath), false, 'must never invoke real or fake Git');
    const calls = fs.existsSync(callsPath)
      ? fs.readFileSync(callsPath, 'utf8').split('\0\0').filter(Boolean).map(call => call.split('\0'))
      : [];
    check({ result, calls, project: fixture.project });
  });
}

function evaluatorCalls(calls) {
  return calls.filter(args => args[args.length - 1].startsWith('You are the Evaluator'));
}

const baseTools = ['Read', 'Write', 'Bash', 'Grep', 'Glob'];
const browserTools = [
  'mcp__playwright__browser_navigate',
  'mcp__playwright__browser_click',
  'mcp__playwright__browser_take_screenshot',
  'mcp__playwright__browser_snapshot',
  'mcp__playwright__browser_type',
  'mcp__playwright__browser_fill_form',
  'mcp__playwright__browser_resize',
  'mcp__playwright__browser_press_key',
];

function assertEvaluatorTools(calls, expected) {
  const launches = evaluatorCalls(calls);
  assert.strictEqual(launches.length, 1);
  const args = launches[0];
  assert.strictEqual(args.filter(arg => arg === '--allowedTools').length, 1);
  assert.deepStrictEqual(args[args.indexOf('--allowedTools') + 1].split(','), expected);
}

function extractShellFunction(name) {
  const functionMatch = harnessSource.match(new RegExp(`${name}\\(\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(functionMatch, `expected scripts/gan-harness.sh to define ${name}`);
  return functionMatch[0];
}

function extractScore(feedback) {
  const functionMatch = harnessSource.match(/extract_score\(\) \{[\s\S]*?\n\}/);
  assert.ok(functionMatch, 'expected scripts/gan-harness.sh to define extract_score');

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-gan-harness-'));
  const feedbackPath = path.join(temporaryDirectory, 'feedback.md');
  fs.writeFileSync(feedbackPath, feedback, 'utf8');

  try {
    return runHarnessScript(`${functionMatch[0]}\nextract_score "$1"`, [feedbackPath]);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function probePlaywright(statusLine, commandStatus = 0) {
  const script = [
    'claude() {',
    '  [ "$#" -eq 3 ] && [ "$1" = mcp ] && [ "$2" = get ] && [ "$3" = playwright ] || return 64',
    '  [ "$NO_COLOR" = 1 ] || return 65',
    "  printf '%s\\n' \"$GAN_TEST_MCP_STATUS\"",
    '  return "$GAN_TEST_MCP_EXIT"',
    '}',
    extractShellFunction('playwright_mcp_is_connected'),
    'if playwright_mcp_is_connected; then printf connected; else printf unavailable; fi',
  ].join('\n');

  return runHarnessScript(script, [], {
    GAN_TEST_MCP_STATUS: statusLine,
    GAN_TEST_MCP_EXIT: String(commandStatus),
  });
}

function evaluatorToolsForMode(mode) {
  return runHarnessScript(
    `${extractShellFunction('evaluator_tools_for_mode')}\nevaluator_tools_for_mode "$1"`,
    [mode]
  ).split(',');
}

function declaredEvaluatorTools() {
  const frontmatter = evaluatorSource.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(frontmatter, 'expected agents/gan-evaluator.md to have frontmatter');
  const toolsLine = frontmatter[1].match(/^tools:\s*(.+)$/m);
  assert.ok(toolsLine, 'expected agents/gan-evaluator.md to declare tools');
  return toolsLine[1].split(',').map(tool => tool.trim());
}

console.log('\n=== GAN harness helpers ===\n');

const results = Object.freeze([
  test('extract_score reads the documented TOTAL table format', () => {
    const feedback = '| **TOTAL** | | | **7.5** |\n';
    const result = extractScore(feedback);

    assert.strictEqual(result, '7.5');
  }),

  test('extract_score reads the compact TOTAL format', () => {
    const feedback = '**TOTAL** | **8.3**\n';
    const result = extractScore(feedback);

    assert.strictEqual(result, '8.3');
  }),

  test('extract_score reads a Verdict score', () => {
    const feedback = 'Verdict: PASS with score 9.1\n';
    const result = extractScore(feedback);

    assert.strictEqual(result, '9.1');
  }),

  test('extract_score does not treat a Verdict threshold as a score', () => {
    const feedback = '## Verdict: PASS / FAIL (threshold: 7.0)\n';
    const result = extractScore(feedback);

    assert.strictEqual(result, '0.0');
  }),

  test('extract_score prefers a TOTAL score after a Verdict threshold', () => {
    const feedback = [
      '## Verdict: PASS / FAIL (threshold: 7.0)',
      '| **TOTAL** | **1.0** | **9.0** |',
    ].join('\n');
    const result = extractScore(feedback);

    assert.strictEqual(result, '9.0');
  }),

  test('extract_score returns the fallback when no supported score exists', () => {
    const feedback = 'Other score: 9.9\n';
    const result = extractScore(feedback);

    assert.strictEqual(result, '0.0');
  }),

  test('Playwright preflight accepts only an explicitly connected server', () => {
    assert.strictEqual(probePlaywright('Status: \u2713 Connected'), 'connected');
    assert.strictEqual(probePlaywright('Status: \u2714 Connected'), 'connected');
    for (const unavailableStatus of [
      'Status: ! Connected \u00b7 tools fetch failed',
      'Status: ! Needs authentication',
      'Status: \u2718 Failed to connect',
      'Status: \u23f8 Pending approval',
      'Status: \u2298 Disabled for this project',
      '',
    ]) {
      assert.strictEqual(probePlaywright(unavailableStatus), 'unavailable');
    }
    assert.strictEqual(probePlaywright('Status: \u2713 Connected', 1), 'unavailable');
    assert.strictEqual(
      probePlaywright('Status: \u2718 Failed to connect\nStatus: \u2713 Connected'),
      'unavailable'
    );
  }),

  test('evaluator tools follow mode and reuse the approved agent contract', () => {
    assert.deepStrictEqual(evaluatorToolsForMode('playwright'), declaredEvaluatorTools());
    for (const mode of ['screenshot', 'code-only']) {
      assert.deepStrictEqual(
        evaluatorToolsForMode(mode),
        ['Read', 'Write', 'Bash', 'Grep', 'Glob']
      );
    }
  }),

  test('Playwright is checked before setup and again before evaluator launch', () => {
    const preflightCall = harnessSource.indexOf('if ! playwright_mcp_is_connected');
    const setupMutation = harnessSource.indexOf('mkdir -p "$FEEDBACK_DIR"');
    const runtimeCheck = harnessSource.indexOf('[ "$EVAL_MODE" = "playwright" ] && ! playwright_mcp_is_connected');
    const evaluatorLaunch = harnessSource.indexOf('claude -p --model "$EVALUATOR_MODEL"');

    assert.ok(preflightCall >= 0 && preflightCall < setupMutation);
    assert.ok(runtimeCheck >= 0 && runtimeCheck < evaluatorLaunch);
    assert.match(harnessSource, /--allowedTools "\$EVALUATOR_TOOLS"/);
    assert.match(harnessSource, /Unsupported GAN_EVAL_MODE/);
  }),

  test('final score lookup is compatible with the macOS Bash 3.2 runtime', () => {
    const finalScoreBlock = harnessSource.match(
      /NUM_ITERATIONS=\$\{#SCORES\[@\]\}\nif \[ "\$NUM_ITERATIONS"[\s\S]*?\nfi/
    );
    const scoreOutput = harnessSource.match(/echo -e "\s{2}Score:[^\n]+/);

    assert.ok(finalScoreBlock, 'expected scripts/gan-harness.sh to select a final score');
    assert.ok(scoreOutput, 'expected scripts/gan-harness.sh to print the final score');
    assert.doesNotMatch(
      harnessSource,
      /\bSCORES\[\s*-\s*\d+\s*\]/,
      'negative array subscripts require Bash 4.3+'
    );

    const output = runHarnessScript(
      [`SCORES=("$@")`, 'CYAN=""', 'NC=""', finalScoreBlock[0], scoreOutput[0]].join('\n'),
      ['6.2', '8.7']
    );

    assert.match(output, /Score:\s+8\.7\s+\/\s+10\.0/);
  }),

  test('declared evaluator tools cover responsive and keyboard tasks', () => {
    assert.deepStrictEqual(declaredEvaluatorTools(), [...baseTools, ...browserTools]);
  }),

  test('actual Playwright evaluator launch includes responsive and keyboard tools', () => {
    withHarnessRun({}, ({ result, calls }) => {
      assert.strictEqual(result.status, 0, result.stderr);
      assertEvaluatorTools(calls, [...baseTools, ...browserTools]);
      assert.strictEqual(calls.filter(args => args[0] === 'mcp').length, 2);
    });
  }),

  test('actual preflight errors and disconnected states refuse before setup writes', () => {
    for (const options of [
      { firstStatus: 'Status: \u2718 Failed to connect' },
      { firstStatus: 'Status: ! Connected \u00b7 tools fetch failed' },
      { firstStatus: '' },
      { firstExit: 1 },
    ]) {
      withHarnessRun(options, ({ result, calls, project }) => {
        assert.strictEqual(result.status, 1);
        assert.deepStrictEqual(calls, [['mcp', 'get', 'playwright']]);
        assert.deepStrictEqual(fs.readdirSync(project), ['.git']);
      });
    }
  }),

  test('unknown mode refuses before CLI calls and setup writes', () => {
    withHarnessRun({ mode: 'unknown' }, ({ result, calls, project }) => {
      assert.strictEqual(result.status, 1);
      assert.deepStrictEqual(calls, []);
      assert.deepStrictEqual(fs.readdirSync(project), ['.git']);
    });
  }),

  test('lost connection and command errors refuse the actual evaluator launch', () => {
    for (const options of [{ secondStatus: 'Status: \u2718 Failed to connect' }, { secondExit: 1 }]) {
      withHarnessRun(options, ({ result, calls, project }) => {
        assert.strictEqual(result.status, 1);
        assert.strictEqual(calls.filter(args => args[0] === 'mcp').length, 2);
        assert.strictEqual(calls.filter(args => args[args.length - 1].startsWith('You are the Generator')).length, 1);
        assert.deepStrictEqual(evaluatorCalls(calls), []);
        assert.strictEqual(fs.existsSync(path.join(project, 'gan-harness', 'evaluator-1.log')), false);
      });
    }
  }),

  ...['screenshot', 'code-only'].map(mode => test(`actual ${mode} launch keeps base tools without MCP probing`, () => {
    withHarnessRun({ mode, firstExit: 1, secondExit: 1 }, ({ result, calls }) => {
      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(calls.some(args => args[0] === 'mcp'), false);
      assertEvaluatorTools(calls, baseTools);
    });
  })),

  test('evaluator mode explicitly denies Playwright tools without changing other phases', () => {
    for (const mode of ['playwright', 'screenshot', 'code-only']) {
      withHarnessRun({ mode }, ({ result, calls }) => {
        assert.strictEqual(result.status, 0, result.stderr);
        const [evaluator] = evaluatorCalls(calls);
        const denyIndex = evaluator.indexOf('--disallowedTools');
        if (mode === 'playwright') {
          assert.strictEqual(denyIndex, -1);
        } else {
          assert.ok(denyIndex >= 0, `${mode} must deny the configured Playwright server tools`);
          assert.strictEqual(evaluator[denyIndex + 1], 'mcp__playwright__*');
          assert.strictEqual(evaluator.filter(arg => arg === '--disallowedTools').length, 1);
        }
        for (const args of calls.filter(args => args[0] === '-p' && args !== evaluator)) {
          assert.strictEqual(args.includes('--disallowedTools'), false);
        }
      });
    }
  }),
]);

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
