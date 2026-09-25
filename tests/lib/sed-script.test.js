'use strict';
const assert = require('assert');
const { sedScripts, sedScriptTexts, sedExecution } = require('../../scripts/lib/sed-script');

console.log('=== Testing sed-script.js ===\n');

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

console.log('Which arguments are scripts:');
test('the first operand is the script, the others are input files', () => {
  assert.deepStrictEqual(sedScripts(['-n', 's/x/y/p', 'a.txt', 'b.txt']), ['s/x/y/p']);
});
test('with -e, every operand is an input file', () => {
  assert.deepStrictEqual(sedScripts(['-e', 's/x/y/', 'e git push']), ['s/x/y/']);
  assert.deepStrictEqual(sedScripts(['notes.md', '-e', 'p']), ['p']);
});
test('attached and long forms of -e, including a prefix of --expression', () => {
  assert.deepStrictEqual(sedScripts(['-es/x/y/', '--expression=p', '--expr', 'd']), ['s/x/y/', 'p', 'd']);
});
test('-f and --file name a script that is not on the line', () => {
  assert.deepStrictEqual(sedScripts(['-f', 'fix.sed', 'e git push']), []);
  assert.deepStrictEqual(sedScripts(['--file=fix.sed', 'e git push']), []);
});
test('-ie is -i with the backup suffix e', () => {
  assert.deepStrictEqual(sedScripts(['-ie', '-n', 'p', 'notes.md']), ['p']);
});
test('-l takes a value, and -- ends the options', () => {
  assert.deepStrictEqual(sedScripts(['-l', '80', 'p']), ['p']);
  assert.deepStrictEqual(sedScripts(['-n', '--', '-p', 'f']), ['-p']);
});
test('every operand may be a script when the words can still change', () => {
  assert.deepStrictEqual(sedScripts(['$EXPR', 'e git push', 'f'], true), ['$EXPR', 'e git push', 'f']);
});
test('sed joins its scripts into one, unless the words can still change', () => {
  assert.deepStrictEqual(sedScriptTexts(['-e', 'a\\', '-e', 'text']), ['a\\\ntext']);
  assert.deepStrictEqual(sedScriptTexts(['%s', 's/x/y/e'], true), ['%s', 's/x/y/e']);
});

console.log('\nWhat a script runs:');
test('an e command runs its text, to the end of the line', () => {
  assert.deepStrictEqual(sedExecution('e git push; echo done'), {
    commands: ['git push; echo done'],
    runsInput: false,
  });
});
test('an e command without text runs the pattern space', () => {
  assert.deepStrictEqual(sedExecution('1e'), { commands: [], runsInput: true });
});
test('the e flag of s runs the replacement, with any delimiter', () => {
  for (const script of ['s/x/git push/e', 's|x|git push|e', 'sxfooxgit pushxe']) {
    assert.deepStrictEqual(sedExecution(script).commands, ['git push'], script);
  }
});
test('an escaped character in the replacement stands for itself', () => {
  assert.deepStrictEqual(sedExecution('s/x/git\\ push/e').commands, ['git push']);
});
test('the text of a, i and c, a comment and a file name run nothing', () => {
  for (const script of ['1i e git push', '$a e git push', '/x/c e git push', '# e git push', 'w e git push']) {
    assert.deepStrictEqual(sedExecution(script), { commands: [], runsInput: false }, script);
  }
});
test('labels named e are not e commands', () => {
  assert.deepStrictEqual(sedExecution(':e\n$!N;s/\\n/ /;te'), { commands: [], runsInput: false });
});
test('an address regex is not read as a command', () => {
  assert.deepStrictEqual(sedExecution('/s|x|git push|e/p'), { commands: [], runsInput: false });
  assert.deepStrictEqual(sedExecution('\\%s/x/git push/e%p'), { commands: [], runsInput: false });
});
test('an unfinished s command ends the reading: sed rejects the script', () => {
  assert.deepStrictEqual(sedExecution('s/x/y\ne git push'), { commands: [], runsInput: false });
});
test('a y command is read past, whatever its parts hold', () => {
  assert.deepStrictEqual(sedExecution('y/e/E/;e git push').commands, ['git push']);
});

console.log(`\nPassed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
