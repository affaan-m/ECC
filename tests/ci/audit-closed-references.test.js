#!/usr/bin/env node
/**
 * Contract + unit tests for the closed-issue delivery-claim audit.
 *
 * Contract side: the maintenance workflow must run the audit on the weekly
 * schedule with job-level read-only permissions. Unit side: the evidence
 * contract from the #3522 review — asserted claims vs contextual references,
 * four observed PR states, and visible collection completeness. A CLI fixture
 * (stub gh script) exercises pagination and retrieval failures end to end.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const audit = require('../../scripts/ci/audit-closed-references.js');

const WORKFLOW_PATH = path.join(__dirname, '..', '..', '.github', 'workflows', 'maintenance.yml');
const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'ci', 'audit-closed-references.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function run() {
  console.log('\n=== Testing closed-issue delivery-claim audit ===\n');
  let passed = 0;
  let failed = 0;
  const check = (name, fn) => (test(name, fn) ? passed++ : failed++);

  const source = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  const script = fs.readFileSync(SCRIPT_PATH, 'utf8');

  check('maintenance workflow runs the audit on schedule', () => {
    assert.match(source, /closed-reference-audit:/);
    assert.match(source, /node scripts\/ci\/audit-closed-references\.js/);
    assert.match(source, /GH_TOKEN:\s*\$\{\{ github\.token \}\}/);
  });

  check('audit job is scoped to read permissions', () => {
    const job = source.split('closed-reference-audit:')[1] || '';
    assert.match(job, /permissions:\s*\n\s*contents:\s*read\s*\n\s*issues:\s*read\s*\n\s*pull-requests:\s*read/);
  });

  check('audit stays read-only: no comment or close calls', () => {
    assert.doesNotMatch(script, /-X\s*(POST|PATCH|PUT)/);
    assert.doesNotMatch(script, /method:\s*['"](POST|PATCH|PUT|DELETE)/);
  });

  check('asserted delivery claims are extracted with wording variants', () => {
    const text = 'Delivered through #3500; also fixed in #3133 and shipped via #3495 and PR #2100.';
    const claims = audit.extractRefs(text, 'closing-comment', 'http://x/1').filter((r) => r.kind === 'claim');
    assert.deepStrictEqual(claims.map((r) => r.pr), [3500, 3133, 3495, 2100]);
  });

  check('historical mentions, quotes, fences, and negations are not claims', () => {
    assert.deepStrictEqual(audit.extractRefs('see discussion in #100', 'issue-body', 'u').filter((r) => r.kind === 'claim'), []);
    assert.deepStrictEqual(audit.extractRefs('> fixed in #100', 'issue-body', 'u').filter((r) => r.kind === 'claim'), []);
    assert.deepStrictEqual(audit.extractRefs('```\nfixed in #100\n```', 'issue-body', 'u').filter((r) => r.kind === 'claim'), []);
    assert.deepStrictEqual(audit.extractRefs('was not fixed in #100', 'issue-body', 'u').filter((r) => r.kind === 'claim'), []);
    assert.deepStrictEqual(audit.extractRefs('cannot be closed by #100', 'issue-body', 'u').filter((r) => r.kind === 'claim'), []);
  });

  const NOW = Date.parse('2026-10-12T12:00:00Z');
  const days = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

  check('#3408 fixture: closing claim #3500 is found, historical #3060 stays context', () => {
    const issue = {
      number: 3408, state: 'closed', closed_at: days(1),
      html_url: 'http://x/3408', title: 'detector gap',
      body: 'Same area as #3060, historical context only.',
    };
    const comments = [{
      body: 'Delivered through #3500',
      html_url: 'http://x/3408#c3500',
      created_at: days(1),
    }];
    const refs = audit.extractEvidence(issue, comments, NOW);
    const claims = refs.filter((r) => r.kind === 'claim');
    const context = refs.filter((r) => r.kind === 'reference');
    assert.deepStrictEqual(claims.map((r) => r.pr), [3500]);
    assert.deepStrictEqual(context.map((r) => r.pr), [3060]);
    assert.strictEqual(claims[0].sourceUrl, 'http://x/3408#c3500');
    const entries = [{ issue: 3408, issueUrl: issue.html_url, refs }];
    const verdicts = audit.buildVerdicts(entries, new Map([[3500, { observed: 'merged' }]]));
    const summary = audit.buildSummary(verdicts, audit.collectReferences(entries), []).join('\n');
    assert.match(summary, /#3500/);
    assert.match(summary, /#3408: [^\n]*#3060/);
    assert.doesNotMatch(summary, /#3060[^\n]*not merged/);
    assert.doesNotMatch(summary, /#3060[^\n]*unmerged/);
  });

  check('four observed states stay distinct', () => {
    const entries = [
      { issue: 1, issueUrl: 'u', refs: [{ pr: 11, kind: 'claim', source: 'closing-comment', sourceUrl: 'u', snippet: 'delivered through #11' }] },
      { issue: 2, issueUrl: 'u', refs: [{ pr: 22, kind: 'claim', source: 'closing-comment', sourceUrl: 'u', snippet: 'fixed in #22' }] },
      { issue: 3, issueUrl: 'u', refs: [{ pr: 33, kind: 'claim', source: 'closing-comment', sourceUrl: 'u', snippet: 'shipped via #33' }] },
      { issue: 4, issueUrl: 'u', refs: [{ pr: 44, kind: 'claim', source: 'closing-comment', sourceUrl: 'u', snippet: 'landed in #44' }] },
    ];
    const states = new Map([
      [11, { observed: 'merged' }],
      [22, { observed: 'open-unmerged' }],
      [33, { observed: 'closed-unmerged' }],
      [44, { observed: 'unknown', reason: 'HTTP 404' }],
    ]);
    const verdicts = audit.buildVerdicts(entries, states);
    assert.deepStrictEqual(verdicts.map((v) => v.verdict), ['pass', 'unmerged', 'unmerged', 'unverifiable']);
    const summary = audit.buildSummary(verdicts, [], []).join('\n');
    assert.match(summary, /#22: open-unmerged/);
    assert.match(summary, /#33: closed-unmerged/);
    assert.match(summary, /manual verification required/);
    assert.match(summary, /HTTP 404/);
    assert.match(summary, /does not establish that the claim failed/);
  });

  check('unknown evidence is advisory, never a failed-claim finding', () => {
    const entries = [{ issue: 5, issueUrl: 'u', refs: [{ pr: 55, kind: 'claim', source: 'issue-body', sourceUrl: 'u', snippet: 'fixed in #55' }] }];
    const verdicts = audit.buildVerdicts(entries, new Map([[55, { observed: 'unknown', reason: 'HTTP 404' }]]));
    assert.strictEqual(verdicts[0].verdict, 'unverifiable');
    assert.match(audit.buildSummary(verdicts, [], []).join('\n'), /Unverifiable — manual verification required/);
  });

  check('window filter keeps only recent closed issues and drops PRs', () => {
    const issues = [
      { number: 1, state: 'closed', closed_at: days(3) },
      { number: 2, state: 'closed', closed_at: days(45) },
      { number: 3, state: 'open', closed_at: days(1) },
      { number: 4, state: 'closed', closed_at: days(2), pull_request: { url: 'x' } },
      { number: 5, state: 'closed', closed_at: null },
    ];
    const kept = audit.selectRecentClosedIssues(issues, NOW, 30).map((i) => i.number);
    assert.deepStrictEqual(kept, [1]);
  });

  check('comment window starts at issue closure (close comments count)', () => {
    const comments = [
      { body: 'closed as delivered through #3133', html_url: 'c1', created_at: days(10) },
      { body: 'old pre-close chatter #999', html_url: 'c2', created_at: days(40) },
      { body: 'post-close follow-up landed in #3500', html_url: 'c3', created_at: days(1) },
    ];
    const kept = audit.selectWindowComments(comments, days(11), 30, NOW);
    assert.deepStrictEqual(kept.map((c) => c.html_url), ['c1', 'c3']);
  });

  check('collection failures surface as incomplete, never as all-clear', () => {
    const fetchIssues = () => ({ items: [{ number: 11, state: 'closed', closed_at: days(2), html_url: 'u', title: 'gap', body: 'fixed in #77' }] });
    const fetchComments = () => ({ items: [], error: 'HTTP 403' });
    const { entries, incomplete } = audit.collectEntries(fetchIssues, fetchComments, NOW, 30);
    assert.strictEqual(entries.length, 1); // issue body evidence survives the comment failure
    assert.match(entries[0].refs.map((r) => r.pr).join(','), /77/);
    assert.match(incomplete[0], /#11 comments unavailable: HTTP 403/);
    const summary = audit.buildSummary([], audit.collectReferences(entries), incomplete).join('\n');
    assert.match(summary, /Audit incomplete/);
    assert.match(summary, /absence of findings below is not an all-clear/);
  });

  check('issues list failure yields an explicitly empty, incomplete audit', () => {
    const { entries, incomplete } = audit.collectEntries(() => ({ items: [], error: 'HTTP 502' }), () => ({ items: [], error: null }), NOW, 30);
    assert.deepStrictEqual(entries, []);
    assert.match(incomplete[0], /issue list unavailable: HTTP 502/);
    assert.match(audit.buildSummary([], [], incomplete).join('\n'), /Audit incomplete/);
  });

  // CLI fixture: a stub gh script exercises pagination (issue on page two)
  // and a retrieval failure, end to end through the real main().
  check('CLI fixture: page-two issue is audited and failed comments report incomplete', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-cli-'));
    const stub = path.join(tmp, 'stub-gh.js');
    fs.writeFileSync(stub, `
      const args = process.argv.slice(2);
      const url = args.find((a) => a.includes('/issues?state=closed')) || '';
      if (url) {
        const page1 = [{ number: 1, state: 'closed', closed_at: '2026-10-11T00:00:00Z', html_url: 'u1', title: 'a', body: 'no refs here' }];
        const page2 = [{ number: 88, state: 'closed', closed_at: '2026-10-11T00:00:00Z', html_url: 'u88', title: 'page two', body: 'no refs either' }];
        process.stdout.write(JSON.stringify([page1, page2]));
        return;
      }
      if (args.some((a) => a.includes('/issues/88/comments'))) {
        process.stderr.write('gh: HTTP 500');
        process.exit(1);
      }
      if (args.some((a) => a.includes('/issues/1/comments'))) {
        process.stdout.write(JSON.stringify([{ body: 'Delivered through #3500', html_url: 'c1', created_at: '2026-10-11T00:00:00Z' }]));
        return;
      }
      if (args.some((a) => a.includes('/pulls/'))) {
        process.stdout.write(JSON.stringify({ state: 'closed', merged: true }));
        return;
      }
      process.stderr.write('unexpected args');
      process.exit(2);
    `);
    const summaryPath = path.join(tmp, 'summary.md');
    const env = {
      ...process.env,
      GITHUB_REPOSITORY: 'example/repo',
      GITHUB_STEP_SUMMARY: summaryPath,
      AUDIT_GH_SCRIPT: stub,
    };
    execFileSync(process.execPath, [SCRIPT_PATH], { env, encoding: 'utf8' });
    const summary = fs.readFileSync(summaryPath, 'utf8');
    assert.match(summary, /Delivered through #3500/); // page-one issue's claim was audited
    assert.match(summary, /#88 comments unavailable: HTTP 500/);
    assert.match(summary, /Audit incomplete/);
    assert.match(summary, /Observed: /);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  check('CLI fixture: 101 distinct cited PRs report the unchecked claim and incomplete audit', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-cap-'));
    try {
      const stub = path.join(tmp, 'stub-gh.js');
      fs.writeFileSync(stub, `
        const args = process.argv.slice(2);
        if (args.some((a) => a.includes('/issues?state=closed'))) {
          const body = Array.from({ length: 101 }, (_, i) => 'fixed in #' + (i + 1)).join('; ');
          const issue = { number: 99, state: 'closed', closed_at: new Date().toISOString(), html_url: 'u99', title: 'delivery', body };
          process.stdout.write(JSON.stringify([[issue]]));
        } else if (args.some((a) => a.includes('/issues/99/comments'))) {
          process.stdout.write(JSON.stringify([[]]));
        } else if (args.some((a) => a.includes('/pulls/'))) {
          process.stdout.write(JSON.stringify({ state: 'closed', merged: true }));
        } else {
          process.stderr.write('unexpected args');
          process.exit(2);
        }
      `);
      const summaryPath = path.join(tmp, 'summary.md');
      execFileSync(process.execPath, [SCRIPT_PATH], {
        env: { ...process.env, GITHUB_REPOSITORY: 'example/repo', GITHUB_STEP_SUMMARY: summaryPath, AUDIT_GH_SCRIPT: stub },
        encoding: 'utf8',
      });
      const summary = fs.readFileSync(summaryPath, 'utf8');
      assert.match(summary, /\*\*Audit incomplete\*\*/);
      assert.match(summary, /1 cited PR\(s\) not checked: PR check limit of 100 reached/);
      assert.match(summary, /101 asserted delivery claim\(s\) found: 0 unmerged finding\(s\), 1 unverifiable/);
      assert.match(summary, /#101: unavailable \(not fetched\)/);
      assert.match(summary, /#100: merged/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  console.log(`\nPassed: ${passed}  Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

run();
