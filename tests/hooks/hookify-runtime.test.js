/**
 * Contract tests for the ECC-native Hookify rule runtime (#2561).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const runtimePath = path.join(repoRoot, 'scripts', 'hooks', 'hookify-runtime.js');
const runtime = require(runtimePath);

function test(name, fn) {
  try {
    fn();
    console.log('  \u2713 ' + name);
    return true;
  } catch (error) {
    console.log('  \u2717 ' + name);
    console.log('    Error: ' + error.message);
    return false;
  }
}

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hookify-'));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  return root;
}

function writeRule(root, slug, frontmatter, message = 'Hookify policy matched.') {
  const file = path.join(root, '.claude', 'hookify.' + slug + '.local.md');
  fs.writeFileSync(file, '---\n' + frontmatter.trim() + '\n---\n' + message + '\n');
  return file;
}

function runHook(root, input, env = {}) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  return runtime.run(raw, {
    cwd: root,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: root,
      ...env,
    },
  });
}

function parseDecision(result) {
  assert.strictEqual(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout, 'expected hook output');
  return JSON.parse(result.stdout);
}

function removeProject(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('\nHookify runtime tests (#2561)');
console.log('\u2500'.repeat(50));

let passed = 0;
let failed = 0;

if (test('loads enabled project-local rules and ignores disabled rules', () => {
  const root = createProject();
  try {
    writeRule(root, 'enabled', 'name: enabled-rule\nenabled: true\nevent: bash\npattern: npm\\s+publish');
    writeRule(root, 'disabled', 'name: disabled-rule\nenabled: false\nevent: bash\npattern: npm\\s+publish');
    const loaded = runtime.loadRules(root);
    assert.deepStrictEqual(loaded.rules.map(rule => rule.name), ['enabled-rule']);
    assert.deepStrictEqual(loaded.diagnostics, []);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('parses supported quoted scalars and rejects unsupported frontmatter shapes', () => {
  const parsed = runtime.parseRuleFrontmatter([
    'name: "quoted-rule"',
    "event: 'bash'",
    'enabled: TRUE',
    'pattern: "npm\\\\s+test"',
  ].join('\n'));
  assert.deepStrictEqual({ ...parsed }, {
    name: 'quoted-rule',
    event: 'bash',
    enabled: true,
    pattern: 'npm\\s+test',
  });
  assert.throws(
    () => runtime.parseRuleFrontmatter('name: [one, two]'),
    /flow collections/
  );
  assert.throws(
    () => runtime.parseRuleFrontmatter('name: "unterminated'),
    /unterminated quoted scalar/
  );
  assert.throws(
    () => runtime.parseRuleFrontmatter('name: rule\n  nested: value'),
    /nested values/
  );
})) passed++; else failed++;

if (test('parses inline YAML comments and literal block scalars', () => {
  const inline = runtime.parseRuleFrontmatter('name: inline # rule name\nevent: bash\npattern: npm # command comment');
  assert.strictEqual(inline.name, 'inline');
  assert.strictEqual(inline.pattern, 'npm');

  const block = runtime.parseRuleFrontmatter([
    'name: block-scalar',
    'event: bash',
    'pattern: |-',
    '  npm\\s+',
    '  publish',
  ].join('\n'));
  assert.strictEqual(block.pattern, 'npm\\s+\npublish');

  const folded = runtime.parseRuleFrontmatter([
    'pattern: >-',
    '  foo  bar',
    '',
    '  baz',
  ].join('\n'));
  assert.strictEqual(folded.pattern, 'foo  bar\nbaz');

  const conditions = runtime.parseRuleFrontmatter([
    'conditions: # all entries must match',
    '  - pattern: |-',
    '      npm\\s+',
    '      publish',
    '    field: command',
  ].join('\n'));
  assert.strictEqual(conditions.conditions[0].pattern, 'npm\\s+\npublish');
})) passed++; else failed++;

if (test('runtime has no install-time package dependency', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:js-yaml|yaml)['"]\)/);
  const result = spawnSync(process.execPath, [runtimePath], {
    cwd: os.tmpdir(),
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: os.tmpdir(), NODE_PATH: '' },
    timeout: 10000,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '');
})) passed++; else failed++;

if (test('blocks a matching Bash command before tool execution', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'publish',
      'name: block-publish\nenabled: true\nevent: bash\naction: block\npattern: npm\\s+publish',
      'Publishing requires an explicit release approval.'
    );
    const output = parseDecision(runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm publish --access public' },
      cwd: root,
    }));
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');

    assert.match(output.hookSpecificOutput.permissionDecisionReason, /block-publish/);
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /release approval/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('emits visible additionalContext for warning rules', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'warn-force',
      'name: warn-force\nenabled: true\nevent: bash\naction: warn\npattern: git\\s+push\\s+--force',
      'Prefer --force-with-lease.'
    );
    const output = parseDecision(runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push --force origin topic' },
    }));
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.match(output.hookSpecificOutput.additionalContext, /warn-force/);
    assert.match(output.hookSpecificOutput.additionalContext, /force-with-lease/);
    assert.ok(!output.hookSpecificOutput.permissionDecision);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('matches simple file rules against paths and edited content', () => {
  const root = createProject();
  try {
    writeRule(root, 'env-file', 'name: warn-env-file\nevent: file\npattern: \\.env$', 'Do not edit secrets directly.');
    writeRule(root, 'debugger', 'name: warn-debugger\nevent: file\npattern: debugger', 'Remove debugger statements.');

    const pathOutput = parseDecision(runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: path.join(root, '.env'), content: 'SAFE=value' },
    }));
    assert.match(pathOutput.hookSpecificOutput.additionalContext, /warn-env-file/);

    const contentOutput = parseDecision(runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/app.js', old_string: 'run();', new_string: 'debugger; run();' },
    }));
    assert.match(contentOutput.hookSpecificOutput.additionalContext, /warn-debugger/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('simple file rules do not match text that an Edit removes', () => {
  const root = createProject();
  try {
    writeRule(root, 'removed-debugger', 'name: warn-debugger\nevent: file\npattern: debugger', 'Remove debugger statements.');
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/app.js', old_string: 'debugger; run();', new_string: 'run();' },
    });
    assert.strictEqual(result.stdout, result.raw);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('supports advanced conditions and requires every condition to match', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'api-key',
      [
        'name: block-api-key',
        'event: file',
        'action: block',
        'conditions:',
        '  - field: file_path',
        '    operator: ends_with',
        '    pattern: .env',
        '  - field: content',
        '    operator: contains',
        '    pattern: API_KEY=',
      ].join('\n'),
      'Keep credentials out of tracked files.'
    );

    const matching = parseDecision(runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'config/.env', content: 'API_KEY=secret' },
    }));
    assert.strictEqual(matching.hookSpecificOutput.permissionDecision, 'deny');

    const postOutput = parseDecision(runHook(root, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'config/.env', content: 'API_KEY=secret' },
      tool_response: {},
    }));
    assert.strictEqual(postOutput.decision, 'block');

    const nonMatching = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'config/.env.example', content: 'API_KEY=placeholder' },
    });
    assert.strictEqual(nonMatching.stdout, nonMatching.raw);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('rejects a rule that combines pattern and conditions', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'ambiguous',
      'name: ambiguous\nevent: bash\npattern: npm\nconditions:\n  - field: command\n    operator: contains\n    pattern: publish',
      'Ambiguous rule.'
    );
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    });
    assert.strictEqual(result.stdout, result.raw);
    assert.match(result.stderr, /ambiguous/);
    assert.match(result.stderr, /either pattern or conditions/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('does not satisfy negative conditions when the requested field is absent', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'missing-field',
      'name: missing-field\nevent: bash\nconditions:\n  - field: file_path\n    operator: not_contains\n    pattern: vendor',
      'A missing file path must not match.'
    );
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'pwd' },
    });
    assert.strictEqual(result.stdout, result.raw);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('requires MultiEdit conditions to match the same edit item', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'correlated-edits',
      'name: correlated-edits\nevent: file\naction: block\nconditions:\n  - field: file_path\n    operator: ends_with\n    pattern: .env\n  - field: content\n    operator: contains\n    pattern: API_KEY=',
      'A single edit must satisfy both conditions.'
    );
    const split = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'MultiEdit',
      tool_input: { edits: [
        { file_path: 'config/.env', new_string: 'SAFE=value' },
        { file_path: 'src/constants.js', new_string: 'API_KEY=placeholder' },
      ] },
    });
    assert.strictEqual(split.stdout, split.raw);

    const correlated = parseDecision(runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'MultiEdit',
      tool_input: { edits: [
        { file_path: 'config/.env', new_string: 'API_KEY=secret' },
        { file_path: 'src/constants.js', new_string: 'SAFE=value' },
      ] },
    }));
    assert.strictEqual(correlated.hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('supports PowerShell and MultiEdit on the cross-platform aliases', () => {
  const root = createProject();
  try {
    writeRule(root, 'remove-item', 'name: warn-remove-item\nevent: bash\npattern: Remove-Item', 'Review recursive deletion.');
    writeRule(root, 'multi-edit', 'name: warn-eval\nevent: file\npattern: eval\\(', 'Avoid dynamic evaluation.');

    const shellOutput = parseDecision(runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'PowerShell',
      tool_input: { command: 'Remove-Item -Recurse build' },
    }));
    assert.match(shellOutput.hookSpecificOutput.additionalContext, /warn-remove-item/);

    const editOutput = parseDecision(runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'MultiEdit',
      tool_input: { edits: [{ file_path: 'a.js', new_string: 'eval(source)' }] },
    }));
    assert.match(editOutput.hookSpecificOutput.additionalContext, /warn-eval/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('bounds one simple rule to one isolated regex evaluation for large MultiEdit input', () => {
  const root = createProject();
  try {
    writeRule(root, 'large-multi', 'name: large-multi\nevent: file\npattern: sentinel$', 'Match the final edit.');
    const edits = Array.from({ length: 100 }, (_, index) => ({
      file_path: 'src/file-' + index + '.js',
      new_string: index === 99 ? 'sentinel' : 'ordinary content',
    }));
    const started = Date.now();
    const output = parseDecision(runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'MultiEdit',
      tool_input: { edits },
    }));
    assert.ok(Date.now() - started < 1000, 'large MultiEdit matching should stay bounded');
    assert.match(output.hookSpecificOutput.additionalContext, /large-multi/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('uses prompt input and the top-level block contract for UserPromptSubmit', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'production',
      'name: block-production-deploy\nevent: prompt\naction: block\npattern: deploy.*production',
      'Production deploys require a change ticket.'
    );
    const output = parseDecision(runHook(root, {
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Please deploy this service to production',
    }));
    assert.strictEqual(output.decision, 'block');
    assert.match(output.reason, /change ticket/);
    assert.ok(!output.hookSpecificOutput);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('blocks Stop once and skips recursive stop_hook_active events', () => {
  const root = createProject();
  try {
    writeRule(root, 'tests', 'name: require-tests\nevent: stop\naction: block\npattern: .*', 'Run the test suite before stopping.');

    const first = parseDecision(runHook(root, {
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Implementation is complete.',
    }));
    assert.strictEqual(first.decision, 'block');
    assert.match(first.reason, /Run the test suite/);

    const retry = runHook(root, {
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: 'Tests now pass.',
    });
    assert.strictEqual(retry.stdout, retry.raw);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('matches all-event rules while respecting tool_matcher', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'all-write',
      'name: warn-generated\nevent: all\ntool_matcher: Write|Edit\npattern: generated',
      'Confirm generated output is intentional.'
    );
    const edit = parseDecision(runHook(root, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/generated.js', new_string: 'export {}' },
      tool_response: {},
    }));
    assert.strictEqual(edit.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(edit.hookSpecificOutput.additionalContext, /warn-generated/);

    const bash = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'echo generated' },
    });
    assert.strictEqual(bash.stdout, bash.raw);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('all-event rules can match tool events outside bash and file aliases', () => {
  const root = createProject();
  try {
    writeRule(root, 'all-read', 'name: warn-sensitive-read\nevent: all\npattern: sensitive\\.json', 'Review access to sensitive data.');
    const output = parseDecision(runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: 'config/sensitive.json' },
    }));
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.match(output.hookSpecificOutput.additionalContext, /warn-sensitive-read/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('an all-event wildcard can match a Stop payload with no optional text', () => {
  const root = createProject();
  try {
    writeRule(root, 'all-stop', 'name: warn-all-stop\nevent: all\npattern: .*', 'Review the completed turn.');
    const output = parseDecision(runHook(root, {
      hook_event_name: 'Stop',
      stop_hook_active: false,
    }));
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'Stop');
    assert.match(output.hookSpecificOutput.additionalContext, /warn-all-stop/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('fails open on malformed YAML, invalid regex, and unsupported operators', () => {
  const root = createProject();
  try {
    fs.writeFileSync(path.join(root, '.claude', 'hookify.bad-yaml.local.md'), '---\nname: [\n---\nBad YAML');
    writeRule(root, 'bad-regex', 'name: bad-regex\nevent: bash\npattern: "("', 'Invalid regex');
    writeRule(
      root,
      'bad-condition',
      'name: bad-condition\nevent: bash\nconditions:\n  - field: command\n    operator: executes\n    pattern: npm',
      'Unsupported operator'
    );
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm publish' },
    });
    assert.strictEqual(result.stdout, result.raw);
    assert.match(result.stderr, /bad-yaml/);
    assert.match(result.stderr, /bad-regex/);
    assert.match(result.stderr, /bad-condition/);
    assert.doesNotMatch(result.stderr, /npm publish/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('rejects duplicate keys instead of silently changing rule semantics', () => {
  const root = createProject();
  try {
    writeRule(root, 'duplicate-action', 'name: duplicate-action\nevent: bash\naction: block\naction: warn\npattern: .*', 'Duplicate action.');
    writeRule(root, 'duplicate-condition', 'name: duplicate-condition\nevent: bash\nconditions:\n  - field: command\n    field: file_path\n    operator: contains\n    pattern: pwd', 'Duplicate field.');
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'pwd' },
    });
    assert.strictEqual(result.stdout, result.raw);
    assert.match(result.stderr, /duplicate-action/);
    assert.match(result.stderr, /duplicate-condition/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('rejects unknown keys instead of silently weakening a rule', () => {
  const root = createProject();
  try {
    writeRule(root, 'typo-action', 'name: typo-action\nevent: bash\nactions: block\npattern: .*', 'Typo must fail closed at rule level.');
    writeRule(root, 'typo-condition', 'name: typo-condition\nevent: bash\nconditions:\n  - field: command\n    operators: contains\n    pattern: pwd', 'Typo must not change matching.');
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'pwd' },
    });
    assert.strictEqual(result.stdout, result.raw);
    assert.match(result.stderr, /typo-action/);
    assert.match(result.stderr, /typo-condition/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('rejects common catastrophic-backtracking regex shapes', () => {
  const root = createProject();
  try {
    writeRule(root, 'nested-quantifier', 'name: nested-quantifier\nevent: bash\npattern: (a+)+$', 'Unsafe regex.');
    writeRule(root, 'nested-parens', 'name: nested-parens\nevent: bash\npattern: ((a)+)+$', 'Unsafe regex.');
    writeRule(root, 'ambiguous-alternative', 'name: ambiguous-alternative\nevent: bash\npattern: (a|aa)+$', 'Unsafe regex.');
    writeRule(root, 'repeated-wildcard', 'name: repeated-wildcard\nevent: bash\npattern: .*prefix.*suffix', 'Unsafe regex.');
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'a'.repeat(20000) + '!' },
    });
    assert.strictEqual(result.stdout, result.raw);
    assert.match(result.stderr, /nested-quantifier/);
    assert.match(result.stderr, /nested-parens/);
    assert.match(result.stderr, /ambiguous-alternative/);
    assert.match(result.stderr, /repeated-wildcard/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('hard-times out ReDoS shapes that pass static screening', () => {
  const root = createProject();
  try {
    writeRule(root, 'runtime-redos', 'name: runtime-redos\nevent: bash\npattern: a+a+$', 'Must time out safely.');
    const started = Date.now();
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'a'.repeat(60000) + '!' },
    });
    assert.ok(Date.now() - started < 1000, 'regex timeout must bound hook latency');
    assert.strictEqual(result.stdout, result.raw);
    assert.match(result.stderr, /regex evaluation exceeded/);
    assert.doesNotMatch(result.stderr, /a\+a\+/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('a timed-out blocking rule fails closed', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'timeout-block',
      'name: timeout-block\nevent: bash\naction: block\npattern: a+a+$|BLOCK_ME',
      'Timed-out blocking rules require review.'
    );
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'a'.repeat(60000) + '! BLOCK_ME' },
    });
    const output = parseDecision(result);
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /Timed-out blocking rules/);
    assert.match(result.stderr, /regex evaluation exceeded/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('a timed-out rule cannot suppress a later valid blocking rule', () => {
  const root = createProject();
  try {
    writeRule(root, 'aaa-timeout', 'name: aaa-timeout\nevent: bash\npattern: a+a+$', 'Must time out safely.');
    writeRule(root, 'zzz-block', 'name: zzz-block\nevent: bash\naction: block\npattern: !$', 'The later rule must still block.');
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'a'.repeat(60000) + '!' },
    });
    const output = parseDecision(result);
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /zzz-block/);
    assert.match(result.stderr, /regex evaluation exceeded/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('caps rule files and emitted messages without producing invalid JSON', () => {
  const root = createProject();
  try {
    fs.writeFileSync(
      path.join(root, '.claude', 'hookify.oversized.local.md'),
      '---\nname: oversized\nevent: bash\npattern: .*\n---\n' + 'x'.repeat(runtime.MAX_RULE_BYTES + 1)
    );
    writeRule(root, 'long-message', 'name: long-message\nevent: bash\npattern: .*', 'm'.repeat(runtime.MAX_MESSAGE_CHARS * 2));
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'pwd' },
    });
    const output = parseDecision(result);
    assert.ok(output.hookSpecificOutput.additionalContext.length <= runtime.MAX_MESSAGE_CHARS);
    assert.match(result.stderr, /oversized/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('blocking rules inspect content beyond 64 KiB and MultiEdit entry 100', () => {
  const root = createProject();
  try {
    writeRule(root, 'deep-content', 'name: deep-content\nevent: file\naction: block\npattern: BLOCK_ME', 'Deep content must be checked.');
    const writeOutput = parseDecision(runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'large.txt', content: 'x'.repeat(70 * 1024) + 'BLOCK_ME' },
    }));
    assert.strictEqual(writeOutput.hookSpecificOutput.permissionDecision, 'deny');

    const edits = Array.from({ length: 101 }, (_, index) => ({
      file_path: 'src/file-' + index + '.js',
      new_string: index === 100 ? 'BLOCK_ME' : 'safe',
    }));
    const multiOutput = parseDecision(runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'MultiEdit',
      tool_input: { edits },
    }));
    assert.strictEqual(multiOutput.hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('condition evaluation budget fails closed for an uninspected blocking rule', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'budget',
      'name: budget\nevent: file\naction: block\nconditions:\n  - field: file_path\n    operator: equals\n    pattern: never-match',
      'Every edit must be inspected.'
    );
    const edits = Array.from(
      { length: runtime.MAX_RULE_EVALUATIONS + 1 },
      (_, index) => ({ file_path: 'src/file-' + index + '.js', new_string: 'safe' })
    );
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'MultiEdit',
      tool_input: { edits },
    });
    const output = parseDecision(result);
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(result.stderr, /evaluation budget exceeded/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

if (test('a warning cannot consume the budget and hide a later blocking rule', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'aaa-warning',
      'name: budget-warning\nevent: file\naction: warn\nconditions:\n  - field: file_path\n    operator: equals\n    pattern: never-match',
      'Warning only.'
    );
    writeRule(
      root,
      'zzz-block',
      'name: budget-block\nevent: file\naction: block\nconditions:\n  - field: content\n    operator: contains\n    pattern: BLOCK_ME',
      'Uninspected edits must be blocked.'
    );
    const edits = Array.from(
      { length: runtime.MAX_RULE_EVALUATIONS },
      (_, index) => ({ file_path: 'src/file-' + index + '.js', new_string: 'safe' })
    );
    const result = runHook(root, {
      hook_event_name: 'PreToolUse',
      tool_name: 'MultiEdit',
      tool_input: { edits },
    });
    const output = parseDecision(result);
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(output.hookSpecificOutput.permissionDecisionReason, /Uninspected edits/);
    assert.match(result.stderr, /evaluation budget exceeded/);
  } finally {
    removeProject(root);
  }
})) passed++; else failed++;

console.log('\nPassed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed > 0 ? 1 : 0);
