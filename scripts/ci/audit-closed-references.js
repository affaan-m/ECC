#!/usr/bin/env node
/**
 * Audit recently closed issues whose asserted delivery claims cite a PR that
 * is not actually merged.
 *
 * Motivated by #3223: an issue closed as "fixed in #N" while #N was closed
 * without merging leaves a completion claim that does not hold up. This audit
 * runs weekly from .github/workflows/maintenance.yml, scans issue text and
 * close-window comments for *asserted* delivery claims, verifies each cited
 * PR's merge state, and reports findings to the workflow step summary.
 *
 * Evidence contract (per the #3522 review):
 * - Only asserted delivery claims ("delivered through #N", "fixed in #N")
 *   produce findings. Historical mentions, quoted text, fenced examples,
 *   negated claims, and tracking-only references are reported separately as
 *   context — a merged PR alone also does not certify issue completion.
 * - Observed states are reported distinctly: merged, open-unmerged,
 *   closed-unmerged, and unknown (404, rate limit, transient failures). An
 *   unavailable PR warrants manual verification; it does not establish that
 *   a claim failed.
 * - Collection is paginated and its completeness is visible: skipped pages,
 *   rate limits, and retrieval failures turn the report into an explicitly
 *   incomplete audit rather than an all-clear.
 *
 * Read-only by design: findings are advisory, the script never comments on or
 * closes anything, and always exits 0 so the scheduled run never breaks.
 */

'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

const DEFAULT_WINDOW_DAYS = 30;
const MAX_COMMENT_REQUESTS = 200;
const MAX_PR_CHECKS = 100;

const CLAIM_PATTERN =
  /\b(?:delivered|delivers|fixed|fixes|shipped|ships|landed|lands|resolved|resolves|implemented|implements|completed|completes|closed|closes|merged|merges)\s+(?:through|in|via|by|with|as|into)\s+(?:PR\s+)?#(\d+)\b/gi;
const PR_REF_PATTERN = /\bPR\s+#(\d+)\b/gi;
const ANY_REF_PATTERN = /(?:^|[^\w&])#(\d+)\b/g;
const NEGATION_PATTERN =
  /\b(?:not|never|cannot|can't|won't|doesn't|does\s+not|no\s+longer|isn't|wasn't)\s+(?:\w+\s+){0,2}$/i;

function runGh(args, env) {
  const options = { encoding: 'utf8', env, timeout: 60000, maxBuffer: 64 * 1024 * 1024 };
  if (env.AUDIT_GH_SCRIPT) {
    // Testability hook: run a fixture script instead of the real gh CLI.
    return execFileSync(process.execPath, [env.AUDIT_GH_SCRIPT, ...args], options);
  }
  return execFileSync('gh', args, options);
}

function describeGhError(error) {
  const stderr = (error && error.stderr) || '';
  const http = stderr.match(/HTTP (\d{3})/);
  if (http) return `HTTP ${http[1]}`;
  return String((error && error.message) || error).split('\n')[0];
}

// Pure: fenced code blocks, inline code, and blockquoted lines are examples or
// quotation, not assertions made by the author — strip them before matching.
function stripNonEvidence(text) {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');
}

// Pure: a claim pattern preceded by negation words is not an assertion.
function isNegated(clean, matchIndex) {
  const before = clean.slice(Math.max(0, matchIndex - 60), matchIndex);
  return NEGATION_PATTERN.test(before);
}

// Pure: classify every #N in one text as an asserted delivery claim or a
// contextual reference. Deduplicates per (pr, kind). In a closing comment a
// bare "PR #N" reference is the closing evidence; in issue text it stays
// context.
function extractRefs(text, source, sourceUrl) {
  const clean = stripNonEvidence(text);
  if (!clean) return [];
  const refs = [];
  const claimMatches = [...clean.matchAll(CLAIM_PATTERN)];
  if (source === 'closing-comment') claimMatches.push(...clean.matchAll(PR_REF_PATTERN));
  for (const match of claimMatches) {
    if (isNegated(clean, match.index)) continue;
    refs.push({ pr: Number(match[1]), kind: 'claim', source, sourceUrl, snippet: match[0] });
  }
  const ranges = claimMatches.map((m) => [m.index, m.index + m[0].length]);
  for (const match of clean.matchAll(ANY_REF_PATTERN)) {
    const insideClaim = ranges.some(([start, end]) => match.index >= start && match.index < end);
    if (insideClaim || isNegated(clean, match.index)) continue;
    refs.push({ pr: Number(match[1]), kind: 'reference', source, sourceUrl, snippet: match[0].trim() });
  }
  const seen = new Set();
  return refs.filter((ref) => (seen.has(ref.pr + ':' + ref.kind) ? false : (seen.add(ref.pr + ':' + ref.kind), true)));
}

// Pure: issues closed within the look-back window; PRs are not issues.
function selectRecentClosedIssues(issues, nowMs, windowDays) {
  const cutoff = nowMs - windowDays * 24 * 60 * 60 * 1000;
  return issues.filter(
    (issue) =>
      issue.state === 'closed' &&
      !issue.pull_request &&
      typeof issue.closed_at === 'string' &&
      Date.parse(issue.closed_at) >= cutoff
  );
}

// Pure: comment objects (body + html_url) inside the window, starting at the
// issue's closure so the closing comment always counts as evidence.
function selectWindowComments(comments, issueClosedAt, windowDays, nowMs) {
  const cutoff = nowMs - windowDays * 24 * 60 * 60 * 1000;
  return comments
    .filter((comment) => typeof comment.body === 'string')
    .filter((comment) => Date.parse(comment.created_at) >= Math.max(cutoff, Date.parse(issueClosedAt) - 60_000));
}

// Pure: one entry per issue with its claims and contextual references.
function extractEvidence(issue, comments, nowMs) {
  const refs = [
    ...extractRefs([issue.title, issue.body].filter(Boolean).join('\n'), 'issue-body', issue.html_url),
  ];
  for (const comment of selectWindowComments(comments, issue.closed_at, DEFAULT_WINDOW_DAYS, nowMs)) {
    refs.push(...extractRefs(comment.body, 'closing-comment', comment.html_url));
  }
  return refs;
}

// Collect issues + evidence. Fetch failures are surfaced as incomplete notes,
// never silently swallowed into an empty list.
function collectEntries(fetchIssues, fetchComments, nowMs, windowDays) {
  const { items: issues, error } = fetchIssues();
  if (error) return { entries: [], incomplete: [`issue list unavailable: ${error}`] };
  const incomplete = [];
  const entries = [];
  for (const issue of selectRecentClosedIssues(issues, nowMs, windowDays)) {
    const { items: comments, error: commentError } = fetchComments(issue.number);
    if (commentError) incomplete.push(`#${issue.number} comments unavailable: ${commentError}`);
    const refs = extractEvidence(issue, comments, nowMs);
    if (refs.length) entries.push({ issue: issue.number, issueUrl: issue.html_url, refs });
  }
  return { entries, incomplete };
}

function uniqueClaimPrs(entries) {
  return [...new Set(entries.flatMap((entry) => entry.refs.filter((r) => r.kind === 'claim').map((r) => r.pr)))];
}

function collectReferences(entries) {
  const seen = new Set();
  const refs = [];
  for (const entry of entries) {
    for (const ref of entry.refs.filter((r) => r.kind === 'reference')) {
      const key = entry.issue + ':' + ref.pr;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ issue: entry.issue, pr: ref.pr });
    }
  }
  return refs;
}

// Pure: one verdict row per asserted claim. Merged passes; open/closed
// unmerged are findings; unknown is unverifiable and needs manual verification.
function buildVerdicts(entries, pullStates) {
  const rows = [];
  for (const entry of entries) {
    for (const ref of entry.refs.filter((r) => r.kind === 'claim')) {
      const state = pullStates.get(ref.pr) || { observed: 'unknown', reason: 'not fetched' };
      rows.push({
        issue: entry.issue, pr: ref.pr, snippet: ref.snippet, source: ref.source,
        sourceUrl: ref.sourceUrl, observed: state.observed, reason: state.reason || null,
        verdict: state.observed === 'merged' ? 'pass' : state.observed === 'unknown' ? 'unverifiable' : 'unmerged',
      });
    }
  }
  return rows;
}

function summaryIncomplete(lines, incomplete) {
  if (!incomplete.length) return;
  lines.push('', '**Audit incomplete** — some evidence could not be collected; absence of findings below is not an all-clear:');
  for (const note of incomplete) lines.push(`- ${note}`);
}

function summaryFindings(lines, unmerged) {
  if (!unmerged.length) return;
  lines.push('', '### Findings — asserted delivery claims whose cited PR is not merged');
  for (const v of unmerged) {
    lines.push(`- #${v.issue} claims "${v.snippet}" (source: ${v.source}, ${v.sourceUrl}) → #${v.pr}: ${v.observed}.`);
  }
}

function summaryUnverifiable(lines, unverifiable) {
  if (!unverifiable.length) return;
  lines.push('', '### Unverifiable — manual verification required');
  for (const v of unverifiable) {
    lines.push(`- #${v.issue} claims "${v.snippet}" (${v.sourceUrl}) → #${v.pr}: unavailable (${v.reason}). An unavailable PR does not establish that the claim failed.`);
  }
}

// Traceability: every checked claim is listed with its evidence link, passes
// included — an all-clear line alone cannot be audited.
function summaryPasses(lines, passes) {
  if (!passes.length) return;
  lines.push('', '### Checked claims — cited PR is merged');
  for (const v of passes) {
    lines.push(`- #${v.issue} claims "${v.snippet}" (source: ${v.source}, ${v.sourceUrl}) → #${v.pr}: merged.`);
  }
}

// Pure: markdown lines for the step summary.
function buildSummary(verdicts, references, incomplete) {
  const lines = ['## Closed-issue delivery-claim audit', '', `Observed: ${new Date().toISOString()}`];
  summaryIncomplete(lines, incomplete);
  const unmerged = verdicts.filter((v) => v.verdict === 'unmerged');
  const unverifiable = verdicts.filter((v) => v.verdict === 'unverifiable');
  lines.push('', `${verdicts.length} asserted delivery claim(s) found: ${unmerged.length} unmerged finding(s), ${unverifiable.length} unverifiable.`);
  summaryFindings(lines, unmerged);
  summaryUnverifiable(lines, unverifiable);
  summaryPasses(lines, verdicts.filter((v) => v.verdict === 'pass'));
  if (references.length) {
    lines.push('', '### Contextual references (not delivery claims)');
    const byIssue = new Map();
    for (const r of references) {
      if (!byIssue.has(r.issue)) byIssue.set(r.issue, []);
      byIssue.get(r.issue).push('#' + r.pr);
    }
    for (const [issue, prs] of byIssue) {
      lines.push(`- #${issue}: ${[...new Set(prs)].join(', ')}`);
    }
  }
  if (!verdicts.length && !references.length && !incomplete.length) {
    lines.push('No asserted delivery claims found in recently closed issues.');
  }
  if (verdicts.length && !unmerged.length) {
    lines.push('', 'No unmerged findings. A merged cited PR supports the claim; it does not by itself certify issue completion, current code after a revert, or package publication.');
  }
  return lines;
}

// Paginated gh api fetch: --paginate --slurp yields one array per page.
function fetchAllPages(args, env) {
  try {
    const raw = JSON.parse(runGh(['api', '--paginate', '--slurp', args], env));
    return { items: Array.isArray(raw) ? raw.flat() : [], error: null };
  } catch (error) {
    return { items: [], error: describeGhError(error) };
  }
}

// Comment fetching is bounded by a request budget; exhaustion is reported as
// incompleteness instead of passing as an empty list.
function makeCommentFetcher(env) {
  let budget = MAX_COMMENT_REQUESTS;
  return (number) => {
    if (budget-- <= 0) return { items: [], error: 'comment request budget exhausted' };
    return fetchAllPages(`repos/${env.GITHUB_REPOSITORY}/issues/${number}/comments?per_page=100`, env);
  };
}

// Four observed states, kept distinct: merged / open-unmerged /
// closed-unmerged / unknown (404, rate limit, transient failure).
function fetchPullState(env, number) {
  try {
    const pr = JSON.parse(runGh(['api', `repos/${env.GITHUB_REPOSITORY}/pulls/${number}`], env));
    if (pr.merged === true) return { observed: 'merged' };
    if (pr.state === 'open') return { observed: 'open-unmerged' };
    if (pr.state === 'closed') return { observed: 'closed-unmerged' };
    return { observed: 'unknown', reason: 'unexpected PR payload' };
  } catch (error) {
    return { observed: 'unknown', reason: describeGhError(error) };
  }
}

function fetchPullStates(env, prNumbers, incomplete) {
  const states = new Map();
  if (prNumbers.length > MAX_PR_CHECKS) {
    incomplete.push(`${prNumbers.length - MAX_PR_CHECKS} cited PR(s) not checked: PR check limit of ${MAX_PR_CHECKS} reached`);
  }
  for (const number of prNumbers.slice(0, MAX_PR_CHECKS)) {
    states.set(number, fetchPullState(env, number));
  }
  return states;
}

function main() {
  const env = process.env;
  if (!env.GITHUB_REPOSITORY || !env.GITHUB_STEP_SUMMARY) {
    console.error('audit-closed-references: requires GITHUB_REPOSITORY and GITHUB_STEP_SUMMARY');
    process.exitCode = 1;
    return;
  }
  const issuesResult = fetchAllPages(
    `repos/${env.GITHUB_REPOSITORY}/issues?state=closed&sort=updated&direction=desc&per_page=100`, env
  );
  const fetchComments = makeCommentFetcher(env);
  const { entries, incomplete } = collectEntries(
    () => issuesResult, fetchComments, Date.now(), DEFAULT_WINDOW_DAYS
  );
  const pullStates = fetchPullStates(env, uniqueClaimPrs(entries), incomplete);
  const verdicts = buildVerdicts(entries, pullStates);
  const references = collectReferences(entries);
  const report = buildSummary(verdicts, references, incomplete).join('\n');
  fs.appendFileSync(env.GITHUB_STEP_SUMMARY, report + '\n');
  console.log(report);
  // Advisory by design: findings land in the summary; the run stays green so
  // the weekly audit is never the thing that fails.
}

module.exports = {
  DEFAULT_WINDOW_DAYS,
  MAX_COMMENT_REQUESTS,
  CLAIM_PATTERN,
  stripNonEvidence,
  isNegated,
  extractRefs,
  selectRecentClosedIssues,
  selectWindowComments,
  extractEvidence,
  collectEntries,
  uniqueClaimPrs,
  collectReferences,
  buildVerdicts,
  buildSummary,
  fetchAllPages,
  fetchPullState,
};

if (require.main === module) main();
