// Regression coverage for the opensource-sanitizer Step 7 "Unreadable Files" pass.
//
// The classifier is a shell block inside agents/opensource-sanitizer.md. This test extracts that
// exact block and runs it in fixture directories, so it exercises the text that ships rather than
// a copy. The block writes one line per listed path to a manifest beside the project directory
// (<dir>.UNREADABLE_FILES.txt) and prints only a tally and a final "Unreadable count:" line, so
// most assertions read the manifest and stdout separately.
//
// Tools are resolved from PATH and symlinked into a scratch bin dir, which lets a case remove one
// (file, od, sort) or replace one with a shim (file, find). A file(1) shim must answer in the shape
// the block asks for: "type/subtype; charset=enc".

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const agentPath = path.join(repoRoot, 'agents', 'opensource-sanitizer.md');
const skillPath = path.join(repoRoot, 'skills', 'opensource-pipeline', 'SKILL.md');

if (process.platform === 'win32') {
  console.log('SKIP: sanitizer-unreadable (POSIX shell block, not applicable on win32)');
  console.log('\n  Passed: 0\n  Failed: 0\n  Skipped: 1');
  process.exit(0);
}

function which(tool) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, tool);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_err) {
      // not in this dir
    }
  }
  return null;
}

const NEEDED = ['sh', 'bash', 'find', 'tr', 'cmp', 'dd', 'od', 'sort', 'cut', 'uniq', 'rm', 'cat', 'env'];
const missing = NEEDED.filter((t) => !which(t));
if (missing.length > 0) {
  console.log('SKIP: sanitizer-unreadable (missing ' + missing.join(', ') + ' in test environment)');
  console.log('\n  Passed: 0\n  Failed: 0\n  Skipped: 1');
  process.exit(0);
}
const realFind = which('find');
const realFile = which('file');

// --- Extract the Step 7 shell block from the agent file -------------------------------------------
function extractStep7() {
  const md = fs.readFileSync(agentPath, 'utf8');
  const afterHeading = md.split('### Step 7')[1];
  assert.ok(afterHeading, 'agent file is missing the "### Step 7" heading');
  const m = afterHeading.match(/```bash\n([\s\S]*?)\n```/);
  assert.ok(m, 'could not find the Step 7 ```bash block');
  return m[1];
}
const STEP7 = extractStep7();

// --- Temp dir management --------------------------------------------------------------------------
const tempDirs = [];
const lockedPaths = [];
function makeTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const p of lockedPaths) {
    try {
      fs.chmodSync(p, 0o755);
    } catch (_err) {
      // already gone
    }
  }
  for (const dir of tempDirs) {
    try {
      fs.chmodSync(dir, 0o755);
    } catch (_err) {
      // already gone
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dir + '.UNREADABLE_FILES.txt', { force: true });
  }
});

// Scratch bin dir with every needed tool except `omit`; `shims` maps a name to script text.
function makeBin(opts) {
  const { omit = [], shims = {}, withFile = false } = opts || {};
  const dir = makeTemp('san-bin-');
  const tools = NEEDED.concat(withFile && realFile ? ['file'] : []);
  for (const t of tools) {
    if (omit.includes(t) || t in shims) continue;
    fs.symlinkSync(which(t), path.join(dir, t));
  }
  for (const [name, body] of Object.entries(shims)) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, '#!/usr/bin/env bash\n' + body + '\n');
    fs.chmodSync(p, 0o755);
  }
  return dir;
}

// A file(1) stand-in that prints `out` and exits `rc`.
function fileShim(out, rc) {
  const body = (out === '' ? '' : "printf '%s\\n' '" + out + "'\n") + 'exit ' + (rc || 0);
  return makeBin({ shims: { file: body } });
}

// --- Running the block ----------------------------------------------------------------------------
const MANIFEST = 'UNREADABLE_FILES.txt';
// The manifest is a sibling of the project directory, so no scan step can read it back.
function manifestOf(root) {
  return root + '.' + MANIFEST;
}

function scan(root, binDir) {
  const env = { ...process.env };
  if (binDir) env.PATH = binDir;
  const res = spawnSync('sh', ['-c', STEP7], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(res.status, 0, 'block exited non-zero: ' + res.status + ' ' + res.stderr);
  const lines = res.stdout.split('\n').filter((l) => l !== '');
  assert.ok(lines.length > 0, 'block printed nothing');
  const last = lines[lines.length - 1];
  assert.ok(/^Unreadable count: /.test(last), 'last line must be the count, got: ' + JSON.stringify(last));
  const problems = lines.filter((l) => l.startsWith('Scan problem: '));
  const manifestPath = manifestOf(root);
  const records = fs.existsSync(manifestPath)
    ? fs.readFileSync(manifestPath, 'latin1').split('\n').filter((l) => l !== '').map((l) => {
      const i = l.indexOf('\t');
      return { q: l.slice(0, i), label: l.slice(i + 1), raw: l };
    })
    : [];
  return { stdout: res.stdout, stderr: res.stderr, lines, last, problems, records, count: last.slice('Unreadable count: '.length) };
}

function labelOf(result, needle) {
  const hit = result.records.find((r) => r.q.includes(needle));
  return hit ? hit.label : undefined;
}

function write(root, name, data) {
  fs.writeFileSync(path.join(root, name), data);
}

// --- Harness --------------------------------------------------------------------------------------
class Skip extends Error {}
function skip(reason) {
  throw new Skip(reason);
}

let passed = 0;
let failed = 0;
let skipped = 0;
function run(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  PASS: ' + name);
  } catch (err) {
    if (err instanceof Skip) {
      skipped += 1;
      console.log('  SKIP: ' + name + ' (' + err.message + ')');
    } else {
      failed += 1;
      console.log('  FAIL: ' + name);
      console.log('    ' + String(err.message).split('\n').join('\n    '));
    }
  }
}

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

const SIG = {
  pk03: Buffer.from('PK\x03\x04payload text'),
  pk05: Buffer.from('PK\x05\x06' + 'z'.repeat(18)),
  pk07: Buffer.from('PK\x07\x08payload text'),
  ole: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x41, 0x41]),
  pdf: Buffer.from('%PDF-1.4\nplain looking body\n'),
  gz: Buffer.from([0x1f, 0x8b, 0x08, 0x41, 0x41, 0x41, 0x41, 0x41]),
  bz2: Buffer.from('BZh9AAAAAAAAAA'),
  zst: Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x41, 0x41, 0x41, 0x41]),
  sevenz: Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x41, 0x41, 0x41]),
};

const SIG_LEN = { pk03: 4, pk05: 4, pk07: 4, ole: 8, pdf: 4, gz: 2, bz2: 3, zst: 4, sevenz: 6 };

function seedText(root) {
  write(root, 'ascii.txt', 'hello world\nthis is text\n');
  write(root, 'utf8.md', 'caf\u00e9 \u4e2d\u6587 \u{1f600}\ttab\r\nline\n');
  write(root, 'data.json', '{"json":true,"k":"v"}\n');
  write(root, 'bundle.min.js', '!function(){var a=1,b="x";console.log(a+b)}();');
}

// 1. Ordinary text ------------------------------------------------------------------------------------
run('ordinary text, JSON and minified JS pass: count 0, no manifest (no file(1))', () => {
  const root = makeTemp('san-text-');
  seedText(root);
  const r = scan(root, makeBin());
  assert.strictEqual(r.stdout, 'Unreadable count: 0\n');
  assert.ok(!fs.existsSync(manifestOf(root)), 'manifest must not exist when nothing is listed');
});

run('ordinary text passes with file(1) answering text/x-Algol68 or image/svg+xml', () => {
  for (const out of ['text/x-Algol68; charset=us-ascii', 'image/svg+xml; charset=us-ascii', 'text/plain; charset=utf-8', 'application/json; charset=us-ascii']) {
    const root = makeTemp('san-text2-');
    seedText(root);
    const r = scan(root, fileShim(out));
    assert.strictEqual(r.stdout, 'Unreadable count: 0\n', out + ' must not list text, got: ' + r.stdout);
    assert.ok(!fs.existsSync(manifestOf(root)), out + ': no manifest expected');
  }
});

run('ordinary text passes with the real file(1)', () => {
  if (!realFile) skip('file(1) not installed');
  const root = makeTemp('san-text3-');
  seedText(root);
  write(root, 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>\n');
  const r = scan(root, makeBin({ withFile: true }));
  assert.strictEqual(r.stdout, 'Unreadable count: 0\n', 'real file(1) listed text: ' + r.stdout);
});

run('a real PNG is listed by its mime type under the real file(1)', () => {
  if (!realFile) skip('file(1) not installed');
  const root = makeTemp('san-png-');
  write(root, 'logo.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const r = scan(root, makeBin({ withFile: true }));
  assert.strictEqual(r.count, '1');
  assert.strictEqual(labelOf(r, 'logo.png'), 'image/png');
});

// 2. Detector failure on text ------------------------------------------------------------------------
run('file(1) failing on a text file lists it as unverified (exit 1, empty, garbage, valid shape with exit 1)', () => {
  const variants = {
    'exit 1, no output': fileShim('', 1),
    'exit 0, empty output': fileShim('', 0),
    'exit 0, garbage text': fileShim('cannot open (No such file or directory)', 0),
    'exit 0, wrong shape': fileShim('text/plain', 0),
    'exit 1, valid shape': fileShim('text/plain; charset=us-ascii', 1),
  };
  for (const [name, bin] of Object.entries(variants)) {
    const root = makeTemp('san-broken-');
    write(root, 'plain.txt', 'hello\n');
    const r = scan(root, bin);
    assert.strictEqual(r.count, '1', name + ': text must fail closed, got ' + r.stdout);
    assert.strictEqual(labelOf(r, 'plain.txt'), 'detector error, unverified', name);
  }
});

run('control-byte file keeps its label when file(1) fails, and takes the mime type when file(1) is healthy', () => {
  const root = makeTemp('san-ctl-');
  write(root, 'a.dat', 'text\x01more\n');
  let r = scan(root, fileShim('', 1));
  assert.strictEqual(labelOf(r, 'a.dat'), 'contains NUL or control bytes (not plain text)');
  r = scan(root, fileShim('image/png; charset=binary', 0));
  assert.strictEqual(labelOf(r, 'a.dat'), 'image/png');
  r = scan(root, fileShim('text/plain; charset=us-ascii', 0));
  assert.strictEqual(labelOf(r, 'a.dat'), 'contains NUL or control bytes (not plain text)');
});

// 3. file(1) absent ---------------------------------------------------------------------------------
run('file(1) absent: ZIP, OLE, PDF and NUL files are listed, text still passes', () => {
  const root = makeTemp('san-nofile-');
  seedText(root);
  write(root, 'book.docx', SIG.pk03);
  write(root, 'legacy.doc', SIG.ole);
  write(root, 'doc.pdf', SIG.pdf);
  write(root, 'sneaky.bin', Buffer.from('before\x00after\n'));
  const bin = makeBin();
  assert.ok(!fs.existsSync(path.join(bin, 'file')), 'setup: file(1) must be absent');
  const r = scan(root, bin);
  assert.strictEqual(r.count, '4');
  for (const n of ['book.docx', 'legacy.doc', 'doc.pdf', 'sneaky.bin']) assert.ok(labelOf(r, n), n + ' must be listed');
  for (const n of ['ascii.txt', 'utf8.md', 'data.json', 'bundle.min.js']) assert.strictEqual(labelOf(r, n), undefined, n + ' must pass');
});

run('control-byte blob with no NUL or signature is listed without file(1)', () => {
  const root = makeTemp('san-blob-');
  write(root, 'blob.dat', Buffer.from('\x01\x02\x03secret=AKIAEXAMPLE\x1b\x07tail'));
  const r = scan(root, makeBin());
  assert.strictEqual(r.count, '1');
  assert.strictEqual(labelOf(r, 'blob.dat'), 'contains NUL or control bytes (not plain text)');
});

// 4. First-byte signatures --------------------------------------------------------------------------
run('each first-byte signature is listed with its own label, with and without file(1)', () => {
  const expect = {
    pk03: 'ZIP/OOXML', pk05: 'ZIP/OOXML', pk07: 'ZIP/OOXML', ole: 'OLE compound', pdf: 'PDF',
    gz: 'gzip', bz2: 'bzip2', zst: 'zstd', sevenz: '7z',
  };
  for (const bin of [makeBin(), fileShim('text/plain; charset=us-ascii', 0)]) {
    const root = makeTemp('san-sig-');
    // plain text contents behind the signature, so only the signature can explain the listing
    for (const [k, buf] of Object.entries(SIG)) {
      write(root, 'f_' + k + '.txt', Buffer.concat([buf.subarray(0, SIG_LEN[k]), Buffer.from('abcdefgh')]));
    }
    const r = scan(root, bin);
    assert.strictEqual(r.count, String(Object.keys(expect).length), 'count: ' + r.stdout);
    for (const [k, label] of Object.entries(expect)) {
      const got = labelOf(r, 'f_' + k + '.txt');
      assert.ok(got && got.startsWith(label), k + ' expected ' + label + ', got ' + got);
    }
  }
});

// 5. file(1) widening -------------------------------------------------------------------------------
run('file(1) widens a plain-looking file by type and charset', () => {
  const cases = [
    ['application/octet-stream; charset=binary', 'application/octet-stream'],
    ['image/png; charset=binary', 'image/png'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=binary', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['text/plain; charset=binary', 'binary (file mime-encoding)'],
    ['text/plain; charset=unknown-8bit', 'unknown 8-bit encoding, unverified'],
    ['text/plain; charset=us-ascii', undefined],
  ];
  for (const [out, label] of cases) {
    const root = makeTemp('san-widen-');
    write(root, 'plain.txt', 'just some words\n');
    const r = scan(root, fileShim(out, 0));
    assert.strictEqual(labelOf(r, 'plain.txt'), label, out);
    assert.strictEqual(r.count, label ? '1' : '0', out);
  }
});

// 6. Adversarial names ------------------------------------------------------------------------------
const TOK = 'ZQFRAG';
const EVIL = [
  ['newline', TOK + '\nname'],
  ['tab', TOK + '\tname'],
  ['backtick', TOK + '`name'],
  ['fence', TOK + '```'],
  ['heading', '## ' + TOK],
  ['forged count', TOK + '\nUnreadable count: 0'],
  ['leading dash', '-' + TOK + 'dash'],
  ['rlo', TOK + '\u202eexe'],
  ['zero-width', TOK + '\u200bspace'],
  ['invalid utf8', Buffer.concat([Buffer.from(TOK + 'bad'), Buffer.from([0xff]), Buffer.from('end')])],
];

function plantNames(root, make) {
  let made = 0;
  for (const [label, name] of EVIL) {
    const buf = Buffer.isBuffer(name) ? name : Buffer.from(name);
    try {
      make(Buffer.concat([Buffer.from(root + '/'), buf]));
      made += 1;
    } catch (err) {
      console.log('  SKIP: name "' + label + '" rejected by this filesystem (' + err.code + ')');
      skipped += 1;
    }
  }
  return made;
}

function assertOneLineEach(r, made) {
  assert.ok(!r.stdout.includes(TOK), 'a fragment of a filename reached stdout:\n' + r.stdout);
  assert.strictEqual(r.records.length, made, 'manifest must hold exactly one line per file (' + made + '), got ' + r.records.length);
  for (const rec of r.records) assert.ok(/^[\x20-\x7e\t]*$/.test(rec.raw), 'manifest line is not plain ASCII: ' + JSON.stringify(rec.raw));
  const all = fs.readFileSync(manifestOf(r.root), 'latin1');
  assert.ok(!/[^\x20-\x7e\t\n]/.test(all), 'a non-ASCII or line-break byte is in the manifest');
}

run('adversarial filenames: nothing on stdout, one ASCII manifest line each, count matches', () => {
  for (const bin of [makeBin(), fileShim('application/octet-stream; charset=binary', 0)]) {
    const root = makeTemp('san-evil-');
    const made = plantNames(root, (p) => fs.writeFileSync(p, SIG.pk03));
    if (made === 0) skip('filesystem rejected every name');
    const r = scan(root, bin);
    r.root = root;
    assertOneLineEach(r, made);
    assert.strictEqual(r.count, String(made));
    assert.strictEqual(r.lines.filter((l) => l.startsWith('Unreadable count:')).length, 1, 'a name forged a count line');
    assert.strictEqual(r.stdout.split('\n').filter((l) => l.startsWith('## ') || l.startsWith('```')).length, 0, 'a name forged a heading or fence');
  }
});

run('adversarial names on a plain-text file that file(1) lists, and on the NUL path', () => {
  const root = makeTemp('san-evil2-');
  const made = plantNames(root, (p) => fs.writeFileSync(p, Buffer.from('nul\x00in body\n')));
  if (made === 0) skip('filesystem rejected every name');
  const r = scan(root, makeBin());
  r.root = root;
  assertOneLineEach(r, made);
  assert.strictEqual(r.count, String(made));
});

// 7. Unreadable file and directory with awkward names ------------------------------------------------
run('unreadable file and directory with awkward names: one manifest line each, nothing on stdout', () => {
  if (isRoot) skip('running as root, mode 000 is still readable');
  const root = makeTemp('san-noread-');
  const fileName = path.join(root, TOK + '\nlocked`file');
  const dirName = path.join(root, TOK + '\n## dir');
  fs.writeFileSync(fileName, 'secret=hunter2\n');
  fs.mkdirSync(dirName);
  fs.writeFileSync(path.join(dirName, 'inner.txt'), 'x\n');
  fs.chmodSync(fileName, 0o000);
  fs.chmodSync(dirName, 0o000);
  lockedPaths.push(dirName);
  const r = scan(root, makeBin());
  r.root = root;
  assert.ok(!r.stdout.includes(TOK), 'a filename reached stdout:\n' + r.stdout);
  const fileRec = r.records.filter((x) => x.label === 'file not readable');
  const dirRec = r.records.filter((x) => x.label === 'directory not readable, contents unscanned');
  assert.strictEqual(fileRec.length, 1, 'unreadable file record');
  assert.strictEqual(dirRec.length, 1, 'unreadable directory record');
  for (const rec of r.records) assert.ok(/^[\x20-\x7e\t]*$/.test(rec.raw), 'non-ASCII manifest line');
  assert.strictEqual(r.records.length, 2);
});

// 8. Unreadable directory count behavior ------------------------------------------------------------
run('unreadable directory is recorded; the count is a number only if the walk saw no error', () => {
  if (isRoot) skip('running as root, mode 000 is still readable');
  const root = makeTemp('san-dir-');
  const dir = path.join(root, 'restricted');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'inner.txt'), 'x\n');
  write(root, 'ok.txt', 'fine\n');
  fs.chmodSync(dir, 0o000);
  lockedPaths.push(dir);
  const r = scan(root, makeBin());
  assert.strictEqual(r.records.filter((x) => x.label === 'directory not readable, contents unscanned').length, 1);
  // GNU find and bfs both exit non-zero on a directory they cannot open, so the walk reports a
  // problem and the count is unknown. It must never be a number lower than what was listed.
  console.log('    observed: ' + r.lines.join(' | '));
  if (/^\d+$/.test(r.count)) {
    assert.ok(Number(r.count) >= r.records.length, 'count below the number of manifest lines');
  } else {
    assert.ok(/^unknown \(\d+ listed, \d+ scan problems\)$/.test(r.count), 'bad unknown form: ' + r.count);
    assert.ok(r.problems.length >= 1, 'unknown count needs a Scan problem line');
  }
});

// 9. Walk failure, per pass --------------------------------------------------------------------------
function findShim(failType) {
  // fail the pass whose -type argument is `failType`, delegate the other to the real find
  return makeBin({
    shims: {
      find: 'for a in "$@"; do if [ "$prev" = -type ] && [ "$a" = ' + failType + ' ]; then exit 1; fi; prev=$a; done\n'
        + 'exec ' + JSON.stringify(realFind) + ' "$@"',
    },
  });
}

run('file walk failure: Scan problem about the file walk and an unknown count', () => {
  const root = makeTemp('san-findf-');
  write(root, 'book.docx', SIG.pk03);
  const r = scan(root, findShim('f'));
  assert.ok(r.problems.some((l) => /file walk/.test(l)), 'file walk problem missing: ' + r.stdout);
  assert.ok(!r.problems.some((l) => /directory walk/.test(l)), 'directory walk must not be blamed');
  assert.ok(/^unknown \(0 listed, 1 scan problems\)$/.test(r.count), r.count);
});

run('directory walk failure: Scan problem about the directory walk and an unknown count', () => {
  const root = makeTemp('san-findd-');
  write(root, 'book.docx', SIG.pk03);
  const r = scan(root, findShim('d'));
  assert.ok(r.problems.some((l) => /directory walk/.test(l)), 'directory walk problem missing: ' + r.stdout);
  assert.ok(!r.problems.some((l) => /file walk/.test(l)), 'file walk must not be blamed');
  assert.ok(/^unknown \(1 listed, 1 scan problems\)$/.test(r.count), r.count);
  assert.strictEqual(labelOf(r, 'book.docx') !== undefined, true, 'files found before the failure are still listed');
});

run('a walker that dies before its END record: ended-early problem and an unknown count', () => {
  const root = makeTemp('san-dead-');
  write(root, 'book.docx', SIG.pk03);
  // the find stand-in kills the shell that runs the walk, so the reader only ever sees EOF
  const bin = makeBin({ shims: { find: 'kill -9 "$PPID"\nexit 1' } });
  const r = scan(root, bin);
  assert.ok(r.problems.some((l) => /ended early/.test(l)), 'ended-early problem missing: ' + r.stdout);
  assert.ok(r.count.startsWith('unknown'), 'a dead walker must not yield a number: ' + r.count);
});

// 10. Manifest not writable -------------------------------------------------------------------------
run('manifest that cannot be written: could-not-write problem and unknown count', () => {
  if (isRoot) skip('running as root, a read-only dir is still writable');
  const parent = makeTemp('san-ro-');
  const root = path.join(parent, 'project');
  fs.mkdirSync(root);
  write(root, 'book.docx', SIG.pk03);
  fs.chmodSync(parent, 0o555);
  lockedPaths.push(parent);
  try {
    fs.accessSync(parent, fs.constants.W_OK);
    skip('directory is still writable on this filesystem');
  } catch (err) {
    if (err instanceof Skip) throw err;
  }
  const r = scan(root, makeBin());
  assert.ok(r.problems.some((l) => /could not write/.test(l)), 'could-not-write problem missing: ' + r.stdout);
  assert.ok(/^unknown \(1 listed, 1 scan problems\)$/.test(r.count), r.count);
});

// 11. Missing preflight tool ------------------------------------------------------------------------
run('od or dd missing: scan problem, unknown count, every non-empty file listed', () => {
  for (const tool of ['od', 'dd']) {
    const root = makeTemp('san-nopre-');
    write(root, 'leak.dat', 'api_key=hunter2\n');
    write(root, 'plain.txt', 'hello\n');
    write(root, 'empty.txt', '');
    const r = scan(root, makeBin({ omit: [tool] }));
    assert.ok(r.problems.some((l) => l.includes(tool + ' is missing')), tool + ' problem missing: ' + r.stdout);
    assert.ok(/^unknown \(2 listed, 1 scan problems\)$/.test(r.count), tool + ': ' + r.count);
    assert.strictEqual(labelOf(r, 'leak.dat'), 'detector error, unverified');
    assert.strictEqual(labelOf(r, 'plain.txt'), 'detector error, unverified');
    assert.strictEqual(labelOf(r, 'empty.txt'), undefined, 'zero-byte file is not listed');
  }
});

run('tr or cmp missing: scan problem and unknown count', () => {
  for (const tool of ['tr', 'cmp']) {
    const root = makeTemp('san-nopre2-');
    write(root, 'plain.txt', 'hello\n');
    const r = scan(root, makeBin({ omit: [tool] }));
    assert.ok(r.problems.some((l) => l.includes(tool + ' is missing')), tool + ' problem missing: ' + r.stdout);
    assert.ok(r.count.startsWith('unknown'), tool + ': ' + r.count);
  }
});

// 12. sort missing ----------------------------------------------------------------------------------
run('sort, cut or uniq missing: the count is still correct and the missing tally is said out loud', () => {
  for (const tool of ['sort', 'cut', 'uniq']) {
    const root = makeTemp('san-notally-');
    write(root, 'book.docx', SIG.pk03);
    write(root, 'doc.pdf', SIG.pdf);
    write(root, 'plain.txt', 'hello\n');
    const r = scan(root, makeBin({ omit: [tool] }));
    assert.strictEqual(r.count, '2', tool + ': ' + r.stdout);
    assert.strictEqual(r.records.length, 2);
    assert.ok(r.lines.some((l) => l.startsWith('No tally: ')), tool + ': a missing tally must not be silent: ' + r.stdout);
  }
});

run('a signature read that fails after one byte lists the file as unverified, not as a short text file', () => {
  const root = makeTemp('san-sigfail-');
  write(root, 'doc.pdf', SIG.pdf);
  // dd stand-in: hand over the first byte, then fail
  const bin = makeBin({ shims: { dd: 'for a in "$@"; do case $a in if=*) f=${a#if=} ;; esac; done\nIFS= read -r -n 1 c < "$f"\nprintf %s "$c"\nexit 1' } });
  const r = scan(root, bin);
  assert.strictEqual(r.count, '1', r.stdout);
  assert.strictEqual(labelOf(r, 'doc.pdf'), 'detector error, unverified');
});

// Manifest location ---------------------------------------------------------------------------------
run('the manifest is written beside the project directory, never inside it', () => {
  const root = makeTemp('san-where-');
  fs.mkdirSync(path.join(root, 'sub'));
  write(root, 'book.docx', SIG.pk03);
  write(root, path.join('sub', 'doc.pdf'), SIG.pdf);
  const r = scan(root, makeBin());
  assert.strictEqual(r.count, '2');
  assert.ok(fs.existsSync(manifestOf(root)), 'manifest missing beside the project directory');
  const inside = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) walk(path.join(dir, ent.name));
      else if (ent.name.includes(MANIFEST)) inside.push(path.join(dir, ent.name));
    }
  };
  walk(root);
  assert.deepStrictEqual(inside, [], 'a manifest inside the project would be grepped by Steps 1-3 on a re-run');
});

// One-byte files -----------------------------------------------------------------------------------
run('a one-byte text file passes even when file(1) calls it binary; a one-byte NUL is listed', () => {
  const root = makeTemp('san-onebyte-');
  write(root, '__init__.py', '\n');
  write(root, 'x.txt', 'x');
  const shim = fileShim('application/octet-stream; charset=binary');
  assert.strictEqual(scan(root, shim).stdout, 'Unreadable count: 0\n');
  write(root, 'nul.bin', Buffer.from([0x00]));
  const r = scan(root, shim);
  assert.strictEqual(r.count, '1');
  assert.strictEqual(labelOf(r, 'nul.bin'), 'application/octet-stream');
});

// 13. Stale manifest --------------------------------------------------------------------------------
run('a stale manifest from an earlier run is removed by a clean run', () => {
  const root = makeTemp('san-stale-');
  fs.writeFileSync(manifestOf(root), 'stale-entry\told reason\n');
  write(root, 'plain.txt', 'hello\n');
  const r = scan(root, makeBin());
  assert.strictEqual(r.stdout, 'Unreadable count: 0\n');
  assert.ok(!fs.existsSync(manifestOf(root)), 'stale manifest survived a clean run');
});

run('a stale manifest does not leak its lines into a run that lists files', () => {
  const root = makeTemp('san-stale2-');
  fs.writeFileSync(manifestOf(root), 'stale-entry\told reason\n');
  write(root, 'book.docx', SIG.pk03);
  const r = scan(root, makeBin());
  assert.strictEqual(r.count, '1');
  assert.strictEqual(r.records.length, 1);
  assert.ok(!fs.readFileSync(manifestOf(root), 'latin1').includes('stale-entry'));
});

// 14. Last line, tally -----------------------------------------------------------------------------
run('stdout is only problems, a tally and a last count line; the tally has no paths', () => {
  const root = makeTemp('san-tally-');
  write(root, 'one.docx', SIG.pk03);
  write(root, 'two.docx', SIG.pk03);
  write(root, 'doc.pdf', SIG.pdf);
  const r = scan(root, makeBin());
  assert.strictEqual(r.count, '3');
  const tally = r.lines.slice(0, -1);
  assert.strictEqual(tally.length, 2, 'expected two tally lines, got ' + JSON.stringify(tally));
  assert.ok(tally.some((l) => /^\s*2 ZIP\/OOXML/.test(l)));
  assert.ok(tally.some((l) => /^\s*1 PDF$/.test(l)));
  assert.ok(!/\.docx|\.pdf|\.\//.test(r.stdout), 'a path reached stdout');
});

run('every run ends on an Unreadable count line, including problem runs', () => {
  const root = makeTemp('san-last-');
  write(root, 'plain.txt', 'hello\n');
  for (const bin of [makeBin(), makeBin({ omit: ['od'] }), findShim('f'), findShim('d'), fileShim('', 1)]) {
    const r = scan(root, bin);
    assert.ok(r.last.startsWith('Unreadable count: '), r.last);
  }
});

// Pruned directories ----------------------------------------------------------------------------------
run('.git, node_modules and __pycache__ are not walked, at any depth', () => {
  const root = makeTemp('san-prune-');
  for (const d of ['.git', 'node_modules/pkg', 'sub/__pycache__', 'sub/.git/objects']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
    write(root, path.join(d, 'blob.bin'), SIG.pk03);
  }
  write(root, 'real.docx', SIG.pk03);
  const r = scan(root, makeBin());
  assert.strictEqual(r.count, '1', r.stdout);
  assert.strictEqual(r.records.length, 1);
});

// 15. Doc consistency -------------------------------------------------------------------------------
run('the pipeline gate and the agent doc name the same manifest and count', () => {
  const agent = fs.readFileSync(agentPath, 'utf8');
  const skill = fs.readFileSync(skillPath, 'utf8');
  for (const [name, text] of [['agent doc', agent], ['pipeline skill', skill]]) {
    assert.ok(text.includes(MANIFEST), name + ' must name ' + MANIFEST);
    assert.ok(/Unreadable count/.test(text), name + ' must name "Unreadable count"');
  }
  assert.ok(!/file list/i.test(skill), 'the skill must not tell anyone to show a file list');
  const verify = skill.split('### /opensource verify')[1].split('\n### ')[0];
  assert.ok(verify.includes(MANIFEST), '/opensource verify must point at the manifest');
});

console.log('\n  Passed: ' + passed + '\n  Failed: ' + failed + '\n  Skipped: ' + skipped);
process.exit(failed > 0 ? 1 : 0);
