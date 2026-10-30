#!/usr/bin/env node
/** Moderate Issue creation metadata only. Never execute or print contributor text. */
const fs = require('node:fs');
const path = require('node:path');
const { githubAPI, listPages, validatePolicy, strongestWindow, blockAuthor } = require('./pr-burst-guard');

const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})(?:\[bot\])?$/i;
const CAP_MARKER = '<!-- ecc-issue-open-cap -->';
const ALERT_MARKER = '<!-- ecc-issue-burst:';
const isIssue = issue => !issue.pull_request;
const byCreation = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.number - b.number;

function capExcess(openRows, current, policy, alreadyClosed = new Set(), action = 'opened') {
  validatePolicy(policy);
  const open = [...new Map([...openRows, current].map(issue => [issue.number, issue])).values()]
    .filter(issue => isIssue(issue) && issue.user.id === current.user.id
      && issue.state === 'open' && !alreadyClosed.has(issue.number)).sort(byCreation);
  const currentIndex = open.findIndex(issue => issue.number === current.number);
  const excess = open.length <= policy.maxOpen || currentIndex < 0 ? []
    : action === 'reopened' ? [open[currentIndex]]
      : open.filter((issue, index) => index >= policy.maxOpen && byCreation(issue, current) >= 0);
  return { openCount: open.length, maxOpen: policy.maxOpen,
    capExcess: excess.map(issue => ({ number: issue.number, state: issue.state })) };
}

async function notify(api, root, current, result, policy) {
  const day = result.until.slice(0, 10);
  const marker = `${ALERT_MARKER}${current.user.id}:${day} -->`;
  const rows = await listPages(api, `${root}/issues?state=all&sort=created&direction=desc`,
    batch => batch.some(issue => issue.created_at?.slice(0, 10) < day));
  const existing = rows.find(issue => isIssue(issue) && issue.user?.login === 'github-actions[bot]'
    && issue.body?.includes(marker));
  const escalation = '<!-- ecc-issue-burst:block-threshold -->';
  if (existing?.body.includes(escalation) && !result.block) return;
  const mentions = policy.notify.map(login => `@${login}`).join(' ');
  const body = [marker, result.block ? escalation : '', `${mentions}: Issue submission moderation triggered.`, '',
    `Author: @${current.user.login} (user ID ${current.user.id}).`,
    `Observed: ${result.count} Issue creations between ${result.since} and ${result.until}.`,
    `Policy: close Issues beyond ${policy.closeAbove}; block beyond ${policy.blockAbove} in ${policy.windowMinutes} minutes.`,
    `Blocking: ${result.blockStatus}.`, `Excess Issues: ${result.excess.map(issue => `#${issue.number}`).join(', ') || 'none'}.`,
    `Enforcement errors: ${result.errors.join('; ') || 'none'}.`, '',
    'Counts include closed Issues and exclude pull requests. Review the Actions run before lifting an account block.']
    .filter(Boolean).join('\n');
  if (!existing) await api('POST', `${root}/issues`, { title: `Issue burst alert: ${current.user.login}`, body });
  else {
    if (result.block && !existing.body.includes(escalation)) {
      await api('POST', `${root}/issues/${existing.number}/comments`, {
        body: `${mentions}: the Issue burst escalated. Blocking: ${result.blockStatus}.`,
      });
    }
    await api('PATCH', `${root}/issues/${existing.number}`, { body });
  }
}

async function enforceCap(api, root, issue, current, result) {
  try {
    await api('PATCH', `${root}/issues/${issue.number}`, { state: 'closed' });
    const comments = await listPages(api, `${root}/issues/${issue.number}/comments?sort=created`);
    if (comments.some(comment => comment.user?.login === 'github-actions[bot]'
      && comment.body?.includes(CAP_MARKER))) return;
    await api('POST', `${root}/issues/${issue.number}/comments`, { body: [CAP_MARKER,
      `Closed automatically: @${current.user.login} has ${result.openCount} open Issues in this repository, above the limit of ${result.maxOpen} per author.`,
      '', 'Close older Issues or wait for them to be resolved, then reopen this one. This limit protects maintainer triage capacity.',
      'Policy: `.github/ISSUE_MODERATION.md`.'].join('\n') });
  } catch (error) { result.errors.push(`#${issue.number}: ${error.message}`); }
}

async function moderate({ api, blockAPI, repository, number, action = 'opened', policy, dryRun = false, now = Date.now() }) {
  validatePolicy(policy);
  if (!/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(repository) || !Number.isSafeInteger(number) || number < 1) {
    throw new Error('Invalid repository or Issue number');
  }
  if (!['opened', 'reopened'].includes(action)) throw new Error('Unsupported Issue event');
  const root = `/repos/${repository}`;
  const repo = await api('GET', root);
  const current = await api('GET', `${root}/issues/${number}`);
  if (!isIssue(current)) return { skipped: 'pull request' };
  if (!LOGIN.test(current.user.login)) throw new Error('Invalid Issue author login');
  // The guard's own alert Issues must never enter the moderation ledger.
  if (current.user.login === 'github-actions[bot]') return { skipped: 'guard bot' };
  let permission;
  try { permission = (await api('GET', `${root}/collaborators/${current.user.login}/permission`)).permission; }
  catch (error) {
    if (error.status !== 404) throw error;
    permission = 'none';
  }
  const burstExempt = ['admin', 'maintain', 'write'].includes(permission);
  let result;
  if (burstExempt) result = { author: current.user.login, burstExempt, dryRun, errors: [], excess: [],
    blockStatus: 'Exempt from burst threshold' };
  else {
    const end = action === 'opened' ? Date.parse(current.created_at) : now;
    const since = end - policy.windowMinutes * 60000;
    const rows = (await listPages(api, `${root}/issues?state=all&sort=created&direction=desc`,
      batch => batch.some(issue => Date.parse(issue.created_at) < since))).filter(isIssue);
    result = { ...strongestWindow(rows, current, policy, end), author: current.user.login,
      burstExempt, dryRun, errors: [], blockStatus: 'Below blocking threshold' };
  }
  const openRows = (await listPages(api, `${root}/issues?state=open&sort=created&direction=desc`)).filter(isIssue);
  Object.assign(result, capExcess(openRows, current, policy, new Set(result.excess.map(issue => issue.number)), action));
  if (dryRun) {
    if (result.block) result.blockStatus = 'Dry run: would attempt owner-scoped blocking';
    return result;
  }
  if (result.excess.length) {
    if (result.block) result.blockStatus = await blockAuthor(blockAPI, repo.owner, current.user.login);
    for (const issue of result.excess) {
      if (issue.state !== 'open') continue;
      try {
        await api('PATCH', `${root}/issues/${issue.number}`, { state: 'closed' });
        await api('PUT', `${root}/issues/${issue.number}/lock`, { lock_reason: 'spam' });
      } catch (error) { result.errors.push(`#${issue.number}: ${error.message}`); }
    }
    await notify(api, root, current, result, policy);
  }
  for (const issue of result.capExcess) await enforceCap(api, root, issue, current, result);
  return result;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const issueIndex = process.argv.indexOf('--issue');
  const number = issueIndex >= 0 ? Number(process.argv[issueIndex + 1]) : event.issue?.number;
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.github/issue-submission-policy.json'), 'utf8'));
  const result = await moderate({ api: githubAPI(process.env.GITHUB_TOKEN),
    blockAPI: !dryRun && process.env.PR_MODERATION_BLOCK_TOKEN ? githubAPI(process.env.PR_MODERATION_BLOCK_TOKEN) : undefined,
    repository: process.env.GITHUB_REPOSITORY, number, action: event.action || 'opened', policy, dryRun });
  const report = JSON.stringify(result, null, 2);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Issue submission guard\n\n\`\`\`json\n${report}\n\`\`\`\n`);
  if (result.errors?.length || /^(Failed|Unavailable):/.test(result.blockStatus || '')) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { capExcess, moderate };
