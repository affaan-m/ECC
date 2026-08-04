const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'ci', 'check-unicode-safety.js');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    return true;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    return false;
  }
}

function runCheck(root, args = []) {
  return spawnSync('node', [scriptPath, ...args], {
    env: {
      ...process.env,
      ECC_UNICODE_SCAN_ROOT: root,
    },
    encoding: 'utf8',
  });
}

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const warningEmoji = String.fromCodePoint(0x26A0, 0xFE0F);
const toolsEmoji = String.fromCodePoint(0x1F6E0, 0xFE0F);
const zeroWidthSpace = String.fromCodePoint(0x200B);
const rocketEmoji = String.fromCodePoint(0x1F680);

let passed = 0;
let failed = 0;

if (
  test('fails on invisible unicode and emoji before cleanup', () => {
    const root = makeTempRoot('ecc-unicode-check-');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), `> ${warningEmoji} Important launch note\n`);
    fs.writeFileSync(path.join(root, 'scripts', 'sample.js'), `const x = "a${zeroWidthSpace}";\n`);

    const result = runCheck(root);
    assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /dangerous-invisible U\+200B/);
    assert.match(result.stderr, /emoji U\+26A0/);
  })
)
  passed++;
else failed++;

if (
  test('write mode removes emoji and invisible unicode', () => {
    const root = makeTempRoot('ecc-unicode-fix-');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'guide.md'), `> ${warningEmoji} Important launch note\n`);
    fs.writeFileSync(path.join(root, 'README.md'), `## ${toolsEmoji} Tools\n`);
    fs.writeFileSync(path.join(root, 'note.txt'), `one${zeroWidthSpace}two\n`);

    const writeResult = runCheck(root, ['--write']);
    assert.strictEqual(writeResult.status, 0, writeResult.stdout + writeResult.stderr);

    assert.strictEqual(fs.readFileSync(path.join(root, 'docs', 'guide.md'), 'utf8'), '> WARNING: Important launch note\n');
    assert.strictEqual(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), '## Tools\n');
    assert.strictEqual(fs.readFileSync(path.join(root, 'note.txt'), 'utf8'), 'onetwo\n');

    const cleanResult = runCheck(root);
    assert.strictEqual(cleanResult.status, 0, cleanResult.stdout + cleanResult.stderr);
  })
)
  passed++;
else failed++;

if (
  test('write mode does not rewrite executable files', () => {
    const root = makeTempRoot('ecc-unicode-code-');
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    const scriptFile = path.join(root, 'scripts', 'sample.js');
    const original = `const label = "Launch ${rocketEmoji}";\n`;
    fs.writeFileSync(scriptFile, original);

    const result = runCheck(root, ['--write']);
    assert.notStrictEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /scripts[/\\]sample\.js:1:23 emoji U\+1F680/);
    assert.strictEqual(fs.readFileSync(scriptFile, 'utf8'), original);
  })
)
  passed++;
else failed++;

if (
  test('plain symbols like copyright remain allowed', () => {
    const root = makeTempRoot('ecc-unicode-symbols-');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'legal.md'), 'Copyright © ECC\nTrademark ® ECC\n');

    const result = runCheck(root);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  })
)
  passed++;
else failed++;

// Invisible code points newly covered by the denylist. These were missing
// from the previous denylist and silently passed through both detection and
// `--write` mode. Each is a documented LLM-prompt-injection vector
// (Tag block "ASCII smuggling"; the other invisibles are widely cited in
// homograph / Discord / Twitter smuggling references).

const NEWLY_COVERED_RANGES = [
  { codePoint: 0xE0041, label: 'Tag block U+E0041 (TAG LATIN CAPITAL LETTER A)' },
  { codePoint: 0xE007F, label: 'Tag block U+E007F (CANCEL TAG, range end)' },
  { codePoint: 0x180E, label: 'U+180E MONGOLIAN VOWEL SEPARATOR' },
  { codePoint: 0x115F, label: 'U+115F HANGUL CHOSEONG FILLER' },
  { codePoint: 0x1160, label: 'U+1160 HANGUL JUNGSEONG FILLER' },
  { codePoint: 0x2061, label: 'U+2061 FUNCTION APPLICATION' },
  { codePoint: 0x2064, label: 'U+2064 INVISIBLE PLUS (range end)' },
  { codePoint: 0x3164, label: 'U+3164 HANGUL FILLER' },
];

for (const { codePoint, label } of NEWLY_COVERED_RANGES) {
  if (
    test(`detects ${label}`, () => {
      const root = makeTempRoot('ecc-unicode-newly-covered-');
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      const hex = codePoint.toString(16).toUpperCase().padStart(4, '0');
      fs.writeFileSync(
        path.join(root, 'docs', `probe-${hex}.md`),
        `# Probe\n\nBenign${String.fromCodePoint(codePoint)}text\n`
      );
      const result = runCheck(root);
      assert.notStrictEqual(result.status, 0,
        `expected exit non-zero on U+${hex}, got ${result.status}: ${result.stderr}`);
      assert.match(result.stderr, new RegExp(`dangerous-invisible U\\+${hex}`),
        `expected violation message for U+${hex}, got: ${result.stderr}`);
    })
  )
    passed++;
  else failed++;
}

if (
  test('write mode strips newly-covered invisibles from markdown', () => {
    const root = makeTempRoot('ecc-unicode-newly-covered-write-');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    const tagHidden = [...Array(5)].map((_, i) => String.fromCodePoint(0xE0041 + i)).join('');
    const mongolianHidden = String.fromCodePoint(0x180E);
    const filePath = path.join(root, 'docs', 'mixed.md');
    fs.writeFileSync(filePath, `# Title\n\nBenign${tagHidden}${mongolianHidden}text.\n`);

    const writeResult = runCheck(root, ['--write']);
    assert.strictEqual(writeResult.status, 0,
      `expected --write to succeed, got ${writeResult.status}: ${writeResult.stderr}`);

    const sanitized = fs.readFileSync(filePath, 'utf8');
    assert.doesNotMatch(sanitized, /[\u{E0000}-\u{E007F}]/u,
      'expected tag block characters stripped');
    assert.doesNotMatch(sanitized, /\u{180E}/u,
      'expected U+180E stripped');
    assert.strictEqual(sanitized, '# Title\n\nBenigntext.\n',
      'expected only the invisible characters removed, surrounding text preserved');

    // Re-run without --write; should now pass cleanly.
    const clean = runCheck(root);
    assert.strictEqual(clean.status, 0,
      `expected post-sanitize re-run to pass, got: ${clean.stderr}`);
  })
)
  passed++;
else failed++;

if (
  test('skips Python virtual environments', () => {
    const root = makeTempRoot('ecc-unicode-venv-');
    fs.mkdirSync(path.join(root, '.venv', 'lib', 'python3.12', 'site-packages'), { recursive: true });
    fs.mkdirSync(path.join(root, 'venv', 'lib', 'python3.12', 'site-packages'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.venv', 'lib', 'python3.12', 'site-packages', 'package.py'),
      `message = "hello ${rocketEmoji}"\n`
    );
    fs.writeFileSync(
      path.join(root, 'venv', 'lib', 'python3.12', 'site-packages', 'package.py'),
      `message = "hello ${rocketEmoji}"\n`
    );

    const result = runCheck(root);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  })
)
  passed++;
else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
