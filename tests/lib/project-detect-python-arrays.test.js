const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exitCode = failed > 0 ? 1 : 0;
