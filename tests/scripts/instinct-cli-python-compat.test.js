/**
 * Tests that instinct-cli.py keeps running on old and new Pythons.
 *
 * The CLI supports Python 3.6 and newer, but CI runs a current Python, so a
 * newer-only construct would not fail anywhere until a user on an old
 * interpreter hit it. The static check below parses the script with the
 * oldest grammar ast offers (3.7 on current Pythons, which only adds the
 * async/await keywords) and rejects what that parse misses: unquoted builtin
 * generics and X | Y unions in evaluated annotations, newer-only APIs, and f-string forms
 * from 3.8 and 3.12 that ast does not record.
 * The other cases run the CLI under the strictest warning settings of the
 * current Python and cover the end-of-life notice.
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
import ast, re, sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()
problems = []

try:
    try:
        tree = ast.parse(src, filename=path, feature_version=(3, 6))
    except TypeError:
        # Python 3.6/3.7 lack feature_version; their native parser already
        # rejects newer f-string and statement syntax.
        tree = ast.parse(src, filename=path)
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
        # X | Y in an evaluated annotation is a PEP 604 union on 3.10+; an
        # operand type with its own __or__ could still make it valid earlier.
        if isinstance(sub, ast.BinOp) and isinstance(sub.op, ast.BitOr):
            problems.append("line %d: unquoted X | Y annotation in %s may need 3.10" % (sub.lineno, where))

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

def replacement_fields(literal):
    """Yield the text of each top-level {...} field in an f-string literal."""
    i, n = 0, len(literal)
    while i < n:
        if literal.startswith("{{", i) or literal.startswith("}}", i):
            i += 2
            continue
        if literal[i] != "{":
            i += 1
            continue
        depth, j = 1, i + 1
        while j < n and depth:
            depth += {"{": 1, "}": -1}.get(literal[j], 0)
            j += 1
        yield literal[i + 1:j - 1]
        i = j

def check_fstring(node):
    # ast keeps neither the "=" specifier (3.8) nor how quotes nest (3.12),
    # so read the literal's own source text.
    if not hasattr(ast, "get_source_segment"):
        # Python 3.6/3.7 reject newer f-string forms during the native parse.
        return
    segment = ast.get_source_segment(src, node)
    if not segment:
        return
    body = segment.lstrip("rRbBuUfF")
    quote = body[:3] if body[:3] in ('"""', "'''") else body[:1]
    inner = body[len(quote):len(body) - len(quote)]
    for field in replacement_fields(inner):
        expr = re.split(r"(?<![!=<>])![rsa]\s*(?::|$)|:(?![^\[]*\])", field, maxsplit=1)[0]
        if re.search(r"(?<![=!<>])=\s*$", expr):
            problems.append("line %d: f-string = specifier needs 3.8" % node.lineno)
        if "\\" in field:
            problems.append("line %d: backslash in an f-string field needs 3.12" % node.lineno)
        if quote in field:
            problems.append("line %d: reused quotes in an f-string field need 3.12" % node.lineno)
        if "#" in field:
            problems.append("line %d: comment in an f-string field needs 3.12" % node.lineno)

for node in ast.walk(tree):
    if isinstance(node, ast.JoinedStr):
        check_fstring(node)

for problem in problems:
    print(problem)
`;

function loadAndCall(body, env = {}) {
  const code = [
    'import argparse, importlib.util, sys',
    `spec = importlib.util.spec_from_file_location('icli', ${JSON.stringify(cliPath)})`,
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    body,
  ].join('\n');
  const tmp = createTempDir();
  try {
    const r = runPython(['-c', code], {
      env: { CLV2_HOMUNCULUS_DIR: path.join(tmp, 'homunculus'), ...env },
    });
    if (r.status !== 0) {
      throw new Error(`python exited ${r.status}: ${r.stderr || r.error}`);
    }
    return r;
  } finally {
    cleanupDir(tmp);
  }
}

console.log('\n=== Testing instinct-cli.py Python compatibility ===\n');

test('the script uses nothing newer than Python 3.6', () => {
  const r = runPython(['-c', COMPAT_CHECK, cliPath]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), '', `3.6-incompatible constructs:\n${r.stdout}`);
});

function runCompatCheck(lines) {
  const tmp = createTempDir();
  try {
    const sample = path.join(tmp, 'sample.py');
    fs.writeFileSync(sample, [...lines, ''].join('\n'));
    const r = runPython(['-c', COMPAT_CHECK, sample]);
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout;
  } finally {
    cleanupDir(tmp);
  }
}

// Every line here parses on all supported Pythons, so each finding is
// reported on its own rather than hidden behind a parse error.
test('the compatibility check catches what it is meant to catch', () => {
  const out = runCompatCheck([
    'import subprocess',
    'def f(x: list[str]) -> dict[str, int]:',
    '    subprocess.run(["git"], capture_output=True, text=True)',
    '    return x[0].removeprefix("a")',
    'n = 1',
    'd = {"k": 1}',
    "c = f'{n == 1} {n!r:>4} {d[\"k\"]} {{n=}}'",
    'def g(x: str | None) -> "str | None":',
    '    return x',
    'def h(x: "str | None") -> None:',
    '    pass',
  ]);
  const expectedProblems = [
    'list[...]',
    'dict[...]',
    'capture_output=',
    'text=',
    '.removeprefix()',
    'line 8: unquoted X | Y annotation in g',
  ];
  for (const expected of expectedProblems) {
    assert.ok(out.includes(expected), `missing ${expected} in:\n${out}`);
  }
  for (const unexpected of ['line 7:', 'line 10:']) {
    assert.ok(!out.includes(unexpected), `3.6-valid line flagged:\n${out}`);
  }
  assert.strictEqual((out.match(/X \| Y/g) || []).length, 1, `quoted union flagged:\n${out}`);
});

// Before 3.12 the parser itself rejects some of these forms, and before 3.8
// it rejects the = specifier when asked for the 3.6 grammar. Either the
// specific finding or the parse error counts, so the test holds on any
// Python the CLI supports.
test('the compatibility check rejects f-string forms newer than 3.6', () => {
  const cases = [
    { lines: ['n = 1', 'a = f"{n=}"'], finding: 'line 2: f-string = specifier' },
    { lines: ['d = {"k": 1}', 'b = f"{d["k"]}"'], finding: 'line 2: reused quotes' },
  ];
  for (const { lines, finding } of cases) {
    const out = runCompatCheck(lines);
    assert.ok(
      out.includes(finding) || /^syntax newer than 3\.6 at line 2:/m.test(out),
      `${lines[1]} not rejected:\n${out}`
    );
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
      CLV2_SKIP_PYTHON_EOL_NOTICE: '1',
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

test('an end-of-life Python gets a one-line notice on stderr', () => {
  const r = loadAndCall(
    "m._SUPPORTED_PYTHON = (99, 0)\nm._warn_if_python_eol(argparse.Namespace(command='status'))",
    { CLV2_SKIP_PYTHON_EOL_NOTICE: '' }
  );
  assert.strictEqual(r.stdout, '');
  const lines = r.stderr.trim().split(/\r?\n/);
  assert.strictEqual(lines.length, 1, r.stderr);
  assert.match(lines[0], /^\[instinct-cli\] Python 3\.\d+ is past end of life\. .*99\.0 or newer/);
});

test('the notice stays quiet for --quiet, the opt-out and a supported Python', () => {
  const quiet = loadAndCall(
    "m._SUPPORTED_PYTHON = (99, 0)\nm._warn_if_python_eol(argparse.Namespace(command='prune', quiet=True))",
    { CLV2_SKIP_PYTHON_EOL_NOTICE: '' }
  );
  assert.strictEqual(quiet.stderr, '');

  const optedOut = loadAndCall(
    "m._SUPPORTED_PYTHON = (99, 0)\nm._warn_if_python_eol(argparse.Namespace(command='status'))",
    { CLV2_SKIP_PYTHON_EOL_NOTICE: '1' }
  );
  assert.strictEqual(optedOut.stderr, '');

  const supported = loadAndCall(
    "m._SUPPORTED_PYTHON = (3, 0)\nm._warn_if_python_eol(argparse.Namespace(command='status'))",
    { CLV2_SKIP_PYTHON_EOL_NOTICE: '' }
  );
  assert.strictEqual(supported.stderr, '');
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
