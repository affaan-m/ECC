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
  assert.ok(result.warnings.every(warning => warning.kind === 'dynamic' && warning.expression === 'process.env.ECC_PLUGIN_PATH'));
  assert.ok(result.warnings.every(warning => warning.file.endsWith('skills/ecc-guide/scripts/tool.js')));
  assert.equal(result.dynamicCount, result.warnings.length);
}));

test('an absolute require leaves the carrier tree and fails', () => withFixture(root => {
  plantSkillScript(root, "'use strict';\n\nrequire('/opt/shared/helper');\n");
  const result = validator().validate(root);
  assert.equal(result.status, 'failure');
  assert.ok(specifiersOf(result.failures).includes('/opt/shared/helper'));
  assert.ok(result.failures.every(failure => failure.reason === 'outside-carrier-tree'));
}));

for (const specifier of ['C:/shared/helper', 'C:\\shared\\helper', '\\\\server\\share\\helper', 'file:///opt/helper.js']) {
  test(`an absolute Windows or file URL require fails: ${specifier}`, () => withFixture(root => {
    plantSkillScript(root, `'use strict';\n\nrequire(${JSON.stringify(specifier)});\n`);
    const result = validator().validate(root);
    assert.equal(result.status, 'failure');
    assert.ok(result.failures.length > 0);
    assert.ok(result.failures.every(failure => failure.reason === 'outside-carrier-tree'));
    assert.deepEqual(result.warnings, []);
  }));
}

test('a directory require resolves through index.json', () => withFixture(root => {
  write(root, 'skills/ecc-guide/scripts/data/index.json', '{}\n');
  plantSkillScript(root, "'use strict';\n\nmodule.exports = require('./data');\n");
  const result = validator().validate(root);
  assert.equal(result.status, 'success', JSON.stringify(result.failures));
}));

// Node resolves import() and static imports by exact path: no extension
// search and no directory index, even when the calling file is CommonJS.
for (const [label, planned, source] of [
  ['an extensionless import()', 'helper.js', "module.exports = import('./helper');\n"],
  ['a directory import() through index.json', 'data/index.json', "module.exports = import('./data');\n"],
  ['a directory import() through index.js', 'data/index.js', "module.exports = import('./data');\n"],
  ['an extensionless static import', 'helper.js', "import helper from './helper';\nexport default helper;\n"],
]) {
  test(`${label} fails even when the require form would resolve`, () => withFixture(root => {
    write(root, `skills/ecc-guide/scripts/${planned}`, planned.endsWith('.json') ? '{}\n' : 'module.exports = 1;\n');
    plantSkillScript(root, source);
    const result = validator().validate(root);
    assert.equal(result.status, 'failure');
    assert.ok(result.failures.every(failure => failure.reason === 'unplanned-target'));
  }));
}

test('an import() naming the planned file exactly resolves', () => withFixture(root => {
  write(root, 'skills/ecc-guide/scripts/helper.js', 'module.exports = 1;\n');
  plantSkillScript(root, "module.exports = import('./helper.js');\n");
  const result = validator().validate(root);
  assert.equal(result.status, 'success', JSON.stringify(result.failures));
}));

test('an extensionless require still resolves through the CommonJS extension search', () => withFixture(root => {
  write(root, 'skills/ecc-guide/scripts/helper.js', 'module.exports = 1;\n');
  plantSkillScript(root, "module.exports = require('./helper');\n");
  const result = validator().validate(root);
  assert.equal(result.status, 'success', JSON.stringify(result.failures));
}));

// An extensionless require searches only .js, .json and .node, then a
// directory's index; .cjs and .mjs must be named explicitly.
for (const extension of ['cjs', 'mjs']) {
  test(`an extensionless require does not resolve to a .${extension} file`, () => withFixture(root => {
    write(root, `skills/ecc-guide/scripts/helper.${extension}`, 'module.exports = 1;\n');
    plantSkillScript(root, "module.exports = require('./helper');\n");
    const result = validator().validate(root);
    assert.equal(result.status, 'failure');
    assert.ok(result.failures.every(failure => failure.reason === 'unplanned-target'));
  }));
}

test('an extensionless require resolves to a .json file', () => withFixture(root => {
  write(root, 'skills/ecc-guide/scripts/helper.json', '{}\n');
  plantSkillScript(root, "module.exports = require('./helper');\n");
  const result = validator().validate(root);
  assert.equal(result.status, 'success', JSON.stringify(result.failures));
}));

test('an object method named require is not a module load', () => withFixture(root => {
  plantSkillScript(root, "const records = { require: name => name };\nmodule.exports = records.require('./label');\n");
  const result = validator().validate(root);
  assert.equal(result.status, 'success', JSON.stringify(result.failures));
  assert.deepEqual(result.warnings, []);
}));

test('a tagged template named from is not an import', () => withFixture(root => {
  plantSkillScript(root, 'const from = parts => parts[0];\nmodule.exports = from`./helper`;\n');
  const result = validator().validate(root);
  assert.equal(result.status, 'success', JSON.stringify(result.failures));
  assert.deepEqual(result.warnings, []);
}));

test('a backslash-separated relative require fails: Linux and macOS read it as one filename', () => withFixture(root => {
  write(root, 'skills/ecc-guide/scripts/lib/helper.js', 'module.exports = 1;\n');
  plantSkillScript(root, "module.exports = require('./lib\\\\helper.js');\n");
  const result = validator().validate(root);
  assert.equal(result.status, 'failure');
  assert.ok(specifiersOf(result.failures).includes('./lib\\helper.js'));
  assert.ok(result.failures.every(failure => failure.reason === 'non-portable-separator'));
}));

test('a package import warns because carriers ship no node_modules; builtins do not', () => withFixture(root => {
  plantSkillScript(root, "'use strict';\n\nconst yaml = require('js-yaml');\nconst { x } = require('@scope/pkg/deep');\n"
    + "const fs = require('node:fs');\nconst path = require('path');\nmodule.exports = { yaml, x, fs, path };\n");
  const result = validator().validate(root);
  assert.equal(result.status, 'success');
  const packages = result.warnings.filter(warning => warning.kind === 'package').map(warning => warning.package);
  assert.deepEqual([...new Set(packages)].sort(), ['@scope/pkg', 'js-yaml']);
  assert.equal(result.packageCount, packages.length);
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
  ['whitespace before the call paren', "require ('./spaced'); require\n('./newline'); import ('./spaced-import');",
    ['./spaced', './newline', './spaced-import']],
  ['whitespace inside path.join from __dirname', "require (path.join (__dirname, 'lib', 'y.js'));", ['./lib/y.js']],
  ['unicode escape in a specifier', "require('\\u002e./escaped');", ['../escaped']],
  ['hex and braced escapes in a specifier', "require('\\x2e/a'); require(`\\u{2e}/b`);", ['./a', './b']],
  ['escaped quote and backslash', "require('./it\\'s'); require('.\\\\win');", ["./it's", '.\\win']],
  ['regex after an if condition', "if (ok) /['\"]/.test(text); require('./missing');", ['./missing']],
  ['regex after a while condition', "while (more) /\"/.test(s); require('./after-while');", ['./after-while']],
  ['division after a method named if', "const v = a.if(x) / 2, q = \"/\"; require('./after-method');", ['./after-method']],
  ['division after a call inside a condition', "if (f(a) / 2 > 1) { q = \"/\"; } require('./after-nested');", ['./after-nested']],
  ['regex after a block', "if (ok) {} /\"/.test(text); require('./after-block');", ['./after-block']],
  ['division after a method named if across a line break',
    "const n = obj.\nif(x) / 2, q = \"/\"; require('./after-spaced-method');", ['./after-spaced-method']],
  ['division after an optional-chained method named while',
    "const n = obj?. while(x) / 2, q = \"/\"; require('./after-optional');", ['./after-optional']],
  ['a tagged template named from', 'const from = p => p[0]; const s = from`./helper`;', []],
  ['a template import() is still a dependency', 'import(`./templated`);', ['./templated']],
  ['member calls named require or import',
    "r.require('./label'); obj?.import('./x'); obj . require('./y'); obj.\nimport('./z'); require('./real');", ['./real']],
];

test('scanner: computed arguments nested more than one level deep still warn', () => {
  const { dynamic } = validator().extractReferences(
    "require(path.join(__dirname, getName())); require(a(b(c()))); obj.require(hidden());");
  assert.deepEqual(dynamic.sort(), ['a(b(c()))', 'path.join(__dirname, getName())']);
});

for (const [label, source, expected] of SCANNER_CASES) {
  test(`scanner: ${label}`, () => {
    assert.deepEqual(validator().extractReferences(source).specifiers.sort(), [...expected].sort());
  });
}

test('scanner: an identifier named from before a template chunk is not an import', () => {
  assert.deepEqual(validator().extractReferences('const s = `${from} is shipped as ${to}`;'),
    { specifiers: [], imports: [], packages: [], dynamic: [] });
});

test('scanner: import() and static imports are reported apart from require', () => {
  const { specifiers, imports } = validator().extractReferences(
    "require('./a'); import('./b'); import c from './c'; import './d'; require(path.join(__dirname, 'e.js'));");
  assert.deepEqual(specifiers.sort(), ['./a', './b', './c', './d', './e.js']);
  assert.deepEqual(imports.sort(), ['./b', './c', './d']);
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
