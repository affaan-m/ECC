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

function plantSkillScript(root, source) {
  write(root, 'skills/ecc-guide/scripts/tool.js', source);
}

function specifiersOf(failures) {
  return failures.map(failure => failure.specifier);
}

test('the real registry closes: every planned script resolves inside its carrier', () => {
  const result = validator().validate();
  assert.equal(result.status, 'success');
  assert.deepEqual(result.failures, []);
  assert.equal(result.layouts.length, 5);
  assert.deepEqual(result.profiles, ['lean@1', 'full@1']);
  assert.ok(result.scriptCount > 0, 'expected planned JavaScript files to inspect');
  assert.ok(result.resolvedCount > 0, 'expected at least one resolved relative specifier');
  assert.ok(result.plannedFileCount > result.scriptCount);
});

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
  const result = childProcess.spawnSync(process.execPath, [SCRIPT_PATH, '--json'], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'success');
  assert.equal(receipt.schemaVersion, 'ecc.carrier-closure.v1');
  assert.equal(receipt.projectionCount, receipt.layouts.length * receipt.profiles.length);
  assert.deepEqual(receipt.failures, []);
  assert.ok(Array.isArray(receipt.warnings));
  assert.ok(Number.isInteger(receipt.scriptCount));
  assert.equal(receipt.loadSmoke, 'deferred');
});

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
