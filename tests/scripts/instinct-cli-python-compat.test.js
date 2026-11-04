/**
 * Tests that instinct-cli.py keeps running on old and new Pythons.
 *
 * The CLI supports Python 3.6 and newer, but CI runs a current Python, so a
 * newer-only construct would not fail anywhere until a user on an old
 * interpreter hit it. The static check below parses the script with the 3.6
 * grammar and rejects the runtime constructs a grammar check cannot see:
 * unquoted builtin generics in evaluated annotations and newer-only APIs.
 * The last case runs the CLI under the strictest warning settings of the
 * current Python.
 *
 * Run with: node tests/scripts/instinct-cli-python-compat.test.js
 */

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
    if (r.status === 0 && /Python 3\.(\d+)/.test(r.stdout + r.stderr)) return bin;
  }
  return null;
}

const PYTHON3 = detectPython3();
if (!PYTHON3) {
  console.log('\n=== Testing instinct-cli.py Python compatibility ===\n');
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-instinct-cli-compat-'));
}

function cleanupDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runPython(args, options = {}) {
  return spawnSync(PYTHON3, args, {
    encoding: 'utf8',
    timeout: 60000,
    ...options,
    env: { ...process.env, ...(options.env || {}) },
  });
}

// Prints one line per construct that would break on Python 3.6.
const COMPAT_CHECK = String.raw`
import ast, sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()
problems = []

try:
    tree = ast.parse(src, filename=path, feature_version=(3, 6))
except SyntaxError as exc:
    print("syntax newer than 3.6 at line %s: %s" % (exc.lineno, exc.msg))
    sys.exit(0)

BUILTIN_GENERICS = {"list", "dict", "set", "tuple", "type", "frozenset"}
NEWER_METHODS = {"removeprefix", "removesuffix", "is_relative_to", "with_stem"}
# Keywords newer than 3.6, keyed by the callable they belong to.
NEWER_KEYWORDS = {
    "run": {"capture_output", "text"},
    "Popen": {"text"},
    "check_output": {"text"},
    "copytree": {"dirs_exist_ok"},
    "unlink": {"missing_ok"},
    "zip": {"strict"},
}

def call_name(func):
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return ""

def check_annotation(node, where):
    if node is None:
        return
    for sub in ast.walk(node):
        if (isinstance(sub, ast.Subscript) and isinstance(sub.value, ast.Name)
                and sub.value.id in BUILTIN_GENERICS):
            problems.append("line %d: unquoted %s[...] annotation in %s" % (sub.lineno, sub.value.id, where))

for node in ast.walk(tree):
    if isinstance(node, ast.ImportFrom) and node.module == "__future__":
        for alias in node.names:
            if alias.name == "annotations":
                problems.append("line %d: from __future__ import annotations needs 3.7" % node.lineno)
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        all_args = getattr(node.args, "posonlyargs", []) + node.args.args + node.args.kwonlyargs
        for extra in (node.args.vararg, node.args.kwarg):
            if extra is not None:
                all_args.append(extra)
        for arg in all_args:
            check_annotation(arg.annotation, node.name)
        check_annotation(node.returns, node.name)
    if isinstance(node, ast.AnnAssign):
        check_annotation(node.annotation, "a variable annotation")
    if isinstance(node, ast.Attribute) and node.attr in NEWER_METHODS:
        problems.append("line %d: .%s() is newer than 3.6" % (node.lineno, node.attr))
    if isinstance(node, ast.Call):
        newer = NEWER_KEYWORDS.get(call_name(node.func), set())
        for kw in node.keywords:
            if kw.arg in newer:
                problems.append("line %d: keyword %s= is newer than 3.6" % (node.lineno, kw.arg))

for problem in problems:
    print(problem)
`;

console.log('\n=== Testing instinct-cli.py Python compatibility ===\n');

test('the script uses nothing newer than Python 3.6', () => {
  const r = runPython(['-c', COMPAT_CHECK, cliPath]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), '', `3.6-incompatible constructs:\n${r.stdout}`);
});

test('the compatibility check catches what it is meant to catch', () => {
  const tmp = createTempDir();
  try {
    const sample = path.join(tmp, 'sample.py');
    fs.writeFileSync(
      sample,
      [
        'import subprocess',
        'def f(x: list[str]) -> dict[str, int]:',
        '    subprocess.run(["git"], capture_output=True, text=True)',
        '    return x[0].removeprefix("a")',
        '',
      ].join('\n')
    );
    const r = runPython(['-c', COMPAT_CHECK, sample]);
    assert.strictEqual(r.status, 0, r.stderr);
    for (const expected of ['list[...]', 'dict[...]', 'capture_output=', 'text=', '.removeprefix()']) {
      assert.ok(r.stdout.includes(expected), `missing ${expected} in:\n${r.stdout}`);
    }
  } finally {
    cleanupDir(tmp);
  }
});

test('commands run with every warning turned into an error', () => {
  const tmp = createTempDir();
  try {
    const projectDir = path.join(tmp, 'repo');
    fs.mkdirSync(projectDir, { recursive: true });
    const init = spawnSync('git', ['init', '-q'], { cwd: projectDir, encoding: 'utf8' });
    assert.strictEqual(init.status, 0, init.stderr);

    const env = {
      CLV2_HOMUNCULUS_DIR: path.join(tmp, 'homunculus'),
      CLAUDE_PROJECT_DIR: projectDir,
    };
    const sample = path.join(repoRoot, '.claude', 'homunculus', 'instincts', 'inherited', 'ecc-instincts.yaml');
    const strict = ['-X', 'dev', '-X', 'warn_default_encoding', '-W', 'error', cliPath];
    const commands = [
      ['import', sample, '--force', '--scope', 'global'],
      ['status'],
      ['export', '--output', path.join(tmp, 'export.yaml')],
      ['evolve'],
      ['projects'],
      ['prune', '--dry-run'],
    ];
    for (const command of commands) {
      const r = runPython([...strict, ...command], { cwd: projectDir, env });
      assert.strictEqual(r.status, 0, `${command.join(' ')} exited ${r.status}:\n${r.stderr}`);
    }
  } finally {
    cleanupDir(tmp);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
