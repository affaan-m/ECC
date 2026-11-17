/**
 * Registered-hook ownership regressions for scripts/hooks/context-gate.js.
 *
 * Each case fires the gate through the same run-with-flags.js entry that
 * hooks/hooks.json registers, inside a disposable ECC_AGENT_DATA_HOME. The
 * hook only proposes a checkpoint path; these cases check that the proposal
 * never lands on another owner's file, a link, or a special file, and that
 * the resume command survives the shell as one literal argument.
 *
 * Run with: node tests/hooks/context-gate-ownership.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, 'scripts', 'hooks', 'run-with-flags.js');
const UNSUPPORTED_LINK_CODES = new Set(['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP']);

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function createSandbox() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-context-gate-owner-')));
  const dataHome = path.join(root, 'data');
  const resumeDir = path.join(dataHome, 'session-data', 'resume');
  fs.mkdirSync(resumeDir, { recursive: true });
  const transcript = path.join(root, 'usage.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ message: { model: 'claude-test', usage: { input_tokens: 185000 } } }) + '\n');
  const env = {
    ...process.env,
    HOME: path.join(root, 'home'),
    USERPROFILE: path.join(root, 'home'),
    ECC_AGENT_DATA_HOME: dataHome,
    ECC_CONTEXT_GATE_MODE: 'enforce',
    ECC_CONTEXT_WINDOW_TOKENS: '200000',
    ECC_HOOK_PROFILE: 'standard'
  };
  delete env.ECC_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  delete env.ECC_DISABLED_HOOKS;
  return { root, resumeDir, transcript, env };
}

// The proposed checkpoint is the indented line that is an absolute .md path:
// "/..." on POSIX, "C:\\..." (or a UNC path) on Windows.
function isProposedPathLine(line) {
  return /^\s+\S/.test(line) && line.endsWith('.md') && path.isAbsolute(line.trim());
}

function fire(sandbox, extra = {}) {
  const input = { cwd: path.join(sandbox.root, 'owner-a', 'project'), session_id: 'mysess', transcript_path: sandbox.transcript, ...extra };
  const result = spawnSync(process.execPath, [RUNNER, 'user-prompt:context-gate', 'scripts/hooks/context-gate.js', 'standard,strict'], {
    cwd: REPO_ROOT,
    env: sandbox.env,
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 5000
  });
  if (result.error) return { timeout: result.error.code };
  const text = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  const lines = text.split('\n');
  const target = lines.find(isProposedPathLine);
  const marker = lines.find(line => line.includes('<!-- ecc-handoff'));
  return { text, target: target && target.trim(), marker: marker && marker.trim() };
}

function clearResumeDir(sandbox) {
  for (const name of fs.readdirSync(sandbox.resumeDir)) {
    const entry = path.join(sandbox.resumeDir, name);
    // rmSync({ force }) can skip a dangling symlink, so unlink non-directories directly.
    if (fs.lstatSync(entry).isDirectory()) fs.rmSync(entry, { recursive: true, force: true });
    else fs.unlinkSync(entry);
  }
}

function canLink(sandbox, kind) {
  const probe = path.join(sandbox.root, `probe-${kind}`);
  const source = path.join(sandbox.root, 'probe-source');
  fs.writeFileSync(source, 'probe');
  try {
    if (kind === 'symlink') fs.symlinkSync(source, probe);
    else fs.linkSync(source, probe);
    fs.unlinkSync(probe);
    return true;
  } catch (err) {
    if (UNSUPPORTED_LINK_CODES.has(err.code)) return false;
    throw err;
  }
}

function ownMarker(fired) {
  return fired.marker.replace('<GIT_HEAD>', 'a'.repeat(40));
}

function runTests() {
  console.log('\n=== Testing context-gate checkpoint ownership (registered hook) ===\n');

  const sandbox = createSandbox();
  const symlinks = canLink(sandbox, 'symlink');
  const hardlinks = canLink(sandbox, 'hardlink');
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const record = ok => {
    if (ok) passed++;
    else failed++;
  };

  try {
    record(test('same-named project roots get distinct proposals', () => {
      clearResumeDir(sandbox);
      const a = fire(sandbox);
      const b = fire(sandbox, { cwd: path.join(sandbox.root, 'owner-b', 'project') });
      assert.ok(a.target && b.target, `both fires should propose a destination. Got: ${a.target ? b.text : a.text}`);
      assert.notStrictEqual(a.target, b.target);
    }));

    record(test('session IDs that sanitize alike get distinct proposals', () => {
      clearResumeDir(sandbox);
      const a = fire(sandbox, { session_id: 'owner/a' });
      const b = fire(sandbox, { session_id: 'owner?a' });
      assert.ok(a.target && b.target, `both fires should propose a destination. Got: ${a.target ? b.text : a.text}`);
      assert.notStrictEqual(a.target, b.target);
    }));

    record(test('a marker from another project is preserved and not reused', () => {
      clearResumeDir(sandbox);
      const first = fire(sandbox);
      const foreign = '<!-- ecc-handoff session=mysess project=OTHER source-rev=deadbeef -->\nFOREIGN PROJECT\n';
      fs.writeFileSync(first.target, foreign);
      const again = fire(sandbox);
      assert.notStrictEqual(again.target, first.target);
      assert.strictEqual(fs.readFileSync(first.target, 'utf8'), foreign);
    }));

    record(test('the exact complete owner marker is reused', () => {
      clearResumeDir(sandbox);
      const first = fire(sandbox);
      fs.writeFileSync(first.target, ownMarker(first) + '\nOWN\n');
      assert.strictEqual(fire(sandbox).target, first.target);
    }));

    record(test('a complete marker naming another project is not reused', () => {
      clearResumeDir(sandbox);
      const first = fire(sandbox);
      fs.writeFileSync(first.target, ownMarker(first).replace('project=project', 'project=OTHER') + '\nOTHER\n');
      assert.notStrictEqual(fire(sandbox).target, first.target);
    }));

    record(test('a marker that is not the first line is not ownership', () => {
      clearResumeDir(sandbox);
      const first = fire(sandbox);
      fs.writeFileSync(first.target, 'ordinary text ' + ownMarker(first) + '\nUNMARKED\n');
      assert.notStrictEqual(fire(sandbox).target, first.target);
    }));

    if (symlinks) {
      record(test('a live symlink at the destination is never targeted', () => {
        clearResumeDir(sandbox);
        const first = fire(sandbox);
        const outside = path.join(sandbox.root, 'outside.md');
        const outsideBytes = ownMarker(first) + '\nOUTSIDE\n';
        fs.writeFileSync(outside, outsideBytes);
        fs.symlinkSync(outside, first.target);
        assert.notStrictEqual(fire(sandbox).target, first.target);
        assert.strictEqual(fs.readFileSync(outside, 'utf8'), outsideBytes);
      }));

      record(test('a dangling symlink at the destination is never targeted', () => {
        clearResumeDir(sandbox);
        const first = fire(sandbox);
        fs.symlinkSync(path.join(sandbox.root, 'absent.md'), first.target);
        assert.notStrictEqual(fire(sandbox).target, first.target);
      }));

      record(test('a linked handoff directory declines the checkpoint', () => {
        clearResumeDir(sandbox);
        const outsideDir = path.join(sandbox.root, 'outside-dir');
        fs.mkdirSync(outsideDir);
        fs.rmdirSync(sandbox.resumeDir);
        fs.symlinkSync(outsideDir, sandbox.resumeDir);
        try {
          const fired = fire(sandbox);
          assert.strictEqual(fired.target, undefined);
          assert.ok(fired.text.includes('Do NOT auto-write'));
        } finally {
          fs.unlinkSync(sandbox.resumeDir);
          fs.mkdirSync(sandbox.resumeDir);
        }
      }));
    } else {
      skipped += 3;
    }

    if (hardlinks) {
      record(test('a multiply linked owner file is never targeted', () => {
        clearResumeDir(sandbox);
        const first = fire(sandbox);
        const outside = path.join(sandbox.root, 'outside-owned.md');
        fs.writeFileSync(outside, ownMarker(first) + '\nOUTSIDE OWNER\n');
        fs.linkSync(outside, first.target);
        assert.notStrictEqual(fire(sandbox).target, first.target);
      }));
    } else {
      skipped++;
    }

    const mkfifo = process.platform === 'win32' ? null : spawnSync('mkfifo', [path.join(sandbox.root, 'probe-fifo')]);
    if (mkfifo && mkfifo.status === 0) {
      record(test('a FIFO at the destination does not block the prompt', () => {
        clearResumeDir(sandbox);
        const first = fire(sandbox);
        assert.strictEqual(spawnSync('mkfifo', [first.target]).status, 0);
        const again = fire(sandbox);
        assert.ok(!again.timeout, 'hook must not hang on a FIFO');
        assert.ok(again.target && again.target !== first.target);
      }));
    } else {
      skipped++;
    }

    if (process.platform !== 'win32') {
      record(test('the resume prompt reaches the shell as one literal argument', () => {
        clearResumeDir(sandbox);
        const quotedHome = path.join(sandbox.root, "data '$(__ecc_quote_probe__) `literal`");
        const env = { ...sandbox.env, ECC_AGENT_DATA_HOME: quotedHome };
        const fired = fire({ ...sandbox, env });
        const command = fired.text.split('\n').find(line => line.trim().startsWith('claude ')).trim();
        const shell = spawnSync('/bin/sh', ['-c', 'claude(){ printf "%s" "$1"; }; ' + command], {
          cwd: sandbox.root,
          env,
          encoding: 'utf8',
          timeout: 2000
        });
        assert.strictEqual(shell.status, 0, shell.stderr);
        assert.strictEqual(shell.stdout, `Read ${fired.target} and continue the work described there.`);
      }));
    } else {
      skipped++;
    }
  } finally {
    fs.rmSync(sandbox.root, { recursive: true, force: true });
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}, Skipped: ${skipped}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
