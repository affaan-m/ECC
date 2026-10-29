'use strict';
/**
 * Tests for scripts/lib/gateguard-change-profile.js.
 *
 * Run with: node tests/lib/gateguard-change-profile.test.js
 */

const assert = require('assert');
const path = require('path');

const { profileChange, languageFor, UNKNOWN_PROFILE, MAX_SIDE_BYTES } = require(
  path.join(__dirname, '..', '..', 'scripts', 'lib', 'gateguard-change-profile.js')
);

console.log('=== Testing gateguard-change-profile.js ===\n');

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

const edit = (filePath, oldString, newString) =>
  profileChange({ filePath, tool: 'Edit', edits: [{ old_string: oldString, new_string: newString }], fileText: oldString });
const inFile = (filePath, fileText, oldString, newString, replaceAll = false) =>
  profileChange({ filePath, tool: 'Edit', edits: [{ old_string: oldString, new_string: newString, replace_all: replaceAll }], fileText }).trivial;
const write = (filePath, content) => profileChange({ filePath, tool: 'Write', content });
const surface = (filePath, oldString, newString) => edit(filePath, oldString, newString).touchesPublicSurface;
const data = (filePath, oldString, newString) => edit(filePath, oldString, newString).touchesData;
const trivial = (filePath, oldString, newString) => edit(filePath, oldString, newString).trivial;

// ── languages and bounds ──
console.log('languages and bounds:');

test('supported extensions map to a language; others do not', () => {
  const expected = {
    'a.js': 'js', 'a.mjs': 'js', 'a.cjs': 'js', 'a.jsx': 'js', 'a.ts': 'js', 'a.tsx': 'js', 'a.mts': 'js', 'a.cts': 'js',
    'a.py': 'python', 'a.pyi': 'python', 'a.go': 'go', 'a.rs': 'rust', 'a.java': 'java', 'a.kt': 'kotlin', 'a.kts': 'kotlin',
    'a.cs': 'csharp', 'a.c': 'c', 'a.h': 'c', 'a.cc': 'cpp', 'a.cpp': 'cpp', 'a.cxx': 'cpp', 'a.hpp': 'cpp', 'a.hh': 'cpp',
    'SRC\\A.PY': 'python', 'a.sh': 'shell', 'a.bash': 'shell', 'a.zsh': 'shell', 'a.ps1': 'powershell', 'a.psm1': 'powershell',
    'a.bat': 'batch', 'a.cmd': 'batch', 'B.CMD': 'batch'
  };
  for (const [file, lang] of Object.entries(expected)) assert.strictEqual(languageFor(file), lang, file);
  for (const file of ['a.rb', 'a.fish', 'a.psd1', 'Makefile', 'a.mk', 'a.yaml', 'a.md', 'a', 'a.swift', '', null]) {
    assert.strictEqual(languageFor(file), null, String(file));
  }
});

test('unknown language, bad shapes, and over-bound input give the unknown profile', () => {
  const big = 'x'.repeat(MAX_SIDE_BYTES + 1);
  const cases = [
    edit('a.rb', '# a', '# b'),
    edit('Makefile', '# a', '# b'),
    profileChange({ filePath: 'a.js', tool: 'Edit', edits: [] }),
    profileChange({ filePath: 'a.js', tool: 'Edit', edits: [{ old_string: 1, new_string: 'x' }] }),
    profileChange({ filePath: 'a.js', tool: 'Edit', edits: 'nope' }),
    profileChange({ filePath: 'a.js', tool: 'Write', content: 42 }),
    profileChange({ filePath: 'a.js', tool: 'Read', content: 'x' }),
    profileChange(null),
    profileChange({ filePath: 'a.js', tool: 'Edit', edits: Array.from({ length: 65 }, () => ({ old_string: 'a', new_string: 'b' })) }),
    edit('a.js', big, '// x'),
    edit('a.js', '// x', big),
    write('a.js', big),
    edit('a.js', 'é'.repeat(MAX_SIDE_BYTES / 2 + 1), 'x')
  ];
  for (const [index, profile] of cases.entries()) {
    assert.deepStrictEqual(profile, UNKNOWN_PROFILE, `case ${index}`);
  }
  assert.deepStrictEqual(UNKNOWN_PROFILE, { known: false, language: null, touchesPublicSurface: true, touchesData: true, trivial: false });
  assert.ok(Object.isFrozen(UNKNOWN_PROFILE));
});

test('a combined MultiEdit over the total bound is unknown', () => {
  const chunk = 'y'.repeat(MAX_SIDE_BYTES - 16);
  const edits = Array.from({ length: 5 }, () => ({ old_string: chunk, new_string: chunk }));
  assert.deepStrictEqual(profileChange({ filePath: 'a.js', tool: 'Edit', edits }), UNKNOWN_PROFILE);
});

// ── public surface ──
console.log('\npublic surface:');

test('JS/TS: export, module.exports, exports., and public members touch the surface', () => {
  assert.strictEqual(surface('a.js', 'export function f(a) {', 'export function f(a, b) {'), true);
  assert.strictEqual(surface('a.ts', 'const x = 1;', 'export const x = 1;'), true);
  assert.strictEqual(surface('a.js', 'module.exports = { a };', 'module.exports = { a, b };'), true);
  assert.strictEqual(surface('a.js', 'exports.a = a;', 'exports.a = b;'), true);
  assert.strictEqual(surface('a.ts', '  public run(): void {', '  public run(x: number): void {'), true);
  assert.strictEqual(surface('a.ts', 'export default class A {}', 'export default class B {}'), true);
  assert.strictEqual(surface('types.d.ts', 'type A = string;', 'type A = number;'), true, 'declaration files are all surface');
});

test('JS/TS: body-only changes and look-alike words do not touch the surface', () => {
  assert.strictEqual(surface('a.js', '  return a + 1;', '  return a + 2;'), false);
  assert.strictEqual(surface('a.js', 'const exported = 1;', 'const exported = 2;'), false);
  assert.strictEqual(surface('a.js', 'function exporter() {}', 'function exporter(a) {}'), false);
  assert.strictEqual(surface('a.js', 'const publicKey = k;', 'const publicKey = j;'), false);
});

test('Python: public def/class, dunders, __all__ and __init__.py touch the surface', () => {
  assert.strictEqual(surface('a.py', 'def load(path):', 'def load(path, strict):'), true);
  assert.strictEqual(surface('a.py', '    async def fetch(self):', '    async def fetch(self, x):'), true);
  assert.strictEqual(surface('a.py', 'class Loader:', 'class Loader(Base):'), true);
  assert.strictEqual(surface('a.py', '    def __init__(self):', '    def __init__(self, x):'), true);
  assert.strictEqual(surface('a.py', "__all__ = ['a']", "__all__ = ['a', 'b']"), true);
  assert.strictEqual(surface('pkg/__init__.py', 'x = 1', 'x = 2'), true, '__init__.py is all surface');
  assert.strictEqual(surface('a.py', 'x = 1\nLIMIT = 3', 'x = 1\nLIMIT = 4'), true, 'module-level public name');
});

test('Python: a column-0 constant touches the surface even on the first line of a snippet', () => {
  assert.strictEqual(surface('a.py', 'BASE = "https://a.test/#home"', 'BASE = "https://a.test/#admin"'), true);
  assert.strictEqual(surface('a.py', 'MAX_RETRIES = 3', 'MAX_RETRIES = 4'), true);
  assert.strictEqual(surface('a.py', 'TIMEOUT: float = 1.5', 'TIMEOUT: float = 2.5'), true);
  assert.strictEqual(surface('a.py', 'x = 1\nretries = 3', 'x = 1\nretries = 4'), true, 'public name after the first line');
});

test('Python: private, indented, lowercase first-line and comparison lines stay local', () => {
  assert.strictEqual(surface('a.py', '_BASE = 1', '_BASE = 2'), false, 'private constant');
  assert.strictEqual(surface('a.py', '    LIMIT = 3', '    LIMIT = 4'), false, 'indented');
  assert.strictEqual(surface('a.py', 'result = compute(a)', 'result = compute(b)'), false, 'first line may start mid-line');
  assert.strictEqual(surface('a.py', 'LIMIT == 3', 'LIMIT == 4'), false, 'comparison');
  assert.strictEqual(surface('a.py', 'X1 = 1', 'X1 = 2'), true, 'digits allowed after the first letter');
});

test('Python: private definitions and bodies do not touch the surface', () => {
  assert.strictEqual(surface('a.py', 'def _helper(a):', 'def _helper(a, b):'), false);
  assert.strictEqual(surface('a.py', '    return a + 1', '    return a + 2'), false);
  assert.strictEqual(surface('a.py', '    x = 1', '    x = 2'), false, 'indented assignment');
  assert.strictEqual(surface('a.py', 'x = 1\n_limit = 3', 'x = 1\n_limit = 4'), false, 'module-level private name');
});

test('Go: capitalised declarations touch the surface; lowercase ones do not', () => {
  assert.strictEqual(surface('a.go', 'func Load(p string) error {', 'func Load(p string, s bool) error {'), true);
  assert.strictEqual(surface('a.go', 'func (s *Store) Get(k string) {', 'func (s *Store) Get(k int) {'), true);
  assert.strictEqual(surface('a.go', 'type Config struct {', 'type Config struct { // x'), true);
  assert.strictEqual(surface('a.go', '\tName string', '\tName int'), true, 'exported field');
  assert.strictEqual(surface('a.go', 'func load(p string) {', 'func load(p int) {'), false);
  assert.strictEqual(surface('a.go', 'func (s *store) get() {', 'func (s *store) get(k int) {'), false);
  assert.strictEqual(surface('a.go', '\treturn x + 1', '\treturn x + 2'), false);
});

test('Rust: pub items, impl/trait blocks and macro exports touch the surface', () => {
  assert.strictEqual(surface('a.rs', 'pub fn load() {', 'pub fn load(x: u8) {'), true);
  assert.strictEqual(surface('a.rs', 'pub(crate) fn load() {', 'pub(crate) fn load(x: u8) {'), true);
  assert.strictEqual(surface('a.rs', 'impl Display for A {', 'impl Debug for A {'), true);
  assert.strictEqual(surface('a.rs', '#[macro_export]\nmacro_rules! m {', '#[macro_export]\nmacro_rules! n {'), true);
  assert.strictEqual(surface('a.rs', 'fn load() {', 'fn load(x: u8) {'), false);
  assert.strictEqual(surface('a.rs', '    x + 1', '    x + 2'), false);
  assert.strictEqual(surface('a.rs', 'let publish = 1;', 'let publish = 2;'), false);
});

test('Rust: derive, repr, no_mangle and extern items touch the surface', () => {
  assert.strictEqual(surface('a.rs', '#[derive(Clone)]', '#[derive(Clone, Copy)]'), true);
  assert.strictEqual(surface('a.rs', '#[repr(C)]', '#[repr(packed)]'), true);
  assert.strictEqual(surface('a.rs', '#[no_mangle]', '#[export_name = "f"]'), true);
  assert.strictEqual(surface('a.rs', 'extern "C" fn f() {}', 'extern "C" fn f(x: i32) {}'), true);
  assert.strictEqual(surface('a.rs', '#[inline]', '#[inline(always)]'), false);
});

test('members of exported containers touch the surface when the file shows the container', () => {
  const inside = (filePath, fileText, oldString, newString) =>
    profileChange({ filePath, tool: 'Edit', edits: [{ old_string: oldString, new_string: newString }], fileText }).touchesPublicSurface;
  const hits = [
    ['a.js', 'module.exports = {\n  parse,\n  format,\n};\n', '  format,\n', ''],
    ['a.js', 'exports.defaults = {\n  retries: 3,\n};\n', '  retries: 3,', '  retries: 5,'],
    ['a.ts', 'export interface Options {\n  timeout: number;\n}\n', '  timeout: number;', '  timeout?: number;'],
    ['a.ts', 'export enum Color {\n  Red,\n  Green,\n}\n', '  Green,\n', ''],
    ['a.ts', 'export type Mode =\n  | "a"\n  | "b";\n', '  | "b";', '  | "c";'],
    ['a.ts', 'export declare namespace N {\n  const x: number;\n}\n', '  const x: number;', '  const x: string;'],
    ['a.js', 'export const defaults = {\n  retries: 3,\n};\n', '  retries: 3,', '  retries: 5,'],
    ['a.js', 'export {\n  parse,\n  format,\n};\n', '  format,\n', ''],
    ['a.ts', 'export class Client {\n  constructor(private url: string) {}\n\n  get(path: string) {\n    return 1;\n  }\n}\n', '  get(path: string) {', '  get(path: string, opts?: object) {'],
    ['a.ts', 'export default class Client {\n  static retries = 3;\n}\n', '  static retries = 3;', '  static retries = 5;'],
    ['a.py', '__all__ = [\n    "a",\n    "b",\n]\n', '    "b",\n', ''],
    ['a.py', '@dataclass\nclass Options:\n    timeout: int = 5\n', '    timeout: int = 5', '    timeout: float = 5.0'],
    ['a.py', 'class Options:\n    """Doc."""\n    retries = 3\n', '    retries = 3', '    retries = 5'],
    ['a.rs', 'pub enum E {\n    A,\n    B,\n}\n', '    B,\n', ''],
    ['a.rs', 'pub struct S {\n    a: u8,\n}\n', '    a: u8,', '    a: u16,'],
    ['a.rs', 'pub trait T {\n    fn f(&self);\n}\n', '    fn f(&self);', '    fn f(&self, x: u8);'],
    ['a.rs', 'pub use crate::{\n    a,\n    b,\n};\n', '    b,\n', '']
  ];
  for (const [file, text, before, after] of hits) assert.strictEqual(inside(file, text, before, after), true, `${file}: ${JSON.stringify(before)}`);
  const misses = [
    ['a.js', 'export function f() {\n  return 1;\n}\n', '  return 1;', '  return 2;'],
    ['a.js', 'export const handler = async (req) => {\n  return 1;\n};\n', '  return 1;', '  return 2;'],
    ['a.js', 'module.exports = function (x) {\n  return x;\n};\n', '  return x;', '  return x + 1;'],
    ['a.ts', 'export class Client {\n  get(path: string) {\n    return 1;\n  }\n}\n', '    return 1;', '    return 2;'],
    ['a.js', 'function local() {\n  return 1;\n}\nmodule.exports = { local };\n', '  return 1;', '  return 2;'],
    ['a.py', 'class Options:\n    def run(self):\n        x = 1\n', '        x = 1', '        x = 2'],
    ['a.py', 'class _Private:\n    x = 1\n', '    x = 1', '    x = 2'],
    ['a.py', 'def f():\n    x = 1\n', '    x = 1', '    x = 2'],
    ['a.rs', 'pub struct S {\n    a: u8,\n}\n\nfn f() {\n    x();\n}\n', '    x();', '    y();'],
    ['a.rs', 'impl S {\n    fn helper(&self) {\n        x();\n    }\n}\n', '        x();', '        y();']
  ];
  for (const [file, text, before, after] of misses) assert.strictEqual(inside(file, text, before, after), false, `${file}: ${JSON.stringify(before)}`);
});

test('Java, Kotlin, C#, C and C++ always count as touching the surface', () => {
  for (const file of ['a.java', 'a.kt', 'a.cs', 'a.c', 'a.cpp']) {
    const profile = edit(file, 'x = 1;', 'x = 2;');
    assert.strictEqual(profile.known, true, file);
    assert.strictEqual(profile.touchesPublicSurface, true, file);
  }
});

test('Write always touches the surface', () => {
  const profile = write('a.js', 'const x = 1;\n');
  assert.strictEqual(profile.known, true);
  assert.strictEqual(profile.touchesPublicSurface, true);
  assert.strictEqual(profile.trivial, false);
});

// ── shell scripts ──
console.log('\nshell scripts:');

test('shell: function definitions and exported variables touch the surface', () => {
  const hits = [
    ['a.sh', 'deploy() {', 'deploy() {\n  set -e'],
    ['a.sh', 'function deploy {', 'function deploy_all {'],
    ['a.bash', 'function deploy() {', 'function deploy(){'],
    ['a.zsh', 'my-helper () {', 'my-helper () { :'],
    ['a.sh', 'export PATH="$HOME/bin:$PATH"', 'export PATH="$HOME/.local/bin:$PATH"'],
    ['a.sh', 'declare -x MODE=a', 'declare -x MODE=b'],
    ['a.ps1', 'function Get-Item2 {', 'function Get-Item2 { param($x)'],
    ['a.psm1', 'Export-ModuleMember -Function Get-A', 'Export-ModuleMember -Function Get-A, Get-B'],
    ['a.ps1', 'param([string]$Path)', 'param([string]$Path, [switch]$Force)'],
    ['a.ps1', '[CmdletBinding()]', '[CmdletBinding(SupportsShouldProcess)]'],
    ['a.ps1', 'FILTER Only-Odd { }', 'FILTER Only-Odd { $_ }'],
    ['a.bat', 'set X=1', 'set X=2']
  ];
  for (const [file, before, after] of hits) assert.strictEqual(surface(file, before, after), true, `${file}: ${before}`);
});

test('shell: bodies and local variables do not touch the surface', () => {
  const misses = [
    ['a.sh', '  echo "building"', '  echo "building all"'],
    ['a.sh', '  local dir=$1', '  local dir=$2'],
    ['a.sh', 'count=1', 'count=2'],
    ['a.sh', '  exporter --run', '  exporter --run --fast'],
    ['a.ps1', '  Write-Output $x', '  Write-Output $y'],
    ['a.ps1', '  $functionName = 1', '  $functionName = 2']
  ];
  for (const [file, before, after] of misses) assert.strictEqual(surface(file, before, after), false, `${file}: ${before}`);
});

test('shell: redirection to files, HTTP clients, jq and CSV touch data', () => {
  const hits = [
    ['a.sh', 'echo "$line" >> "$OUT"'],
    ['a.sh', 'sort < input.txt'],
    ['a.sh', 'cmd &> run.log'],
    ['a.sh', 'curl -s "$URL"'],
    ['a.sh', 'wget -q "$URL"'],
    ['a.sh', "jq -r '.items[]'"],
    ['a.sh', 'cut -d, -f2 report.csv'],
    ['a.ps1', '$r = Invoke-RestMethod $u'],
    ['a.ps1', 'Get-Content $p | Out-File out.txt'],
    ['a.ps1', 'Import-Csv rows.csv'],
    ['a.ps1', 'Set-Content -Path $p -Value $v'],
    ['a.bat', 'type a.txt > b.txt']
  ];
  for (const [file, text] of hits) assert.strictEqual(data(file, 'x=1', text), true, `${file}: ${text}`);
});

test('shell: descriptor duplication and null devices do not touch data', () => {
  const misses = [
    ['a.sh', 'make build 2>&1'],
    ['a.sh', 'command -v git >/dev/null 2>&1'],
    ['a.sh', 'echo "done" >&2'],
    ['a.sh', 'if [ "$a" -gt 1 ]; then echo hi; fi'],
    ['a.ps1', 'git fetch > $null'],
    ['a.ps1', 'Write-Output ($a -gt 1)'],
    ['a.bat', 'del tmp >nul 2>&1']
  ];
  for (const [file, text] of misses) assert.strictEqual(data(file, 'x=1', text), false, `${file}: ${text}`);
});

test('shell: comment-only and whitespace-only edits are trivial', () => {
  const cases = [
    ['a.sh', '# build\n', '# Build all targets.\n'],
    ['a.sh', 'make all  # old', 'make all  # new'],
    ['a.sh', 'make   all', 'make all'],
    ['a.bash', 'n=${#arr[@]} # old', 'n=${#arr[@]} # new'],
    ['a.sh', 'echo "$#" ; # old', 'echo "$#" ; # new'],
    ['a.sh', 'echo "${name}" # old', 'echo "${name}" # new'],
    ['a.zsh', 'if true; then\n  x\nfi', 'if true; then\n    x\nfi'],
    ['a.ps1', '# old\nGet-Item a', '# new\nGet-Item a'],
    ['a.ps1', '<# old\nhelp #>\nGet-Item a', '<# new\nhelp #>\nGet-Item a'],
    ['a.ps1', "Write-Output 'a''b' # old", "Write-Output 'a''b' # new"],
    ['a.bat', 'REM old\necho a', 'REM new\necho a'],
    ['a.cmd', '@rem old\necho a', '@REM new\necho a'],
    ['a.bat', 'echo a\n\necho b', 'echo a\necho b']
  ];
  for (const [file, before, after] of cases) {
    assert.strictEqual(trivial(file, before, after), true, `${file}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }
});

test('shell: # inside strings, words, heredocs and substitutions is never a comment', () => {
  const cases = [
    ['a.sh', 'echo "a # b"', 'echo "a # c"'],
    ['a.sh', "echo 'a # b'", "echo 'a # c'"],
    ['a.sh', 'echo a#b', 'echo a#c'],
    ['a.sh', 'x=#old', 'x=#new'],
    ['a.sh', 'cat <<EOF\n# a\nEOF', 'cat <<EOF\n# b\nEOF'],
    ['a.sh', 'cat <<-EOF\n\t# a\n\tEOF', 'cat <<-EOF\n\t# b\n\tEOF'],
    ['a.sh', "cat <<'EOF'\n# a\nEOF", "cat <<'EOF'\n# b\nEOF"],
    ['a.bash', 'grep x <<< "# a"', 'grep x <<< "# b"'],
    ['a.sh', 'echo "$(printf " #a")"', 'echo "$(printf " #b")"'],
    ['a.sh', 'echo "${x:-" #a"}"', 'echo "${x:-" #b"}"'],
    ['a.sh', 'echo `echo #a`', 'echo `echo #b`'],
    ['a.bash', "echo $'it\\'s' # a", "echo $'it\\'s' # b"],
    ['a.sh', "echo 'a\\' '  x  '", "echo 'a\\' ' x '"],
    ['a.sh', 'echo a\\  b', 'echo a\\ b'],
    ['a.zsh', 'print -l *(#q.) # a', 'print -l *(#q.) # b'],
    ['a.sh', 'echo "multi\n# a"', 'echo "multi\n# b"'],
    ['a.ps1', 'Write-Output "a # b"', 'Write-Output "a # c"'],
    ['a.ps1', "Write-Output 'a # b'", "Write-Output 'a # c'"],
    ['a.ps1', 'Write-Output a#b', 'Write-Output a#c'],
    ['a.ps1', '$s = @"\n# a\n"@', '$s = @"\n# b\n"@'],
    ['a.ps1', "$s = @'\n# a\n'@", "$s = @'\n# b\n'@"],
    ['a.ps1', 'Write-Output "$(Get-X " #a")"', 'Write-Output "$(Get-X " #b")"'],
    ['a.ps1', 'Write-Output \u201ca # b\u201d', 'Write-Output \u201ca # c\u201d']
  ];
  for (const [file, before, after] of cases) {
    assert.strictEqual(trivial(file, before, after), false, `${file}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }
});

test('shell: directives, continuations and significant whitespace are never trivial', () => {
  const cases = [
    ['a.sh', '#!/bin/bash\nset -e', '#!/bin/sh\nset -e'],
    ['a.sh', 'make \\\n  all', 'make \\\n# note\n  all'],
    ['a.sh', 'echo a  # old', 'echo a\\ # new'],
    ['a.ps1', '#Requires -Version 5\nGet-Item a', '#Requires -Version 7\nGet-Item a'],
    ['a.ps1', '#requires -RunAsAdministrator', '# requires nothing'],
    ['a.ps1', 'Get-Item `\n  a', 'Get-Item `\n# note\n  a'],
    ['a.ps1', '<# a <# b #> #>', '<# a <# c #> #>'],
    ['a.ps1', 'Get-Item a <# old #>', 'Get-Item a<# new #>'],
    ['a.bat', 'echo a  b', 'echo a b'],
    ['a.bat', ':: old\necho a', ':: new\necho a'],
    ['a.bat', 'REM 100%\necho a', 'REM 50%\necho a'],
    ['a.bat', 'echo a ^\nREM old', 'echo a ^\nREM new'],
    ['a.bat', 'echo a & REM old', 'echo a & REM new'],
    ['a.bat', 'REMARK old', 'REMARK new'],
    ['a.sh', 'echo a\r#b', 'echo a\r#c'],
    ['a.sh', 'echo a\vb', 'echo a b'],
    ['a.ps1', 'Write-Output a\u00a0#b', 'Write-Output a\u00a0#c'],
    ['a.bat', '\vREM old\necho a', '\vREM new\necho a'],
    ['a.bat', '(\n  REM old)\n  echo a\n)', '(\n  REM new)\n  echo a\n)'],
    ['a.bat', 'REM a > b', 'REM a > c']
  ];
  for (const [file, before, after] of cases) {
    assert.strictEqual(trivial(file, before, after), false, `${file}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }
});

// ── data ──
console.log('\ndata:');

test('file I/O, serialisation, SQL, schema and date handling touch data', () => {
  const hits = [
    ['a.js', 'const cfg = JSON.parse(raw);'],
    ['a.js', "const text = fs.readFileSync(p, 'utf8');"],
    ['a.ts', 'await writeFile(out, body);'],
    ['a.py', "with open(path) as fh:"],
    ['a.py', 'rows = csv.reader(fh)'],
    ['a.py', 'doc = yaml.safe_load(fh)'],
    ['a.py', "stamp = datetime.now().strftime('%Y')"],
    ['a.js', 'const when = new Date(ts).toISOString();'],
    ['a.go', 'err := json.Unmarshal(b, &v)'],
    ['a.go', 'f, err := os.Open(p)'],
    ['a.rs', 'let s = std::fs::read_to_string(p)?;'],
    ['a.rs', 'let v: T = serde_json::from_str(&s)?;'],
    ['a.java', 'rs = stmt.executeQuery("select id from users");'],
    ['a.py', 'cur.execute("INSERT INTO t VALUES (1)")'],
    ['a.ts', 'const schema = z.object({});'],
    ['a.py', 'df = pd.read_parquet(p)'],
    ['a.cs', 'var created = DateTime.UtcNow;'],
    ['a.kt', 'val ts = Instant.now().toEpochMilli() // timestamp']
  ];
  for (const [file, text] of hits) {
    assert.strictEqual(edit(file, 'x = 1', `${text}\n`).touchesData, true, `${file}: ${text}`);
  }
});

test('clock reads, encodings, browser storage and data stores touch data', () => {
  const hits = [
    ['a.go', 't := time.Now()'],
    ['a.go', 'd, err := time.ParseDuration(s)'],
    ['a.py', 'started = time.time()'],
    ['a.rs', 'let now = SystemTime::now();'],
    ['a.rs', 'let t = chrono::Local::now();'],
    ['a.py', 'zone = ZoneInfo("UTC")'],
    ['a.js', 'const raw = Buffer.from(s, "base64");'],
    ['a.js', 'localStorage.setItem("k", v);'],
    ['a.js', 'document.cookie = v;'],
    ['a.py', 'packed = msgpack.packb(v)'],
    ['a.js', 'await prisma.user.findMany();'],
    ['a.py', 'engine = sqlalchemy.create_engine(url)'],
    ['a.js', 'const text = new TextDecoder(encoding).decode(bytes);']
  ];
  for (const [file, text] of hits) assert.strictEqual(data(file, 'x = 1', text), true, `${file}: ${text}`);
  const misses = [['a.js', 'setTimeout(run, 10);'], ['a.go', 'ctx, cancel := context.WithTimeout(ctx, d)'], ['a.py', 'runtime = compute()']];
  for (const [file, text] of misses) assert.strictEqual(data(file, 'x = 1', text), false, `${file}: ${text}`);
});

test('ordinary logic and look-alike words do not touch data', () => {
  const misses = [
    ['a.js', 'return a + b;'],
    ['a.js', 'const updated = validate(candidate);'],
    ['a.py', 'total = sum(values) / count'],
    ['a.go', 'if n > limit { return errTooMany }'],
    ['a.rs', 'let reopened = retry(opener);'],
    ['a.js', 'button.opened = true;']
  ];
  for (const [file, text] of misses) {
    assert.strictEqual(data(file, 'x = 1', text), false, `${file}: ${text}`);
  }
});

test('data is judged on both sides of an Edit and on Write content', () => {
  assert.strictEqual(data('a.js', 'JSON.parse(x)', 'parse(x)'), true, 'removed data handling still counts');
  assert.strictEqual(write('a.py', 'import json\n').touchesData, true);
  assert.strictEqual(write('a.py', 'def f():\n    return 1\n').touchesData, false);
});

// ── trivial ──
console.log('\ntrivial:');

test('comment-only and whitespace-only edits are trivial in every supported language', () => {
  const cases = [
    ['a.js', '// old note\nfoo();', '// new note\nfoo();'],
    ['a.js', 'foo(); // old', 'foo(); // new'],
    ['a.js', '/* a\n * b\n */\nfoo();', '/* a\n * c\n */\nfoo();'],
    ['a.js', 'if (x) {\n  foo();\n}', 'if (x) {\n    foo();\n}'],
    ['a.js', 'foo(a,  b);', 'foo(a, b);   '],
    ['a.js', 'foo();\n\nbar();', 'foo();\nbar();'],
    ['a.js', 'foo();', '// added\nfoo();'],
    ['a.ts', "const s = 'x'; // why", "const s = 'x'; // because"],
    ['a.py', '# old\nx = 1', '# new\nx = 1'],
    ['a.py', 'x = 1  # old', 'x = 1  # new'],
    ['a.py', "s = 'a#b'  # old", "s = 'a#b'  # new"],
    ['a.go', '\t// Load loads.\n\treturn nil', '\t// Load reads.\n\treturn nil'],
    ['a.rs', "fn f<'a>(x: &'a str) {} // old", "fn f<'a>(x: &'a str) {} // new"],
    ['a.rs', "let c = '\"'; // old", "let c = '\"'; // new"],
    ['a.java', 'int x = 1; // old', 'int x = 1; // new'],
    ['a.kt', 'val x = "a" // old', 'val x = "a" // new'],
    ['a.cs', 'var x = "a"; // old', 'var x = "a"; // new'],
    ['a.c', '#include <stdio.h>\n/* old */', '#include <stdio.h>\n/* new */'],
    ['a.cpp', "char c = 'x'; // old", "char c = 'x'; // new"]
  ];
  for (const [file, before, after] of cases) {
    assert.strictEqual(trivial(file, before, after), true, `${file}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }
});

test('a comment change that also edits code is not trivial', () => {
  assert.strictEqual(trivial('a.js', '// old\nfoo(1);', '// new\nfoo(2);'), false);
  assert.strictEqual(trivial('a.py', 'x = 1  # old', 'x = 2  # new'), false);
  assert.strictEqual(trivial('a.js', 'foo();', 'foo();\nbar();'), false);
  assert.strictEqual(trivial('a.js', 'foo(); bar();', 'foo();\nbar();'), false, 'line structure is code');
});

test('whitespace inside strings and between tokens is code', () => {
  assert.strictEqual(trivial('a.js', "s = 'a b';", "s = 'a  b';"), false);
  assert.strictEqual(trivial('a.js', 'x = a+b;', 'x = a + b;'), false);
  assert.strictEqual(trivial('a.py', 'x = f"a"', 'x = f "a"'), false);
  assert.strictEqual(trivial('a.c', 'int x;', 'intx;'), false);
  assert.strictEqual(trivial('a.c', 'a/* c */b', 'ab'), false);
});

test('indentation changes are never trivial in Python', () => {
  assert.strictEqual(trivial('a.py', 'if x:\n    y()', 'if x:\n        y()'), false);
  assert.strictEqual(trivial('a.py', 'if x:\n    y()', 'if x:\n\ty()'), false);
  assert.strictEqual(trivial('a.py', 'if x:\n    y()\n    # note', 'if x:\n    y()\n        # note moved'), true, 'comment lines carry no indentation');
});

test('C preprocessor lines are code', () => {
  assert.strictEqual(trivial('a.c', '#define LIMIT 1', '#define LIMIT 2'), false);
  assert.strictEqual(trivial('a.h', '#include "a.h"', '#include "b.h"'), false);
  assert.strictEqual(trivial('a.c', '#if 0\nx();\n#endif', '#if 1\nx();\n#endif'), false);
});

test('multi-line strings, templates and raw strings are never trivial', () => {
  const cases = [
    ['a.js', 'const s = `\n// a\n`;', 'const s = `\n// b\n`;'],
    ['a.js', '// a\n`;', '// b\n`;'],
    ['a.go', 'q := `\n// a\n`', 'q := `\n// b\n`'],
    ['a.py', 'x = """\n# a\n"""', 'x = """\n# b\n"""'],
    ['a.py', "x = '''# a'''", "x = '''# b'''"],
    ['a.py', 'x = f"{d["#"]}"  # old', 'x = f"{d["#"]}"  # new'],
    ['a.java', 'String s = """\n// a\n""";', 'String s = """\n// b\n""";'],
    ['a.kt', 'val s = "${m["//"]}" // a', 'val s = "${m["//"]}" // b'],
    ['a.cs', 'var s = @"a\n// a";', 'var s = @"a\n// b";'],
    ['a.cs', 'var s = $"{d["//"]}"; // a', 'var s = $"{d["//"]}"; // b'],
    ['a.rs', 'let s = r#"// a"#;', 'let s = r#"// b"#;'],
    ['a.rs', 'let s = "line\n// a";', 'let s = "line\n// b";'],
    ['a.cpp', 'auto s = R"(// a)";', 'auto s = R"(// b)";'],
    ['a.c', 'char *s = "a\\\n// a";', 'char *s = "a\\\n// b";']
  ];
  for (const [file, before, after] of cases) {
    assert.strictEqual(trivial(file, before, after), false, `${file}: ${JSON.stringify(before)}`);
  }
});

test('ambiguous JS syntax is never trivial', () => {
  assert.strictEqual(trivial('a.js', "x = /'/; y = '//'", "x = /'/; y = '//x'"), false, 'regex literal');
  assert.strictEqual(trivial('a.js', 'x = a / b; // old', 'x = a / b; // new'), false, 'division');
  assert.strictEqual(trivial('a.jsx', '<p>// old</p>', '<p>// new</p>'), false, 'JSX text');
  assert.strictEqual(trivial('a.js', 'x = 1;\n--> old', 'x = 1;\n--> new'), false, 'HTML close comment');
});

test('comment tricks that can hide code are never trivial', () => {
  assert.strictEqual(trivial('a.c', '// note\nx();', '// note \\\nx();'), false, 'backslash continues a C line comment');
  assert.strictEqual(trivial('a.c', '// note\nx();', '// note ??/\nx();'), false, 'trigraph continuation');
  assert.strictEqual(trivial('a.rs', '/* a /* b */ */', '/* a /* c */ */'), false, 'nested block comment');
  assert.strictEqual(trivial('a.js', '/* open', '/* still open'), false, 'unterminated block comment');
  assert.strictEqual(trivial('a.js', "s = 'open", "s = 'open2"), false, 'unterminated string');
  assert.strictEqual(trivial('a.py', 'x = a \\\n  + b', 'x = a \\  \n  + b'), false, 'whitespace after a line continuation');
});

test('a code line ending in a line continuation is never trivial', () => {
  const cases = [
    ['a.c', '#define A 1 \\\n// c\nint x;', '#define A 1 \\\nint x;'],
    ['a.c', '#define A 1 \\\nint x;', '#define A 1 \\\n// c\nint x;'],
    ['a.cpp', '#define F(x) \\\n  /* a */ (x)', '#define F(x) \\\n  /* b */ (x)'],
    ['a.h', 'int x; \\', 'int x; \\ '],
    ['a.py', 'y = 1 + \\\n    2\n# c', 'y = 1 + \\\n    2'],
    ['a.py', 'y = 1 + \\', 'y = 1 +  \\'],
    ['a.js', "s = 'a' + \\\n// c", "s = 'a' + \\\n// d"]
  ];
  for (const [file, before, after] of cases) {
    assert.strictEqual(trivial(file, before, after), false, `${file}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }
});

test('directive comments are code: shebangs, encodings, type, lint and build directives', () => {
  const cases = [
    ['a.py', '#!/usr/bin/env python3\nprint(1)', '#!/usr/bin/env -S python3 -X dev\nprint(1)'],
    ['a.py', '# -*- coding: utf-8 -*-\ns = 1', '# -*- coding: latin-1 -*-\ns = 1'],
    ['a.py', '# vim: set fileencoding=utf-8 :\ns = 1', '# vim: set fileencoding=latin-1 :\ns = 1'],
    ['a.py', 'x = f()  # type: ignore', 'x = f()  # ok'],
    ['a.py', 'import os  # noqa: F401', 'import os  # unused'],
    ['a.py', 'x = 1  # pylint: disable=invalid-name', 'x = 1  # fine'],
    ['a.py', 'call(cmd, shell=True)  # nosec', 'call(cmd, shell=True)  # reviewed'],
    ['a.py', 'def f():  # pragma: no cover\n    pass', 'def f():  # rarely hit\n    pass'],
    ['a.py', 'x = 1', 'x = 1  # fmt: skip'],
    ['a.ts', '// @ts-expect-error\nconst n: number = s;', '// expected\nconst n: number = s;'],
    ['a.ts', 'const n = s; // @ts-ignore', 'const n = s; // ignore'],
    ['a.ts', '/// <reference types="node" />\nx();', '/// <reference types="deno" />\nx();'],
    ['a.js', '/* eslint-disable no-eval */\neval(x);', '/* note */\neval(x);'],
    ['a.js', 'eval(x); // eslint-disable-line', 'eval(x); // reviewed'],
    ['a.js', 'const m = import(/* webpackChunkName: "a" */ "./a");', 'const m = import(/* webpackChunkName: "b" */ "./a");'],
    ['a.js', 'const v = /*#__PURE__*/ make();', 'const v = /* pure */ make();'],
    ['a.js', '// @flow\nx();', '// flow\nx();'],
    ['a.js', '/** @type {number} */\nlet n;', '/** @type {string} */\nlet n;'],
    ['a.js', '/* global jQuery */\njQuery();', '/* jQuery */\njQuery();'],
    ['a.js', 'x(); // istanbul ignore next', 'x(); // rarely'],
    ['a.js', 'x(); // prettier-ignore', 'x(); // keep'],
    ['a.go', '//go:build linux\n\npackage o', '//go:build ignore\n\npackage o'],
    ['a.go', '// +build linux\n\npackage o', '// +build ignore\n\npackage o'],
    ['a.go', '//go:embed a.txt\nvar s string', '//go:embed b.txt\nvar s string'],
    ['a.go', '//go:generate stringer -type=A\ntype A int', '//go:generate rm -rf .\ntype A int'],
    ['a.go', '//export Add\nfunc Add() {}', '// Add adds\nfunc Add() {}'],
    ['a.go', 'x := f() //nolint:errcheck', 'x := f() // fine'],
    ['a.go', '// Code generated by protoc. DO NOT EDIT.\npackage p', '// Written by hand.\npackage p'],
    ['a.rs', '/// ```\n/// assert!(true);\n/// ```\nfn f() {}', '/// ```\n/// assert!(false);\n/// ```\nfn f() {}'],
    ['a.rs', '//! assert!(true);\nfn f() {}', '//! assert!(false);\nfn f() {}'],
    ['a.rs', '/** assert!(true); */\nfn f() {}', '/** assert!(false); */\nfn f() {}'],
    ['a.c', 'case 1: x(); /* fallthrough */\ncase 2: y();', 'case 1: x(); /* next */\ncase 2: y();'],
    ['a.cpp', 'int x = f(); // NOLINT', 'int x = f(); // ok'],
    ['a.java', 'int x = f(); // NOSONAR', 'int x = f(); // ok'],
    ['a.cs', 'var x = f(); // ReSharper disable once All', 'var x = f(); // ok'],
    ['a.kt', 'val x = f() // ktlint-disable', 'val x = f() // ok'],
    ['a.sh', '# shellcheck disable=SC2086\necho $x', '# quoting is fine\necho $x'],
    ['a.sh', 'echo a\n#!/bin/sh', 'echo a\n#!/bin/bash'],
    ['a.ps1', '# PSScriptAnalyzer suppression\nGet-Item a', '# note\nGet-Item a'],
    ['a.bat', 'REM vim: set ff=dos :\necho a', 'REM note\necho a'],
    ['a.py', 'API_KEY = load()  # pragma: allowlist secret', 'API_KEY = load()  # loaded'],
    ['a.js', 'const k = "x"; // gitleaks:allow', 'const k = "x"; // ok'],
    ['a.go', 'fmt.Println(42)\n// Output: 42', 'fmt.Println(42)\n// Output: 43'],
    ['a.zsh', '#compdef _git git\nx', '#compdef _hg hg\nx']
  ];
  for (const [file, before, after] of cases) {
    assert.strictEqual(trivial(file, before, after), false, `${file}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  }
});

test('an unchanged directive does not stop a nearby comment edit from being trivial', () => {
  assert.strictEqual(trivial('a.py', '#!/usr/bin/env python3\n# old\nx = 1', '#!/usr/bin/env python3\n# new\nx = 1'), true);
  assert.strictEqual(trivial('a.ts', '// @ts-check\n// old\nx();', '// @ts-check\n// new\nx();'), true);
  assert.strictEqual(trivial('a.sh', '#!/bin/sh\n# old\nmake', '#!/bin/sh\n# new\nmake'), true);
});

test('Write, unknown languages and MultiEdit with any non-trivial entry are not trivial', () => {
  assert.strictEqual(write('a.js', '// only a comment\n').trivial, false);
  assert.strictEqual(trivial('a.rb', '# a', '# b'), false);
  assert.strictEqual(trivial('a.fish', '# a', '# b'), false);
  const multi = edits => profileChange({ filePath: 'a.js', tool: 'Edit', edits, fileText: '// a\nfoo();\n// c\nf(1);\n' });
  assert.strictEqual(multi([{ old_string: '// a', new_string: '// b' }, { old_string: '// c', new_string: '// d' }]).trivial, true);
  assert.strictEqual(multi([{ old_string: '// a', new_string: '// b' }, { old_string: 'f(1)', new_string: 'f(2)' }]).trivial, false);
});

// ── file context ──
console.log('\nfile context:');

test('an edit is trivial only against the file it applies to', () => {
  const change = { filePath: 'a.js', tool: 'Edit', edits: [{ old_string: '// a', new_string: '// b' }] };
  assert.strictEqual(profileChange(change).trivial, false, 'no file text');
  assert.strictEqual(profileChange({ ...change, fileText: null }).trivial, false, 'unreadable file');
  assert.strictEqual(profileChange({ ...change, fileText: 'x();\n' }).trivial, false, 'old_string not in the file');
  assert.strictEqual(profileChange({ ...change, fileText: '// a\n// a\n' }).trivial, false, 'ambiguous without replace_all');
  assert.strictEqual(profileChange({ ...change, fileText: 'x();\n// a\ny();\n' }).trivial, true);
  assert.strictEqual(inFile('a.js', 'x();\n', '', '// a'), false, 'empty old_string');
  assert.strictEqual(inFile('a.js', '// a\n// a\n', '// a', '// b', true), true, 'replace_all over comments');
  assert.strictEqual(inFile('a.js', `// a\n${'x();\n'.repeat(10)}`, '// a', '// b'), true);
  assert.strictEqual(inFile('a.js', `// a\n${'x'.repeat(2 * 1024 * 1024)}`, '// a', '// b'), false, 'file over the bound');
  for (const pattern of ["$'", '$`', '$&', '$$', '$1', '$<a>']) {
    assert.strictEqual(inFile('a.js', 'x();\n// a\ny();\n', '// a', `// b ${pattern}`), false, `replacement pattern ${pattern}`);
  }
  assert.strictEqual(inFile('a.js', 'x();\n// a\ny();\n', '// a', '// costs $5 or $x'), false, 'a dollar digit reads as a pattern');
  assert.strictEqual(inFile('a.js', 'x();\n// a\ny();\n', '// a', '// costs $ x'), true);
});

test('comment-looking text inside a multi-line construct of the file is not trivial', () => {
  const cases = [
    ['a.js', 'const q = `\n  // hint\n  SELECT 1\n`;\n', '  // hint', '  // other'],
    ['a.js', 'const q = html`\n  <p>${x}</p>\n  // a\n`;\n', '  // a', '  // b'],
    ['a.js', "const s = 'a\\\n// a';\n", "// a';", "// b';"],
    ['a.js', 'const s = "abc // q";\n', '// q"', '// r"'],
    ['a.js', 'x = "// a"; // a\n', '// a', '// b', true],
    ['a.js', '/* start\nmiddle\n// a */ x(1);\n', 'x(1)', 'x(2)'],
    ['a.ts', 'const t = `\n${a}\n// a\n`;\n', '// a', '// b'],
    ['a.py', 'Q = """\n# limit 10\nSELECT 1\n"""\n', '# limit 10', '# limit 99'],
    ['a.py', "Q = f'''\n{x}\n# a\n'''\n", '# a', '# b'],
    ['a.py', 'Q = (\n    "a"\n)\nS = """x\ny\n# a\n"""\n', '# a', '# b'],
    ['a.go', 'var q = `\nfirst\n// a\n`\n', '// a', '// b'],
    ['a.rs', 'let s = "line\nnext\n// a";\n', '// a";', '// b";'],
    ['a.rs', 'let s = r#"\nx\n// a\n"#;\n', '// a', '// b'],
    ['a.rs', '/* a /* b */\nx\n// c */ y(1);\n', 'y(1)', 'y(2)'],
    ['a.cpp', 'auto s = R"x(\nfirst\n// a\n)x";\n', '// a', '// b'],
    ['a.cs', 'var s = @"\nfirst\n// a";\n', '// a";', '// b";'],
    ['a.java', 'String s = """\nfirst\n// a\n""";\n', '// a', '// b'],
    ['a.kt', 'val s = """\nfirst\n// a\n"""\n', '// a', '// b'],
    ['a.sh', 'cat > colors.txt <<EOF\n#ff0000\n#00ff00\nEOF\n', '#00ff00', '#0000ff'],
    ['a.sh', "echo 'multi\nline\n# a'\n", "# a'", "# b'"],
    ['a.sh', 'x="\nfirst\n# a"\n', '# a"', '# b"'],
    ['a.ps1', '$s = @"\nfirst\n# a\n"@\n', '# a', '# b'],
    ['a.ps1', "$s = 'multi\nline\n# a'\n", "# a'", "# b'"],
    ['a.ps1', '<# help\nfirst\n# a #> Get-Item a\n', 'Get-Item a', 'Remove-Item a']
  ];
  for (const [file, text, before, after, all] of cases) {
    assert.strictEqual(inFile(file, text, before, after, all), false, `${file}: ${JSON.stringify(text)}`);
  }
});

test('an edit next to a continued line is not trivial', () => {
  const cases = [
    ['a.c', '#define A 1 \\\n// c\nint x;\n', '// c\n', ''],
    ['a.c', '#define A(x) \\\n  (x) + \\\n  1\n// c\n', '// c', '// d'],
    ['a.py', 'y = 1 + \\\n    2\n# c\nz()\n', '# c\n', ''],
    ['a.sh', 'make \\\n  all\n# c\nrm x\n', '# c\n', ''],
    ['a.ps1', 'Get-Item `\n  a\n# c\nRemove-Item b\n', '# c\n', ''],
    ['a.bat', 'echo a ^\nb\nREM c\necho d\n', 'REM c\n', '']
  ];
  for (const [file, text, before, after] of cases) {
    assert.strictEqual(inFile(file, text, before, after), false, `${file}: ${JSON.stringify(text)}`);
  }
});

test('an edit that joins or splits a line across the snippet boundary is not trivial', () => {
  assert.strictEqual(inFile('a.js', 'a();\n// c\nb();\n', '// c\n', '// c '), false, 'next line joins the comment');
  assert.strictEqual(inFile('a.js', 'a(); // x\nb();\n', '\nb();', ' b();'), false, 'line joins the previous comment');
  assert.strictEqual(inFile('a.py', 'x = 1\n# c\nimport os\n', '# c\n', '# c'), false);
  assert.strictEqual(inFile('a.sh', 'echo a\n# c\nrm -rf b\n', '# c\n', '# c '), false);
});

test('comment edits after closed multi-line constructs stay trivial', () => {
  const cases = [
    ['a.js', 'const q = `a\n${b}\nc`;\nconst r = /[/"]+/g;\nconst d = x / 2;\n\n// old\nfoo();\n', '// old', '// new'],
    ['a.js', '#!/usr/bin/env node\nconst s = "a // b";\n\n// old\nfoo();\n', '// old', '// new'],
    ['a.ts', 'function f<T>(x: Array<T>): T {\n  return x[0];\n}\n\n// old\nfoo();\n', '// old', '// new'],
    ['a.py', 'def f():\n    """Doc with # hash\n    and more.\n    """\n    return f"{x!r}"\n\n# old\nfoo()\n', '# old', '# new'],
    ['a.go', 'var q = `raw\nstring`\n\n// old\nfunc f() {}\n', '// old', '// new'],
    ['a.rs', "fn f<'a>(s: &'a str) -> char {\n    let r = r#\"raw \" quote\"#;\n    '\"'\n}\n\n// old\nfn g() {}\n", '// old', '// new'],
    ['a.cpp', 'auto s = R"x(\nraw )" still\n)x";\n\n// old\nint y;\n', '// old', '// new'],
    ['a.cs', 'var s = @"a\n""b""";\nvar t = $"{name} is {age:D2}";\n\n// old\nint y;\n', '// old', '// new'],
    ['a.java', 'String s = """\ntext\n""";\n\n// old\nint y;\n', '// old', '// new'],
    ['a.sh', "cat <<'EOF'\n# body\nEOF\necho 'a\nb'\n\n# old\nmake\n", '# old', '# new'],
    ['a.ps1', '$s = @"\nbody # x\n"@\n<# help\n#>\n\n# old\nGet-Item a\n', '# old', '# new'],
    ['a.bat', 'echo a ^\nb\n\nREM old\necho c\n', 'REM old', 'REM new']
  ];
  for (const [file, text, before, after] of cases) {
    assert.strictEqual(inFile(file, text, before, after), true, `${file}: ${JSON.stringify(text)}`);
  }
});

test('file context work stays linear on hostile files', () => {
  const size = 512 * 1024;
  const texts = ['`'.repeat(size), '/*'.repeat(size / 2), '"\\'.repeat(size / 2), '<<a\n'.repeat(size / 4), "r#'".repeat(size / 3), '${'.repeat(size / 2), '\\\n'.repeat(size / 2)];
  for (const [index, text] of texts.entries()) {
    for (const file of ['a.js', 'a.py', 'a.rs', 'a.cpp', 'a.cs', 'a.sh', 'a.ps1', 'a.bat']) {
      const start = process.hrtime.bigint();
      inFile(file, `${text}\n// a\n`, '// a', '// b');
      inFile(file, `${'// a\n'.repeat(1000)}${text}`, '// a', '// b', true);
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      assert.ok(ms < 500, `text ${index} in ${file} took ${ms.toFixed(1)} ms`);
    }
  }
});

test('comments that mention exports or data do not stop an edit from being trivial', () => {
  const profile = edit('a.js', '// export JSON later\nfoo();', '// export JSON soon\nfoo();');
  assert.strictEqual(profile.trivial, true);
  assert.strictEqual(profile.known, true);
});

// ── bounded work ──
console.log('\nbounded work:');

test('64 KiB adversarial inputs profile in linear time', () => {
  const size = MAX_SIDE_BYTES;
  const inputs = [
    '/*'.repeat(size / 2),
    '//'.repeat(size / 2),
    "'".repeat(size),
    '"\\'.repeat(size / 2),
    '\\\n'.repeat(size / 2),
    'a'.repeat(size),
    ' '.repeat(size - 1) + 'x',
    '\n'.repeat(size),
    'export '.repeat(Math.floor(size / 7)),
    'def _'.repeat(Math.floor(size / 5)),
    'aA'.repeat(size / 2),
    '# \\'.repeat(Math.floor(size / 3)),
    'func ('.repeat(Math.floor(size / 6)),
    'select from '.repeat(Math.floor(size / 12)),
    '"${'.repeat(Math.floor(size / 3)) + '}',
    '<# '.repeat(Math.floor(size / 3)),
    "'' ".repeat(Math.floor(size / 3)),
    '> '.repeat(size / 2)
  ];
  for (const [index, input] of inputs.entries()) {
    for (const file of ['a.js', 'a.py', 'a.go', 'a.rs', 'a.c', 'a.sh', 'a.ps1', 'a.bat']) {
      const start = process.hrtime.bigint();
      edit(file, input, `${input} `);
      write(file, input);
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      assert.ok(ms < 250, `input ${index} in ${file} took ${ms.toFixed(1)} ms`);
    }
  }
});

test('never throws on hostile shapes', () => {
  const hostile = [
    { filePath: 'a.js', tool: 'Edit', edits: [null, { old_string: 'a', new_string: 'b' }] },
    { filePath: 'a.js', tool: 'Edit', edits: [{ get old_string() { throw new Error('boom'); }, new_string: 'b' }] },
    { filePath: { toString() { throw new Error('boom'); } }, tool: 'Edit', edits: [] },
    { filePath: 'a.js', tool: 'Write', get content() { throw new Error('boom'); } }
  ];
  for (const input of hostile) assert.deepStrictEqual(profileChange(input), UNKNOWN_PROFILE);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
