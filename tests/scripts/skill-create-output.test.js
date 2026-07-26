/**
 * Tests for scripts/node/skill-create-output.js
 *
 * Tests the SkillCreateOutput class and helper functions.
 *
 * Run with: node tests/scripts/skill-create-output.test.js
 */

const assert = require('assert');
// Import the module (local path: scripts/node/)
const { SkillCreateOutput } = require('../../scripts/node/skill-create-output');

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

// Strip ANSI escape sequences for assertions
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// Capture console.log output
function captureLog(fn) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    fn();
    return logs;
  } finally {
    console.log = origLog;
  }
}

function runTests() {
  console.log('\n=== Testing skill-create-output.js ===\n');

  let passed = 0;
  let failed = 0;

  // Constructor tests
  console.log('SkillCreateOutput constructor:');

  if (test('creates instance with repo name', () => {
    const output = new SkillCreateOutput('test-repo');
    assert.strictEqual(output.repoName, 'test-repo');
    assert.strictEqual(output.width, 70); // default width
  })) passed++; else failed++;

  if (test('accepts custom width option', () => {
    const output = new SkillCreateOutput('repo', { width: 100 });
    assert.strictEqual(output.width, 100);
  })) passed++; else failed++;

  // header() tests
  console.log('\nheader():');

  if (test('outputs header with repo name', () => {
    const output = new SkillCreateOutput('my-project');
    const logs = captureLog(() => output.header());
    const combined = logs.join('\n');
    assert.ok(combined.includes('Skill Creator'), 'Should include Skill Creator');
    assert.ok(combined.includes('my-project'), 'Should include repo name');
  })) passed++; else failed++;

  if (test('header handles long repo names without crash', () => {
    const output = new SkillCreateOutput('a-very-long-repository-name-that-exceeds-normal-width-limits');
    // Should not throw RangeError
    const logs = captureLog(() => output.header());
    assert.ok(logs.length > 0, 'Should produce output');
  })) passed++; else failed++;

  // analysisResults() tests
  console.log('\nanalysisResults():');

  if (test('displays analysis data', () => {
    const output = new SkillCreateOutput('repo');
    const logs = captureLog(() => output.analysisResults({
      commits: 150,
      timeRange: 'Jan 2026 - Feb 2026',
      contributors: 3,
      files: 200,
    }));
    const combined = logs.join('\n');
    assert.ok(combined.includes('150'), 'Should show commit count');
    assert.ok(combined.includes('Jan 2026'), 'Should show time range');
    assert.ok(combined.includes('200'), 'Should show file count');
  })) passed++; else failed++;

  // patterns() tests
  console.log('\npatterns():');

  if (test('displays patterns with confidence bars', () => {
    const output = new SkillCreateOutput('repo');
    const logs = captureLog(() => output.patterns([
      { name: 'Test Pattern', trigger: 'when testing', confidence: 0.9, evidence: 'Tests exist' },
      { name: 'Another Pattern', trigger: 'when building', confidence: 0.5, evidence: 'Build exists' },
    ]));
    const combined = logs.join('\n');
    assert.ok(combined.includes('Test Pattern'), 'Should show pattern name');
    assert.ok(combined.includes('when testing'), 'Should show trigger');
    assert.ok(stripAnsi(combined).includes('90%'), 'Should show confidence as percentage');
  })) passed++; else failed++;

  if (test('handles patterns with missing confidence (defaults to 80%)', () => {
    const output = new SkillCreateOutput('repo');
    // Local code uses || 0.8, so missing confidence defaults to 80%
    const logs = captureLog(() => output.patterns([
      { name: 'No Confidence', trigger: 'always', evidence: 'evidence' },
    ]));
    const combined = logs.join('\n');
    assert.ok(stripAnsi(combined).includes('80%'), 'Should default to 80% confidence');
  })) passed++; else failed++;

  // output() tests
  console.log('\noutput():');

  if (test('displays file paths', () => {
    const output = new SkillCreateOutput('repo');
    const logs = captureLog(() => output.output('/path/to/SKILL.md'));
    const combined = logs.join('\n');
    assert.ok(combined.includes('SKILL.md'), 'Should show skill path');
    assert.ok(combined.includes('Complete'), 'Should show completion message');
  })) passed++; else failed++;

  // nextSteps() tests
  console.log('\nnextSteps():');

  if (test('displays next steps', () => {
    const output = new SkillCreateOutput('repo');
    const logs = captureLog(() => output.nextSteps());
    const combined = logs.join('\n');
    assert.ok(combined.includes('Next Steps'), 'Should show Next Steps title');
    assert.ok(combined.includes('SKILL.md'), 'Should mention reviewing the skill');
  })) passed++; else failed++;

  // footer() tests
  console.log('\nfooter():');

  if (test('displays footer with attribution', () => {
    const output = new SkillCreateOutput('repo');
    const logs = captureLog(() => output.footer());
    const combined = logs.join('\n');
    assert.ok(combined.includes('Everything Claude Code'), 'Should include project name');
  })) passed++; else failed++;

  // progressBar edge cases (tests the clamp fix)
  console.log('\nprogressBar edge cases:');

  if (test('does not crash with confidence > 1.0 (percent > 100)', () => {
    const output = new SkillCreateOutput('repo');
    // confidence 1.5 => percent 150
    const logs = captureLog(() => output.patterns([
      { name: 'Overconfident', trigger: 'always', confidence: 1.5, evidence: 'too much' },
    ]));
    const combined = stripAnsi(logs.join('\n'));
    assert.ok(combined.includes('150%'), 'Should show 150%');
  })) passed++; else failed++;

  if (test('renders 0% confidence bar without crash', () => {
    const output = new SkillCreateOutput('repo');
    // Note: local code uses || 0.8, so confidence=0 becomes 0.8 (80%)
    // This tests that 0.0 is treated as falsy and defaults to 80%
    const logs = captureLog(() => output.patterns([
      { name: 'Zero Confidence', trigger: 'never', confidence: 0.0, evidence: 'none' },
    ]));
    const combined = stripAnsi(logs.join('\n'));
    assert.ok(combined.includes('80%'), 'Should show 80% (0 is falsy with || operator)');
  })) passed++; else failed++;

  if (test('renders 100% confidence bar without crash', () => {
    const output = new SkillCreateOutput('repo');
    const logs = captureLog(() => output.patterns([
      { name: 'Perfect', trigger: 'always', confidence: 1.0, evidence: 'certain' },
    ]));
    const combined = stripAnsi(logs.join('\n'));
    assert.ok(combined.includes('100%'), 'Should show 100%');
  })) passed++; else failed++;

  // Empty array edge cases
  console.log('\nempty array edge cases:');

  if (test('patterns() with empty array produces header but no entries', () => {
    const output = new SkillCreateOutput('repo');
    const logs = captureLog(() => output.patterns([]));
    const combined = logs.join('\n');
    assert.ok(combined.includes('Patterns'), 'Should show header');
  })) passed++; else failed++;

  // Box drawing crash fix (regression test)
  console.log('\nbox() crash prevention:');

  if (test('analysisResults does not crash with very narrow width', () => {
    const output = new SkillCreateOutput('repo', { width: 10 });
    const logs = captureLog(() => output.analysisResults({
      commits: 1, timeRange: 'today', contributors: 1, files: 1,
    }));
    assert.ok(logs.length > 0, 'Should produce output without crash');
  })) passed++; else failed++;

  // box() alignment regression test
  console.log('\nbox() alignment:');

  if (test('top, middle, and bottom lines have equal visual width', () => {
    const output = new SkillCreateOutput('repo', { width: 40 });
    const logs = captureLog(() => output.analysisResults({
      commits: 5, timeRange: 'today', contributors: 1, files: 3,
    }));
    const combined = logs.join('\n');
    const boxLines = combined.split('\n').filter(l => stripAnsi(l).trim().length > 0);
    const boxDrawn = boxLines.filter(l => {
      const s = stripAnsi(l).trim();
      return s.startsWith('\u256D') || s.startsWith('\u2502') || s.startsWith('\u2570');
    });
    if (boxDrawn.length >= 3) {
      const widths = boxDrawn.map(l => stripAnsi(l).length);
      const firstWidth = widths[0];
      widths.forEach((w, i) => {
        assert.strictEqual(w, firstWidth,
          `Line ${i} width ${w} should match first line width ${firstWidth}`);
      });
    }
  })) passed++; else failed++;

  // box() content overflow
  console.log('\nbox() content overflow:');

  if (test('box does not crash when content line exceeds width', () => {
    const output = new SkillCreateOutput('repo', { width: 30 });
    const logs = captureLog(() => output.analysisResults({
      commits: 1,
      timeRange: 'an-extremely-long-time-range-string-that-clearly-exceeds-the-box-width',
      contributors: 1,
      files: 1,
    }));
    assert.ok(logs.length > 0, 'Should produce output without RangeError');
  })) passed++; else failed++;

  if (test('patterns renders negative confidence without crash', () => {
    const output = new SkillCreateOutput('repo');
    const logs = captureLog(() => output.patterns([
      { name: 'Negative', trigger: 'never', confidence: -0.1, evidence: 'impossible' },
    ]));
    const combined = stripAnsi(logs.join('\n'));
    assert.ok(combined.includes('-10%'), 'Should show -10%');
  })) passed++; else failed++;

  if (test('header does not crash with very long repo name', () => {
    const longRepo = 'A'.repeat(100);
    const output = new SkillCreateOutput(longRepo);
    const logs = captureLog(() => output.header());
    assert.ok(logs.length > 0, 'Should produce output without crash');
  })) passed++; else failed++;

  if (test('footer produces output', () => {
    const output = new SkillCreateOutput('repo');
    const logs = captureLog(() => output.footer());
    const combined = stripAnsi(logs.join('\n'));
    assert.ok(combined.includes('Powered by'), 'Should include attribution text');
  })) passed++; else failed++;

  // header width alignment
  console.log('\nheader() width alignment:');

  if (test('header subtitle line matches border width', () => {
    const output = new SkillCreateOutput('test-repo');
    const logs = captureLog(() => output.header());
    const lines = logs.map(l => stripAnsi(l));
    const borderLine = lines.find(l => l.includes('═══'));
    const subtitleLine = lines.find(l => l.includes('Extracting patterns'));
    assert.ok(borderLine, 'Should find border line');
    assert.ok(subtitleLine, 'Should find subtitle line');
    assert.strictEqual(subtitleLine.length, borderLine.length,
      `Subtitle width (${subtitleLine.length}) should match border width (${borderLine.length})`);
  })) passed++; else failed++;

  if (test('header all lines have consistent width for short repo name', () => {
    const output = new SkillCreateOutput('abc');
    const logs = captureLog(() => output.header());
    const lines = logs.map(l => stripAnsi(l)).filter(l => l.includes('║') || l.includes('╔') || l.includes('╚'));
    assert.ok(lines.length >= 4, 'Should have at least 4 box lines');
    const widths = lines.map(l => l.length);
    const first = widths[0];
    widths.forEach((w, i) => {
      assert.strictEqual(w, first,
        `Line ${i} width (${w}) should match first line (${first})`);
    });
  })) passed++; else failed++;

  // box() width accuracy
  console.log('\nbox() width accuracy:');

  if (test('box lines in analysisResults() match the default box width of 60', () => {
    const output = new SkillCreateOutput('repo');
    const logs = captureLog(() => output.analysisResults({
      commits: 10, timeRange: 'this week', contributors: 2, files: 12,
    }));
    const combined = logs.join('\n');
    const boxLines = combined.split('\n').filter(l => {
      const s = stripAnsi(l).trim();
      return s.startsWith('\u256D') || s.startsWith('\u2502') || s.startsWith('\u2570');
    });
    assert.ok(boxLines.length >= 3, 'Should have at least 3 box lines');
    boxLines.forEach((l, i) => {
      const w = stripAnsi(l).length;
      assert.strictEqual(w, 60,
        `Box line ${i} should be 60 chars wide, got ${w}`);
    });
  })) passed++; else failed++;

  if (test('box lines with custom width match self-consistently', () => {
    const output = new SkillCreateOutput('repo', { width: 40 });
    const logs = captureLog(() => output.analysisResults({
      commits: 2, timeRange: 'short', contributors: 1, files: 2,
    }));
    const combined = logs.join('\n');
    const boxLines = combined.split('\n').filter(l => {
      const s = stripAnsi(l).trim();
      return s.startsWith('\u256D') || s.startsWith('\u2502') || s.startsWith('\u2570');
    });
    assert.ok(boxLines.length >= 3, 'Should have at least 3 box lines');
    const firstWidth = stripAnsi(boxLines[0]).length;
    boxLines.forEach((l, i) => {
      const w = stripAnsi(l).length;
      assert.strictEqual(w, firstWidth,
        `Box line ${i} width ${w} should match first line ${firstWidth}`);
    });
  })) passed++; else failed++;

  // analysisResults zero values
  console.log('\nanalysisResults zero values:');

  if (test('analysisResults handles zero values for all data fields', () => {
    const output = new SkillCreateOutput('repo');
    const logs = captureLog(() => output.analysisResults({
      commits: 0, timeRange: '', contributors: 0, files: 0,
    }));
    const combined = logs.join('\n');
    assert.ok(combined.includes('0'), 'Should display zero values');
    assert.ok(logs.length > 0, 'Should produce output without crash');
  })) passed++; else failed++;

  // demo export
  console.log('\ndemo export:');

  if (test('module exports demo function alongside SkillCreateOutput', () => {
    const mod = require('../../scripts/node/skill-create-output');
    assert.ok(mod.demo, 'Should export demo function');
    assert.strictEqual(typeof mod.demo, 'function', 'demo should be a function');
    assert.ok(mod.SkillCreateOutput, 'Should also export SkillCreateOutput');
    assert.strictEqual(typeof mod.SkillCreateOutput, 'function', 'SkillCreateOutput should be a constructor');
  })) passed++; else failed++;

  // analyzePhase() async method
  console.log('\nanalyzePhase() async method:');

  if (test('analyzePhase completes without error and writes to stdout', () => {
    const output = new SkillCreateOutput('test-repo');
    const writes = [];
    const origWrite = process.stdout.write;
    process.stdout.write = function(str) { writes.push(String(str)); return true; };
    try {
      const promise = output.analyzePhase({ commits: 42 });
      assert.ok(promise && typeof promise.then === 'function',
        'analyzePhase should return a Promise');
    } finally {
      process.stdout.write = origWrite;
    }
    assert.ok(writes.length > 0, 'Should have written output via process.stdout.write');
    assert.ok(writes.some(w => w.includes('Analyzing')), 'Should include "Analyzing" label');
  })) passed++; else failed++;

  // Summary
  console.log(`\n=== Test Results ===`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
