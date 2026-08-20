const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;

const repoRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(
  repoRoot,
  'skills',
  'continuous-learning-v2',
  'scripts',
  'instinct-cli.py'
);

function detectPython3() {
  for (const bin of ['python3', 'python']) {
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return bin;
  }
  return null;
}

const PYTHON3 = detectPython3();
if (!PYTHON3) {
  console.log('\n=== Testing instinct-cli.py evolve generation ===\n');
  console.log('  - skipped: Python 3 not found in PATH');
  console.log('\nPassed: 0');
  console.log('Failed: 0');
  process.exit(0);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-instinct-cli-evolve-'));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeInstinct(root, id, trigger, confidence = 0.8, domain = 'workflow') {
  const dir = path.join(root, 'instincts', 'personal');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.yaml`),
    [
      '---',
      `id: ${id}`,
      `trigger: "${trigger}"`,
      `confidence: ${confidence}`,
      `domain: ${domain}`,
      '---',
      '',
      `## Action`,
      '',
      `Action for ${id}.`,
      '',
    ].join('\n')
  );
}

// CLV2_NO_PROJECT pins the run to global scope, so seeded instincts live in
// <root>/instincts/personal and generated files land in <root>/evolved.
function runCli(root, args) {
  return spawnSync(PYTHON3, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLV2_HOMUNCULUS_DIR: root,
      CLV2_NO_PROJECT: '1',
      HOME: path.join(root, 'home'),
      USERPROFILE: path.join(root, 'home'),
      CLAUDE_PROJECT_DIR: '',
    },
  });
}

function generatedCommands(root) {
  const dir = path.join(root, 'evolved', 'commands');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort();
}

// Eight unrelated workflow triggers: no two share enough keywords to cluster,
// so each one is its own command candidate.
const EIGHT_TRIGGERS = [
  ['run-tests', 'when running tests'],
  ['build-images', 'when building images'],
  ['deploy-services', 'when deploying services'],
  ['profile-memory', 'when profiling memory'],
  ['rotate-secrets', 'when rotating secrets'],
  ['tag-releases', 'when tagging releases'],
  ['prune-caches', 'when pruning caches'],
  ['review-requests', 'when reviewing pull requests'],
];

function seedEight(root) {
  for (const [id, trigger] of EIGHT_TRIGGERS) {
    writeInstinct(root, id, trigger);
  }
}

console.log('\n=== Testing instinct-cli.py evolve generation ===\n');

test('generated command names are cut on a word boundary', () => {
  const root = createTempDir();
  try {
    writeInstinct(root, 'archaeology', 'when investigating complex systems');
    writeInstinct(root, 'codebases', 'when learning about complex codebases');
    writeInstinct(root, 'large-text', 'when analyzing large text files');

    const result = runCli(root, ['evolve', '--generate']);
    assert.strictEqual(result.status, 0, result.stderr);

    const names = generatedCommands(root);
    // A hard slice used to yield investigating-comple.md and
    // learning-about-compl.md, which read as typos.
    assert.deepStrictEqual(names, [
      'analyzing-large-text.md',
      'investigating.md',
      'learning-about.md',
    ]);
  } finally {
    cleanupDir(root);
  }
});

test('a cut landing on a separator keeps the whole word', () => {
  const root = createTempDir();
  try {
    writeInstinct(root, 'a', 'when analyzing large text files');
    writeInstinct(root, 'b', 'when running tests');
    writeInstinct(root, 'c', 'when building images');

    assert.strictEqual(runCli(root, ['evolve', '--generate']).status, 0);
    // "analyzing-large-text" is exactly the slug limit and ends on a word, so
    // nothing further may be dropped.
    assert.ok(generatedCommands(root).includes('analyzing-large-text.md'));
  } finally {
    cleanupDir(root);
  }
});

test('every command candidate is generated, not just the first five', () => {
  const root = createTempDir();
  try {
    seedEight(root);

    const result = runCli(root, ['evolve', '--generate']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(
      generatedCommands(root).length,
      EIGHT_TRIGGERS.length,
      'a fixed cap silently dropped candidates'
    );
  } finally {
    cleanupDir(root);
  }
});

test('--limit caps generation and reports what it skipped', () => {
  const root = createTempDir();
  try {
    seedEight(root);

    const result = runCli(root, ['evolve', '--generate', '--limit', '3']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(generatedCommands(root).length, 3);
    assert.match(result.stdout, /writing 3 of 8 command candidates/);
    assert.match(result.stdout, /5 skipped/);
  } finally {
    cleanupDir(root);
  }
});

test('colliding slugs produce distinct files instead of overwriting', () => {
  const root = createTempDir();
  try {
    // Both triggers trim to "investigating".
    writeInstinct(root, 'first', 'when investigating complex systems');
    writeInstinct(root, 'second', 'when investigating extraordinarily convoluted pipelines');
    writeInstinct(root, 'third', 'when running tests');

    assert.strictEqual(runCli(root, ['evolve', '--generate']).status, 0);

    const names = generatedCommands(root);
    assert.ok(names.includes('investigating.md'), `missing base name in ${names}`);
    assert.ok(names.includes('investigating-2.md'), `missing deduped name in ${names}`);
    assert.strictEqual(new Set(names).size, names.length);
  } finally {
    cleanupDir(root);
  }
});

test('preview states how many candidates it left out', () => {
  const root = createTempDir();
  try {
    seedEight(root);

    const result = runCli(root, ['evolve']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /COMMAND CANDIDATES \(8\)/);
    assert.match(result.stdout, /and 3 more command candidates not shown/);
  } finally {
    cleanupDir(root);
  }
});

test('preview names match the files --generate writes', () => {
  const root = createTempDir();
  try {
    writeInstinct(root, 'first', 'when investigating complex systems');
    writeInstinct(root, 'second', 'when investigating extraordinarily convoluted pipelines');
    writeInstinct(root, 'third', 'when running tests');

    const preview = runCli(root, ['evolve']);
    assert.strictEqual(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /\/investigating\b/);
    assert.match(preview.stdout, /\/investigating-2\b/);

    assert.strictEqual(runCli(root, ['evolve', '--generate']).status, 0);
    const names = generatedCommands(root);
    assert.ok(names.includes('investigating.md'));
    assert.ok(names.includes('investigating-2.md'));
  } finally {
    cleanupDir(root);
  }
});

function parseFrontmatter(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0 && !line.startsWith(' ')) {
      fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return fm;
}

test('generated skills carry loadable name + description frontmatter', () => {
  const root = createTempDir();
  try {
    writeInstinct(root, 'first', 'when investigating complex systems');
    writeInstinct(root, 'second', 'when investigating complex systems');
    writeInstinct(root, 'third', 'when running tests');

    assert.strictEqual(runCli(root, ['evolve', '--generate']).status, 0);

    const skillsDir = path.join(root, 'evolved', 'skills');
    const skillDirs = fs.existsSync(skillsDir) ? fs.readdirSync(skillsDir) : [];
    assert.ok(skillDirs.length > 0, 'expected at least one generated skill');

    for (const name of skillDirs) {
      const skillFile = path.join(skillsDir, name, 'SKILL.md');
      const fm = parseFrontmatter(skillFile);
      assert.ok(fm, `${name}/SKILL.md has no frontmatter block`);
      assert.strictEqual(fm.name, name, `${name}: frontmatter name must match its folder`);
      assert.ok(fm.description && fm.description.length > 0, `${name}: description must not be empty`);
      assert.ok(!/[<>]/.test(fm.description), `${name}: description must not contain < or >`);
    }
  } finally {
    cleanupDir(root);
  }
});

test('generated agents carry name + description alongside model/tools', () => {
  const root = createTempDir();
  try {
    writeInstinct(root, 'a', 'when reviewing pull requests');
    writeInstinct(root, 'b', 'when reviewing pull requests');
    writeInstinct(root, 'c', 'when reviewing pull requests');

    assert.strictEqual(runCli(root, ['evolve', '--generate']).status, 0);

    const agentsDir = path.join(root, 'evolved', 'agents');
    const agents = fs.existsSync(agentsDir) ? fs.readdirSync(agentsDir) : [];
    assert.ok(agents.length > 0, 'expected at least one generated agent');

    for (const file of agents) {
      const fm = parseFrontmatter(path.join(agentsDir, file));
      assert.ok(fm, `${file} has no frontmatter block`);
      assert.strictEqual(fm.name, path.basename(file, '.md'));
      assert.ok(fm.description && fm.description.length > 0, `${file}: description must not be empty`);
      assert.strictEqual(fm.model, 'sonnet');
    }
  } finally {
    cleanupDir(root);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
