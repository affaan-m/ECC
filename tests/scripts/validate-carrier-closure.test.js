'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const childProcess = require('node:child_process');
const test = require('node:test');
const { withFixture, write } = require('../lib/helpers/context-fixture');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/ci/validate-carrier-closure.js');

function validator() {
  return require(SCRIPT_PATH);
}

let realRun = null;
function realRegistryRun() {
  if (!realRun) {
    const result = childProcess.spawnSync(process.execPath, [SCRIPT_PATH, '--json'], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000,
    });
    realRun = { status: result.status, stderr: result.stderr, receipt: JSON.parse(result.stdout) };
  }
  return realRun;
}

function plantSkillScript(root, source) {
  write(root, 'skills/ecc-guide/scripts/tool.js', source);
}

function specifiersOf(failures) {
  return failures.map(failure => failure.specifier);
}

test('a planted require that leaves the carrier tree fails with its specifier', () => withFixture(root => {
  const escape = '../../../../../scripts/lib/context-profile-support';
  plantSkillScript(root, `'use strict';\n\nconst support = require('${escape}');\n\nmodule.exports = { support };\n`);
  const result = validator().validate(root);
  assert.equal(result.status, 'failure');
  assert.ok(specifiersOf(result.failures).includes(escape));
  assert.ok(result.failures.some(failure => failure.reason === 'outside-carrier-tree'));
  assert.ok(result.failures.every(failure => failure.file.endsWith('skills/ecc-guide/scripts/tool.js')));
}));

test('a relative require that stays inside the tree but is unplanned fails', () => withFixture(root => {
  plantSkillScript(root, "'use strict';\n\nrequire('../../shared/helper');\n");
  const result = validator().validate(root);
  assert.equal(result.status, 'failure');
  assert.ok(specifiersOf(result.failures).includes('../../shared/helper'));
  assert.ok(result.failures.some(failure => failure.reason === 'unplanned-target'));
}));

test('a dynamic require warns without failing', () => withFixture(root => {
  plantSkillScript(root, "'use strict';\n\nmodule.exports = require(process.env.ECC_PLUGIN_PATH);\n");
  const result = validator().validate(root);
  assert.equal(result.status, 'success');
  assert.deepEqual(result.failures, []);
  assert.ok(result.warnings.length > 0);
  assert.ok(result.warnings.every(warning => warning.expression === 'process.env.ECC_PLUGIN_PATH'));
  assert.ok(result.warnings.every(warning => warning.file.endsWith('skills/ecc-guide/scripts/tool.js')));
  assert.equal(result.dynamicCount, result.warnings.length);
}));

test('a require shape quoted inside a string literal is not a dependency', () => withFixture(root => {
  plantSkillScript(root, "'use strict';\n\nconst snippet = \"require('../../../../../etc/passwd')\";\n\nmodule.exports = { snippet };\n");
  const result = validator().validate(root);
  assert.equal(result.status, 'success');
  assert.deepEqual(result.warnings, []);
}));

test('--json emits a machine-readable receipt and exits zero on a clean registry', () => {
  const { status, stderr, receipt } = realRegistryRun();
  assert.equal(status, 0, stderr);
  assert.equal(receipt.schemaVersion, 'ecc.carrier-closure.v1');
  assert.equal(receipt.projectionCount, receipt.layouts.length * receipt.profiles.length);
  assert.ok(Array.isArray(receipt.warnings));
  assert.ok(Number.isInteger(receipt.scriptCount));
  assert.equal(receipt.loadSmoke, 'deferred');
});

test('the real registry closes: every planned script resolves inside its carrier', () => {
  const { receipt } = realRegistryRun();
  assert.equal(receipt.status, 'success');
  assert.deepEqual(receipt.failures, []);
  assert.equal(receipt.layouts.length, 5);
  assert.deepEqual(receipt.profiles, ['lean@1', 'full@1']);
  assert.ok(receipt.scriptCount > 0, 'expected planned JavaScript files to inspect');
  assert.ok(receipt.resolvedCount > 0, 'expected at least one resolved relative specifier');
  assert.ok(receipt.plannedFileCount > receipt.scriptCount);
});

const SCANNER_CASES = [
  ['division before a require', "const r = a / b; require('./after-division');", ['./after-division']],
  ['regex holding a quote', "const re = /it's/; require('./after-regex');", ['./after-regex']],
  ['regex holding a slash in a class', "const re = /[/]/g; require('./after-class');", ['./after-class']],
  ['regex after return', "function f() { return /x/.test(y); } require('./after-return');", ['./after-return']],
  ['division after a closing paren', "const v = (a) / 2 / 3; require('./after-paren');", ['./after-paren']],
  ['object braces inside an interpolation', "const s = `a ${ {k: 1}.k } b`; require('./after-template');", ['./after-template']],
  ['require text inside a template', "const s = `require('./fake')`;", []],
  ['require inside an interpolation', "const s = `${require('./in-interpolation')}`;", ['./in-interpolation']],
  ['block comment', "/* require('./commented') */ require('./real');", ['./real']],
  ['multi-line import', "import {\n  a,\n  b\n} from\n  './multi';", ['./multi']],
  ['re-export', 'export * from "./reexport.js";', ['./reexport.js']],
  ['path.join from __dirname', "require(path.join(__dirname, '..', 'lib', 'x.js'));", ['./../lib/x.js']],
];

for (const [label, source, expected] of SCANNER_CASES) {
  test(`scanner: ${label}`, () => {
    assert.deepEqual(validator().extractReferences(source).specifiers.sort(), [...expected].sort());
  });
}

test('unknown flags are rejected', () => {
  const result = childProcess.spawnSync(process.execPath, [SCRIPT_PATH, '--write'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument/);
});

test('the gate is registered in the normal test workflow', () => {
  const { scripts } = require('../../package.json');
  assert.equal(scripts['carrier-closure:check'], 'node scripts/ci/validate-carrier-closure.js');
  assert.ok(scripts.test.includes('validate-carrier-closure.js'));
});
