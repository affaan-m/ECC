'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  collectInteractiveOptions,
  main,
  parseArgs,
  validateExecutionMode,
} = require('../../scripts/install-guided');

const repoRoot = path.join(__dirname, '..', '..');
const guidedPtyFixture = path.join(repoRoot, 'tests', 'fixtures', 'run-guided-install-pty.js');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function fakeTerminal(answers) {
  const queue = [...answers];
  let prompts = [];
  return {
    async question(prompt = '') {
      prompts = [...prompts, prompt];
      if (queue.length === 0) throw new Error('No fake answer available');
      return queue.shift();
    },
    close() {},
    get prompts() { return [...prompts]; },
  };
}

function capture(isTTY = true) {
  let value = '';
  return {
    isTTY,
    write(chunk) { value += chunk; },
    read() { return value; },
  };
}

function quoteShellArgument(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runGuidedPtyFixture(answers) {
  if (process.platform === 'win32') return null;
  const command = [process.execPath, guidedPtyFixture];
  const scriptArgs = process.platform === 'darwin'
    ? ['-q', '-e', '/dev/null', ...command]
    : ['-q', '-e', '-c', command.map(quoteShellArgument).join(' '), '/dev/null'];
  const pseudoTerminalCommand = ['script', ...scriptArgs]
    .map(quoteShellArgument)
    .join(' ');
  const answerCommands = answers
    .map(answer => `sleep 0.35; printf '%s\\n' ${quoteShellArgument(answer)}`)
    .join('; ');
  return spawnSync('sh', ['-c', `(${answerCommands}; sleep 0.1) | ${pseudoTerminalCommand}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
  });
}

(async () => {
  console.log('\n=== Guided multi-harness CLI tests ===\n');

  await test('parses repeatable harness flags and provider-specific choices', () => {
    assert.deepStrictEqual(parseArgs([
      '--harness', 'kimi', '--harness', 'claude,codex',
      '--claude-scope', 'local', '--claude-hooks', 'minimal',
      '--profile', 'developer', '--yes', '--dry-run', '--json',
    ]), {
      allHarnesses: false,
      claudeHooks: 'minimal',
      claudeScope: 'local',
      dryRun: true,
      harnesses: ['kimi', 'claude,codex'],
      help: false,
      json: true,
      profile: 'developer',
      yes: true,
    });
    assert.throws(() => parseArgs(['--harness']), /Missing value.*--harness/);
    assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
    assert.throws(
      () => parseArgs(['--all-harnesses', '--harness', 'claude']),
      /mutually exclusive/i
    );
  });

  await test('supports every non-empty Claude, Codex, and Kimi selection combination', () => {
    const combinations = [
      ['claude'], ['codex'], ['kimi'],
      ['claude', 'codex'], ['claude', 'kimi'], ['codex', 'kimi'],
      ['claude', 'codex', 'kimi'],
    ];
    for (const harnesses of combinations) {
      const parsed = parseArgs(harnesses.flatMap(id => ['--harness', id]));
      assert.deepStrictEqual(parsed.harnesses, harnesses);
    }
  });

  await test('interactive selection reprompts and only asks relevant provider questions', async () => {
    const output = capture();
    const result = await collectInteractiveOptions(parseArgs([]), {
      output,
      terminal: fakeTerminal(['bogus', '1,3', '3', '2', '4']),
    });
    assert.deepStrictEqual(result.harnesses, ['claude', 'kimi']);
    assert.strictEqual(result.claudeScope, 'local');
    assert.strictEqual(result.claudeHooks, 'minimal');
    assert.strictEqual(result.profile, 'security');
    assert.match(output.read(), /Please choose/i);
    assert.doesNotMatch(output.read(), /Codex.*scope/i);
  });

  await test('interactive prompts keep spacing, recommended defaults, and one visible confirmation', async () => {
    const output = capture();
    const terminal = fakeTerminal(['all', '1', '3', '2']);
    const options = await collectInteractiveOptions(parseArgs([]), { output, terminal });
    assert.deepStrictEqual(options.harnesses, ['claude', 'codex', 'kimi']);
    assert.match(output.read(), /Advanced adapters[^\n]+\.\n\n\nWhere should Claude/);
    assert.deepStrictEqual(terminal.prompts, [
      'Choose one or more (for example 1,3 or all): ',
      'Choose [Recommended: user] (one option only): ',
      'Choose [Recommended: standard] (one option only): ',
      'Choose [Recommended: core] (one option only): ',
    ]);

    const confirmationOutput = capture();
    const confirmationTerminal = fakeTerminal(['y']);
    const code = await main([
      '--harness', 'codex',
    ], {
      applyPlan: async () => ({ status: 'complete', completed: [{ id: 'codex' }] }),
      createPlan: async request => ({
        request,
        harnesses: [{ id: 'codex', channel: 'native-plugin', preview: {} }],
      }),
      interactive: true,
      output: confirmationOutput,
      terminal: confirmationTerminal,
      showWelcome: () => {},
      startSpinner: () => ({ stop() {} }),
    });
    assert.strictEqual(code, 0);
    assert.deepStrictEqual(
      confirmationTerminal.prompts,
      ['Apply ECC to these harnesses? [y/N]: ']
    );
  });

  await test('real PTY shows every all-harness question and applies after visible yes', () => {
    const result = runGuidedPtyFixture(['all', '1', '3', '2', 'y']);
    if (result === null) return;
    assert.strictEqual(result.status, 0, result.stderr);
    const visible = `${result.stdout}${result.stderr}`
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\r/g, '');
    const orderedPrompts = [
      'Choose one or more (for example 1,3 or all):',
      'Choose [Recommended: user] (one option only):',
      'Choose [Recommended: standard] (one option only):',
      'Choose [Recommended: core] (one option only):',
      'Apply ECC to these harnesses? [y/N]:',
      'PTY_WELCOME_SHOWN',
    ];
    let previousIndex = -1;
    for (const prompt of orderedPrompts) {
      const promptIndex = visible.indexOf(prompt);
      assert.ok(promptIndex > previousIndex, `missing or out-of-order PTY prompt: ${prompt}`);
      previousIndex = promptIndex;
    }
    assert.doesNotMatch(visible, /install cancelled/i);
  });

  await test('non-interactive and JSON modes require complete explicit choices', () => {
    assert.throws(
      () => validateExecutionMode(parseArgs([]), false),
      /--harness/i
    );
    assert.throws(
      () => validateExecutionMode(parseArgs(['--harness', 'claude', '--json']), true),
      /Claude.*scope.*hooks/i
    );
    assert.throws(
      () => validateExecutionMode(parseArgs([
        '--harness', 'claude', '--claude-scope', 'user', '--claude-hooks', 'standard', '--json',
      ]), true),
      /--yes/i
    );
  });

  await test('runs one preflight, one confirmation, and one apply for all selected harnesses', async () => {
    const output = capture();
    const terminal = fakeTerminal(['y']);
    const events = [];
    const code = await main([
      '--harness', 'claude', '--harness', 'codex', '--harness', 'kimi',
      '--claude-scope', 'user', '--claude-hooks', 'standard', '--profile', 'core',
    ], {
      applyPlan: async plan => { events.push('apply'); return { status: 'complete', completed: plan.harnesses }; },
      createPlan: async request => {
        events.push('preflight');
        return {
          request,
          harnesses: request.harnesses.map(id => ({ id, channel: id === 'kimi' ? 'managed-project' : 'native-plugin', preview: {} })),
        };
      },
      interactive: true,
      output,
      terminal,
      showWelcome: () => events.push('welcome'),
      startSpinner: () => ({ stop: () => events.push('spinner:stop') }),
    });
    assert.strictEqual(code, 0);
    assert.deepStrictEqual(events, ['preflight', 'apply', 'spinner:stop', 'welcome']);
    assert.strictEqual(
      terminal.prompts.filter(prompt => /Apply ECC to these harnesses\?/.test(prompt)).length,
      1
    );
  });

  await test('cancellation and dry-run perform no mutation or welcome', async () => {
    for (const dryRun of [false, true]) {
      const output = capture();
      let applyCalls = 0;
      let welcomeCalls = 0;
      const args = [
        '--harness', 'codex',
        ...(dryRun ? ['--dry-run'] : []),
      ];
      const code = await main(args, {
        applyPlan: async () => { applyCalls += 1; },
        createPlan: async request => ({ request, harnesses: [{ id: 'codex', channel: 'native-plugin', preview: {} }] }),
        interactive: true,
        output,
        terminal: fakeTerminal(dryRun ? [] : ['n']),
        showWelcome: () => { welcomeCalls += 1; },
      });
      assert.strictEqual(code, 0);
      assert.strictEqual(applyCalls, 0);
      assert.strictEqual(welcomeCalls, 0);
    }
  });

  await test('JSON mode emits one clean result document', async () => {
    const output = capture(true);
    const code = await main(['--harness', 'codex', '--yes', '--json'], {
      applyPlan: async () => ({ status: 'complete', completed: [{ id: 'codex' }], retryHarnesses: [] }),
      createPlan: async request => ({ request, harnesses: [{ id: 'codex', channel: 'native-plugin', preview: {} }] }),
      interactive: true,
      output,
      showWelcome: () => { throw new Error('welcome must be suppressed'); },
    });
    assert.strictEqual(code, 0);
    const value = JSON.parse(output.read());
    assert.strictEqual(value.result.status, 'complete');
  });

  await test('help and failed apply paths are actionable', async () => {
    const helpOutput = capture();
    assert.strictEqual(await main(['--help'], { output: helpOutput }), 0);
    assert.match(helpOutput.read(), /Advanced managed adapters/);

    const output = capture();
    const errorOutput = capture();
    const code = await main(['--harness', 'codex', '--yes'], {
      applyPlan: async () => ({
        status: 'failed',
        completed: [],
        failure: { id: 'codex', message: 'verification failed' },
        retryHarnesses: ['codex'],
      }),
      createPlan: async request => ({ request, harnesses: [{ id: 'codex', channel: 'native-plugin', preview: {} }] }),
      errorOutput,
      interactive: false,
      output,
    });
    assert.strictEqual(code, 1);
    assert.match(
      errorOutput.read(),
      /Retry with: ecc-universal install --guided --harness codex/
    );

    const jsonError = capture();
    assert.strictEqual(await main(['--json'], {
      errorOutput: jsonError,
      interactive: false,
      output: capture(false),
    }), 1);
    assert.strictEqual(JSON.parse(jsonError.read()).error.code, 'GUIDED_INSTALL_FAILED');
  });

  await test('retry command preserves unfinished provider-specific choices', async () => {
    const output = capture(false);
    const errorOutput = capture(false);
    const code = await main([
      '--harness', 'claude', '--harness', 'kimi',
      '--claude-scope', 'local', '--claude-hooks', 'strict',
      '--profile', 'developer', '--yes',
    ], {
      applyPlan: async () => ({
        status: 'failed',
        completed: [],
        failure: { id: 'claude', message: 'verification failed' },
        retryHarnesses: ['claude', 'kimi'],
      }),
      createPlan: async request => ({
        request,
        harnesses: [
          { id: 'claude', channel: 'native-plugin', preview: {} },
          { id: 'kimi', channel: 'managed-project', preview: {} },
        ],
      }),
      errorOutput,
      interactive: false,
      output,
    });
    assert.strictEqual(code, 1);
    assert.match(
      errorOutput.read(),
      /Retry with: ecc-universal install --guided --harness claude --harness kimi --claude-scope local --claude-hooks strict --profile developer/
    );
  });

  await test('human-facing parser errors never echo terminal control bytes', async () => {
    const errorOutput = capture();
    const code = await main(['--harness', 'codex\u001b[31m'], {
      errorOutput,
      interactive: false,
      output: capture(false),
    });
    assert.strictEqual(code, 1);
    assert.ok(!errorOutput.read().includes('\u001b'));
    assert.doesNotMatch(errorOutput.read(), /\[31m/);
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
