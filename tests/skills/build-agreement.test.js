'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'skills/master-agreement-generator/scripts/build-agreement.js');
const templatePath = path.join(repoRoot, 'skills/master-agreement-generator/references/master-template.example.md');
const specPath = path.join(repoRoot, 'skills/master-agreement-generator/references/spec.example.json');
const builder = require(scriptPath);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

const template = fs.readFileSync(templatePath, 'utf8');
const exampleSpec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

console.log('\n=== build-agreement ===\n');

test('renders every placeholder from the example spec', () => {
  const output = builder.render(template, exampleSpec);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(output), 'placeholders remain');
  assert.match(output, /Acme Compute Ltd/);
  assert.match(output, /\*\*ACME COMPUTE LTD\*\*/);
  assert.match(output, /SOURCING FEE/);
  assert.match(output, /\| 1 \| 2026-08-20 \| Lot A \(16 nodes\) \| introducer \| 12 months \| standard \|/);
  assert.match(output, /the Data Processing Addendum dated 2026-09-01; amendable/);
});

test('renders the empty schedule placeholder row and blank lines when fields are omitted', () => {
  const output = builder.render(template, { file: 'X', short: 'Xco', role: 'buyer', date: 'January 1, 2030' });
  assert.ok(output.includes(builder.EMPTY_SCHEDULE_ROW));
  assert.match(output, new RegExp(`Name: ${builder.BLANK}`));
  assert.match(output, /\*\*XCO\*\*/);
  assert.match(output, /January 1, 2030/);
  assert.ok(!output.includes('; amendable') || output.includes('matter; amendable'), 'supplement separator must be empty');
});

test('selects the role clause by spec.role', () => {
  for (const role of ['buyer', 'supplier', 'mutual']) {
    const values = builder.buildValues({ file: 'X', short: 'Xco', role });
    assert.strictEqual(values.FEE_TITLE, builder.ROLE_CLAUSES[role].title);
    assert.ok(!values.ROLE_CLAUSE.includes('{cp}'), 'counterparty short name not substituted');
  }
  assert.match(builder.buildValues({ file: 'X', short: 'Xco', role: 'mutual' }).ROLE_CLAUSE, /Each Party may introduce/);
});

test('rejects unknown roles and missing required fields', () => {
  assert.throws(() => builder.buildValues({ file: 'X', short: 'Xco', role: 'partner' }), /unknown role "partner"/);
  assert.throws(() => builder.buildValues({ short: 'Xco', role: 'buyer' }), /spec\.file is required/);
});

test('explicit Markdown-only build writes draft without converter activity', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-build-agreement-'));
  try {
    const result = builder.build(templatePath, specPath, outDir, { markdownOnly: true, pandoc: false, now: new Date('2030-01-01T00:00:00Z') });
    assert.ok(fs.existsSync(result.markdown));
    assert.strictEqual(path.basename(result.markdown), 'AcmeSupplier MASTER.md');
    assert.strictEqual(result.docxSkipped, true);
    assert.strictEqual(result.docx, null);
    assert.strictEqual(result.documentStatus, 'draft');
    assert.match(fs.readFileSync(result.markdown, 'utf8'), /DRAFT/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('main returns usage exit code without arguments', () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.strictEqual(builder.main([]), 2);
  } finally {
    console.error = originalError;
  }
});

function withOutputFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agreement-containment-'));
  const artifacts = path.join(root, 'artifacts');
  const outDir = path.join(artifacts, 'nested', 'out');
  const input = path.join(root, 'spec.json');
  const log = path.join(root, 'pandoc.jsonl');
  const preload = path.join(root, 'pandoc-fixture.cjs');
  const behavior = path.join(root, 'converter-mode.json');
  fs.writeFileSync(behavior, JSON.stringify('success'));
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'nested', 'escaped MASTER.md'), 'external sentinel');
  // Preload only in the child CLI process: no real pandoc or provider calls.
  fs.writeFileSync(preload, `
    const fs = require('fs');
    const path = require('path');
    require('child_process').spawnSync = (command, args) => {
      if (command !== 'pandoc') throw new Error('unexpected fixture command');
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
      const mode = JSON.parse(fs.readFileSync(${JSON.stringify(behavior)}, 'utf8'));
      if (args[0] === '--version') return { status: mode === 'missing' ? 1 : 0, stdout: 'fixture pandoc' };
      if (mode === 'no-output') return { status: 0, stderr: '' };
      if (mode === 'empty') { fs.writeFileSync(args[2], ''); return { status: 0, stderr: '' }; }
      if (mode === 'failure') {
        fs.writeFileSync(args[2], 'partial artifact');
        return { status: 1, stderr: 'synthetic conversion failure' };
      }
      for (const target of [args[0], args[2]]) {
        const relative = path.relative(${JSON.stringify(root)}, path.resolve(target));
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('fixture escaped');
      }
      fs.copyFileSync(args[0], args[2]);
      return { status: 0, stderr: '' };
    };
  `);
  const run = (args = [], chosenTemplate = templatePath) => spawnSync(process.execPath, ['--require', preload, scriptPath, chosenTemplate, input, outDir, ...args], {
    cwd: root,
    env: { PATH: '', TZ: 'UTC' },
    encoding: 'utf8', timeout: 3000,
  });
  const setSpec = fields => fs.writeFileSync(input, JSON.stringify({ ...exampleSpec, ...fields }));
  const setFile = file => setSpec({ file });
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
  try {
    const setConverter = mode => fs.writeFileSync(behavior, JSON.stringify(mode));
    fn({ root, artifacts, outDir, input, setFile, setSpec, setConverter, calls, run });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function snapshot(directory) {
  return fs.readdirSync(directory).sort().map(name => {
    const target = path.join(directory, name);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return [name, 'symlink', fs.readlinkSync(target)];
    return [name, stat.isDirectory() ? snapshot(target) : fs.readFileSync(target, 'utf8')];
  });
}

const invalidFiles = [
  ['parent traversal', '../escaped'], ['nested traversal', '../../escaped'],
  ['forward separator', 'child/name'], ['backward separator', 'child\\name'],
  ['backward traversal', '..\\escaped'], ['drive absolute', 'C:\\temp\\escape'],
  ['drive relative', 'C:escape'], ['UNC', '\\\\server\\share\\escape'],
  ['dot', '.'], ['dot dot', '..'], ['empty', ''], ['blank', '   '],
  ['missing', undefined], ['null', null], ['number', 7], ['object', {}],
  ['NUL', 'bad\0name'], ['CR', 'bad\rname'], ['LF', 'bad\nname'], ['DEL', 'bad\x7fname'],
  ['wildcard', 'bad*name'], ['alternate stream', 'name:stream'], ['reserved device', 'CON.txt'],
  ['trailing dot', 'name.'], ['trailing space', 'name '],
  ...['COM', 'LPT'].flatMap(prefix => ['¹', '²', '³'].map(digit => [`device ${prefix}${digit}`, `${prefix}${digit}.txt`])),
];

for (const [name, file] of [...invalidFiles, ['absolute', null]]) {
  test(`rejects ${name} filename before any output or pandoc activity`, () => withOutputFixture(fixture => {
    fixture.setFile(name === 'absolute' ? path.join(fixture.artifacts, 'absolute') : file);
    const before = snapshot(fixture.artifacts);
    assert.throws(() => builder.build(templatePath, fixture.input, fixture.outDir, { markdownOnly: true, pandoc: false }), /spec\.file/);
    assert.deepStrictEqual(snapshot(fixture.artifacts), before, 'build changed output files');
    const result = fixture.run();
    assert.strictEqual(result.status, 1, result.stderr);
    assert.match(result.stderr, /spec\.file/);
    assert.deepStrictEqual(snapshot(fixture.artifacts), before, 'CLI changed output files');
    assert.deepStrictEqual(fixture.calls(), [], 'pandoc must not be probed or invoked');
  }));
}

for (const extension of ['md', 'docx']) {
  for (const dangling of [false, true]) {
    test(`rejects ${dangling ? 'dangling' : 'existing'} ${extension} destination symlink before writes`, () => withOutputFixture(fixture => {
      fixture.setFile('Acme');
      fs.mkdirSync(fixture.outDir);
      const target = path.join(fixture.artifacts, 'external');
      if (!dangling) fs.writeFileSync(target, 'do not overwrite');
      fs.symlinkSync(target, path.join(fixture.outDir, `Acme MASTER.${extension}`), 'file');
      const other = extension === 'md' ? 'docx' : 'md';
      fs.writeFileSync(path.join(fixture.outDir, `Acme MASTER.${other}`), 'existing output');
      const before = snapshot(fixture.artifacts);
      assert.throws(() => builder.build(templatePath, fixture.input, fixture.outDir, { markdownOnly: true, pandoc: false }), /symlink/);
      assert.deepStrictEqual(snapshot(fixture.artifacts), before);
      const result = fixture.run();
      assert.strictEqual(result.status, 1, result.stderr);
      assert.match(result.stderr, /symlink/);
      assert.deepStrictEqual(snapshot(fixture.artifacts), before);
      assert.deepStrictEqual(fixture.calls(), []);
    }));
  }
}

test('preserves names with spaces and regular-file rebuilds', () => withOutputFixture(fixture => {
  fixture.setFile('Acme Supplier');
  const first = builder.build(templatePath, fixture.input, fixture.outDir, { markdownOnly: true, pandoc: false });
  assert.strictEqual(path.dirname(path.resolve(first.markdown)), fixture.outDir);
  assert.strictEqual(path.basename(first.markdown), 'Acme Supplier MASTER.md');
  fs.writeFileSync(first.markdown, 'old output');
  const second = builder.build(templatePath, fixture.input, fixture.outDir, { markdownOnly: true, pandoc: false });
  assert.strictEqual(second.markdown, first.markdown);
  assert.strictEqual(fs.readFileSync(second.markdown, 'utf8'), builder.render(template, { ...exampleSpec, file: 'Acme Supplier' }));
}));

test('CLI fixture conversion writes both artifacts directly inside the output root', () => withOutputFixture(fixture => {
  fixture.setFile('Acme Supplier');
  const result = fixture.run();
  assert.strictEqual(result.status, 0, result.stderr);
  const md = path.join(fixture.outDir, 'Acme Supplier MASTER.md');
  const docx = path.join(fixture.outDir, 'Acme Supplier MASTER.docx');
  assert.deepStrictEqual(fixture.calls(), [['--version'], [md, '-o', docx]]);
  assert.strictEqual(fs.readFileSync(docx, 'utf8'), fs.readFileSync(md, 'utf8'));
  assert.strictEqual(fs.readFileSync(path.join(fixture.artifacts, 'nested', 'escaped MASTER.md'), 'utf8'), 'external sentinel');
}));

test('default template is clearly draft and does not promise universal notice authority', () => {
  const output = builder.render(template, exampleSpec);
  assert.match(output, /DRAFT/);
  assert.ok(!output.includes('Execution copy. Our fields are complete'));
  assert.ok(!output.includes('No re-signing'));
  assert.match(output, /authorized by the executed agreement/);
  assert.match(output, /amendment/);
  assert.match(output, /negotiation/);
});

test('Markdown-only CLI succeeds explicitly without probing pandoc', () => withOutputFixture(fixture => {
  fixture.setFile('Acme');
  fixture.setConverter('missing');
  fs.mkdirSync(fixture.outDir);
  fs.writeFileSync(path.join(fixture.outDir, 'Acme MASTER.docx'), 'stale artifact');
  const result = fixture.run(['--markdown-only']);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /draft/);
  assert.match(result.stdout, /explicit Markdown-only/);
  assert.deepStrictEqual(fixture.calls(), []);
  assert.ok(!fs.existsSync(path.join(fixture.outDir, 'Acme MASTER.docx')));
}));

for (const mode of ['missing', 'failure', 'no-output', 'empty']) {
  test(`DOCX-required CLI fails for ${mode} and exposes no stale or partial DOCX`, () => withOutputFixture(fixture => {
    fixture.setFile('Acme');
    fixture.setConverter(mode);
    fs.mkdirSync(fixture.outDir);
    fs.writeFileSync(path.join(fixture.outDir, 'Acme MASTER.docx'), 'stale artifact');
    const result = fixture.run(['--require-docx']);
    assert.strictEqual(result.status, 1, result.stderr);
    assert.match(result.stderr, /DOCX|pandoc/);
    assert.ok(!fs.existsSync(path.join(fixture.outDir, 'Acme MASTER.docx')));
  }));
}

test('custom templates receive the same mandatory draft notice', () => {
  const output = builder.render('# Custom agreement\n{{CP_SHORT}}', exampleSpec);
  assert.match(output, /^\*\*DRAFT:/);
  assert.match(output, /Not an execution copy/);
});

test('library converter disable alone cannot silently satisfy DOCX requirement', () => withOutputFixture(fixture => {
  fixture.setFile('Acme');
  assert.throws(() => builder.build(templatePath, fixture.input, fixture.outDir, { pandoc: false }), /DOCX required/);
}));

test('default CLI requires DOCX when converter is missing', () => withOutputFixture(fixture => {
  fixture.setFile('Acme');
  fixture.setConverter('missing');
  const result = fixture.run();
  assert.strictEqual(result.status, 1, result.stderr);
  assert.match(result.stderr, /DOCX/);
}));

test('unknown, conflicting and excess CLI arguments fail without writes', () => withOutputFixture(fixture => {
  fixture.setFile('Acme');
  for (const args of [['--typo'], ['--execution-copy'], ['extra'], ['--markdown-only', '--require-docx']]) {
    const before = snapshot(fixture.artifacts);
    const result = fixture.run(args);
    assert.strictEqual(result.status, 2, result.stderr);
    assert.deepStrictEqual(snapshot(fixture.artifacts), before);
  }
  assert.deepStrictEqual(fixture.calls(), []);
}));

const validScheduleRow = ['1', '2030-01-01', 'Synthetic lot', 'introducer', '12 months', 'standard'];
const invalidSchedules = [
  ['null', null], ['object', {}], ['string', 'entry'], ['number', 1], ['boolean', false],
  ['null row', [null]], ['object row', [{}]], ['string row', ['entry']],
  ['five cells', [validScheduleRow.slice(0, 5)]], ['seven cells', [[...validScheduleRow, 'extra']]],
  ['mixed rows', [validScheduleRow, []]],
  ...[null, true, {}, []].map((cell, index) => [`invalid cell ${index}`, [[...validScheduleRow.slice(0, 5), cell]]]),
  ...['\ud800', '\udc00'].map((cell, index) => [`unpaired surrogate ${index}`, [[...validScheduleRow.slice(0, 5), cell]]]),
];

for (const [name, schedule] of invalidSchedules) {
  test(`rejects schedule ${name} before output or pandoc activity`, () => withOutputFixture(fixture => {
    fixture.setSpec({ schedule });
    for (const existing of [false, true]) {
      if (existing) {
        fs.mkdirSync(fixture.outDir);
        for (const extension of ['md', 'docx']) {
          fs.writeFileSync(path.join(fixture.outDir, `AcmeSupplier MASTER.${extension}`), 'existing artifact');
        }
      }
      const before = snapshot(fixture.artifacts);
      assert.throws(() => builder.build(templatePath, fixture.input, fixture.outDir, { markdownOnly: true, pandoc: false }), /schedule/);
      assert.deepStrictEqual(snapshot(fixture.artifacts), before);
      const result = fixture.run();
      assert.strictEqual(result.status, 1, result.stderr);
      assert.match(result.stderr, /schedule/);
      assert.deepStrictEqual(snapshot(fixture.artifacts), before);
      assert.deepStrictEqual(fixture.calls(), []);
    }
  }));
}

test('rejects sparse schedules, sparse rows and non-JSON cells with indexed errors', () => {
  const sparseRow = [...validScheduleRow];
  delete sparseRow[2];
  assert.throws(() => builder.renderScheduleRows(new Array(1)), /schedule\[0\]/);
  assert.throws(() => builder.renderScheduleRows([sparseRow]), /schedule\[0\]\[2\]/);
  for (const cell of [undefined, NaN, Infinity, -Infinity, 1n, Symbol('cell'), () => 'cell']) {
    assert.throws(() => builder.renderScheduleRows([[...validScheduleRow.slice(0, 5), cell]]), /schedule\[0\]\[5\]/);
  }
});

test('preserves empty schedule semantics, finite numbers and input data', () => {
  assert.strictEqual(builder.renderScheduleRows(undefined), builder.EMPTY_SCHEDULE_ROW);
  assert.strictEqual(builder.renderScheduleRows([]), builder.EMPTY_SCHEDULE_ROW);
  const rows = Object.freeze([Object.freeze([1, '', 'Synthetic lot', 'introducer', 0, 1.5]), Object.freeze([...validScheduleRow])]);
  assert.strictEqual(builder.renderScheduleRows(rows), '| 1 |  | Synthetic lot | introducer | 0 | 1.5 |\n| 1 | 2030-01-01 | Synthetic lot | introducer | 12 months | standard |');
});

const adversarialSchedule = [
  ['A|B', 'A\\|B', '`code|cell`', '<b>literal</b>', '&amp; &#124;', 'line1\r\nline2\rline3\nline4'],
  ['**bold** _text_', '[label](https://example.invalid)', '$x^2$ ~sub~', "\"quote\" and 'text'", 'a--b...c', '  edge  spaces  '],
  ['{.class} @citation', '\\textbf{raw}', 'x\ty', 42, '', 'Unicode café 東京 😀'],
];
const displayedSchedule = [
  ['A|B', 'A\\|B', '`code|cell`', '<b>literal</b>', '&amp; &#124;', 'line1 line2 line3 line4'],
  ['**bold** _text_', '[label](https://example.invalid)', '$x^2$ ~sub~', "\"quote\" and 'text'", 'a--b...c', '  edge  spaces  '],
  ['{.class} @citation', '\\textbf{raw}', 'x\ty', '42', '', 'Unicode café 東京 😀'],
];

test('encodes table syntax, normalizes line breaks and leaves input unchanged', () => {
  const before = JSON.stringify(adversarialSchedule);
  const output = builder.renderScheduleRows(adversarialSchedule);
  assert.strictEqual(output.split('\n').length, adversarialSchedule.length);
  assert.ok(!output.includes('A|B'));
  assert.ok(!output.includes('<b>literal</b>'));
  assert.ok(!output.includes('`code|cell`'));
  assert.ok(output.includes('line1 line2 line3 line4'));
  assert.strictEqual(JSON.stringify(adversarialSchedule), before);
});

const rendererPath = process.env.ECC_AGREEMENT_TEST_PANDOC;
if (rendererPath) {
  test('independent pandoc renderer preserves every displayed field in six-column rows', () => {
    const markdown = '| A | B | C | D | E | F |\n|---|---|---|---|---|---|\n' + builder.renderScheduleRows(adversarialSchedule);
    const result = spawnSync(rendererPath, ['--from=markdown', '--to=json'], {
      input: markdown, encoding: 'utf8', timeout: 10000, env: { PATH: '' },
    });
    assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
    const blocks = JSON.parse(result.stdout).blocks;
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].t, 'Table');
    const rows = blocks[0].c[4].flatMap(body => body[3]);
    const displayed = rows.map(row => {
      assert.strictEqual(row[1].length, 6);
      return row[1].map(cell => cell[4].map(block => {
        assert.ok(['Plain', 'Para'].includes(block.t));
        return block.c.map(inline => {
          if (inline.t === 'Space') return ' ';
          assert.strictEqual(inline.t, 'Str', 'cell text must not become executable or formatted Markdown');
          return inline.c;
        }).join('');
      }).join(''));
    });
    assert.deepStrictEqual(displayed, displayedSchedule);
  });
} else {
  console.log('  Independent renderer check not requested; set ECC_AGREEMENT_TEST_PANDOC to an installed pandoc.');
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
