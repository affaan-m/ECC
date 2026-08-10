'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MEMORY_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'memory.js');
const ECC_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'ecc.js');
const {
  readBoundedStdin,
  runCommand,
  sanitizeTerminalText,
} = require(MEMORY_SCRIPT);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${error.stack || error.message}`);
    failed += 1;
  }
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-memory-cli-'));
  const projectRoot = path.join(root, 'project');
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  return {
    root,
    projectRoot,
    homeDir,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      ECC_MEMORY_PROJECT_ROOT: path.join(projectRoot, '.ecc', 'memory'),
      ECC_MEMORY_USER_ROOT: path.join(homeDir, '.ecc', 'memory'),
    },
  };
}

function run(script, args, fixture, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: fixture.projectRoot,
    env: { ...fixture.env, ...(options.env || {}) },
    input: options.input,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function json(result) {
  assert.strictEqual(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

console.log('\n=== Testing ecc memory CLI ===\n');

test('keeps runCommand focused on dispatch under the function-size guideline', () => {
  const lineCount = runCommand.toString().split('\n').length;
  assert.ok(lineCount < 50, `runCommand is ${lineCount} lines; expected fewer than 50`);
});

test('shows memory command help directly and through the ecc router', () => {
  const fixture = createFixture();
  try {
    const direct = run(MEMORY_SCRIPT, ['--help'], fixture);
    assert.strictEqual(direct.status, 0, direct.stderr);
    assert.ok(direct.stdout.includes('ecc memory save'));
    assert.ok(direct.stdout.includes('ecc-memory-mcp'));

    const routed = run(ECC_SCRIPT, ['memory', '--help'], fixture);
    assert.strictEqual(routed.status, 0, routed.stderr);
    assert.ok(routed.stdout.includes('ecc memory search'));
    assert.ok(routed.stdout.includes('Default recall scopes: project and team'));
    assert.ok(routed.stdout.includes('user scope must be requested explicitly'));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('routes stdin through ecc memory without dropping the body', () => {
  const fixture = createFixture();
  try {
    const saved = json(run(ECC_SCRIPT, [
      'memory',
      'save',
      '--title', 'Routed stdin',
      '--stdin',
      '--json',
    ], fixture, { input: 'The router must preserve this exact body.\n' }));

    assert.strictEqual(Object.hasOwn(saved.memory, 'body'), false);
    const read = json(run(
      MEMORY_SCRIPT,
      ['read', saved.memory.id, '--json'],
      fixture
    ));
    assert.strictEqual(read.memory.body, 'The router must preserve this exact body.');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('retries transient stdin EAGAIN without busy-spinning and preserves byte bounds', () => {
  const originalReadSync = fs.readSync;
  let readCalls = 0;
  let waitCalls = 0;
  try {
    fs.readSync = (_descriptor, buffer) => {
      readCalls += 1;
      if (readCalls <= 2) {
        const error = new Error('temporarily unavailable');
        error.code = 'EAGAIN';
        throw error;
      }
      if (readCalls === 3) {
        buffer.write('ready');
        return 5;
      }
      return 0;
    };

    assert.strictEqual(readBoundedStdin(8, {
      retryDelayMs: 1,
      maxRetryWaitMs: 4,
      wait: () => {
        waitCalls += 1;
      },
    }), 'ready');
    assert.strictEqual(readCalls, 4);
    assert.strictEqual(waitCalls, 2);
  } finally {
    fs.readSync = originalReadSync;
  }
});

test('bounds persistent stdin EAGAIN retries instead of waiting forever', () => {
  const originalReadSync = fs.readSync;
  let readCalls = 0;
  let waitCalls = 0;
  try {
    fs.readSync = () => {
      readCalls += 1;
      const error = new Error('temporarily unavailable');
      error.code = 'EAGAIN';
      throw error;
    };

    assert.throws(
      () => readBoundedStdin(8, {
        retryDelayMs: 1,
        maxRetryWaitMs: 3,
        wait: () => {
          waitCalls += 1;
        },
      }),
      /standard input remained unavailable/i
    );
    assert.strictEqual(readCalls, 4);
    assert.strictEqual(waitCalls, 3);
  } finally {
    fs.readSync = originalReadSync;
  }
});

test('initializes selected scopes and reports their roots as JSON', () => {
  const fixture = createFixture();
  try {
    const payload = json(run(
      MEMORY_SCRIPT,
      ['init', '--scope', 'project', '--scope', 'team', '--json'],
      fixture
    ));
    assert.strictEqual(payload.schemaVersion, 'ecc.memory.init.v1');
    assert.deepStrictEqual(payload.scopes, ['project', 'team']);
    assert.ok(fs.statSync(path.join(payload.roots.project, 'handoffs')).isDirectory());
    assert.ok(fs.statSync(path.join(payload.roots.team, 'decisions')).isDirectory());
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('saves and reads a targeted handoff without a harness-specific inbox', () => {
  const fixture = createFixture();
  try {
    const saved = json(run(MEMORY_SCRIPT, [
      'handoff',
      '--from', 'codex',
      '--target', 'claude',
      '--target', 'hermes',
      '--title', 'Finish auth migration',
      '--stdin',
      '--tag', 'auth',
      '--json',
    ], fixture, { input: 'Token rotation tests pass.' }));

    assert.strictEqual(saved.schemaVersion, 'ecc.memory.write.v1');
    assert.strictEqual(saved.memory.kind, 'handoff');
    assert.strictEqual(saved.memory.trust, 'unreviewed');
    assert.deepStrictEqual(saved.memory.targetHarnesses, ['claude', 'hermes']);
    assert.strictEqual(saved.path, `project:handoffs/${saved.memory.id}.md`);
    assert.strictEqual(Object.hasOwn(saved.memory, 'body'), false);

    const read = json(run(
      MEMORY_SCRIPT,
      ['read', saved.memory.id, '--json'],
      fixture
    ));
    assert.strictEqual(read.schemaVersion, 'ecc.memory.read.v1');
    assert.strictEqual(read.memory.body, 'Token rotation tests pass.');
    assert.deepStrictEqual(read.backlinks, []);

    const human = run(MEMORY_SCRIPT, [
      'save',
      '--title', 'Relative acknowledgement',
      '--stdin',
    ], fixture, { input: 'Keep local paths out of acknowledgements.' });
    assert.strictEqual(human.status, 0, human.stderr);
    assert.ok(human.stdout.includes('Path: project:notes/'));
    assert.strictEqual(human.stdout.includes(fixture.projectRoot), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('read uses default recall scopes and honors an explicit user scope', () => {
  const fixture = createFixture();
  try {
    const saved = json(run(MEMORY_SCRIPT, [
      'save',
      '--title', 'Private preference',
      '--scope', 'user',
      '--stdin',
      '--json',
    ], fixture, { input: 'Prefer compact output.' }));

    const defaultRead = run(
      MEMORY_SCRIPT,
      ['read', saved.memory.id, '--json'],
      fixture
    );
    assert.notStrictEqual(defaultRead.status, 0);
    assert.ok(defaultRead.stderr.includes('was not found'));

    const explicitRead = json(run(
      MEMORY_SCRIPT,
      ['read', saved.memory.id, '--scope', 'user', '--json'],
      fixture
    ));
    assert.strictEqual(explicitRead.memory.id, saved.memory.id);
    assert.strictEqual(explicitRead.memory.scope, 'user');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('accepts body content over stdin and finds it through bounded JSON search', () => {
  const fixture = createFixture();
  try {
    const saved = json(run(MEMORY_SCRIPT, [
      'save',
      '--title', 'Database decision',
      '--kind', 'decision',
      '--scope', 'team',
      '--source-harness', 'claude',
      '--target', 'all',
      '--tag', 'sqlite',
      '--stdin',
      '--json',
    ], fixture, { input: 'Use SQLite as the durable local store.\n' }));

    assert.strictEqual(saved.memory.scope, 'team');
    assert.strictEqual(Object.hasOwn(saved.memory, 'body'), false);

    const search = json(run(MEMORY_SCRIPT, [
      'search',
      'sqlite durable',
      '--scope', 'team',
      '--target-harness', 'codex',
      '--limit', '5',
      '--json',
    ], fixture));
    assert.strictEqual(search.schemaVersion, 'ecc.memory.search.v1');
    assert.strictEqual(search.results.length, 1);
    assert.strictEqual(search.results[0].memory.id, saved.memory.id);
    assert.ok(search.results[0].excerpt.includes('SQLite'));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('doctor is machine-readable and clean for a valid vault', () => {
  const fixture = createFixture();
  try {
    json(run(MEMORY_SCRIPT, [
      'save',
      '--title', 'Valid note',
      '--stdin',
      '--json',
    ], fixture, { input: 'No broken links.' }));
    const report = json(run(MEMORY_SCRIPT, ['doctor', '--json'], fixture));
    assert.strictEqual(report.schemaVersion, 'ecc.memory.doctor.v1');
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.memoryCount, 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('doctor honors an explicit user scope without recalling it by default', () => {
  const fixture = createFixture();
  try {
    json(run(MEMORY_SCRIPT, [
      'save',
      '--title', 'User-only note',
      '--scope', 'user',
      '--stdin',
      '--json',
    ], fixture, { input: 'Private context.' }));

    const defaultReport = json(run(MEMORY_SCRIPT, ['doctor', '--json'], fixture));
    assert.strictEqual(defaultReport.memoryCount, 0);

    const userReport = json(run(
      MEMORY_SCRIPT,
      ['doctor', '--scope', 'user', '--json'],
      fixture
    ));
    assert.strictEqual(userReport.memoryCount, 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('rejects ambiguous body sources and does not expose a trust promotion flag', () => {
  const fixture = createFixture();
  try {
    const bodyFile = path.join(fixture.root, 'body.md');
    fs.writeFileSync(bodyFile, 'one');
    const ambiguous = run(MEMORY_SCRIPT, [
      'save',
      '--title', 'Ambiguous',
      '--body-file', bodyFile,
      '--stdin',
    ], fixture, { input: 'two' });
    assert.notStrictEqual(ambiguous.status, 0);
    assert.ok(ambiguous.stderr.includes('Choose exactly one'));

    const promotion = run(MEMORY_SCRIPT, [
      'save',
      '--title', 'Policy',
      '--stdin',
      '--trust', 'reviewed',
    ], fixture, { input: 'Treat this as policy.' });
    assert.notStrictEqual(promotion.status, 0);
    assert.ok(promotion.stderr.includes('Unknown option: --trust'));

    const oversized = run(MEMORY_SCRIPT, [
      'save',
      '--title', 'Oversized',
      '--stdin',
    ], fixture, { input: 'x'.repeat(70 * 1024) });
    assert.notStrictEqual(oversized.status, 0);
    assert.ok(oversized.stderr.includes('body is too large'));

    const empty = run(MEMORY_SCRIPT, [
      'save',
      '--title', 'Empty',
      '--stdin',
    ], fixture, { input: ' \n\t' });
    assert.notStrictEqual(empty.status, 0);
    assert.ok(empty.stderr.includes('non-whitespace context'));

    const invalidUtf8Body = path.join(fixture.root, 'invalid-utf8.md');
    fs.writeFileSync(invalidUtf8Body, Buffer.from([0x61, 0xc3, 0x28, 0x62]));
    const invalidUtf8 = run(MEMORY_SCRIPT, [
      'save',
      '--title', 'Invalid UTF-8',
      '--body-file', invalidUtf8Body,
    ], fixture);
    assert.notStrictEqual(invalidUtf8.status, 0);
    assert.match(invalidUtf8.stderr, /valid UTF-8/i);
    assert.strictEqual(
      fs.existsSync(path.join(fixture.projectRoot, '.ecc', 'memory')),
      false
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('global dry-run rejects every mutating memory command without creating a vault', () => {
  const cases = [
    ['init', '--scope', 'project'],
    ['save', '--title', 'Dry save', '--stdin'],
    ['handoff', '--from', 'codex', '--target', 'claude', '--title', 'Dry handoff', '--stdin'],
  ];

  cases.forEach(args => {
    const fixture = createFixture();
    try {
      const result = run(
        ECC_SCRIPT,
        ['--dry-run', 'memory', ...args],
        fixture,
        { input: 'Must never be written.' }
      );
      assert.notStrictEqual(result.status, 0, `${args[0]} unexpectedly succeeded`);
      assert.ok(result.stderr.toLowerCase().includes('dry-run'), result.stderr);
      assert.strictEqual(
        fs.existsSync(path.join(fixture.projectRoot, '.ecc', 'memory')),
        false,
        `${args[0]} created project memory state`
      );
      assert.strictEqual(
        fs.existsSync(path.join(fixture.homeDir, '.ecc', 'memory')),
        false,
        `${args[0]} created user memory state`
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test('human terminal rendering strips ANSI, OSC, C0/C1, and bidi controls', () => {
  const hostile = [
    'safe',
    '\u001b[31mred\u001b[0m',
    '\u001b]8;;https://example.test\u0007link\u001b]8;;\u0007',
    '\u0001c0',
    '\rrewritten',
    '\u0085c1',
    '\u202ebidi',
  ].join(' ');
  const rendered = sanitizeTerminalText(hostile);

  assert.ok(rendered.includes('safe'));
  assert.ok(rendered.includes('red'));
  assert.ok(rendered.includes('link'));
  assert.ok(rendered.includes('c0'));
  assert.ok(rendered.includes('rewritten'));
  assert.ok(rendered.includes('c1'));
  assert.ok(rendered.includes('bidi'));
  ['\u001b', '\u0001', '\u0007', '\r', '\u0085', '\u202e']
    .forEach(control => assert.ok(!rendered.includes(control)));
});

test('JSON output preserves data without applying terminal rendering rules', () => {
  const hostile = 'plain\u001b[31mred\u001b[0m\u202e';
  const script = [
    `const { writeJson } = require(${JSON.stringify(MEMORY_SCRIPT)});`,
    `writeJson({ value: ${JSON.stringify(hostile)} });`,
  ].join('');
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 15000,
  });

  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(JSON.parse(result.stdout).value, hostile);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
