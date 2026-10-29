/**
 * Tests for scripts/dsh/generate-hooks-config.js
 *
 * Run with: node tests/scripts/dsh-generate-hooks-config.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const gen = require('../../scripts/dsh/generate-hooks-config');

function test(name, fn) {
  try {
    fn();
    console.log('  \u2713 ' + name);
    return true;
  } catch (err) {
    console.log('  \u2717 ' + name);
    console.log('    Error: ' + err.message);
    return false;
  }
}

function runTests() {
  let passed = 0;
  let failed = 0;

  if (test('mapMatcher maps Claude tool names to DSH lower-case names', () => {
    assert.strictEqual(gen.mapMatcher('Bash'), 'bash');
    assert.strictEqual(gen.mapMatcher('Edit|MultiEdit'), 'edit');
    assert.strictEqual(gen.mapMatcher('Write|Edit|MultiEdit'), 'write|edit');
  })) passed++; else failed++;

  if (test('mapMatcher keeps regex passthrough tokens untouched', () => {
    assert.strictEqual(gen.mapMatcher('.*'), '.*');
    assert.strictEqual(gen.mapMatcher('^mcp__'), '^mcp__');
    assert.strictEqual(gen.mapMatcher('.*|Task'), '.*|task');
  })) passed++; else failed++;

  if (test('mapCommand prefixes plugin-root env vars and keeps the resolver intact', () => {
    const cmd = 'node -e "resolver" pretooluse:bash:check-console-log scripts/hooks/check-console-log.js standard';
    const out = gen.mapCommand(cmd, '/ecc');
    assert.strictEqual(out, 'CLAUDE_PLUGIN_ROOT=\'/ecc\' ECC_PLUGIN_ROOT=\'/ecc\' ' + cmd);
  })) passed++; else failed++;

  if (test('mapCommand passes through non-resolver commands with prefix only', () => {
    const out = gen.mapCommand('echo hi', '/ecc');
    assert.strictEqual(out, 'CLAUDE_PLUGIN_ROOT=\'/ecc\' ECC_PLUGIN_ROOT=\'/ecc\' echo hi');
  })) passed++; else failed++;

  if (test('generateConfig skips unsupported events and reports them', () => {
    const doc = { hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node -e "x" node scripts/hooks/a.js' }] }],
      PreCompact: [{ matcher: '.*', hooks: [{ type: 'command', command: 'echo hi' }] }],
      SessionEnd: [{ matcher: '.*', hooks: [{ type: 'command', command: 'echo hi' }] }],
    } };
    const { config, report } = gen.generateConfig('/ecc', doc);
    assert.deepStrictEqual(Object.keys(config.hooks), ['PreToolUse']);
    assert.ok(report.some(r => r.includes('PreCompact')));
    assert.ok(report.some(r => r.includes('SessionEnd')));
  })) passed++; else failed++;

  if (test('generateConfig preserves timeout and maps matcher groups', () => {
    const doc = { hooks: {
      PostToolUse: [{ matcher: 'Edit|MultiEdit|Write', hooks: [
        { type: 'command', command: 'node -e "x" node scripts/hooks/b.js', timeout: 30 },
      ] }],
    } };
    const { config } = gen.generateConfig('/ecc', doc);
    const g = config.hooks.PostToolUse[0];
    assert.strictEqual(g.matcher, 'edit|write');
    assert.strictEqual(g.hooks[0].timeout, 30);
  })) passed++; else failed++;

  if (test('generateConfig supports the bridge-only Subagent events', () => {
    assert.ok(gen.SUPPORTED_EVENTS.has('SubagentStart'));
    assert.ok(gen.SUPPORTED_EVENTS.has('SubagentStop'));
  })) passed++; else failed++;

  if (test('mapMatcher preserves case-sensitive regex tokens with metacharacters', () => {
    assert.strictEqual(gen.mapMatcher('^mcp__GitHub__.*'), '^mcp__GitHub__.*');
    assert.strictEqual(gen.mapMatcher('\\S'), '\\S');
  })) passed++; else failed++;

  if (test('mapCommand shell-quotes dangerous path characters', () => {
    const dollar = gen.mapCommand('echo hi', '/home/u/$proj');
    assert.ok(dollar.startsWith("CLAUDE_PLUGIN_ROOT='/home/u/$proj' "), 'literal inside single quotes: ' + dollar);
    const quoted = gen.mapCommand('echo hi', "/home/u'z");
    assert.ok(quoted.startsWith("CLAUDE_PLUGIN_ROOT='/home/u'\\''z' "), 'embedded quote escaped: ' + quoted);
  })) passed++; else failed++;

  if (test('CLI rejects missing flag values with exit code 2', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const res = spawnSync('node', [
      path.join(repoRoot, 'scripts', 'dsh', 'generate-hooks-config.js'),
      '--ecc-root',
    ], { encoding: 'utf8' });
    assert.strictEqual(res.status, 2, 'exit 2 on missing value, stderr: ' + res.stderr);
    assert.ok(res.stderr.includes('Missing value for --ecc-root'));
  })) passed++; else failed++;

  if (test('CLI end-to-end writes valid JSON to --out', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-dsh-'));
    const outPath = path.join(tmp, 'hooks.dsh.json');
    const repoRoot = path.resolve(__dirname, '..', '..');
    const res = spawnSync('node', [
      path.join(repoRoot, 'scripts', 'dsh', 'generate-hooks-config.js'),
      '--ecc-root', repoRoot, '--out', outPath,
    ], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, 'CLI exit 0, stderr: ' + res.stderr);
    const doc = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.ok(doc.hooks.PreToolUse.length > 0, 'PreToolUse groups present');
    assert.ok(Object.keys(doc.hooks).includes('SessionStart'));
    assert.ok(!Object.keys(doc.hooks).includes('PreCompact'), 'unsupported event excluded');
    fs.rmSync(tmp, { recursive: true, force: true });
  })) passed++; else failed++;

  console.log('');
  console.log('Passed: ' + passed + ', Failed: ' + failed);
  return failed === 0;
}

process.exit(runTests() ? 0 : 1);
