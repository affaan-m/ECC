#!/usr/bin/env node
/**
 * Validate the Codex-facing .codex/agents role-file surface.
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOML = require('@iarna/toml');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ROLES_DIR = path.join(REPO_ROOT, '.codex', 'agents');
const AGENTS_DIR = path.join(REPO_ROOT, 'agents');
const GENERATOR = path.join(REPO_ROOT, 'scripts', 'codex', 'generate-agent-roles.js');
const GENERATED_MARKER = '# generated-by: scripts/codex/generate-agent-roles.js';

// Codex agent role files accept these keys; developer_instructions is required.
const ALLOWED_ROLE_KEYS = new Set([
  'approval_policy',
  'developer_instructions',
  'model',
  'description',
  'model_reasoning_effort',
  'name',
  'sandbox_mode',
]);
const SANDBOX_MODES = new Set(['read-only', 'workspace-write', 'danger-full-access']);
const REASONING_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);

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

function listRoleFiles() {
  return fs.readdirSync(ROLES_DIR)
    .filter(file => file.endsWith('.toml'))
    .sort();
}

function listCanonicalAgents() {
  return fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name.slice(0, -3))
    .sort();
}

function readRole(file) {
  const source = fs.readFileSync(path.join(ROLES_DIR, file), 'utf8');
  return { source, parsed: TOML.parse(source) };
}

function run() {
  console.log('\n=== Testing Codex agent role surface ===\n');

  let passed = 0;
  let failed = 0;
  const roleFiles = listRoleFiles();

  if (test('Codex agent role directory is populated', () => {
    assert.ok(roleFiles.length > 0, 'Expected at least one .codex/agents role file');
  })) passed++; else failed++;

  if (test('every role file parses as TOML and defines developer_instructions', () => {
    for (const file of roleFiles) {
      const { parsed } = readRole(file);
      assert.ok(
        typeof parsed.developer_instructions === 'string'
          && parsed.developer_instructions.trim().length > 0,
        `${file} must define a non-blank developer_instructions`
      );
    }
  })) passed++; else failed++;

  // Codex rejects a role file missing `name` or `description` with "Ignoring
  // malformed agent role definition", so both are hard requirements.
  if (test('every role file defines a name matching its filename', () => {
    for (const file of roleFiles) {
      const { parsed } = readRole(file);
      assert.ok(
        typeof parsed.name === 'string' && parsed.name.trim().length > 0,
        `${file} must define a non-empty name`
      );
      assert.strictEqual(
        parsed.name,
        file.slice(0, -5),
        `${file} name must match its filename`
      );
    }
  })) passed++; else failed++;

  if (test('every role file defines a description', () => {
    for (const file of roleFiles) {
      const { parsed } = readRole(file);
      assert.ok(
        typeof parsed.description === 'string' && parsed.description.trim().length > 0,
        `${file} must define a non-empty description`
      );
    }
  })) passed++; else failed++;

  if (test('role files only use keys Codex accepts', () => {
    for (const file of roleFiles) {
      const { parsed } = readRole(file);
      const unexpected = Object.keys(parsed).filter(key => !ALLOWED_ROLE_KEYS.has(key)).sort();
      assert.deepStrictEqual(unexpected, [], `${file} has unsupported keys`);

      if (parsed.sandbox_mode !== undefined) {
        assert.ok(
          SANDBOX_MODES.has(parsed.sandbox_mode),
          `${file} has an unknown sandbox_mode: ${parsed.sandbox_mode}`
        );
      }
      if (parsed.model_reasoning_effort !== undefined) {
        assert.ok(
          REASONING_EFFORTS.has(parsed.model_reasoning_effort),
          `${file} has an unknown model_reasoning_effort: ${parsed.model_reasoning_effort}`
        );
      }
    }
  })) passed++; else failed++;

  if (test('every canonical agent has a generated role file', () => {
    const generated = new Set(
      roleFiles
        .filter(file => fs.readFileSync(path.join(ROLES_DIR, file), 'utf8').startsWith(GENERATED_MARKER))
        .map(file => file.slice(0, -5))
    );
    const missing = listCanonicalAgents().filter(name => !generated.has(name));
    assert.deepStrictEqual(missing, [], 'agents/*.md without a Codex role file');
  })) passed++; else failed++;

  if (test('write-capable agents are not generated as read-only', () => {
    for (const file of roleFiles) {
      const { source, parsed } = readRole(file);
      if (!source.startsWith(GENERATED_MARKER)) continue;

      const name = file.slice(0, -5);
      const frontmatter = fs.readFileSync(path.join(AGENTS_DIR, `${name}.md`), 'utf8')
        .match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!frontmatter) continue;

      const tools = frontmatter[1].match(/^tools:\s*(.*)$/m);
      if (!tools || !/\b(Write|Edit|MultiEdit|NotebookEdit)\b/.test(tools[1])) continue;

      assert.strictEqual(
        parsed.sandbox_mode,
        'workspace-write',
        `${file} grants edit tools in agents/${name}.md and must not be read-only`
      );
    }
  })) passed++; else failed++;

  if (test('generated surface is in sync with agents/*.md', () => {
    execFileSync(process.execPath, [GENERATOR, '--check'], { stdio: 'pipe' });
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

run();
