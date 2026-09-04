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

function runHarnessScript(script, args = [], env = {}) {
  const bashExecutable = process.platform === 'win32' ? 'bash' : '/bin/bash';
  const result = spawnSync(bashExecutable, ['-c', script, 'gan-harness-test', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.strictEqual(result.status, 0, result.stderr || 'GAN harness script failed');
  return result.stdout.trim();
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
]);

const passed = results.filter(Boolean).length;
const failed = results.length - passed;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
