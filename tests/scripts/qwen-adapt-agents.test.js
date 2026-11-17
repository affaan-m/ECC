/**
 * Tests for scripts/qwen-adapt-agents.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'qwen-adapt-agents.js');

function run(args = [], options = {}) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      timeout: 10000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
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

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-qwen-adapt-'));
}

function cleanupTempDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeAgent(dirPath, name, body) {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, name), body);
}

function readAgent(dirPath, name) {
  return fs.readFileSync(path.join(dirPath, name), 'utf8');
}

function runTests() {
  console.log('\n=== Testing qwen-adapt-agents.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('shows help with an explicit help flag', () => {
    const result = run(['--help']);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('Adapt ECC agent frontmatter for Qwen Code'));
    assert.ok(result.stdout.includes('Usage:'));
  })) passed++; else failed++;

  if (test('maps Claude Code tool names to Qwen Code ids', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'gan-planner.md',
        [
          '---',
          'name: gan-planner',
          'description: Planner agent',
          'tools: [Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch]',
          'model: opus',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Updated 1 agent file(s)'));

      const updated = readAgent(agentsDir, 'gan-planner.md');
      // Edit maps to `edit`, not Gemini's `replace`. WebSearch maps to
      // `web_search`, not Gemini's `google_web_search`.
      assert.ok(updated.includes('tools: read_file, write_file, edit, run_shell_command, grep_search, glob, web_search, web_fetch'));
      assert.ok(updated.includes('model: inherit'));
      assert.ok(!updated.includes('model: opus'));
      assert.ok(!updated.includes('WebSearch'));
      assert.ok(!updated.includes('WebFetch'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('preserves the mcp__server__tool shape', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'docs-lookup.md',
        [
          '---',
          'name: docs-lookup',
          'description: Documentation lookup agent',
          'tools: Read, Grep, mcp__context7__resolve-library-id, mcp__context7__query-docs',
          'model: sonnet',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);

      const updated = readAgent(agentsDir, 'docs-lookup.md');
      // Unlike Gemini, which lowercases these to mcp_context7_resolve_library_id,
      // Qwen Code keeps the double-underscore form.
      assert.ok(updated.includes('tools: read_file, grep_search, mcp__context7__resolve-library-id, mcp__context7__query-docs'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('deduplicates MultiEdit and Edit onto a single edit entry', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'code-simplifier.md',
        [
          '---',
          'name: code-simplifier',
          'description: Refactoring agent',
          'tools: Read, Edit, MultiEdit, Write',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);

      const updated = readAgent(agentsDir, 'code-simplifier.md');
      assert.ok(updated.includes('tools: read_file, edit, write_file'));
      assert.strictEqual(updated.split('edit').length - 1, 1);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('remaps an out-of-palette color instead of dropping it', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'harness-optimizer.md',
        [
          '---',
          'name: harness-optimizer',
          'description: Harness tuning agent',
          'tools: Read, Grep',
          'color: teal',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);

      // Qwen Code supports color:, but only red/blue/green/yellow/purple/orange/
      // pink/cyan/auto. An unlisted value is dropped at load time with a
      // warning, so teal is remapped to its nearest valid equivalent.
      const updated = readAgent(agentsDir, 'harness-optimizer.md');
      assert.ok(updated.includes('color: cyan'));
      assert.ok(!updated.includes('color: teal'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('adapts color with long whitespace through the actual CLI', () => {
    const tempDir = createTempDir();
    try {
      const tabs = '\t'.repeat(250000);
      writeAgent(tempDir, 'color.md', ['---', 'name: color', 'tools: Read', `color:${tabs}teal${tabs}`, '---', 'BODY'].join('\n'));
      const result = run([tempDir]);
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(readAgent(tempDir, 'color.md').includes('color: cyan'));
      const before = readAgent(tempDir, 'color.md');
      assert.strictEqual(run([tempDir]).code, 0);
      assert.strictEqual(readAgent(tempDir, 'color.md'), before);
    } finally { cleanupTempDir(tempDir); }
  })) passed++; else failed++;

  if (test('leaves an already-compatible agent untouched', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'security-reviewer.md',
        [
          '---',
          'name: security-reviewer',
          'description: Security agent',
          'tools: read_file, grep_search',
          'color: red',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const before = readAgent(agentsDir, 'security-reviewer.md');
      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Updated 0 agent file(s)'));
      assert.ok(result.stdout.includes('1 already compatible'));
      // A color inside the palette and Qwen-native tool ids need no rewrite.
      assert.strictEqual(readAgent(agentsDir, 'security-reviewer.md'), before);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('leaves the agent body untouched', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');
    const body = ['', 'Read the codebase, then Write a summary.', 'Use Bash only when needed.'].join('\n');

    try {
      writeAgent(
        agentsDir,
        'code-explorer.md',
        ['---', 'name: code-explorer', 'tools: Read, Bash', '---', body].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);

      const updated = readAgent(agentsDir, 'code-explorer.md');
      // Prose that names Claude tools must survive: only frontmatter is in scope.
      assert.ok(updated.endsWith(body));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('is idempotent on a second run', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'architect.md',
        ['---', 'name: architect', 'tools: Read, Grep, Glob', 'color: teal', '---', '', 'Body'].join('\n')
      );

      const first = run([agentsDir]);
      assert.strictEqual(first.code, 0, first.stderr);
      assert.ok(first.stdout.includes('Updated 1 agent file(s)'));
      const afterFirst = readAgent(agentsDir, 'architect.md');

      const second = run([agentsDir]);
      assert.strictEqual(second.code, 0, second.stderr);
      assert.ok(second.stdout.includes('Updated 0 agent file(s)'));
      assert.ok(second.stdout.includes('1 already compatible'));
      assert.strictEqual(readAgent(agentsDir, 'architect.md'), afterFirst);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('defaults to the cwd .qwen/agents directory', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'planner.md',
        ['---', 'name: planner', 'tools: ["Read", "Grep", "Glob"]', '---', '', 'Body'].join('\n')
      );

      const result = run([], { cwd: tempDir });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(readAgent(agentsDir, 'planner.md').includes('tools: read_file, grep_search, glob'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('fails with a clear error when the agents directory is missing', () => {
    const tempDir = createTempDir();

    try {
      const result = run([path.join(tempDir, 'nope')]);
      assert.strictEqual(result.code, 1);
      assert.ok(result.stderr.includes('Agents directory not found'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('adapts a CRLF agent and preserves its line endings', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'windows.md',
        ['---', 'name: windows', 'tools: Read, Bash', 'color: teal', '---', '', 'Body line'].join('\r\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);
      // A CRLF-only match used to report "already compatible" while leaving
      // Read/Bash/teal in place, so assert the update actually happened.
      assert.ok(result.stdout.includes('Updated 1 agent file(s)'), result.stdout);

      const updated = readAgent(agentsDir, 'windows.md');
      assert.ok(updated.includes('tools: read_file, run_shell_command'));
      assert.ok(updated.includes('color: cyan'));
      assert.ok(!updated.includes('Read,'));
      assert.ok(updated.includes('\r\n'), 'CRLF endings were lost');
      assert.ok(!/[^\r]\n/.test(updated), 'found a bare LF in a CRLF file');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('rejects an unknown flag without modifying any file', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'architect.md',
        ['---', 'name: architect', 'tools: Read, Bash', '---', '', 'Body'].join('\n')
      );
      const before = readAgent(agentsDir, 'architect.md');

      const result = run(['--dry-run', agentsDir]);
      assert.strictEqual(result.code, 1);
      assert.ok(result.stderr.includes('Unknown option: --dry-run'), result.stderr);
      // The point of rejecting: a flag that looks like a preview must not
      // rewrite installed agents and still exit 0.
      assert.strictEqual(readAgent(agentsDir, 'architect.md'), before);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('rejects an empty allowlist before writing any agent in the CLI batch', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');
    try {
      for (const emptyTools of ['[]', '[] # no tools', '', 'null', '""']) {
        writeAgent(agentsDir, 'a-valid.md', ['---', 'name: valid', 'tools: Read', 'model: sonnet', '---', 'VALID_BODY'].join('\n'));
        writeAgent(agentsDir, 'z-no-tools.md', ['---', 'name: no-tools', `tools: ${emptyTools}`, 'model: sonnet', '---', 'NO_TOOLS_BODY'].join('\n'));
        writeAgent(agentsDir, 'ignored.txt', 'UNCHANGED');
        const snapshot = () => fs.readdirSync(agentsDir).sort().map(name => [name, fs.readFileSync(path.join(agentsDir, name)).toString('base64')]);
        const before = snapshot();
        for (let attempt = 0; attempt < 2; attempt++) {
          const result = run([agentsDir]);
          assert.strictEqual(result.code, 1, result.stdout);
          assert.match(result.stderr, /z-no-tools.md: Unsupported empty tools allowlist/);
          assert.match(result.stderr, /inherits all tools/);
          assert.deepStrictEqual(snapshot(), before);
        }
      }
    } finally { cleanupTempDir(tempDir); }
  })) passed++; else failed++;

  if (test('adapts a nonempty YAML block list without leftover tool entries', () => {
    const { adaptFrontmatter } = require(SCRIPT);
    const yaml = require('js-yaml');
    const result = adaptFrontmatter(['---', 'name: block-tools', 'description: Neighbor metadata', 'tools:', '  - Read', '', '# Tool list comment', '  - Grep', 'model: sonnet', 'metadata:', '  owner: operator', '---', 'BODY'].join('\n'));
    const parsed = yaml.load(result.text.match(/^---\n([\s\S]*?)\n---/)[1]);
    assert.strictEqual(parsed.tools, 'read_file, grep_search');
    assert.strictEqual(parsed.model, 'inherit');
    assert.strictEqual(parsed.description, 'Neighbor metadata');
    assert.deepStrictEqual(parsed.metadata, { owner: 'operator' });
    assert.strictEqual(adaptFrontmatter(result.text).changed, false);
  })) passed++; else failed++;

  if (test('converts indentless tool sequences through the actual CLI without changing neighboring metadata', () => {
    const tempDir = createTempDir();
    const yaml = require('js-yaml');
    try {
      for (const [name, items] of [['plain.md', '- Read\n- Grep'], ['comments.md', '- Read\n# Keep the list valid\n- Grep']]) {
        writeAgent(tempDir, name, [
          '---', `name: ${name.slice(0, -3)}`, 'description: Preserve neighboring metadata',
          'metadata:', '  color: teal', '  owner: operator',
          'tools:', items, 'model: sonnet', '---', 'BODY_SENTINEL',
        ].join('\n'));
      }
      const first = run([tempDir]);
      assert.strictEqual(first.code, 0, first.stderr);
      const beforeRerun = fs.readdirSync(tempDir).sort().map(name => [name, readAgent(tempDir, name)]);
      for (const [, text] of beforeRerun) {
        const parsed = yaml.load(text.match(/^---\n([\s\S]*?)\n---/)[1]);
        assert.strictEqual(parsed.tools, 'read_file, grep_search');
        assert.strictEqual(parsed.model, 'inherit');
        assert.strictEqual(parsed.description, 'Preserve neighboring metadata');
        assert.deepStrictEqual(parsed.metadata, { color: 'teal', owner: 'operator' });
        assert.ok(text.endsWith('BODY_SENTINEL'));
      }
      assert.strictEqual(run([tempDir]).code, 0);
      assert.deepStrictEqual(fs.readdirSync(tempDir).sort().map(name => [name, readAgent(tempDir, name)]), beforeRerun);
    } finally { cleanupTempDir(tempDir); }
  })) passed++; else failed++;

  if (test('a real managed plan installs parseable indentless tool sequences', () => {
    const { createManifestInstallPlan, previewInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
    const yaml = require('js-yaml');
    const tempDir = createTempDir();
    try {
      const plan = createManifestInstallPlan({
        sourceRoot: path.join(__dirname, '..', '..'), target: 'qwen',
        homeDir: path.join(tempDir, 'home'), projectRoot: tempDir,
        moduleIds: ['agents-core'], env: { HOME: path.join(tempDir, 'home') },
      });
      const operation = plan.operations.find(item => item.contentTransform === 'qwen-agent-frontmatter');
      assert.ok(operation);
      const source = path.join(tempDir, 'source.md');
      fs.writeFileSync(source, ['---', 'name: sequence', 'description: Valid tools',
        'tools:', '- Read', '- Grep', 'model: sonnet', '---', 'MANAGED_BODY'].join('\n'));
      operation.sourcePath = source;
      previewInstallPlan(plan);
      applyInstallPlan(plan);
      const installed = fs.readFileSync(operation.destinationPath, 'utf8');
      const parsed = yaml.load(installed.match(/^---\n([\s\S]*?)\n---/)[1]);
      assert.strictEqual(parsed.tools, 'read_file, grep_search');
      assert.strictEqual(parsed.model, 'inherit');
      assert.ok(installed.endsWith('MANAGED_BODY'));
      assert.ok(fs.existsSync(plan.installStatePath));
    } finally { cleanupTempDir(tempDir); }
  })) passed++; else failed++;

  if (test('rejects an invalid converted alias before changing any standalone file', () => {
    const tempDir = createTempDir();
    try {
      writeAgent(tempDir, 'a-valid.md', ['---', 'name: valid', 'tools: Read', '---', 'BODY'].join('\n'));
      writeAgent(tempDir, 'z-alias.md', ['---', 'name: alias', 'tools: &allowed', '- Read',
        'metadata:', '  allowed: *allowed', '---', 'ALIAS_BODY'].join('\n'));
      const before = fs.readdirSync(tempDir).sort().map(name => [name, readAgent(tempDir, name)]);
      const result = run([tempDir]);
      assert.strictEqual(result.code, 1);
      assert.match(result.stderr, /transformed YAML is invalid/);
      assert.deepStrictEqual(fs.readdirSync(tempDir).sort().map(name => [name, readAgent(tempDir, name)]), before);
    } finally { cleanupTempDir(tempDir); }
  })) passed++; else failed++;

  if (test('rejects uniformly indented mappings without changing neighboring metadata', () => {
    const tempDir = createTempDir();
    try {
      const source = ['---', '  name: indented', '  description: Preserve me', '  tools:', '    - Read', '    - Grep', '  model: sonnet', '---', 'BODY'].join('\n');
      writeAgent(tempDir, 'indented.md', source);
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = run([tempDir]);
        assert.strictEqual(result.code, 1);
        assert.match(result.stderr, /Unsupported indented Qwen agent frontmatter/);
        assert.strictEqual(readAgent(tempDir, 'indented.md'), source);
      }
    } finally { cleanupTempDir(tempDir); }
  })) passed++; else failed++;

  if (test('preflights every managed Qwen transform before file or receipt writes', () => {
    const { applyInstallPlan, previewInstallPlan } = require('../../scripts/lib/install/apply');
    const tempDir = createTempDir();
    const targetRoot = path.join(tempDir, 'installed');
    const sourceRoot = path.join(tempDir, 'source');
    try {
      fs.mkdirSync(targetRoot);
      fs.mkdirSync(sourceRoot);
      const valid = ['---', 'name: valid', 'tools: Read', '---', 'BODY'].join('\n');
      const invalid = ['---', 'name: invalid', 'tools: []', '---', 'BODY'].join('\n');
      writeAgent(sourceRoot, 'a-valid.md', valid);
      writeAgent(sourceRoot, 'z-invalid.md', invalid);
      writeAgent(targetRoot, 'z-invalid.md', 'OPERATOR_OWNED_BYTES');
      writeAgent(targetRoot, 'ecc-install-state.json', '{"preserve":"receipt"}');
      const plan = {
        adapter: { id: 'qwen-home', target: 'qwen' },
        targetRoot,
        installStatePath: path.join(targetRoot, 'ecc-install-state.json'),
        operations: ['a-valid.md', 'z-invalid.md'].map(name => ({
          kind: 'copy-file', sourcePath: path.join(sourceRoot, name),
          sourceRelativePath: `agents/${name}`,
          destinationPath: path.join(targetRoot, name),
          contentTransform: 'qwen-agent-frontmatter',
        })),
      };
      const snapshot = () => fs.readdirSync(targetRoot).sort().map(name => [name, fs.readFileSync(path.join(targetRoot, name)).toString('base64')]);
      const before = snapshot();
      for (const operation of [previewInstallPlan, applyInstallPlan]) {
        assert.throws(() => operation(plan), /Unsupported empty tools allowlist/);
        assert.deepStrictEqual(snapshot(), before);
      }
      fs.unlinkSync(path.join(sourceRoot, 'z-invalid.md'));
      fs.mkdirSync(path.join(sourceRoot, 'z-invalid.md'));
      assert.throws(() => applyInstallPlan(plan), /non-regular source file/);
      assert.deepStrictEqual(snapshot(), before);
    } finally { cleanupTempDir(tempDir); }
  })) passed++; else failed++;

  if (test('keeps an absent tools field absent through CLI adaptation and rerun', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');
    const yaml = require('js-yaml');
    try {
      writeAgent(agentsDir, 'inherit-tools.md', [
        '---', 'name: inherit-tools', 'description: Uses parent tools',
        'model: sonnet', '---', '', 'BODY_SENTINEL'
      ].join('\n'));
      const first = run([agentsDir]);
      assert.strictEqual(first.code, 0, first.stderr);
      const adapted = readAgent(agentsDir, 'inherit-tools.md');
      const parsed = yaml.load(adapted.match(/^---\n([\s\S]*?)\n---/)[1]);
      assert.strictEqual(Object.hasOwn(parsed, 'tools'), false);
      const second = run([agentsDir]);
      assert.strictEqual(second.code, 0, second.stderr);
      assert.strictEqual(readAgent(agentsDir, 'inherit-tools.md'), adapted);
    } finally { cleanupTempDir(tempDir); }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
