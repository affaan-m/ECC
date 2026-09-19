'use strict';
/**
 * Tests for scripts/ci/check-spec-freshness.js
 *
 * v1 contract (file-level freshness):
 * - git invoked via argv array (execFileSync), never via shell string
 * - project root and every enforced target resolved through realpaths and
 *   contained inside the project; symlinked root / escaping target rejected
 * - shallow clones report UNVERIFIED (never ORPHANED/STALE)
 * - truthful verdicts: FRESH / STALE / ORPHANED (target missing or escaping)
 *   / UNVERIFIED (no git, not a repo, shallow, missing/invalid date,
 *   target never committed)
 * - ECC_SPEC_STALE_WARN_ONLY honored (=== "true") → stale no longer fails
 *
 * Date strategy: commits are made at offsets relative to "today" (daysAgo)
 * because ECC_SPEC_STALE_DAYS is capped at 365 — a verification dated years in
 * the past would always trip the age check and mask the change-detection tests.
 *
 * Uses the Node native test runner and real (mini) git repositories.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { execSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'ci', 'check-spec-freshness.js');

// ── Helpers ─────────────────────────────────────────────────────

function runChecker(projectRoot, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX']) {
    delete env[key];
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  const opts = { encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] };
  let isDir = false;
  try {
    isDir = fs.statSync(projectRoot).isDirectory();
  } catch {
    isDir = false;
  }
  if (isDir) {
    // Run with the project as cwd so any (buggy) shell execution would land a
    // marker inside the repo where the hostile-input tests can see it.
    opts.cwd = projectRoot;
  }
  try {
    const result = execFileSync(process.execPath, [SCRIPT, '--project-root', projectRoot], opts);
    return { exitCode: 0, stdout: result, stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

function parseJson(result) {
  const line = result.stdout.trim().split('\n').pop();
  return JSON.parse(line);
}

function git(repo, args) {
  return execSync(`git ${args}`, { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

/** Init an isolated git repo (full history) and return its path. */
function initRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fresh-'));
  git(repo, 'init -q');
  git(repo, 'config user.email "test@example.com"');
  git(repo, 'config user.name "Test Runner"');
  return repo;
}

/** Commit `content` as `relPath` at `date` (YYYY-MM-DD). */
function commitFile(repo, relPath, content, date, message = `commit ${relPath}`) {
  const full = path.join(repo, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  git(repo, 'add -A');
  const env = { ...process.env, GIT_AUTHOR_DATE: `${date}T00:00:00`, GIT_COMMITTER_DATE: `${date}T00:00:00` };
  execSync(`git commit -q -m "${message}"`, { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Write a spec under openspec/specs/<sub>/spec.md with enforced anchors + date. */
function writeSpec(repo, sub, { lastVerified, anchors = [] }) {
  const dir = path.join(repo, 'openspec', 'specs', sub);
  fs.mkdirSync(dir, { recursive: true });
  const anchorLines = anchors.map((a) => `<!-- enforced: ${a} -->`).join('\n');
  const lv = lastVerified === undefined ? '' : `Last verified: ${lastVerified}\n`;
  const content =
    `---\ntitle: ${sub}\n---\n\n` +
    `<!-- id: ${sub} -->\n\n` +
    `${lv}` +
    `### Requirement: ${sub} behavior\n\n` +
    `#### Scenario: holds\n` +
    `- **WHEN** trigger\n` +
    `- **THEN** outcome\n\n` +
    `${anchorLines}\n`;
  fs.writeFileSync(path.join(dir, 'spec.md'), content);
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().split('T')[0];
}

let repos = [];
function track(repo) {
  repos.push(repo);
  return repo;
}

after(() => {
  for (const r of repos) {
    try {
      fs.rmSync(r, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  repos = [];
});

describe('check-spec-freshness (v1, file-level)', () => {
  describe('container / config errors', () => {
    it('returns valid for a missing openspec dir (exit 0)', () => {
      const repo = track(initRepo());
      const result = runChecker(repo);
      assert.strictEqual(result.exitCode, 0);
      assert.deepStrictEqual(parseJson(result).specs, []);
    });

    it('returns valid for an empty openspec dir (exit 0)', () => {
      const repo = track(initRepo());
      fs.mkdirSync(path.join(repo, 'openspec'), { recursive: true });
      const result = runChecker(repo);
      assert.strictEqual(result.exitCode, 0);
    });

    it('exits 2 for a non-existent project root', () => {
      const result = runChecker(path.join(os.tmpdir(), 'ecc-missing-' + Date.now()));
      assert.strictEqual(result.exitCode, 2);
    });

    it('exits 2 for a project root that is a file', () => {
      const file = path.join(os.tmpdir(), 'ecc-file-' + Date.now());
      fs.writeFileSync(file, 'x');
      try {
        const result = runChecker(file);
        assert.strictEqual(result.exitCode, 2);
      } finally {
        fs.rmSync(file, { force: true });
      }
    });

    it('exits 2 for a symlinked project root', () => {
      const real = track(initRepo());
      const link = path.join(os.tmpdir(), 'ecc-link-' + Date.now());
      fs.symlinkSync(real, link);
      try {
        const result = runChecker(link);
        assert.strictEqual(result.exitCode, 2, result.stderr);
      } finally {
        fs.rmSync(link, { force: true });
      }
    });

    it('exits 2 for invalid ECC_SPEC_STALE_DAYS values', () => {
      const repo = track(initRepo());
      for (const bad of ['0', '-5', 'abc', '400', '1.5', '0x10']) {
        const result = runChecker(repo, { ECC_SPEC_STALE_DAYS: bad });
        assert.strictEqual(result.exitCode, 2, `expected exit 2 for "${bad}"`);
      }
    });

    it('accepts the boundary ECC_SPEC_STALE_DAYS value 365', () => {
      const repo = track(initRepo());
      const result = runChecker(repo, { ECC_SPEC_STALE_DAYS: '365' });
      assert.strictEqual(result.exitCode, 0);
    });
  });

  describe('verdicts on a real repo with history', () => {
    // Timeline: src/lib.js committed 300 days ago (v1) and 50 days ago (v2).
    let repo;
    before(() => {
      repo = track(initRepo());
      commitFile(repo, 'src/lib.js', 'v1\n', daysAgo(300), 'lib v1');
      commitFile(repo, 'src/lib.js', 'v2\n', daysAgo(50), 'lib v2');
    });

    it('marks FRESH a spec verified after the last change', () => {
      writeSpec(repo, 'fresh', { lastVerified: daysAgo(1), anchors: ['src/lib.js::run'] });
      const result = runChecker(repo);
      assert.strictEqual(result.exitCode, 0, result.stderr);
      const spec = parseJson(result).specs.find((s) => s.path.includes('fresh'));
      assert.strictEqual(spec.status, 'FRESH', JSON.stringify(spec));
    });

    it('marks STALE a spec whose enforced file changed after verification', () => {
      // Verification 100 days ago: after v1 (300d), before v2 (50d); age 100d is
      // under the 365-day cap, so STALE here is caused by the file change alone.
      writeSpec(repo, 'stale-change', { lastVerified: daysAgo(100), anchors: ['src/lib.js::run'] });
      const result = runChecker(repo, { ECC_SPEC_STALE_DAYS: '365' });
      assert.strictEqual(result.exitCode, 1);
      const spec = parseJson(result).specs.find((s) => s.path.includes('stale-change'));
      assert.strictEqual(spec.status, 'STALE', JSON.stringify(spec));
    });

    it('marks STALE purely from an old verification date (age threshold)', () => {
      // Verification 40 days ago (after the last commit 50d ago → no change),
      // over the default 30-day threshold → STALE by age only.
      writeSpec(repo, 'stale-age', { lastVerified: daysAgo(40), anchors: ['src/lib.js::run'] });
      const result = runChecker(repo); // default threshold 30
      const spec = parseJson(result).specs.find((s) => s.path.includes('stale-age'));
      assert.strictEqual(spec.status, 'STALE', JSON.stringify(spec));
    });

    it('marks UNVERIFIED when Last verified is absent', () => {
      writeSpec(repo, 'unverified', { anchors: ['src/lib.js::run'] });
      const result = runChecker(repo);
      const spec = parseJson(result).specs.find((s) => s.path.includes('unverified'));
      assert.strictEqual(spec.status, 'UNVERIFIED', JSON.stringify(spec));
    });

    it('marks UNVERIFIED when Last verified is not a parseable date', () => {
      writeSpec(repo, 'baddate', { lastVerified: 'not-a-date', anchors: ['src/lib.js::run'] });
      const result = runChecker(repo);
      const spec = parseJson(result).specs.find((s) => s.path.includes('baddate'));
      assert.strictEqual(spec.status, 'UNVERIFIED', JSON.stringify(spec));
    });

    it('marks ORPHANED when the enforced target file does not exist', () => {
      writeSpec(repo, 'orphaned', { lastVerified: daysAgo(1), anchors: ['src/missing.js::ghost'] });
      const result = runChecker(repo);
      const spec = parseJson(result).specs.find((s) => s.path.includes('orphaned'));
      assert.strictEqual(spec.status, 'ORPHANED', JSON.stringify(spec));
    });

    it('marks UNVERIFIED (not ORPHANED) when the target has no git history', () => {
      // File exists on disk but was never committed.
      fs.writeFileSync(path.join(repo, 'src', 'untracked.js'), '// never committed\n');
      writeSpec(repo, 'nohistory', { lastVerified: daysAgo(1), anchors: ['src/untracked.js::fn'] });
      const result = runChecker(repo);
      const spec = parseJson(result).specs.find((s) => s.path.includes('nohistory'));
      assert.strictEqual(spec.status, 'UNVERIFIED', JSON.stringify(spec));
    });

    it('marks ORPHANED when an enforced target escapes via a symlink', () => {
      const outside = path.join(os.tmpdir(), 'ecc-outside-' + Date.now() + '.txt');
      fs.writeFileSync(outside, 'outside\n');
      fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
      fs.symlinkSync(outside, path.join(repo, 'src', 'link.js'));
      try {
        writeSpec(repo, 'escape', { lastVerified: daysAgo(1), anchors: ['src/link.js::x'] });
        const result = runChecker(repo);
        const spec = parseJson(result).specs.find((s) => s.path.includes('escape'));
        assert.strictEqual(spec.status, 'ORPHANED', JSON.stringify(spec));
      } finally {
        fs.rmSync(outside, { force: true });
      }
    });

    it('emits stable JSON on stdout and diagnostics on stderr', () => {
      const result = runChecker(repo, { ECC_SPEC_STALE_DAYS: '365' });
      const parsed = parseJson(result);
      assert.ok(Array.isArray(parsed.specs));
      assert.ok(typeof parsed.staleCount === 'number');
      assert.ok(typeof parsed.totalCount === 'number');
      assert.strictEqual(parsed.totalCount, parsed.specs.length);
      for (const s of parsed.specs) {
        assert.ok(s.path);
        assert.ok(['FRESH', 'STALE', 'ORPHANED', 'UNVERIFIED', 'UNKNOWN'].includes(s.status));
      }
    });
  });

  describe('warning mode / exit contract', () => {
    let staleRepo;
    before(() => {
      staleRepo = track(initRepo());
      commitFile(staleRepo, 'src/lib.js', 'v1\n', daysAgo(300), 'v1');
      commitFile(staleRepo, 'src/lib.js', 'v2\n', daysAgo(50), 'v2');
      writeSpec(staleRepo, 'stale', { lastVerified: daysAgo(100), anchors: ['src/lib.js::run'] });
    });

    it('exits 1 on stale by default', () => {
      const result = runChecker(staleRepo, { ECC_SPEC_STALE_DAYS: '365' });
      assert.strictEqual(result.exitCode, 1);
    });

    it('exits 0 on stale when ECC_SPEC_STALE_WARN_ONLY=true', () => {
      const result = runChecker(staleRepo, {
        ECC_SPEC_STALE_DAYS: '365',
        ECC_SPEC_STALE_WARN_ONLY: 'true',
      });
      assert.strictEqual(result.exitCode, 0, result.stderr);
      const parsed = parseJson(result);
      assert.ok(parsed.specs.some((s) => s.status === 'STALE'), 'stale specs must still be reported');
    });

    it('does not honor non-"true" spellings of the warning flag', () => {
      const result = runChecker(staleRepo, {
        ECC_SPEC_STALE_DAYS: '365',
        ECC_SPEC_STALE_WARN_ONLY: 'TRUE',
      });
      assert.strictEqual(result.exitCode, 1);
    });
  });

  describe('hostile inputs (shell-escape proof)', () => {
    it('does not execute a hostile enforced filename (no command substitution)', () => {
      const repo = track(initRepo());
      const hostileName = 'evil$(touch${IFS}ECCPWNMARK).js';
      commitFile(repo, `src/${hostileName}`, '// evil\n', daysAgo(200), 'evil file');
      writeSpec(repo, 'hostile', { lastVerified: daysAgo(400), anchors: [`src/${hostileName}::evil`] });

      const marker = path.join(repo, 'ECCPWNMARK');
      const result = runChecker(repo);
      assert.strictEqual(fs.existsSync(marker), false, 'shell command substitution must not run');
      // The hostile file genuinely changed after the verification date → STALE.
      assert.strictEqual(result.exitCode, 1, result.stderr);
    });

    it('does not execute a hostile date string', () => {
      const repo = track(initRepo());
      commitFile(repo, 'src/lib.js', 'v1\n', daysAgo(50), 'v1');
      const marker = path.join(repo, 'ECCDATEMARK');
      // The date carries shell payload after a valid date prefix. The checker
      // must only pass the extracted, validated date to git as one argv item —
      // never hand the whole line to a shell.
      writeSpec(repo, 'hostiledate', {
        lastVerified: `${daysAgo(50)}; touch ECCDATEMARK`,
        anchors: ['src/lib.js::run'],
      });
      const result = runChecker(repo);
      assert.strictEqual(fs.existsSync(marker), false, 'hostile date must not execute');
      assert.ok([0, 1].includes(result.exitCode), 'must not crash on hostile date');
      assert.doesNotThrow(() => parseJson(result));
    });
  });

  describe('shallow clones', () => {
    it('reports UNVERIFIED (never ORPHANED/STALE) on shallow history', () => {
      const full = track(initRepo());
      commitFile(full, 'src/lib.js', 'v1\n', daysAgo(300), 'v1');
      commitFile(full, 'src/lib.js', 'v2\n', daysAgo(50), 'v2');

      const shallow = track(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-shallow-')));
      // file:// URL is required: git ignores --depth for plain local paths.
      execFileSync('git', ['clone', '-q', '--depth', '1', `file://${full}`, shallow], {
        stdio: 'ignore',
      });

      // A spec that would be FRESH or STALE on full history must be UNVERIFIED.
      writeSpec(shallow, 'spec', { lastVerified: daysAgo(1), anchors: ['src/lib.js::run'] });
      const result = runChecker(shallow);
      const spec = parseJson(result).specs.find((s) => s.path.includes('spec'));
      assert.ok(spec, 'expected a spec entry');
      assert.strictEqual(spec.status, 'UNVERIFIED', JSON.stringify(spec));
      assert.strictEqual(result.exitCode, 0, 'UNVERIFIED must not fail the check');
    });
  });

  describe('no enforced anchors', () => {
    it('marks a dated spec with no anchors as FRESH (nothing to verify)', () => {
      const repo = track(initRepo());
      commitFile(repo, 'src/lib.js', 'v1\n', daysAgo(50), 'v1');
      writeSpec(repo, 'noanchors', { lastVerified: daysAgo(1), anchors: [] });
      const result = runChecker(repo);
      const spec = parseJson(result).specs.find((s) => s.path.includes('noanchors'));
      assert.strictEqual(spec.status, 'FRESH', JSON.stringify(spec));
    });
  });
});
