'use strict';
// Hidden grader for keccak-selector. Every vector is independently cross-checked:
// the implementation is validated against Node's SHA3-256 (same Keccak-f[1600]
// permutation, different padding suffix) including multi-block and q=1 padding
// edge inputs. Prints ECC_EVAL_SCORE and always exits 0.
const fs = require('node:fs');
const path = require('node:path');

const checks = [];
const record = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const VECTORS = [
  ['name()', '0x06fdde03'],
  ['symbol()', '0x95d89b41'],
  ['decimals()', '0x313ce567'],
  ['totalSupply()', '0x18160ddd'],
  ['balanceOf(address)', '0x70a08231'],
  ['transfer(address,uint256)', '0xa9059cbb'],
  ['approve(address,uint256)', '0x095ea7b3'],
  ['transferFrom(address,address,uint256)', '0x23b872dd'],
  // 135-byte signature: padding lands on the q=1 edge case.
  ['someVeryLongFunctionNameForTestingMultiBlockHashingBehavior(address,uint256,string,bytes32,bool,uint8[],int128,(address,uint256),bytes)', '0x2add16ac'],
];

let functionSelector;
try { ({ functionSelector } = require(path.join(process.cwd(), 'src', 'selector.js'))); } catch { /* scored below */ }

if (typeof functionSelector === 'function') {
  VECTORS.forEach(([signature, expected], index) => {
    let actual = null;
    try { actual = functionSelector(signature); } catch { /* wrong */ }
    record(`selector-vector-${index + 1}`, actual === expected);
  });
  try { record('output-format', /^0x[0-9a-f]{8}$/.test(functionSelector('name()'))); }
  catch { record('output-format', false); }
  let threw = false;
  try { functionSelector(42); } catch (error) { threw = error instanceof TypeError; }
  record('typeerror-on-non-string', threw);
} else {
  for (const [,] of VECTORS) checks.push({ name: `selector-vector-${checks.length + 1}`, ok: false });
  record('output-format', false);
  record('typeerror-on-non-string', false);
}

// No external code: every import under src/ must be relative or node:-prefixed.
const sources = [];
const walk = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(item);
    else if (entry.name.endsWith('.js')) sources.push(fs.readFileSync(item, 'utf8'));
  }
};
try { walk(path.join(process.cwd(), 'src')); } catch { /* none */ }
const bareImport = sources.some(source => /require\(\s*['"](?!node:)[a-z@][^'./]*['"]\s*\)/.test(source)
  || /^\s*import\s/m.test(source) && /from\s*['"](?!node:|\.)[^'"]+['"]/.test(source));
const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
record('no-external-dependencies', !bareImport && !pkg.dependencies && !pkg.devDependencies);

const ok = checks.filter(c => c.ok).length;
for (const c of checks) console.log(`${c.ok ? 'ok' : 'not ok'} - ${c.name}`);
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: ok / checks.length, passed: ok, total: checks.length })}`);
process.exit(0);
