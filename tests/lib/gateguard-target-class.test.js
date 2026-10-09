'use strict';
/**
 * Tests for scripts/lib/gateguard-target-class.js: target classification,
 * question tables, sensitive targets and sibling-collapse eligibility.
 *
 * Run with: node tests/lib/gateguard-target-class.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const libPath = path.join(__dirname, '..', '..', 'scripts', 'lib', 'gateguard-target-class.js');
const hookPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'gateguard-fact-force.js');
const {
  CLASS_QUESTIONS,
  CLASS_CONDENSED_HINTS,
  QUOTE_INSTRUCTION,
  questionIdsFor,
  questionsUseProfile,
  questionText,
  condensedHintFor,
  condensedQuestionPhrase,
  COLLAPSIBLE_CLASSES,
  canonicalPathKey,
  classifyTarget,
  classifyTargetFor,
  isCollapsibleTarget,
  collapseGateDir,
  isSensitiveTarget,
  isSensitiveTargetFor,
  isHardLinkedTargetFor
} = require(libPath);

console.log('=== Testing gateguard-target-class.js ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${desc}: ${e.message}`);
    failed++;
  }
}

function withProjectDir(value, fn) {
  const saved = process.env.CLAUDE_PROJECT_DIR;
  try {
    if (value === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = value;
    fn();
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = saved;
  }
}

// ── classifyTarget ──
console.log('classifyTarget:');

test('classifyTarget table (normalized, lowercased, first match wins)', () => {
  assert.strictEqual(typeof classifyTarget, 'function', 'classifyTarget is exported');
  const cases = [
    ['C:\\Repo\\Skills\\Foo\\Notes.MD', 'instruction'],
    ['/repo/AGENTS.md', 'instruction'],
    ['/repo/commands/plan.md', 'instruction'],
    ['/repo/rules/common/x.txt', 'instruction'],
    ['/repo/hooks/hooks.json', 'config'],
    ['/repo/skills/x/helper.js', 'code'],
    ['/repo/tests/fixtures/readme.md', 'test'],
    ['/repo/pkg/foo_test.go', 'test'],
    ['/repo/test_x.py', 'test'],
    ['/repo/x_test.py', 'test'],
    ['/repo/src/Button.spec.tsx', 'test'],
    ['/repo/src/__tests__/a.js', 'test'],
    ['/repo/README.md', 'prose'],
    ['/repo/docs/a.rst', 'prose'],
    ['/repo/.github/workflows/ci.yml', 'config'],
    ['/repo/pyproject.toml', 'config'],
    ['/repo/.env', 'config'],
    ['/repo/src/main.go', 'code'],
    ['', 'code']
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(classifyTarget(input), expected, `${input} -> ${expected}`);
  }
});

test('classifyTarget covers the extended instruction and config rules', () => {
  const cases = [
    ['/repo/.cursor/rules/x.mdc', 'instruction'],
    ['/repo/docs/x.mdc', 'instruction'],
    ['/repo/.cursorrules', 'instruction'],
    ['/repo/.windsurfrules', 'instruction'],
    ['/repo/AGENT.md', 'instruction'],
    ['/repo/.github/copilot-instructions.md', 'instruction'],
    ['/repo/.github/instructions/py.instructions.md', 'instruction'],
    ['/repo/.github/notes.md', 'prose'],
    ['/repo/docs/instructions.md', 'prose'],
    ['/repo/.env', 'config'],
    ['/repo/.env.local', 'config'],
    ['/repo/.env.example.ts', 'code'],
    ['/repo/.env.config.js', 'code'],
    ['/repo/.envrc', 'code'],
    ['/repo/.mcp.json', 'config']
  ];
  for (const [input, expected] of cases) {
    assert.strictEqual(classifyTarget(input), expected, `${input} -> ${expected}`);
  }
});

test('non-string input classifies as code', () => {
  assert.strictEqual(classifyTarget(undefined), 'code');
  assert.strictEqual(classifyTarget(null), 'code');
  assert.strictEqual(classifyTarget(42), 'code');
});

// ── classifyTargetFor ──
console.log('\nclassifyTargetFor:');

test('classifyTargetFor classifies project-relative paths', () => {
  assert.strictEqual(typeof classifyTargetFor, 'function', 'classifyTargetFor is exported');
  const saved = process.env.CLAUDE_PROJECT_DIR;
  try {
    process.env.CLAUDE_PROJECT_DIR = '/work/tests/proj';
    const data = { cwd: '/work/tests/proj' };
    assert.strictEqual(classifyTargetFor('/work/tests/proj/src/a.py', data), 'code');
    assert.strictEqual(classifyTargetFor('src/a.py', data), 'code', 'relative target');
    assert.strictEqual(classifyTargetFor('/work/tests/proj/tests/a.py', data), 'test');
    // No .git in the synthetic worktree, so the prefix stays and the path is under .claude.
    assert.strictEqual(classifyTargetFor('/work/tests/proj/.claude/worktrees/w1/docs/g.md', data), 'instruction', 'unverified worktree');
    assert.strictEqual(classifyTargetFor('/work/tests/proj/.claude/worktrees/w1/skills/x/SKILL.md', data), 'instruction');
    assert.strictEqual(classifyTargetFor('/work/tests/proj/.claude/agents/a.md', data), 'instruction', 'not a worktree');
    assert.strictEqual(classifyTargetFor('/elsewhere/tests/a.py', data), 'test', 'outside the root: absolute path');
    assert.strictEqual(classifyTargetFor('/work/tests/project2/src/a.py', data), 'test', 'sibling dir is outside the root');
    process.env.CLAUDE_PROJECT_DIR = 'C:\\Work\\Tests\\Proj';
    assert.strictEqual(classifyTargetFor('src\\a.py', { cwd: 'C:\\Work\\Tests\\Proj' }), 'code', 'win32 relative');
    assert.strictEqual(classifyTargetFor('c:/work/tests/proj/src/a.py', { cwd: 'C:\\Work\\Tests\\Proj' }), 'code', 'win32 case-folded');
    delete process.env.CLAUDE_PROJECT_DIR;
    assert.strictEqual(classifyTargetFor('src/a.py', { cwd: '/work/tests/proj' }), 'code', 'cwd fallback root');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = saved;
  }
});

// ── canonicalPathKey ──
console.log('\ncanonicalPathKey:');

test('resolves relative targets against the tool cwd and folds Windows keys', () => {
  withProjectDir('/proj', () => {
    assert.strictEqual(canonicalPathKey('src/a.py', { cwd: '/proj/sub' }), '/proj/sub/src/a.py');
    assert.strictEqual(canonicalPathKey('./a.py', { cwd: '/proj' }), '/proj/a.py');
    assert.strictEqual(canonicalPathKey('/abs/A.py', { cwd: '/proj' }), '/abs/A.py', 'posix keeps case');
  });
  withProjectDir(undefined, () => {
    assert.strictEqual(canonicalPathKey('src\\A.py', { cwd: 'C:\\Proj' }), 'c:/proj/src/a.py');
    assert.strictEqual(canonicalPathKey('a.py', { cwd: 'relative/base' }), 'a.py', 'non-absolute base: raw path');
  });
});

// ── isCollapsibleTarget ──
console.log('\nisCollapsibleTarget:');

test('only code/test/prose outside dotfiles and harness dirs may collapse', () => {
  assert.deepStrictEqual([...COLLAPSIBLE_CLASSES].sort(), ['code', 'prose', 'test']);
  withProjectDir('/proj', () => {
    const data = { cwd: '/proj' };
    assert.strictEqual(isCollapsibleTarget('/proj/src/a.js', data, 'code'), true);
    assert.strictEqual(isCollapsibleTarget('/proj/docs/a.md', data, 'prose'), true);
    assert.strictEqual(isCollapsibleTarget('/proj/app.yaml', data, 'config'), false, 'config');
    assert.strictEqual(isCollapsibleTarget('/proj/skills/x/SKILL.md', data, 'instruction'), false, 'instruction');
    assert.strictEqual(isCollapsibleTarget('/proj/src/.hidden.js', data, 'code'), false, 'dotfile');
    assert.strictEqual(isCollapsibleTarget('/proj/.github/scripts/a.js', data, 'code'), false, 'harness dir');
    assert.strictEqual(isCollapsibleTarget('/proj/.husky/pre-commit.js', data, 'code'), false, 'hook dir');
  });
});

test('a new file under any dot-directory never collapses', () => {
  withProjectDir('/proj', () => {
    const data = { cwd: '/proj' };
    for (const rel of [
      '.devcontainer/post-create.sh',
      '.githooks/pre-commit',
      '.kiro/steering/b.md',
      '.clinerules/b.md',
      '.idea/run.xml',
      '.continue/prompts/b.prompt',
      'src/.generated/a.js',
      '.vscode/tasks.js'
    ]) {
      assert.strictEqual(isCollapsibleTarget(`/proj/${rel}`, data, classifyTargetFor(`/proj/${rel}`, data)), false, rel);
      assert.strictEqual(isCollapsibleTarget(`/proj/${rel}`, data, 'code'), false, `${rel} (as code)`);
    }
    assert.strictEqual(isCollapsibleTarget('/proj/src/gen/a.js', data, 'code'), true, 'control');
  });
});

test('Windows name tricks: trailing dots/spaces, streams and 8.3 short names', () => {
  withProjectDir(undefined, () => {
    const data = { cwd: 'C:\\proj' };
    for (const p of ['C:\\proj\\CLAUDE.md.', 'C:\\proj\\CLAUDE.md ', 'C:\\proj\\CLAUDE.md::$DATA', 'C:\\proj\\CLAUDE.md:x', 'C:\\proj\\CLAUDE.md. .::$DATA']) {
      assert.strictEqual(classifyTargetFor(p, data), 'instruction', JSON.stringify(p));
    }
    assert.strictEqual(classifyTargetFor('C:\\proj\\.claude.\\hooks\\x.md', data), 'instruction', 'trailing dot on a directory');
    assert.strictEqual(classifyTargetFor('C:\\proj\\src\\a.js', data), 'code', 'control');
    const shortName = 'C:\\proj\\CLAUDE~1\\hooks\\x.ps1';
    assert.strictEqual(isCollapsibleTarget(shortName, data, classifyTargetFor(shortName, data)), false, '8.3 short name');
    assert.strictEqual(isCollapsibleTarget('C:\\proj\\src\\x.ps1', data, 'code'), true, 'control');
  });
  withProjectDir('/proj', () => {
    const data = { cwd: '/proj' };
    assert.strictEqual(classifyTargetFor('/proj/CLAUDE.md::$DATA', data), 'instruction', 'posix segment with ::$');
    assert.strictEqual(classifyTargetFor('/proj/notes.md.', data), 'code', 'posix trailing dot is a real name');
  });
});

// ── collapseGateDir (real directories) ──
console.log('\ncollapseGateDir:');

function tempProject() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-collapse-')));
  fs.mkdirSync(path.join(root, 'src', 'real'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
  return root;
}

function trySymlink(target, link, type = 'dir') {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch (e) {
    if (process.platform === 'win32' && e.code === 'EPERM') return false;
    throw e;
  }
}

test('the worktree prefix is stripped only for a real worktree (.git present)', () => {
  const root = tempProject();
  try {
    withProjectDir(root, () => {
      const data = { cwd: root };
      const wt = rel => path.join(root, '.claude', 'worktrees', 'w1', rel);
      fs.mkdirSync(wt('docs'), { recursive: true });
      assert.strictEqual(classifyTargetFor(wt('docs/g.md'), data), 'instruction', 'no .git: stays under .claude');
      assert.strictEqual(classifyTargetFor(wt('src/a.py'), data), 'code');
      assert.strictEqual(isCollapsibleTarget(wt('src/a.py'), data, 'code'), false, 'no .git: never collapses');
      fs.writeFileSync(wt('.git'), 'gitdir: ../../../.git/worktrees/w1\n');
      assert.strictEqual(classifyTargetFor(wt('docs/g.md'), data), 'prose', '.git file: worktree');
      assert.strictEqual(isCollapsibleTarget(wt('src/a.py'), data, 'code'), true, '.git file: collapses like the project');
      assert.strictEqual(isCollapsibleTarget(wt('.claude/hooks/x.sh'), data, 'code'), false, 'harness dir inside a worktree');
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collapse is screened on the real directory (symlinks, missing parents, fs errors)', () => {
  const root = tempProject();
  try {
    withProjectDir(root, () => {
      const data = { cwd: root };
      const at = rel => path.join(root, rel);
      const key = p => (process.platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p);
      assert.strictEqual(collapseGateDir(at('src/real/a.js'), data, 'code'), key(at('src/real')), 'plain directory');
      assert.strictEqual(collapseGateDir(at('src/new/deeper/a.js'), data, 'code'), key(at('src/new/deeper')), 'missing parents');
      assert.strictEqual(collapseGateDir(at('.claude/hooks/a.sh'), data, 'code'), null, 'dot-directory');
      assert.strictEqual(collapseGateDir(at('src/real/a.js'), data, 'config'), null, 'non-collapsible class');
      fs.writeFileSync(at('src/file'), 'x');
      assert.strictEqual(collapseGateDir(at('src/file/a.js'), data, 'code'), null, 'parent is a file (ENOTDIR)');
      if (!trySymlink(at('.claude/hooks'), at('src/tools'))) return;
      assert.strictEqual(collapseGateDir(at('src/tools/evil.sh'), data, 'code'), null, 'symlink into .claude/hooks');
      assert.strictEqual(collapseGateDir(at('src/tools/sub/evil.sh'), data, 'code'), null, 'missing dir under that symlink');
      trySymlink(at('src/real'), at('src/alias'));
      assert.strictEqual(collapseGateDir(at('src/alias/b.js'), data, 'code'), key(at('src/real')), 'in-project symlink keys by the real dir');
      trySymlink(at('tests'), at('src/t-alias'));
      fs.mkdirSync(at('tests'), { recursive: true });
      assert.strictEqual(collapseGateDir(at('src/t-alias/b.js'), data, 'code'), null, 'real location has another class');
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-outside-')));
      try {
        trySymlink(outside, at('src/out'));
        assert.strictEqual(collapseGateDir(at('src/out/b.js'), data, 'code'), null, 'symlink out of the project');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
      trySymlink(at('nowhere'), at('src/dangling'));
      assert.strictEqual(collapseGateDir(at('src/dangling/b.js'), data, 'code'), null, 'dangling symlink');
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a path of the other platform style is never collapsed', () => {
  const other = process.platform === 'win32' ? '/proj' : 'C:\\proj';
  withProjectDir(other, () => {
    const target = process.platform === 'win32' ? '/proj/src/a.js' : 'C:\\proj\\src\\a.js';
    assert.strictEqual(collapseGateDir(target, { cwd: other }, 'code'), null);
  });
});

// ── question tables ──
console.log('\nquestion tables:');

test('every non-code class has questions and a condensed hint; code has neither', () => {
  for (const cls of ['instruction', 'test', 'prose', 'config']) {
    for (const isWrite of [true, false]) {
      const questions = CLASS_QUESTIONS[cls](isWrite);
      assert.ok(Array.isArray(questions) && questions.length >= 2, `${cls} questions`);
      assert.ok(CLASS_CONDENSED_HINTS[cls](isWrite).endsWith('then retry.'), `${cls} hint`);
    }
  }
  assert.strictEqual(CLASS_QUESTIONS.code, undefined);
  assert.strictEqual(CLASS_CONDENSED_HINTS.code, undefined);
  assert.notDeepStrictEqual(CLASS_QUESTIONS.prose(true), CLASS_QUESTIONS.prose(false), 'prose Write and Edit differ');
});

test('questionIdsFor gives stable ids per class, action and change profile', () => {
  const known = (touchesPublicSurface, touchesData) => ({ known: true, language: 'js', touchesPublicSurface, touchesData, trivial: false });
  const table = [
    ['code', false, null, ['importers', 'public-api', 'data-schema', 'external-contract', 'quote-instruction']],
    ['code', true, null, ['callers', 'no-duplicate', 'data-schema', 'external-contract', 'quote-instruction']],
    ['code', false, { known: false, touchesPublicSurface: false, touchesData: false }, ['importers', 'public-api', 'data-schema', 'external-contract', 'quote-instruction']],
    ['code', false, known(true, true), ['importers', 'public-api', 'data-schema', 'external-contract', 'quote-instruction']],
    ['code', false, known(true, false), ['importers', 'public-api', 'quote-instruction']],
    ['code', false, known(false, true), ['local-callers', 'data-schema', 'external-contract', 'quote-instruction']],
    ['code', false, known(false, false), ['local-callers', 'quote-instruction']],
    ['code', true, known(false, false), ['callers', 'no-duplicate', 'quote-instruction']],
    ['code', true, known(true, true), ['callers', 'no-duplicate', 'data-schema', 'external-contract', 'quote-instruction']],
    ['instruction', false, known(false, false), ['loader', 'behaviour-change', 'no-duplicate-instruction', 'quote-instruction']],
    ['test', true, known(false, false), ['under-test', 'existing-tests', 'quote-instruction']],
    ['prose', true, null, ['supersedes', 'linked-from', 'why-new-file', 'quote-instruction']],
    ['prose', false, null, ['references', 'corrects-or-adds', 'quote-instruction']],
    ['config', false, known(false, false), ['config-reader', 'config-effect', 'no-plaintext-secrets', 'quote-instruction']],
    ['__proto__', false, null, ['importers', 'public-api', 'data-schema', 'external-contract', 'quote-instruction']]
  ];
  for (const [cls, isWrite, profile, expected] of table) {
    const ids = questionIdsFor(cls, isWrite, profile);
    assert.deepStrictEqual(ids, expected, `${cls} ${isWrite ? 'Write' : 'Edit'} ${JSON.stringify(profile)}`);
    for (const id of ids) assert.ok(questionText(id), `${id} has text`);
  }
  assert.strictEqual(questionText('constructor'), '');
  assert.strictEqual(questionText('missing'), '');
});

test('class question texts are unchanged by the ids', () => {
  assert.deepStrictEqual(questionIdsFor('prose', true).slice(0, -1).map(questionText), CLASS_QUESTIONS.prose(true));
  assert.deepStrictEqual(questionIdsFor('config', false).slice(0, -1).map(questionText), CLASS_QUESTIONS.config(false));
  assert.strictEqual(questionText('quote-instruction'), QUOTE_INSTRUCTION);
});

test('condensedHintFor matches the question set', () => {
  const local = { known: true, touchesPublicSurface: false, touchesData: false };
  assert.ok(condensedHintFor('code', false, local).includes('call sites in this file or its module'));
  assert.strictEqual(condensedHintFor('test', false, local), CLASS_CONDENSED_HINTS.test(false));
});

test('code condensed hints name exactly the questions of the change profile', () => {
  const known = (touchesPublicSurface, touchesData) => ({ known: true, language: 'js', touchesPublicSurface, touchesData, trivial: false });
  const ids = ['importers', 'public-api', 'local-callers', 'callers', 'no-duplicate', 'data-schema', 'external-contract', 'quote-instruction'];
  for (const id of ids) assert.ok(condensedQuestionPhrase(id), `${id} has a phrase`);
  for (const isWrite of [false, true]) {
    for (const [s, d] of [[true, true], [true, false], [false, true], [false, false]]) {
      const profile = known(s, d);
      const hint = condensedHintFor('code', isWrite, profile);
      const asked = questionIdsFor('code', isWrite, profile);
      for (const id of ids) {
        assert.strictEqual(hint.includes(condensedQuestionPhrase(id)), asked.includes(id), `${isWrite ? 'Write' : 'Edit'} ${s}/${d} ${id}`);
      }
      assert.ok(hint.startsWith('briefly state ') && hint.endsWith(', then retry.'), hint);
    }
  }
});

test('a class that skips profiling asks the same questions under every profile', () => {
  const profiles = [null, { known: false }];
  for (const s of [true, false]) for (const d of [true, false]) profiles.push({ known: true, language: 'js', touchesPublicSurface: s, touchesData: d, trivial: false });
  const classes = ['code', 'test', 'prose', 'instruction', 'config', 'unknown-class'];
  for (const cls of classes) {
    for (const isWrite of [false, true]) {
      const asked = profiles.map(profile => JSON.stringify(questionIdsFor(cls, isWrite, profile)));
      const hints = profiles.map(profile => condensedHintFor(cls, isWrite, profile));
      if (!questionsUseProfile(cls)) {
        assert.strictEqual(new Set(asked).size, 1, `${cls} ${isWrite} questions vary with the profile`);
        assert.strictEqual(new Set(hints).size, 1, `${cls} ${isWrite} hints vary with the profile`);
      }
    }
  }
  assert.strictEqual(questionsUseProfile('code'), true);
  for (const cls of ['test', 'prose', 'instruction', 'config']) assert.strictEqual(questionsUseProfile(cls), false, cls);
});

test('code condensed hints read as one sentence', () => {
  const known = (touchesPublicSurface, touchesData) => ({ known: true, language: 'js', touchesPublicSurface, touchesData, trivial: false });
  assert.strictEqual(
    condensedHintFor('code', false, known(false, false)),
    "briefly state the call sites in this file or its module that rely on the change and the user's verbatim instruction, then retry."
  );
  assert.strictEqual(
    condensedHintFor('code', false, known(true, true)),
    "briefly state the files that import this file, the public functions/classes affected, the data schemas it reads or writes, what outside the repository fixes the format or semantics, and the user's verbatim instruction, then retry."
  );
  assert.strictEqual(
    condensedHintFor('code', true, known(true, false)),
    "briefly state the file(s) and line(s) that will call it, that no existing file serves the same purpose, and the user's verbatim instruction, then retry."
  );
});

test('code condensed hints keep the data and duplicate checks when the profile asks for them', () => {
  const known = (touchesPublicSurface, touchesData) => ({ known: true, language: 'py', touchesPublicSurface, touchesData, trivial: false });
  assert.ok(condensedHintFor('code', false, known(false, true)).includes(condensedQuestionPhrase('data-schema')));
  assert.ok(condensedHintFor('code', false, known(true, false)).includes(condensedQuestionPhrase('importers')));
  for (const profile of [known(false, false), known(true, true)]) {
    assert.ok(condensedHintFor('code', true, profile).includes(condensedQuestionPhrase('no-duplicate')), 'Write asks for duplicates');
    assert.ok(condensedHintFor('code', true, profile).includes(condensedQuestionPhrase('callers')), 'Write asks for callers');
  }
});

test('code condensed Edit hint for an unknown profile names every question asked', () => {
  const expected = "briefly state importers/callers, affected API, data schemas if any, what outside the repository fixes the format or semantics, and the user's verbatim instruction, then retry.";
  for (const profile of [null, undefined, { known: false, touchesPublicSurface: false, touchesData: false }, 'x']) {
    assert.strictEqual(condensedHintFor('code', false, profile), expected);
    assert.strictEqual(condensedHintFor('__proto__', false, profile), expected);
  }
});

test('code condensed Write hint for an unknown profile asks every creation question', () => {
  for (const profile of [null, undefined, { known: false, touchesPublicSurface: false, touchesData: false }, 'x']) {
    assert.strictEqual(
      condensedHintFor('code', true, profile),
      "briefly state the file(s) and line(s) that will call it, that no existing file serves the same purpose, the data schemas it reads or writes, what outside the repository fixes the format or semantics, and the user's verbatim instruction, then retry."
    );
  }
  assert.strictEqual(condensedQuestionPhrase('constructor'), '');
  assert.strictEqual(condensedQuestionPhrase('loader'), '');
});

// ── isSensitiveTarget ──

test('isSensitiveTarget matches every listed basename, segment and prefix rule', () => {
  const sensitive = [
    '.env', '.env.local', '.env.production.local', 'config/.env', 'config/.env.test',
    'certs/server.pem', 'certs/server.key', 'certs/client.p12', 'certs/client.pfx',
    'home/id_rsa', 'home/id_rsa.pub', 'id_ed25519', 'home/id_ed25519.pub',
    'keys/id_ecdsa', 'keys/id_ecdsa.pub', 'keys/id_dsa', '.netrc', 'home/.pgpass',
    'credentials', 'config/credentials.json', 'aws/credentials', 'config/secrets.yaml', 'secrets.json',
    'src/auth/login.py', 'src/authn/x.ts', 'src/authz/policy.go', 'lib/security/x.js',
    'src/secrets/vault.py', 'src/payment/charge.py', 'src/payments/x.py', 'app/billing/invoice.rb',
    'db/migrations/0001_init.sql', 'auth/readme.md', 'src/auth',
    '.github/workflows/ci.yml', '.github/workflows/sub/x.yaml', './.github/workflows/ci.yml',
    '.claude/worktrees/fake/.github/workflows/ci.yml', '/elsewhere/repo/.github/workflows/ci.yml',
    'SRC/Auth/Login.py', '.ENV', 'Certs/Server.PEM', 'src\\billing\\x.py'
  ];
  for (const p of sensitive) assert.strictEqual(isSensitiveTarget(p), true, p);
});

test('isSensitiveTarget is segment-exact and basename-exact (no substring matches)', () => {
  const ordinary = [
    'src/author.py', 'docs/authoring.md', 'lib/paymentutils.py', 'src/authentication/x.py',
    'src/securityutils/x.py', 'src/billingreport.py', 'src/migration.py', 'src/environment.py',
    'envoy.yaml', 'src/keyboard.py', 'src/key.py', 'src/secretsmanager.py', 'src/my_credentials.py',
    'docs/workflows/ci.md', 'github/workflows/ci.yml', '.github/ci.yml', 'src/app.js', 'README.md', 'src/.envrc',
    'src/netrc.py', '.netrc.bak', 'src/pgpass_reader.py'
  ];
  for (const p of ordinary) assert.strictEqual(isSensitiveTarget(p), false, p);
});

test('isSensitiveTarget fails safe (any error => sensitive)', () => {
  const hostile = { toString() { throw new Error('boom'); } };
  assert.strictEqual(isSensitiveTarget(hostile), true);
  assert.strictEqual(isSensitiveTarget(Symbol('x')), true);
});

test('isSensitiveTargetFor uses the project-relative class path', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-sensitive-')));
  try {
    // The project itself sits under an ancestor named `security`: only project-relative segments count.
    const proj = path.join(root, 'security', 'proj');
    fs.mkdirSync(proj, { recursive: true });
    withProjectDir(proj, () => {
      const data = { cwd: proj };
      assert.strictEqual(isSensitiveTargetFor(`${proj}/src/app.py`, data), false, 'ancestor segment ignored');
      assert.strictEqual(isSensitiveTargetFor(`${proj}/src/auth/app.py`, data), true);
      assert.strictEqual(isSensitiveTargetFor('src/billing/x.py', data), true, 'relative to cwd');
      assert.strictEqual(isSensitiveTargetFor(`${proj}/.github/workflows/ci.yml`, data), true);
      fs.mkdirSync(path.join(proj, '.claude', 'worktrees', 'w1'), { recursive: true });
      fs.writeFileSync(path.join(proj, '.claude', 'worktrees', 'w1', '.git'), 'gitdir: x\n');
      assert.strictEqual(isSensitiveTargetFor(`${proj}/.claude/worktrees/w1/.github/workflows/ci.yml`, data), true);
      assert.strictEqual(isSensitiveTargetFor(`${proj}/.claude/worktrees/w1/src/app.py`, data), false);
      assert.strictEqual(isSensitiveTargetFor(`${proj}/.env.`, data), true);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isSensitiveTargetFor also judges the real (symlink-resolved) path', () => {
  const root = tempProject();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-outside-')));
  try {
    withProjectDir(root, () => {
      const data = { cwd: root };
      const at = rel => path.join(root, rel);
      fs.mkdirSync(at('src/auth'), { recursive: true });
      fs.writeFileSync(at('src/auth/login.py'), 'x');
      if (!trySymlink(at('src/auth'), at('src/tools'))) return;
      assert.strictEqual(isSensitiveTargetFor(at('src/tools/login.py'), data), true, 'existing file through a dir symlink');
      assert.strictEqual(isSensitiveTargetFor(at('src/tools/new_handler.py'), data), true, 'new file through a dir symlink');
      assert.strictEqual(isSensitiveTargetFor(at('src/tools/deeper/x.py'), data), true, 'missing dir under the symlink');
      assert.strictEqual(isSensitiveTargetFor('src/tools/login.py', data), true, 'relative spelling');
      trySymlink(at('src/real'), at('src/alias'));
      assert.strictEqual(isSensitiveTargetFor(at('src/alias/a.py'), data), false, 'alias of an ordinary dir');
      assert.strictEqual(isSensitiveTargetFor(at('src/real/a.py'), data), false, 'direct ordinary path');
      fs.mkdirSync(path.join(outside, 'secrets'), { recursive: true });
      trySymlink(path.join(outside, 'secrets'), at('src/ext'));
      assert.strictEqual(isSensitiveTargetFor(at('src/ext/a.py'), data), true, 'real location outside the project is judged too');
      trySymlink(outside, at('src/ext-plain'));
      assert.strictEqual(isSensitiveTargetFor(at('src/ext-plain/a.py'), data), false, 'ordinary location outside the project');
      trySymlink(at('nowhere'), at('src/dangling'));
      assert.strictEqual(isSensitiveTargetFor(at('src/dangling/a.py'), data), true, 'dangling symlink fails closed');
      fs.writeFileSync(at('src/plainfile'), 'x');
      assert.strictEqual(isSensitiveTargetFor(at('src/plainfile/a.py'), data), true, 'ENOTDIR fails closed');
      try {
        fs.symlinkSync(at('src/auth/login.py'), at('src/real/login_link.py'), 'file');
        assert.strictEqual(isSensitiveTargetFor(at('src/real/login_link.py'), data), true, 'file symlink into auth/');
      } catch (e) {
        if (!(process.platform === 'win32' && e.code === 'EPERM')) throw e;
      }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('collapseGateDir never keys a gate for a sensitive real location', () => {
  const root = tempProject();
  try {
    withProjectDir(root, () => {
      const data = { cwd: root };
      const at = rel => path.join(root, rel);
      fs.mkdirSync(at('src/payments'), { recursive: true });
      if (!trySymlink(at('src/payments'), at('src/tools'))) return;
      assert.strictEqual(collapseGateDir(at('src/tools/a.py'), data, 'code'), null);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isSensitiveTargetFor fails safe on bad input', () => {
  assert.strictEqual(isSensitiveTargetFor(undefined, undefined), true);
  assert.strictEqual(isSensitiveTargetFor({ toString() { throw new Error('x'); } }, {}), true);
});

function tryHardLink(existing, link) {
  try {
    fs.linkSync(existing, link);
    return true;
  } catch (e) {
    if (['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS', 'EOPNOTSUPP'].includes(e.code)) return false;
    throw e;
  }
}

test('isHardLinkedTargetFor is true for a file with more than one link', () => {
  const root = tempProject();
  try {
    withProjectDir(root, () => {
      const data = { cwd: root };
      const at = rel => path.join(root, rel);
      fs.mkdirSync(at('src/lib'), { recursive: true });
      fs.writeFileSync(at('src/lib/report.py'), 'x');
      fs.writeFileSync(at('src/lib/single.py'), 'x');
      if (!tryHardLink(at('src/lib/report.py'), at('src/report_alias.py'))) return;
      assert.strictEqual(isHardLinkedTargetFor(at('src/lib/report.py'), data), true, 'original name');
      assert.strictEqual(isHardLinkedTargetFor('src/report_alias.py', data), true, 'second name, relative spelling');
      assert.strictEqual(isHardLinkedTargetFor(at('src/lib/single.py'), data), false, 'single link');
      assert.strictEqual(isHardLinkedTargetFor(at('src/lib/new_file.py'), data), false, 'a missing new file');
      assert.strictEqual(isHardLinkedTargetFor(at('src/lib'), data), false, 'a directory');
      fs.writeFileSync(at('src/plainfile'), 'x');
      assert.strictEqual(isHardLinkedTargetFor(at('src/plainfile/a.py'), data), false, 'ENOTDIR is a missing file');
      if (trySymlink(at('src/lib/report.py'), at('src/report_symlink.py'), 'file')) {
        assert.strictEqual(isHardLinkedTargetFor(at('src/report_symlink.py'), data), true, 'symlink to a hard-linked file');
      }
      if (trySymlink(at('src/lib/single.py'), at('src/single_symlink.py'))) {
        assert.strictEqual(isHardLinkedTargetFor(at('src/single_symlink.py'), data), false, 'symlink to a single-link file');
      }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('isHardLinkedTargetFor fails closed on stat errors other than a missing file', () => {
  const root = tempProject();
  const savedLstat = fs.lstatSync;
  try {
    withProjectDir(root, () => {
      const data = { cwd: root };
      const target = path.join(root, 'src', 'a.py');
      for (const code of ['EACCES', 'EIO', 'ELOOP', 'EPERM']) {
        fs.lstatSync = () => {
          const error = new Error(code);
          error.code = code;
          throw error;
        };
        assert.strictEqual(isHardLinkedTargetFor(target, data), true, code);
      }
      fs.lstatSync = () => {
        throw new Error('no code');
      };
      assert.strictEqual(isHardLinkedTargetFor(target, data), true, 'error without a code');
      fs.lstatSync = savedLstat;
      assert.strictEqual(isHardLinkedTargetFor(undefined, data), true, 'non-string path');
      assert.strictEqual(isHardLinkedTargetFor(target, { cwd: 'relative/dir' }), true, 'unresolvable target');
    });
  } finally {
    fs.lstatSync = savedLstat;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the hook re-exports the lib classification functions', () => {
  // The hook prunes stale state files on load: point it at a scratch dir.
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-target-class-'));
  const savedStateDir = process.env.GATEGUARD_STATE_DIR;
  process.env.GATEGUARD_STATE_DIR = stateDir;
  let hook;
  try {
    hook = require(hookPath);
  } finally {
    if (savedStateDir === undefined) delete process.env.GATEGUARD_STATE_DIR;
    else process.env.GATEGUARD_STATE_DIR = savedStateDir;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
  assert.strictEqual(hook.classifyTarget, classifyTarget);
  assert.strictEqual(hook.classifyTargetFor, classifyTargetFor);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
