/**
 * Regression tests for the bounded council-multi-model Codex adapter.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SKILL_ROOT = path.join(ROOT, 'skills', 'council-multi-model');
const ADAPTER = path.join(SKILL_ROOT, 'scripts', 'review-with-codex.js');
const {
  MAX_PROMPT_BYTES,
  buildCodexArgs,
  buildEnvironment,
  parseArgs,
  providerLabel,
  runStdinReview,
  runReview,
} = require(ADAPTER);

function immediateStdin(chunks) {
  return {
    setEncoding() {},
    on(event, handler) {
      if (event === 'data') chunks.forEach((chunk) => handler(chunk));
      if (event === 'end') handler();
      return this;
    },
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing council-multi-model adapter ===\n');
  let passed = 0;
  let failed = 0;

  if (test('requires explicit OpenAI transfer consent and host-provider disclosure', () => {
    assert.throws(() => parseArgs(['--host-provider', 'anthropic']), /consent/);
    assert.throws(() => parseArgs(['--consent-to-openai']), /host-provider/);
    assert.throws(
      () => parseArgs(['--consent-to-openai', '--host-provider', 'google']),
      /anthropic, openai, or unknown/
    );
    const options = parseArgs([
      '--consent-to-openai', '--host-provider', 'anthropic', '--timeout-seconds', '30',
    ]);
    assert.strictEqual(options.timeoutMs, 30_000);
  })) passed += 1; else failed += 1;

  if (test('bounds configurable timeouts', () => {
    assert.throws(
      () => parseArgs([
        '--consent-to-openai', '--host-provider', 'openai', '--timeout-seconds', '121',
      ]),
      /10 to 120/
    );
  })) passed += 1; else failed += 1;

  if (test('labels provider relationship without overstating diversity', () => {
    assert.strictEqual(providerLabel('anthropic'), 'cross-provider external critique');
    assert.strictEqual(providerLabel('openai'), 'same-provider external critique');
    assert.strictEqual(providerLabel('unknown'), 'provider relationship unverified');
  })) passed += 1; else failed += 1;

  if (test('builds an ephemeral isolated read-only invocation with no inherited MCPs', () => {
    const args = buildCodexArgs('/tmp/isolated', '/tmp/isolated/final.txt');
    const joined = args.join(' ');
    assert.deepStrictEqual(args.slice(0, 3), ['--ask-for-approval', 'never', 'exec']);
    assert.match(joined, /--ephemeral/);
    assert.match(joined, /--ignore-user-config/);
    assert.match(joined, /--ignore-rules/);
    assert.match(joined, /--strict-config/);
    assert.match(joined, /--sandbox read-only/);
    assert.match(joined, /--cd \/tmp\/isolated/);
    assert.ok(args.includes('sandbox_permissions=[]'));
    assert.ok(args.includes('shell_environment_policy.inherit="none"'));
    assert.ok(args.includes('mcp_servers={}'));
    assert.strictEqual(args.at(-1), '-');
  })) passed += 1; else failed += 1;

  if (test('passes only an allowlisted environment to Codex', () => {
    const env = buildEnvironment({
      PATH: '/bin', HOME: '/home/test', CODEX_HOME: '/home/test/.codex',
      GITHUB_TOKEN: 'secret', AWS_SECRET_ACCESS_KEY: 'secret', NODE_OPTIONS: '--require bad',
    });
    assert.deepStrictEqual(env, {
      PATH: '/bin', HOME: '/home/test', CODEX_HOME: '/home/test/.codex',
    });
  })) passed += 1; else failed += 1;

  if (test('runs from a temporary directory, reads the final response, and cleans up', () => {
    let invocation;
    let removed;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-council-test-'));
    const result = runReview('review this draft', {
      consent: true,
      hostProvider: 'openai',
      timeoutMs: 20_000,
    }, {
      env: { PATH: '/bin', HOME: '/home/test' },
      mkdtempSync: () => tempDir,
      spawnSync: (command, args, options) => {
        invocation = { command, args, options };
        const outputIndex = args.indexOf('--output-last-message') + 1;
        fs.writeFileSync(args[outputIndex], 'critical fault', 'utf8');
        return { status: 0, stderr: '' };
      },
      rmSync: (target, options) => {
        removed = { target, options };
        fs.rmSync(target, options);
      },
    });
    assert.strictEqual(invocation.command, 'codex');
    assert.strictEqual(invocation.options.cwd, tempDir);
    assert.strictEqual(invocation.options.timeout, 20_000);
    assert.strictEqual(invocation.options.input, 'review this draft');
    assert.strictEqual(result, 'same-provider external critique\ncritical fault');
    assert.deepStrictEqual(removed, {
      target: tempDir,
      options: { recursive: true, force: true },
    });
  })) passed += 1; else failed += 1;

  if (test('fails before invocation when the packet exceeds the size limit', () => {
    assert.throws(() => runReview('x'.repeat(MAX_PROMPT_BYTES + 1), {
      consent: true,
      hostProvider: 'anthropic',
      timeoutMs: 20_000,
    }), /exceeds/);
  })) passed += 1; else failed += 1;

  if (test('handles stdin overflow, success output, and review failures directly', () => {
    const options = { consent: true, hostProvider: 'anthropic', timeoutMs: 20_000 };

    let stdout = '';
    let stderr = '';
    let exitCode;
    runStdinReview(options, {
      stdin: immediateStdin(['review this draft']),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: (text) => { stderr += text; } },
      runReview: () => 'cross-provider external critique\ncritical fault',
      setExitCode: (code) => { exitCode = code; },
    });
    assert.strictEqual(stdout, 'cross-provider external critique\ncritical fault\n');
    assert.strictEqual(stderr, '');
    assert.strictEqual(exitCode, undefined);

    stdout = '';
    stderr = '';
    exitCode = undefined;
    runStdinReview(options, {
      stdin: immediateStdin(['x'.repeat(MAX_PROMPT_BYTES + 1)]),
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: (text) => { stderr += text; } },
      runReview: () => { throw new Error('must not run'); },
      setExitCode: (code) => { exitCode = code; },
    });
    assert.strictEqual(stdout, '');
    assert.match(stderr, /review packet exceeds/);
    assert.strictEqual(exitCode, 1);

    stderr = '';
    exitCode = undefined;
    runStdinReview(options, {
      stdin: immediateStdin(['review this draft']),
      stdout: { write: () => {} },
      stderr: { write: (text) => { stderr += text; } },
      runReview: () => { throw new Error('authentication failed'); },
      setExitCode: (code) => { exitCode = code; },
    });
    assert.match(stderr, /external review absent: authentication failed/);
    assert.strictEqual(exitCode, 1);
  })) passed += 1; else failed += 1;

  if (test('documents one post-draft node, consent, honest labels, and fail-closed absence', () => {
    const skill = fs.readFileSync(path.join(SKILL_ROOT, 'SKILL.md'), 'utf8');
    assert.match(skill, /adds only one optional\s+post-draft node/);
    assert.match(skill, /explicitly agrees to send that packet to OpenAI/);
    assert.match(skill, /same-provider external critique/);
    assert.match(skill, /external review absent/);
    assert.match(skill, /SKILL_DIR="<native-skill-dir>"/);
    assert.doesNotMatch(skill, /COUNCIL_MULTI_MODEL_SKILL_DIR/);
    assert.doesNotMatch(skill, /^## Entry B|openai-codex SDK|mcp__codex/m);
  })) passed += 1; else failed += 1;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
