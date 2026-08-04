/**
 * Tests for session-activity-tracker.js hook.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'hooks',
  'session-activity-tracker.js'
);
const {
  buildActivityRow,
  extractFileEvents,
  extractFilePaths,
  summarizeOutput,
  run,
} = require(script);

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'session-activity-tracker-test-'));
}

function withTempHome(homeDir) {
  return {
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
}

function runScript(input, envOverrides = {}, options = {}) {
  const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [script], {
    encoding: 'utf8',
    input: inputStr,
    timeout: 10000,
    env: { ...process.env, ...envOverrides },
    cwd: options.cwd,
  });
  return { code: result.status || 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function readMetricRows(homeDir) {
  const metricsFile = path.join(homeDir, '.claude', 'metrics', 'tool-usage.jsonl');
  return fs.readFileSync(metricsFile, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function runTests() {
  console.log('\n=== Testing session-activity-tracker.js ===\n');

  let passed = 0;
  let failed = 0;

  (test('passes through input on stdout', () => {
    const input = {
      tool_name: 'Read',
      tool_input: { file_path: 'README.md' },
      tool_output: { output: 'ok' },
    };
    const inputStr = JSON.stringify(input);
    const result = runScript(input, {
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'sess-123',
    });
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, inputStr);
  }) ? passed++ : failed++);

  (test('creates tool activity metrics rows with file paths', () => {
    const tmpHome = makeTempDir();
    const input = {
      tool_name: 'Write',
      tool_input: {
        file_path: 'src/app.rs',
      },
      tool_output: { output: 'wrote src/app.rs' },
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'ecc-session-1234',
    });
    assert.strictEqual(result.code, 0);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'tool-usage.jsonl');
    assert.ok(fs.existsSync(metricsFile), `Expected metrics file at ${metricsFile}`);

    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.strictEqual(row.session_id, 'ecc-session-1234');
    assert.strictEqual(row.tool_name, 'Write');
    assert.strictEqual(row.input_params_json, '{"file_path":"src/app.rs"}');
    assert.deepStrictEqual(row.file_paths, ['src/app.rs']);
    assert.deepStrictEqual(row.file_events, [{ path: 'src/app.rs', action: 'create' }]);
    assert.ok(row.id, 'Expected stable event id');
    assert.ok(row.timestamp, 'Expected timestamp');

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('captures typed move file events from source/destination inputs', () => {
    const tmpHome = makeTempDir();
    const input = {
      tool_name: 'Move',
      tool_input: {
        source_path: 'src/old.rs',
        destination_path: 'src/new.rs',
      },
      tool_output: { output: 'moved file' },
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'ecc-session-5678',
    });
    assert.strictEqual(result.code, 0);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'tool-usage.jsonl');
    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.deepStrictEqual(row.file_paths, ['src/old.rs', 'src/new.rs']);
    assert.deepStrictEqual(row.file_events, [
      { path: 'src/old.rs', action: 'move' },
      { path: 'src/new.rs', action: 'move' },
    ]);

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('captures replacement diff previews for edit tool input', () => {
    const tmpHome = makeTempDir();
    const input = {
      tool_name: 'Edit',
      tool_input: {
        file_path: 'src/config.ts',
        old_string: 'API_URL=http://localhost:3000',
        new_string: 'API_URL=https://api.example.com',
      },
      tool_output: { output: 'updated config' },
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'ecc-session-edit',
    });
    assert.strictEqual(result.code, 0);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'tool-usage.jsonl');
    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.deepStrictEqual(row.file_events, [
      {
        path: 'src/config.ts',
        action: 'modify',
        diff_preview: 'API_URL=http://localhost:3000 -> API_URL=https://api.example.com',
        patch_preview: '@@\n- API_URL=http://localhost:3000\n+ API_URL=https://api.example.com',
      },
    ]);

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('captures MultiEdit nested edits with typed diff previews', () => {
    const tmpHome = makeTempDir();
    const input = {
      tool_name: 'MultiEdit',
      tool_input: {
        edits: [
          {
            file_path: 'src/a.ts',
            old_string: 'const a = 1;',
            new_string: 'const a = 2;',
          },
          {
            file_path: 'src/b.ts',
            old_string: 'old name',
            new_string: 'new name',
          },
        ],
      },
      tool_output: { output: 'updated two files' },
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'ecc-session-multiedit',
    });
    assert.strictEqual(result.code, 0);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'tool-usage.jsonl');
    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.deepStrictEqual(row.file_paths, ['src/a.ts', 'src/b.ts']);
    assert.deepStrictEqual(row.file_events, [
      {
        path: 'src/a.ts',
        action: 'modify',
        diff_preview: 'const a = 1; -> const a = 2;',
        patch_preview: '@@\n- const a = 1;\n+ const a = 2;',
      },
      {
        path: 'src/b.ts',
        action: 'modify',
        diff_preview: 'old name -> new name',
        patch_preview: '@@\n- old name\n+ new name',
      },
    ]);

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('reclassifies tracked Write activity as modify using git diff context', () => {
    const tmpHome = makeTempDir();
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-activity-tracker-repo-'));

    spawnSync('git', ['init'], { cwd: repoDir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'ecc@example.com'], { cwd: repoDir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.name', 'ECC Tests'], { cwd: repoDir, encoding: 'utf8' });

    const srcDir = path.join(repoDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const trackedFile = path.join(srcDir, 'app.ts');
    fs.writeFileSync(trackedFile, 'const count = 1;\n', 'utf8');
    spawnSync('git', ['add', 'src/app.ts'], { cwd: repoDir, encoding: 'utf8' });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: repoDir, encoding: 'utf8' });

    fs.writeFileSync(trackedFile, 'const count = 2;\n', 'utf8');

    const input = {
      tool_name: 'Write',
      tool_input: {
        file_path: 'src/app.ts',
        content: 'const count = 2;\n',
      },
      tool_output: { output: 'updated src/app.ts' },
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'ecc-session-write-modify',
    }, {
      cwd: repoDir,
    });
    assert.strictEqual(result.code, 0);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'tool-usage.jsonl');
    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.deepStrictEqual(row.file_events, [
      {
        path: 'src/app.ts',
        action: 'modify',
        diff_preview: 'const count = 1; -> const count = 2;',
        patch_preview: '@@ -1 +1 @@\n-const count = 1;\n+const count = 2;',
      },
    ]);

    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('captures tracked Delete activity using git diff context', () => {
    const tmpHome = makeTempDir();
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-activity-tracker-delete-repo-'));

    spawnSync('git', ['init'], { cwd: repoDir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'ecc@example.com'], { cwd: repoDir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.name', 'ECC Tests'], { cwd: repoDir, encoding: 'utf8' });

    const srcDir = path.join(repoDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const trackedFile = path.join(srcDir, 'obsolete.ts');
    fs.writeFileSync(trackedFile, 'export const obsolete = true;\n', 'utf8');
    spawnSync('git', ['add', 'src/obsolete.ts'], { cwd: repoDir, encoding: 'utf8' });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: repoDir, encoding: 'utf8' });

    fs.rmSync(trackedFile, { force: true });

    const input = {
      tool_name: 'Delete',
      tool_input: {
        file_path: 'src/obsolete.ts',
      },
      tool_output: { output: 'deleted src/obsolete.ts' },
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'ecc-session-delete',
    }, {
      cwd: repoDir,
    });
    assert.strictEqual(result.code, 0);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'tool-usage.jsonl');
    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.deepStrictEqual(row.file_events, [
      {
        path: 'src/obsolete.ts',
        action: 'delete',
        diff_preview: 'export const obsolete = true; ->',
        patch_preview: '@@ -1 +0,0 @@\n-export const obsolete = true;',
      },
    ]);

    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('resolves repo-relative paths even when the hook runs from a nested cwd', () => {
    const tmpHome = makeTempDir();
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-activity-tracker-nested-repo-'));

    spawnSync('git', ['init'], { cwd: repoDir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'ecc@example.com'], { cwd: repoDir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.name', 'ECC Tests'], { cwd: repoDir, encoding: 'utf8' });

    const srcDir = path.join(repoDir, 'src');
    const nestedCwd = path.join(repoDir, 'subdir');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(nestedCwd, { recursive: true });

    const trackedFile = path.join(srcDir, 'app.ts');
    fs.writeFileSync(trackedFile, 'const count = 1;\n', 'utf8');
    spawnSync('git', ['add', 'src/app.ts'], { cwd: repoDir, encoding: 'utf8' });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: repoDir, encoding: 'utf8' });

    fs.writeFileSync(trackedFile, 'const count = 2;\n', 'utf8');

    const input = {
      tool_name: 'Write',
      tool_input: {
        file_path: 'src/app.ts',
        content: 'const count = 2;\n',
      },
      tool_output: { output: 'updated src/app.ts' },
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'ecc-session-nested-cwd',
    }, {
      cwd: nestedCwd,
    });
    assert.strictEqual(result.code, 0);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'tool-usage.jsonl');
    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.deepStrictEqual(row.file_events, [
      {
        path: 'src/app.ts',
        action: 'modify',
        diff_preview: 'const count = 1; -> const count = 2;',
        patch_preview: '@@ -1 +1 @@\n-const count = 1;\n+const count = 2;',
      },
    ]);

    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('prefers ECC_SESSION_ID over CLAUDE_SESSION_ID and redacts bash summaries', () => {
    const tmpHome = makeTempDir();
    const input = {
      tool_name: 'Bash',
      tool_input: {
        command: 'curl --token abc123 -H "Authorization: Bearer topsecret" https://example.com',
      },
      tool_output: { output: 'done' },
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'ecc-session-1',
      CLAUDE_SESSION_ID: 'claude-session-2',
    });
    assert.strictEqual(result.code, 0);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'tool-usage.jsonl');
    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.strictEqual(row.session_id, 'ecc-session-1');
    assert.ok(row.input_summary.includes('<REDACTED>'));
    assert.ok(!row.input_summary.includes('abc123'));
    assert.ok(!row.input_summary.includes('topsecret'));
    assert.ok(row.input_params_json.includes('<REDACTED>'));
    assert.ok(!row.input_params_json.includes('abc123'));
    assert.ok(!row.input_params_json.includes('topsecret'));

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('handles invalid JSON gracefully', () => {
    const tmpHome = makeTempDir();
    const invalidInput = 'not valid json {{{';
    const result = runScript(invalidInput, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'sess-123',
    });
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, invalidInput);

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('skips non-PostToolUse events and rows without required identifiers', () => {
    assert.strictEqual(buildActivityRow(
      { tool_name: 'Read', tool_input: { file_path: 'README.md' } },
      { CLAUDE_HOOK_EVENT_NAME: 'PreToolUse', ECC_SESSION_ID: 'sess' }
    ), null);
    assert.strictEqual(buildActivityRow(
      { tool_name: 'Read', tool_input: { file_path: 'README.md' } },
      { CLAUDE_HOOK_EVENT_NAME: 'PostToolUse' }
    ), null);
    assert.strictEqual(buildActivityRow(
      { tool_input: { file_path: 'README.md' } },
      { CLAUDE_HOOK_EVENT_NAME: 'PostToolUse', ECC_SESSION_ID: 'sess' }
    ), null);
  }) ? passed++ : failed++);

  (test('sanitizes nested params, long summaries, and output variants', () => {
    const longValue = `start ${'x'.repeat(260)} ghp_${'A'.repeat(20)}`;
    const row = buildActivityRow(
      {
        tool_name: 'Lookup',
        tool_input: {
          query: longValue,
          secret: `gho_${'B'.repeat(20)}`,
          count: 3,
          enabled: false,
          omitted: null,
          nested: { a: { b: { c: { d: 'too deep' } } } },
          list: [1, true, null, 4],
        },
        tool_output: `line one\nline two ${'y'.repeat(260)}`,
      },
      { CLAUDE_HOOK_EVENT_NAME: 'PostToolUse', CLAUDE_SESSION_ID: 'claude-fallback' }
    );

    assert.strictEqual(row.session_id, 'claude-fallback');
    assert.strictEqual(row.file_paths.length, 0);
    assert.ok(row.input_summary.endsWith('...'), 'Expected long shallow summary to be truncated');
    assert.ok(!row.input_summary.includes('ghp_'), 'Expected GitHub token redaction in input summary');
    assert.ok(row.output_summary.endsWith('...'), 'Expected long output summary to be truncated');
    assert.ok(!row.output_summary.includes('\n'), 'Expected output summary to normalize whitespace');

    const params = JSON.parse(row.input_params_json);
    assert.strictEqual(params.count, 3);
    assert.strictEqual(params.enabled, false);
    assert.strictEqual(params.omitted, null);
    assert.strictEqual(params.secret, '<REDACTED>');
    assert.strictEqual(params.nested.a.b.c, '[Truncated]');
    assert.deepStrictEqual(params.list.slice(0, 3), [1, true, null]);
    assert.strictEqual(params.list[3], 4);
    assert.ok(params.query.endsWith('...'), 'Expected long param value to be truncated');

    assert.strictEqual(summarizeOutput(null), '');
    assert.strictEqual(summarizeOutput(undefined), '');
    assert.strictEqual(summarizeOutput('hello\nworld'), 'hello world');
    assert.strictEqual(summarizeOutput({ ok: true }), '{"ok":true}');
  }) ? passed++ : failed++);

  (test('extracts file paths from nested arrays while filtering duplicates and remote URIs', () => {
    const paths = extractFilePaths({
      file_paths: [
        'src/a.js',
        'src/a.js',
        'https://example.com/file.js',
        '',
        { file_path: 'src/b.js' },
      ],
      nested: {
        source_path: 'app://connector/item',
        deep: [
          { new_file_path: 'src/c.js' },
          { old_file_path: 'plugin://plugin/item' },
          42,
        ],
      },
      ignored: 'not-a-path-field',
    });

    assert.deepStrictEqual(paths, ['src/a.js', 'src/b.js', 'src/c.js']);
    assert.deepStrictEqual(extractFilePaths(null), []);
    assert.deepStrictEqual(extractFilePaths('src/not-collected.js'), []);
  }) ? passed++ : failed++);

  (test('extracts file event previews for create delete and one-sided edits', () => {
    const events = extractFileEvents('Write', {
      files: [
        {
          file_path: 'src/new.ts',
          content: 'first line\nsecond line',
        },
        {
          file_path: 'src/new.ts',
          content: 'first line\nsecond line',
        },
        {
          file_path: 'https://example.com/remote.ts',
          content: 'ignored',
        },
      ],
    });
    assert.deepStrictEqual(events, [
      {
        path: 'src/new.ts',
        action: 'create',
        diff_preview: '+ first line second line',
        patch_preview: '+ first line second line',
      },
    ]);

    assert.deepStrictEqual(extractFileEvents('Remove', {
      file_path: 'src/old.ts',
      content: 'legacy line',
    }), [
      {
        path: 'src/old.ts',
        action: 'delete',
        patch_preview: '- legacy line',
      },
    ]);

    assert.deepStrictEqual(extractFileEvents('Edit', {
      edits: [
        { file_path: 'src/before.ts', old_string: 'legacy', new_string: '' },
        { file_path: 'src/after.ts', old_string: '', new_string: 'modern' },
        { file_path: 'src/no-preview.ts', old_string: '', new_string: '' },
      ],
    }), [
      {
        path: 'src/before.ts',
        action: 'modify',
        diff_preview: 'legacy ->',
        patch_preview: '@@\n- legacy',
      },
      {
        path: 'src/after.ts',
        action: 'modify',
        diff_preview: '-> modern',
        patch_preview: '@@\n+ modern',
      },
      { path: 'src/no-preview.ts', action: 'modify' },
    ]);

    assert.deepStrictEqual(extractFileEvents('Rename', {
      old_file_path: 'src/old-name.ts',
      new_file_path: 'src/new-name.ts',
    }), [
      { path: 'src/old-name.ts', action: 'move' },
      { path: 'src/new-name.ts', action: 'move' },
    ]);

    assert.deepStrictEqual(extractFileEvents('Read', null), []);
    assert.deepStrictEqual(extractFileEvents('Touch', { file_path: 'src/touched.ts' }), [
      { path: 'src/touched.ts', action: 'touch' },
    ]);
  }) ? passed++ : failed++);

  (test('records creation previews unchanged when running outside a git repository', () => {
    const tmpHome = makeTempDir();
    const tmpCwd = makeTempDir();

    const input = {
      tool_name: 'Write',
      tool_input: {
        file_path: 'created.txt',
        content: 'alpha\nbeta',
      },
      tool_output: 17,
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'ecc-session-non-git-create',
    }, {
      cwd: tmpCwd,
    });

    assert.strictEqual(result.code, 0);
    const [row] = readMetricRows(tmpHome);
    assert.strictEqual(row.output_summary, '17');
    assert.deepStrictEqual(row.file_events, [
      {
        path: 'created.txt',
        action: 'create',
        diff_preview: '+ alpha beta',
        patch_preview: '+ alpha beta',
      },
    ]);

    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('preserves absolute paths outside the repo without git enrichment', () => {
    const tmpHome = makeTempDir();
    const outsideDir = makeTempDir();
    const outsideFile = path.join(outsideDir, 'outside.txt');
    fs.writeFileSync(outsideFile, 'outside', 'utf8');

    const input = {
      tool_name: 'Read',
      tool_input: {
        file_path: outsideFile,
      },
      tool_output: 'read outside',
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'ecc-session-absolute-outside',
    });

    assert.strictEqual(result.code, 0);
    const [row] = readMetricRows(tmpHome);
    assert.deepStrictEqual(row.file_paths, [outsideFile]);
    assert.deepStrictEqual(row.file_events, [
      { path: outsideFile, action: 'read' },
    ]);

    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }) ? passed++ : failed++);

  (test('passes empty stdin through without creating metrics', () => {
    const tmpHome = makeTempDir();
    const result = runScript('', {
      ...withTempHome(tmpHome),
      CLAUDE_HOOK_EVENT_NAME: 'PostToolUse',
      ECC_SESSION_ID: 'sess-empty',
    });

    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(run(''), '');
    assert.strictEqual(
      fs.existsSync(path.join(tmpHome, '.claude', 'metrics', 'tool-usage.jsonl')),
      false
    );

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
