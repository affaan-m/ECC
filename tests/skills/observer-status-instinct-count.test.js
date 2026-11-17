/**
 * Regression tests for #2859: status counts eligible top-level instinct files.
 * The loader accepts .yaml/.yml/.md; files can contain zero or many instincts,
 * so this count does not establish parsed-record counts or observer health.
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillRoot = path.join(repoRoot, 'skills', 'continuous-learning-v2');
const observerScript = path.join(skillRoot, 'agents', 'start-observer.sh');
const instinctCli = path.join(skillRoot, 'scripts', 'instinct-cli.py');
const bashBinary = process.env.ECC_TEST_BASH || (process.platform === 'win32' ? null : '/bin/bash');
const childTimeoutMs = 3000;
const childMaxBuffer = 64 * 1024;

class SkipTest extends Error {}

function toShellPath(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  return normalized.replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
}

function readAllowedExtensions() {
  const cliSource = fs.readFileSync(instinctCli, 'utf8');
  const match = cliSource.match(/ALLOWED_INSTINCT_EXTENSIONS\s*=\s*\(([^)]*)\)/);
  assert.ok(match, 'ALLOWED_INSTINCT_EXTENSIONS not found in instinct-cli.py');
  return match[1].split(',')
    .map(part => part.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function fixtureAt(root) {
  const home = path.join(root, 'home');
  const temp = path.join(root, 'tmp');
  const bin = path.join(root, 'bin');
  const homunculus = path.join(root, 'homunculus');
  const instincts = path.join(homunculus, 'instincts', 'personal');
  const unexpected = path.join(root, 'unexpected-command');
  for (const directory of [home, temp, bin, instincts]) fs.mkdirSync(directory, { recursive: true });
  for (const command of ['python', 'python3', 'git', 'claude']) {
    fs.writeFileSync(path.join(bin, command),
      '#!/bin/sh\nprintf unexpected > "$FIXTURE_UNEXPECTED_COMMAND"\nexit 97\n', { mode: 0o700 });
  }
  fs.writeFileSync(path.join(homunculus, 'observations.jsonl'), '');
  return {
    root, instincts, unexpected,
    env: {
      PATH: [toShellPath(bin), '/usr/bin', '/bin'].join(':'),
      HOME: toShellPath(home), USERPROFILE: home, TMPDIR: toShellPath(temp),
      TMP: temp, TEMP: temp, LC_ALL: 'C',
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
      CLV2_NO_PROJECT: '1', CLV2_HOMUNCULUS_DIR: toShellPath(homunculus),
      CLV2_CONFIG: toShellPath(path.join(root, 'absent-config.json')),
      CLV2_PYTHON_CMD: toShellPath(path.join(bin, 'python3')),
      FIXTURE_UNEXPECTED_COMMAND: toShellPath(unexpected),
    },
  };
}

function withFixture(callback, remove = fs.rmSync) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observer-')));
  let failed = false; let primary; let result;
  try {
    result = callback(fixtureAt(root));
  } catch (error) {
    failed = true;
    primary = error;
  }
  try { remove(root, { recursive: true, force: true }); }
  catch (error) { if (!failed) throw error; }
  if (failed) throw primary;
  return result;
}

function checkChild(result) {
  if (result.error) throw result.error;
  assert.strictEqual(result.status, 0, result.stderr || result.stdout || `child signal: ${result.signal}`);
}

function runStatus(files, { run = spawnSync, setup = () => {}, remove = fs.rmSync } = {}) {
  return withFixture(fixture => {
    for (const name of files) {
      const target = path.join(fixture.instincts, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'id: fixture\n');
    }
    setup(fixture);
    // Only this foreground shell's own PID is advertised. No observer, sleep,
    // provider or other background child is started or signalled.
    const program = 'printf "%s\\n" "$$" > "$CLV2_HOMUNCULUS_DIR/.observer.pid"\nexec "$BASH" "$1" status';
    const wrapper = path.join(fixture.root, 'status-wrapper.sh');
    fs.writeFileSync(wrapper, `${program}\n`, { flag: 'wx', mode: 0o600 });
    const result = run(bashBinary, ['--noprofile', '--norc', toShellPath(wrapper),
      toShellPath(observerScript)], {
      cwd: fixture.root, encoding: 'utf8', env: fixture.env,
      timeout: childTimeoutMs, maxBuffer: childMaxBuffer, killSignal: 'SIGKILL',
    });
    checkChild(result);
    assert.ok(!fs.existsSync(fixture.unexpected), 'status must not invoke Git, Python or a provider');
    const lines = (result.stdout || '').split('\n').filter(line => line.startsWith('Instincts:'));
    assert.strictEqual(lines.length, 1, `expected one count in status output:\n${result.stdout}`);
    assert.match(lines[0], /^Instincts:\s+\d+\s*$/);
    return Number(lines[0].split(':')[1].trim());
  }, remove);
}

function fileLink(target, link, type = 'file') {
  try { fs.symlinkSync(target, link, type); }
  catch (error) {
    const unsupported = ['ENOSYS', 'ENOTSUP'].includes(error.code)
      || (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code));
    if (unsupported) throw new SkipTest(`symlink capability unavailable: ${error.code}`);
    throw error;
  }
}

function shellTest(fn) {
  return () => {
    if (!bashBinary) throw new SkipTest('requires bash; set ECC_TEST_BASH on Windows');
    return fn();
  };
}

function cleanupTests() {
  return [
    ['status child has a private environment and bounded execution', () => {
      let root;
      assert.strictEqual(runStatus([], { run: (_command, args, options) => {
        root = options.cwd;
        assert.strictEqual(options.timeout, childTimeoutMs);
        assert.strictEqual(options.maxBuffer, childMaxBuffer);
        assert.strictEqual(options.killSignal, 'SIGKILL');
        assert.strictEqual(options.env.CLV2_NO_PROJECT, '1');
        for (const key of ['BASH_ENV', 'ENV', 'NODE_OPTIONS', 'ANTHROPIC_API_KEY', 'CLAUDE_PROJECT_DIR']) {
          assert.ok(!Object.hasOwn(options.env, key), `unexpected inherited ${key}`);
        }
        assert.ok(options.env.CLV2_CONFIG.endsWith('/absent-config.json'));
        assert.ok(!fs.existsSync(options.env.CLV2_CONFIG));
        assert.strictEqual(args.at(-1), toShellPath(observerScript));
        const program = args.includes('-c') ? args[3] : fs.readFileSync(path.join(root, 'status-wrapper.sh'), 'utf8');
        assert.match(program, /\nexec "\$BASH" "\$1" status\n?$/);
        assert.doesNotMatch(program, /sleep|kill|&/);
        return { status: 0, stdout: 'Instincts: 0\n', stderr: '' };
      } }), 0);
      assert.ok(!fs.existsSync(root));
    }],
    ...['timeout', 'nonzero', 'spawn error'].map(kind => [`${kind} cleans its private fixture`, () => {
      let root;
      const failure = Object.assign(new Error(kind), { code: kind === 'timeout' ? 'ETIMEDOUT' : 'EIO' });
      assert.throws(() => runStatus([], { run: (_command, _args, options) => {
        root = options.cwd;
        return kind === 'nonzero' ? { status: 7, stdout: '', stderr: 'fixture rejected' } : { error: failure };
      } }), error => kind === 'nonzero' ? /fixture rejected/.test(error.message) : error === failure);
      assert.ok(!fs.existsSync(root));
    }]),
    ['cleanup preserves frozen and falsy primary failures', () => {
      for (const primary of [Object.freeze(new Error('primary')), null, false, 0, undefined]) {
        let root; let caught = false;
        try {
          withFixture(value => { root = value.root; throw primary; }, (value, options) => {
            fs.rmSync(value, options); throw new Error('cleanup');
          });
        } catch (error) { caught = true; assert.strictEqual(error, primary); }
        assert.ok(caught);
        assert.ok(!fs.existsSync(root));
      }
    }],
    ['cleanup failure is reported when the fixture otherwise succeeds', () => {
      let root;
      const failure = new Error('cleanup');
      assert.throws(() => withFixture(value => { root = value.root; }, (value, options) => {
        fs.rmSync(value, options); throw failure;
      }), error => error === failure);
      assert.ok(!fs.existsSync(root));
    }],
  ];
}

function buildTests() {
  const allowed = readAllowedExtensions();
  return [
    ['the loader still declares several instinct extensions', () => {
      assert.ok(allowed.length >= 3, `expected several extensions, got ${allowed}`);
    }],
    ...allowed.map(ext => [`status counts ${ext} - the loader accepts it`, shellTest(() => {
      assert.strictEqual(runStatus([`one${ext}`]), 1);
    })]),
    ['status does not recurse - the loader does not', shellTest(() => {
      assert.strictEqual(runStatus(['a.md', 'nested/deep.yaml']), 1);
    })],
    ['status skips directories', shellTest(() => {
      assert.strictEqual(runStatus([], { setup: value => fs.mkdirSync(path.join(value.instincts, 'directory.md')) }), 0);
    })],
    ['status matches case-insensitively', shellTest(() => {
      assert.strictEqual(runStatus(['a.YAML', 'b.YmL', 'c.MD']), 3);
    })],
    ['start-observer.sh parses', shellTest(() => withFixture(fixture => {
      checkChild(spawnSync(bashBinary, ['--noprofile', '--norc', '-n', toShellPath(observerScript)], {
        cwd: fixture.root, env: fixture.env, encoding: 'utf8',
        timeout: childTimeoutMs, maxBuffer: childMaxBuffer, killSignal: 'SIGKILL',
      }));
    }))],
    ['markdown instincts are counted', shellTest(() => {
      assert.strictEqual(runStatus(['a.md', 'b.md', 'c.md']), 3);
    })],
    ['the count matches the loader eligible-file rules', shellTest(() => {
      assert.strictEqual(runStatus(['a.md', 'b.yaml', 'c.yml', 'd.YAML', 'notes.txt', 'nested/deep.md']), 4);
    })],
    ['an empty instincts directory reports 0', shellTest(() => {
      assert.strictEqual(runStatus([]), 0);
    })],
    ['hidden stems count but dot-only extension names have no suffix', shellTest(() => {
      assert.strictEqual(runStatus(['.note.MD', '.yaml', '.YML', '.md']), 1);
    })],
    ['newlines and spaces in one eligible filename count once', shellTest(() => {
      assert.strictEqual(runStatus(['two\nlines with spaces.MD']), 1);
    })],
    ['shell metacharacters in a filename remain inert data', shellTest(() => {
      assert.strictEqual(runStatus(['$(touch unwanted).md'], { setup: value => {
        assert.ok(!fs.existsSync(path.join(value.root, 'unwanted')));
      }, run: (command, args, options) => {
        const result = spawnSync(command, args, options);
        assert.ok(!fs.existsSync(path.join(options.cwd, 'unwanted')));
        return result;
      } }), 1);
    })],
    ['status dispatches a fixed private wrapper file without inline shell code', () => {
      let root;
      assert.strictEqual(runStatus([], { run: (_command, args, options) => {
        root = options.cwd;
        assert.deepStrictEqual(args.slice(0, 2), ['--noprofile', '--norc']);
        assert.ok(!args.includes('-c'), 'status must dispatch a wrapper file, not inline code');
        assert.strictEqual(args.length, 4);
        const wrapper = path.join(root, 'status-wrapper.sh');
        assert.strictEqual(args[2], toShellPath(wrapper));
        assert.strictEqual(args[3], toShellPath(observerScript));
        assert.strictEqual(fs.readFileSync(wrapper, 'utf8'),
          'printf "%s\\n" "$$" > "$CLV2_HOMUNCULUS_DIR/.observer.pid"\nexec "$BASH" "$1" status\n');
        if (process.platform !== 'win32') assert.strictEqual(fs.statSync(wrapper).mode & 0o777, 0o600);
        return { status: 0, stdout: 'Instincts: 0\n', stderr: '' };
      } }), 0);
      assert.ok(!fs.existsSync(root));
    }],
    ['status target path metacharacters remain data and exec retains the advertised PID', shellTest(() => {
      let target;
      assert.strictEqual(runStatus([], { setup: fixture => {
        target = path.join(fixture.root, 'status \' $() `literal` ; &.sh');
        fs.writeFileSync(target,
          '[ "$#" -eq 1 ] && [ "$1" = status ] || exit 96\n'
          + 'IFS= read -r advertised < "$CLV2_HOMUNCULUS_DIR/.observer.pid"\n'
          + '[ "$advertised" = "$$" ] || exit 95\n'
          + 'printf "Instincts: 0\\n"\n', { flag: 'wx', mode: 0o600 });
      }, run: (command, args, options) => {
        assert.strictEqual(args.at(-1), toShellPath(observerScript));
        return spawnSync(command, [...args.slice(0, -1), toShellPath(target)], options);
      } }), 0);
      assert.ok(!fs.existsSync(target));
    })],
    ['linked regular files count without traversing directory links', shellTest(() => {
      assert.strictEqual(runStatus(['a.md', 'b.yaml', 'c.yml', 'd.YAML', '.note.MD',
        '.md', '.yaml', '.YML', 'notes.txt', 'nested/deep.md'], { setup: value => {
        const outside = path.join(value.root, 'outside');
        fs.mkdirSync(outside);
        const target = path.join(outside, 'regular.txt');
        fs.writeFileSync(target, 'private fixture\n');
        fs.writeFileSync(path.join(outside, 'deep.md'), 'not top-level\n');
        fs.mkdirSync(path.join(value.instincts, 'directory.md'));
        fileLink(target, path.join(value.instincts, 'linked.MD'));
        fileLink(outside, path.join(value.instincts, 'directory-link.yaml'), 'dir');
        fileLink(path.join(outside, 'missing'), path.join(value.instincts, 'dangling.yml'));
      } }), 6);
    })],
    ...cleanupTests(),
  ];
}

function main() {
  console.log('\n=== Testing observer status instinct count (#2859) ===\n');
  let passed = 0; let failed = 0; let skipped = 0; let tests;
  try { tests = buildTests(); }
  catch (error) {
    console.error(`  FAIL could not build the test list: ${error.message}`);
    tests = []; failed += 1;
  }
  for (const [name, fn] of tests) {
    try { fn(); console.log(`  PASS ${name}`); passed += 1; }
    catch (error) {
      if (error instanceof SkipTest) {
        console.log(`  SKIP ${name}: ${error.message}`); skipped += 1;
      } else {
        console.error(`  FAIL ${name}: ${error.message}`); failed += 1;
      }
    }
  }
  console.log(`\n  Passed: ${passed}\n  Failed: ${failed}\n  Skipped: ${skipped}`);
  // Let piped summary output drain before the aggregate runner reads it.
  if (failed > 0) process.exitCode = 1;
}

main();
