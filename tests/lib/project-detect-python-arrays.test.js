const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { getPythonDeps, detectProjectType } = require('../../scripts/lib/project-detect');

let passed = 0;
let failed = 0;
function test(name, source, expected, frameworks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-python-array-'));
  try {
    fs.writeFileSync(path.join(root, 'pyproject.toml'), source);
    assert.deepStrictEqual(getPythonDeps(root), expected);
    if (frameworks) assert.deepStrictEqual(detectProjectType(root).frameworks, frameworks);
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}: ${error.message}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('retains a framework requirement containing extras',
  '[project]\ndependencies = ["fastapi[standard]>=0.115"]\n',
  ['fastapi'], ['fastapi']);
test('retains requirements after a dependency containing extras',
  '[project]\ndependencies = ["uvicorn[standard]", "fastapi>=0.115", "flask"]\n',
  ['uvicorn', 'fastapi', 'flask'], ['fastapi', 'flask']);
test('reads literal strings and mixed TOML quote styles',
  "[project]\ndependencies = ['uvicorn[standard]', \"fastapi\", 'flask~=3.0']\n",
  ['uvicorn', 'fastapi', 'flask'], ['fastapi', 'flask']);
test('does not read packages or brackets inside array comments',
  '[project]\ndependencies = [\n # "django" ]\n "fastapi", # "flask"\n "uvicorn[standard]"\n]\n',
  ['fastapi', 'uvicorn'], ['fastapi']);
test('does not select a commented dependency declaration',
  '[project]\n# dependencies = ["django"]\ndependencies = ["flask"]\n',
  ['flask'], ['flask']);
test('keeps comment characters within quoted requirements',
  '[project]\ndependencies = ["flask @ https://example.invalid/pkg.whl#sha256=abcdef", "fastapi"]\n',
  ['flask', 'fastapi'], ['fastapi', 'flask']);
test('keeps escaped quotes in environment markers inside one requirement',
  '[project]\ndependencies = ["fastapi; python_version >= \\"3.11\\"", "flask"]\n',
  ['fastapi', 'flask'], ['fastapi', 'flask']);
test('does not parse an unterminated dependency array',
  '[project]\ndependencies = ["fastapi[standard]"\n',
  [], []);
test('does not use a later table header to close an unfinished dependency array',
  '[project]\ndependencies = ["fastapi",\n[tool.demo]\n',
  [], []);
test('retains dependencies in a project inline table',
  'project = { name = "demo", version = "1.0", dependencies = ["fastapi[standard]", "flask"] }\n',
  ['fastapi', 'flask'], ['fastapi', 'flask']);
test('does not select a dependency declaration inside a quoted value',
  "description = 'dependencies = [\"django\"]'\n[project]\ndependencies = [\"flask\"]\n",
  ['flask'], ['flask']);
test('does not match the suffix of a hyphenated dependency key',
  '[tool.uv]\ndev-dependencies = ["pytest"]\n[project]\ndependencies = ["flask"]\n',
  ['flask'], ['flask']);
test('keeps quotes and fake dependency declarations inside multiline basic descriptions',
  '[project]\ndescription = """A 6" display helper.\ndependencies = ["django"]"""\ndependencies = ["flask"]\n',
  ['flask'], ['flask']);
test('keeps single quotes inside multiline literal descriptions',
  "[project]\ndescription = '''A developer's helper.\ndependencies = [\"django\"]'''\ndependencies = [\"fastapi\"]\n",
  ['fastapi'], ['fastapi']);
test('trims the opening newline of multiline quoted requirements',
  "[project]\ndependencies = ['''\nfastapi''', \"\"\"\r\nflask\"\"\"]\n",
  ['fastapi', 'flask'], ['fastapi', 'flask']);
test('joins escaped newlines inside multiline basic requirements',
  '[project]\ndependencies = ["""fast\\\n  api""", """fl\\ \t\r\n\n  ask"""]\n',
  ['fastapi', 'flask'], ['fastapi', 'flask']);
test('leaves multiline literal backslashes unchanged',
  "[project]\ndependencies = ['''fast\\\napi''']\n",
  ['fast\\'], []);
test('allows one or two quote characters before a multiline closing delimiter',
  '[project]\ndescription = """quoted"""""\ndependencies = ["flask"]\n',
  ['flask'], ['flask']);
test('an unfinished multiline description never exposes a fake dependency array',
  '[project]\ndescription = """A 6" display helper.\ndependencies = ["django"]\n',
  [], []);

const largeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-python-large-array-'));
try {
  const expected = Array.from({ length: 50000 }, (_, index) => `dependency-${index}`);
  fs.writeFileSync(path.join(largeRoot, 'pyproject.toml'),
    `[project]\ndependencies = ${JSON.stringify(expected)}\n`);
  const script = 'const { getPythonDeps } = require(process.argv[1]); '
    + 'process.stdout.write(JSON.stringify(getPythonDeps(process.argv[2])));';
  const result = spawnSync(process.execPath, ['-e', script,
    require.resolve('../../scripts/lib/project-detect'), largeRoot], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), expected);
  passed += 1;
  console.log('  ✓ large dependency arrays preserve source order without repeated copying');
} catch (error) {
  failed += 1;
  console.log(`  ✗ large dependency arrays: ${error.message}`);
} finally {
  fs.rmSync(largeRoot, { recursive: true, force: true });
}

const unfinishedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-python-unfinished-'));
try {
  const script = 'const { getPythonDeps } = require(process.argv[1]); '
    + 'process.stdout.write(JSON.stringify(getPythonDeps(process.argv[2])));';
  const unfinishedSources = [
    '[project]\ndependencies = [\n' + '# abc\n'.repeat(1000),
    '[project]\ndescription = """' + 'line \\" # comment [ ]\n'.repeat(20000),
    "[project]\ndescription = '''" + "a developer's # comment [ ]\n".repeat(20000),
  ];
  for (const source of unfinishedSources) {
    fs.writeFileSync(path.join(unfinishedRoot, 'pyproject.toml'), source);
    const result = spawnSync(process.execPath, ['-e', script,
      require.resolve('../../scripts/lib/project-detect'), unfinishedRoot], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), []);
  }
  passed += 1;
  console.log('  ✓ unfinished arrays and multiline strings complete without backtracking');
} catch (error) {
  failed += 1;
  console.log(`  ✗ an unfinished array with repeated comments: ${error.message}`);
} finally {
  fs.rmSync(unfinishedRoot, { recursive: true, force: true });
}

console.log(`\nPassed: ${passed}, Failed: ${failed}\n`);
process.exitCode = failed > 0 ? 1 : 0;
