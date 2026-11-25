/**
 * Tests for the shell CLV2_HOMUNCULUS_DIR / XDG_DATA_HOME resolver with
 * Windows-form absolute paths (C:/x, C:\x) under MSYS / Cygwin shells.
 *
 * The Node and Python resolvers accept these forms, so the shell hooks must
 * too, otherwise they silently write to a different directory.
 *
 * OSTYPE is assigned inside the probe shell, so the conversion cases run on
 * any platform that has bash. A final case runs against a real Windows shell
 * and is skipped elsewhere.
 *
 * Run with: node tests/hooks/homunculus-dir-windows-path.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const libPath = path.resolve(
  __dirname, '..', '..', 'skills', 'continuous-learning-v2', 'scripts', 'lib', 'homunculus-dir.sh'
);

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

const probe = spawnSync('bash', ['-c', 'printf %s "$OSTYPE"'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  console.log('Skipping homunculus-dir Windows path tests: bash not found\n');
  process.exit(0);
}
const realOstype = probe.stdout.trim();
const realWindowsShell = /^(msys|cygwin|win32)/.test(realOstype);

// Source the resolver in bash with an optional OSTYPE override and env.
function resolve({ ostype, env = {}, strict = false }) {
  const script = `${strict ? 'set -eu\n' : ''}${ostype ? `OSTYPE=${ostype}\n` : ''}source "$LIB"\n_clv2_resolve_homunculus_dir`;
  const childEnv = { ...process.env, HOME: '/home/tester', LIB: libPath.replace(/\\/g, '/') };
  delete childEnv.CLV2_HOMUNCULUS_DIR;
  delete childEnv.XDG_DATA_HOME;
  Object.assign(childEnv, env);
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: childEnv, timeout: 10000 });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

console.log('\n=== homunculus-dir Windows-form paths ===\n');

// The drive mapping depends on OSTYPE alone, never on the host filesystem, so
// these expectations hold on any host. MSYS2 and Git Bash mount drives at
// /<drive>. On Cygwin the resolver uses /proc/cygdrive, which points at the
// configured cygdrive prefix (/cygdrive by default, /mnt etc. via fstab).
// The drive-letter case is preserved.
const drivePrefix = { msys: '', cygwin: '/proc/cygdrive', win32: '' };
for (const ostype of Object.keys(drivePrefix)) {
  test(`${ostype}: C:/ form CLV2_HOMUNCULUS_DIR is accepted`, () => {
    const r = resolve({ ostype, env: { CLV2_HOMUNCULUS_DIR: 'C:/Users/x/dir' } });
    assert.strictEqual(r.stdout, `${drivePrefix[ostype]}/C/Users/x/dir`);
    assert.strictEqual(r.stderr, '');
  });
}

test('cygwin: C:\\ form XDG_DATA_HOME maps under /proc/cygdrive', () => {
  const r = resolve({ ostype: 'cygwin', env: { XDG_DATA_HOME: 'D:\\data\\share' } });
  assert.strictEqual(r.stdout, '/proc/cygdrive/D/data/share/ecc-homunculus');
  assert.strictEqual(r.stderr, '');
});

test('msys: C:\\ form CLV2_HOMUNCULUS_DIR is accepted', () => {
  const r = resolve({ ostype: 'msys', env: { CLV2_HOMUNCULUS_DIR: 'C:\\Users\\x\\dir' } });
  assert.strictEqual(r.stdout, '/C/Users/x/dir');
  assert.strictEqual(r.stderr, '');
});

test('msys: lower- and upper-case drive letters both accepted (case kept; MSYS paths are case-insensitive)', () => {
  const lower = resolve({ ostype: 'msys', env: { CLV2_HOMUNCULUS_DIR: 'd:/data' } });
  const upper = resolve({ ostype: 'msys', env: { CLV2_HOMUNCULUS_DIR: 'D:/data' } });
  assert.strictEqual(lower.stdout, '/d/data');
  assert.strictEqual(upper.stdout, '/D/data');
});

test('msys: XDG_DATA_HOME in Windows form is accepted', () => {
  const r = resolve({ ostype: 'msys', env: { XDG_DATA_HOME: 'C:\\Users\\x\\share' } });
  assert.strictEqual(r.stdout, '/C/Users/x/share/ecc-homunculus');
  assert.strictEqual(r.stderr, '');
});

test('msys: CLV2_HOMUNCULUS_DIR wins over XDG_DATA_HOME', () => {
  const r = resolve({ ostype: 'msys', env: { CLV2_HOMUNCULUS_DIR: 'C:/a', XDG_DATA_HOME: 'C:/b' } });
  assert.strictEqual(r.stdout, '/C/a');
});

test('msys: relative path is still rejected with the existing message', () => {
  const r = resolve({ ostype: 'msys', env: { CLV2_HOMUNCULUS_DIR: 'relative/dir' } });
  assert.strictEqual(r.stdout, '/home/tester/.local/share/ecc-homunculus');
  assert.ok(r.stderr.includes('[ecc] CLV2_HOMUNCULUS_DIR=relative/dir is not absolute; ignoring'));
});

test('msys: drive-relative "C:foo" is still rejected', () => {
  const r = resolve({ ostype: 'msys', env: { CLV2_HOMUNCULUS_DIR: 'C:foo' } });
  assert.strictEqual(r.stdout, '/home/tester/.local/share/ecc-homunculus');
  assert.ok(r.stderr.includes('is not absolute; ignoring'));
});

test('msys: bare drive "C:" is rejected with the existing message', () => {
  const r = resolve({ ostype: 'msys', env: { CLV2_HOMUNCULUS_DIR: 'C:' } });
  assert.strictEqual(r.stdout, '/home/tester/.local/share/ecc-homunculus');
  assert.ok(r.stderr.includes('[ecc] CLV2_HOMUNCULUS_DIR=C: is not absolute; ignoring'));
});

test('msys: drive root "C:/" is accepted', () => {
  const r = resolve({ ostype: 'msys', env: { CLV2_HOMUNCULUS_DIR: 'C:/' } });
  assert.strictEqual(r.stdout, '/C/');
  assert.strictEqual(r.stderr, '');
});

test('msys: a path with a space is accepted and preserved', () => {
  const r = resolve({ ostype: 'msys', env: { CLV2_HOMUNCULUS_DIR: 'C:/a b/c' } });
  assert.strictEqual(r.stdout, '/C/a b/c');
  assert.strictEqual(r.stderr, '');
});

test('msys: a trailing slash is preserved', () => {
  const r = resolve({ ostype: 'msys', env: { CLV2_HOMUNCULUS_DIR: 'C:/a/' } });
  assert.strictEqual(r.stdout, '/C/a/');
  assert.strictEqual(r.stderr, '');
});

test('msys: UNC value \\\\srv\\share is still rejected (pins current behavior)', () => {
  const r = resolve({ ostype: 'msys', env: { CLV2_HOMUNCULUS_DIR: '\\\\srv\\share' } });
  assert.strictEqual(r.stdout, '/home/tester/.local/share/ecc-homunculus');
  assert.ok(r.stderr.includes('[ecc] CLV2_HOMUNCULUS_DIR=\\\\srv\\share is not absolute; ignoring'));
});

test('msys: sourcing and resolving under set -eu does not abort', () => {
  const converted = resolve({ ostype: 'msys', strict: true, env: { CLV2_HOMUNCULUS_DIR: 'C:/Users/x/dir' } });
  assert.strictEqual(converted.status, 0, converted.stderr);
  assert.strictEqual(converted.stdout, '/C/Users/x/dir');
  const xdg = resolve({ ostype: 'msys', strict: true, env: { XDG_DATA_HOME: 'C:\\Users\\x\\share' } });
  assert.strictEqual(xdg.status, 0, xdg.stderr);
  assert.strictEqual(xdg.stdout, '/C/Users/x/share/ecc-homunculus');
  const fallback = resolve({ ostype: 'msys', strict: true, env: { CLV2_HOMUNCULUS_DIR: 'relative/dir' } });
  assert.strictEqual(fallback.status, 0, fallback.stderr);
  assert.strictEqual(fallback.stdout, '/home/tester/.local/share/ecc-homunculus');
});

test('linux: sourcing and resolving under set -eu does not abort', () => {
  const r = resolve({ ostype: 'linux-gnu', strict: true, env: { CLV2_HOMUNCULUS_DIR: '/abs/dir' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '/abs/dir');
});

test('msys: POSIX absolute path is unchanged', () => {
  const r = resolve({ ostype: 'msys', env: { CLV2_HOMUNCULUS_DIR: '/abs/dir' } });
  assert.strictEqual(r.stdout, '/abs/dir');
  assert.strictEqual(r.stderr, '');
});

test('linux: C:/x CLV2_HOMUNCULUS_DIR is still rejected', () => {
  const r = resolve({ ostype: 'linux-gnu', env: { CLV2_HOMUNCULUS_DIR: 'C:/x' } });
  assert.strictEqual(r.stdout, '/home/tester/.local/share/ecc-homunculus');
  assert.ok(r.stderr.includes('[ecc] CLV2_HOMUNCULUS_DIR=C:/x is not absolute; ignoring'));
});

test('darwin: C:\\x XDG_DATA_HOME is still rejected', () => {
  const r = resolve({ ostype: 'darwin23', env: { XDG_DATA_HOME: 'C:\\x' } });
  assert.strictEqual(r.stdout, '/home/tester/.local/share/ecc-homunculus');
  assert.ok(r.stderr.includes('[ecc] XDG_DATA_HOME=C:\\x is not absolute; ignoring'));
});

if (realWindowsShell) {
  // pwd -W is an MSYS extension; Cygwin's bash has only -L and -P.
  const nativePwd = /^cygwin/.test(realOstype) ? 'cygpath -am .' : 'pwd -W';
  test(`real ${realOstype} shell: Windows-form dir resolves to the directory Node sees`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-homunculus-win-'));
    try {
      // The OSTYPE=cygwin pass checks that the /proc/cygdrive form resolves in
      // this shell as well; the Cygwin and MSYS2 runtimes both provide it.
      const forms = [tmp, tmp.replace(/\\/g, '/')];
      for (const [form, override] of forms.flatMap((f) => [[f, ''], [f, 'OSTYPE=cygwin\n']])) {
        const script = `${override}source "$LIB"\nd=$(_clv2_resolve_homunculus_dir) || exit 1\ncd "$d" && ${nativePwd}`;
        const r = spawnSync('bash', ['-c', script], {
          encoding: 'utf8',
          timeout: 10000,
          env: { ...process.env, HOME: '/home/tester', LIB: libPath.replace(/\\/g, '/'), CLV2_HOMUNCULUS_DIR: form },
        });
        assert.strictEqual(r.status, 0, r.stderr);
        // Compare final long-form paths: os.tmpdir() can return an 8.3 short
        // name (C:\Users\RUNNER~1\...) while pwd -W prints the long one.
        const resolved = (p) => fs.realpathSync.native(p).toLowerCase();
        assert.strictEqual(resolved(r.stdout.trim()), resolved(tmp));
        assert.strictEqual(r.stderr.includes('not absolute'), false);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
} else {
  console.log('  - real Windows shell case skipped (not an MSYS/Cygwin shell)');
  skipped++;
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Skipped: ${skipped}`);
process.exit(failed > 0 ? 1 : 0);
