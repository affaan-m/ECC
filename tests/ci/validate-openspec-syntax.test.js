'use strict';
/**
 * Tests for scripts/ci/validate-openspec-syntax.js
 *
 * Covers the v1 OpenSpec schema contract:
 * - baseline specs (Requirement + Scenario, Invariant + enforced anchor)
 * - per-block delta validation (every declared block must be non-empty)
 * - metadata allowlist + unknown-key guard + ordinary comments allowed
 * - enforced anchor grammar (path::symbol, repo-relative, no traversal)
 *
 * The validator expects <root>/openspec/ structure; fixtures are built inline
 * as real files in a temp dir so each case is exercised end-to-end.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'ci', 'validate-openspec-syntax.js');

function runValidator(openspecRoot) {
  try {
    const result = execSync(
      `node "${SCRIPT}" --openspec-root "${openspecRoot}"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return {
      exitCode: 0,
      stdout: (result.stdout || result).trim(),
      stderr: (result.stderr || '').trim(),
    };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || '').trim(),
    };
  }
}

/** Create a temp project root with openspec/specs/ containing given files */
function makeTempProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vs-'));
  const specsDir = path.join(root, 'openspec', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(specsDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return root;
}

// ── Shared content builders ────────────────────────────────────

function requirementSpec(extra = '') {
  return (
    '---\ntitle: Capability\n---\n\n' +
    '### Requirement: Some Req\n' +
    'The system SHALL do the thing.\n\n' +
    '#### Scenario: happy path\n' +
    '- **WHEN** x\n' +
    '- **THEN** y\n\n' +
    extra
  );
}

function invariantSpec(anchor = 'src/lib.js::enforceCheck', extra = '') {
  return (
    '### Invariant: Some Invariant\n' +
    'The system SHALL always hold.\n\n' +
    `<!-- enforced: ${anchor} -->\n\n` +
    extra
  );
}

function deltaSpec(blocks) {
  // blocks: array of { marker: 'ADDED'|'MODIFIED'|'REMOVED', body: string }
  let out = '---\ntitle: Delta\n---\n\n';
  for (const b of blocks) {
    out += `<!-- ${b.marker}: -->\n${b.body}\n`;
  }
  return out;
}

describe('validate-openspec-syntax (v1 schema)', () => {
  describe('container / exit codes', () => {
    it('is valid when openspec dir is missing', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vs-missing-'));
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        assert.strictEqual(parsed.valid, true);
        assert.deepStrictEqual(parsed.errors, []);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('is valid for an empty openspec directory', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vs-empty-'));
      try {
        fs.mkdirSync(path.join(root, 'openspec'));
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('exits 2 for a non-existent root', () => {
      const result = runValidator('/tmp/nonexistent-openspec-root-' + Date.now());
      assert.strictEqual(result.exitCode, 2);
    });

    it('exits 2 when root is a file, not a directory', () => {
      const file = path.join(os.tmpdir(), 'ecc-vs-file-' + Date.now());
      fs.writeFileSync(file, 'x');
      try {
        const result = runValidator(file);
        assert.strictEqual(result.exitCode, 2);
      } finally {
        fs.rmSync(file, { force: true });
      }
    });
  });

  describe('valid baseline specs', () => {
    it('passes a Requirement with a Scenario', () => {
      const root = makeTempProject({ 'valid/spec.md': requirementSpec() });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0, result.stderr);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        assert.strictEqual(parsed.valid, true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('passes a spec without YAML frontmatter (frontmatter optional)', () => {
      const root = makeTempProject({
        'nofm/spec.md':
          '# Spec: nofm\n\n' +
          '### Requirement: Req\n' +
          'SHALL pass.\n\n' +
          '#### Scenario: s\n' +
          '- **WHEN** a\n' +
          '- **THEN** b\n',
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0, result.stderr);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('passes an Invariant with a well-formed enforced anchor', () => {
      const root = makeTempProject({ 'inv/spec.md': invariantSpec() });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0, result.stderr);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('passes allowlisted metadata on Requirement and Invariant', () => {
      const root = makeTempProject({
        'meta/spec.md':
          requirementSpec(
            '<!-- id: some-req -->\n' +
            '<!-- entities: User, Order -->\n' +
            '<!-- test: OrderTest.placesOrder() -->\n' +
            '<!-- depends_on: Earlier Behavior -->\n' +
            '<!-- triggers: Later Behavior -->\n'
          ) +
          invariantSpec('src/orders.js::rejectInvalid', '<!-- verified_by: OrderTest.rejects() -->\n')
          + '<!-- deferred: file1.md, file2.md -->\n',
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0, result.stderr);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('structural validation', () => {
    it('flags a Requirement with no Scenario', () => {
      const root = makeTempProject({
        'noscen/spec.md':
          '### Requirement: Missing Scenario Req\n' +
          'This requirement has no scenario.\n',
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 1);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        const hit = parsed.errors.some((e) => e.includes('has no Scenario'));
        assert.ok(hit, `expected missing-Scenario error, got: ${JSON.stringify(parsed.errors)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('flags an Invariant with no enforced anchor', () => {
      const root = makeTempProject({
        'noenf/spec.md':
          '### Invariant: No Anchor\n' +
          'Must have an anchor.\n',
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 1);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        const hit = parsed.errors.some((e) => e.includes('enforced'));
        assert.ok(hit, `expected missing-enforced error, got: ${JSON.stringify(parsed.errors)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('enforced anchor grammar', () => {
    const CASES = [
      ['spaces instead of ::', 'not a valid anchor'],
      ['empty symbol', 'src/lib.js::'],
      ['empty path', '::check'],
      ['absolute path', '/etc/passwd::x'],
      ['dot-dot traversal', '../secret.js::x'],
      ['nested dot-dot traversal', 'src/../../secret.js::x'],
      ['backslash path', 'src\\lib.js::x'],
    ];

    for (const [label, anchor] of CASES) {
      it(`rejects ${label}`, () => {
        const root = makeTempProject({ 'badanchor/spec.md': invariantSpec(anchor) });
        try {
          const result = runValidator(root);
          assert.strictEqual(result.exitCode, 1, anchor);
          const parsed = JSON.parse(result.stdout.split('\n').pop());
          const hit = parsed.errors.some((e) => e.includes('Invalid enforced anchor'));
          assert.ok(hit, `expected anchor error for "${anchor}", got: ${JSON.stringify(parsed.errors)}`);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      });
    }

    it('accepts a nested relative path anchor', () => {
      const root = makeTempProject({
        'nested/spec.md': invariantSpec('packages/core/src/checker.js::verify'),
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0, result.stderr);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('metadata comments', () => {
    it('flags an unknown machine-shaped metadata key (typo guard)', () => {
      const root = makeTempProject({
        'unk/spec.md':
          requirementSpec('<!-- enforcd: src/lib.js::check -->\n'),
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 1);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        const hit = parsed.errors.some((e) => e.includes('Unknown metadata key'));
        assert.ok(hit, `expected unknown-key error, got: ${JSON.stringify(parsed.errors)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('allows ordinary prose comments even with a colon', () => {
      const root = makeTempProject({
        'prose/spec.md':
          requirementSpec(
            '<!-- Note: this is a human note, keep it -->\n' +
            '<!-- TODO(team): address in follow-up -->\n'
          ),
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0, result.stderr);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('allows colon-less comments anywhere', () => {
      const root = makeTempProject({
        'plain/spec.md': requirementSpec('<!-- just a comment -->\n'),
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0, result.stderr);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('delta files', () => {
    it('passes a delta with three non-empty blocks', () => {
      const root = makeTempProject({
        'deltas/valid.md': deltaSpec([
          { marker: 'ADDED', body: 'Added validation logic.' },
          { marker: 'MODIFIED', body: 'Now uses structured errors.' },
          { marker: 'REMOVED', body: 'Dropped legacy path.' },
        ]),
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 0, result.stderr);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('rejects a delta where the FIRST block is empty but a later one has content', () => {
      // Regression for: "content in any later block made all earlier empty blocks pass"
      const root = makeTempProject({
        'deltas/first-empty.md': deltaSpec([
          { marker: 'ADDED', body: '' },
          { marker: 'MODIFIED', body: 'Some real content.' },
        ]),
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 1);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        const hit = parsed.errors.some((e) => e.includes('Empty ADDED block'));
        assert.ok(hit, `expected empty-ADDED error, got: ${JSON.stringify(parsed.errors)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('rejects a delta where every declared block is empty', () => {
      const root = makeTempProject({
        'deltas/all-empty.md': deltaSpec([
          { marker: 'ADDED', body: '' },
          { marker: 'REMOVED', body: '' },
        ]),
      });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 1);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        const added = parsed.errors.some((e) => e.includes('Empty ADDED block'));
        const removed = parsed.errors.some((e) => e.includes('Empty REMOVED block'));
        assert.ok(added, 'expected empty-ADDED error');
        assert.ok(removed, 'expected empty-REMOVED error');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('rejects an empty file as an empty spec', () => {
      const root = makeTempProject({ 'deltas/empty.md': '' });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 1);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        const hit = parsed.errors.some((e) => e.toLowerCase().includes('empty'));
        assert.ok(hit, `expected empty error, got: ${JSON.stringify(parsed.errors)}`);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('output format', () => {
    it('emits JSON on stdout only', () => {
      const root = makeTempProject({ 'bad.md': '' });
      try {
        const result = runValidator(root);
        assert.strictEqual(result.exitCode, 1);
        const stdoutLines = result.stdout.split('\n').filter((l) => l.trim().length > 0);
        for (const line of stdoutLines) {
          assert.doesNotThrow(() => JSON.parse(line), `stdout must be JSON only: ${line}`);
        }
        assert.ok(result.stderr.length > 0, 'diagnostics should go to stderr');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('reports valid:false with errors on stdout when invalid', () => {
      const root = makeTempProject({ 'bad.md': '' });
      try {
        const result = runValidator(root);
        const parsed = JSON.parse(result.stdout.split('\n').pop());
        assert.strictEqual(parsed.valid, false);
        assert.ok(Array.isArray(parsed.errors) && parsed.errors.length > 0);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
