#!/usr/bin/env node
/** Metadata-only moderation. Never execute PR code or use PR titles/bodies. */
const fs = require('node:fs');
const path = require('node:path');

const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})(?:\[bot\])?$/i;

function validatePolicy(policy) {
  for (const key of ['windowMinutes', 'closeAbove', 'blockAbove', 'maxOpen']) {
    if (!Number.isSafeInteger(policy[key]) || policy[key] < 1) throw new Error(`Invalid policy ${key}`);
  }
  if (policy.blockAbove <= policy.closeAbove) throw new Error('blockAbove must exceed closeAbove');
  if (!Array.isArray(policy.deniedUserIDs) || !policy.deniedUserIDs.every(Number.isSafeInteger)) {
    throw new Error('Invalid deniedUserIDs');
  }
  if (!Array.isArray(policy.notify) || !policy.notify.every(login => LOGIN.test(login))) {
    throw new Error('Invalid notification logins');
  }
}

function githubAPI(token, fetcher = fetch) {
  if (!token) throw new Error('GitHub token is required');
  return async (method, route, body) => {
    if (!/^\/[a-zA-Z0-9][a-zA-Z0-9/_.?=&%[\]-]*$/.test(route)) throw new Error('Invalid GitHub API path');
    const response = await fetcher(`https://api.github.com${route}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      // Never print response bodies, which can contain attacker-controlled text.
      const error = new Error(`GitHub ${method} failed: HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  };
}

async function listPages(api, route, stop = () => false) {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await api('GET', `${route}&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Expected GitHub list response');
    rows.push(...batch);
    if (batch.length < 100 || stop(batch)) return rows;
  }
  throw new Error('Pagination limit reached; refusing an incomplete moderation decision');
}

function evaluate(rows, current, policy, end) {
  validatePolicy(policy);
  if (!Number.isFinite(end)) throw new Error('Invalid window timestamp');
  const since = end - policy.windowMinutes * 60000;
  const recent = [...new Map([...rows, current].map(pr => [pr.number, pr])).values()]
    .filter(pr => pr.user.id === current.user.id && Date.parse(pr.created_at) >= since && Date.parse(pr.created_at) <= end)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.number - b.number);
  const denied = policy.deniedUserIDs.includes(current.user.id);
  const excess = denied ? [current] : recent.slice(policy.closeAbove);
  return { count: recent.length, denied, block: denied || recent.length > policy.blockAbove,
    excess: excess.map(pr => ({ number: pr.number, state: pr.state })),
    since: new Date(since).toISOString(), until: new Date(end).toISOString() };
}

function strongestWindow(rows, current, policy, eventTime) {
  const ordered = [...new Map([...rows, current].map(pr => [pr.number, pr])).values()]
    .filter(pr => pr.user.id === current.user.id)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.number - b.number);
  const times = ordered.map(pr => Date.parse(pr.created_at));
  const excess = new Map(evaluate(rows, current, policy, eventTime).excess.map(pr => [pr.number, pr]));
  let left = 0;
  let count = 0;
  let end = eventTime;
  for (let right = 0; right < times.length; right++) {
    while (times[left] < times[right] - policy.windowMinutes * 60000) left++;
    if (times[right] >= eventTime && right - left + 1 >= count) {
      count = right - left + 1;
      end = times[right];
    }
    if (times[right] >= eventTime && right - left + 1 > policy.closeAbove) {
      excess.set(ordered[right].number, { number: ordered[right].number, state: ordered[right].state });
    }
  }
  const peak = evaluate(rows, current, policy, end);
  return { ...peak, excess: peak.denied ? peak.excess : [...excess.values()] };
}

/** Open-PR cap: keep the author's oldest `maxOpen` open PRs, close the rest. PRs the burst
 *  guard already closed in this run are treated as closed so nothing is mutated twice. */
function capExcess(openRows, current, policy, alreadyClosed = new Set()) {
  validatePolicy(policy);
  const open = [...new Map([...openRows, current].map(pr => [pr.number, pr])).values()]
    .filter(pr => pr.user.id === current.user.id && pr.state === 'open' && !alreadyClosed.has(pr.number))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.number - b.number);
  return { openCount: open.length, maxOpen: policy.maxOpen,
    capExcess: open.slice(policy.maxOpen).map(pr => ({ number: pr.number, state: pr.state })) };
}

const CAP_MARKER = '<!-- ecc-pr-open-cap -->';

async function enforceCap(api, root, pr, current, result) {
  try {
    await api('PATCH', `${root}/pulls/${pr.number}`, { state: 'closed' });
    const comments = await listPages(api, `${root}/issues/${pr.number}/comments?sort=created`);
    if (comments.some(c => c.user?.login === 'github-actions[bot]' && c.body?.includes(CAP_MARKER))) return;
    await api('POST', `${root}/issues/${pr.number}/comments`, { body: [CAP_MARKER,
      `Closed automatically: @${current.user.login} has ${result.openCount} open pull requests in this repository, above the limit of ${result.maxOpen} per contributor.`,
      '', 'Get existing PRs merged, or close the ones you no longer need, then reopen this one. The limit is about review capacity, not the quality of this patch.',
      'Contributors with repository write access are exempt. Policy: `.github/PR_MODERATION.md`.'].join('\n') });
  } catch (error) {
    result.errors.push(`#${pr.number}: ${error.message}`);
  }
}

async function blockAuthor(blockAPI, owner, login) {
  if (!blockAPI) return 'Unavailable: PR_MODERATION_BLOCK_TOKEN is not configured';
  try {
    if (owner.type !== 'User') throw new Error('Only personal repository owners are supported');
    const identity = await blockAPI('GET', '/user');
    if (identity.login.toLowerCase() !== owner.login.toLowerCase()) {
      throw new Error('Block token must use the repository owner identity');
    }
    await blockAPI('PUT', `/user/blocks/${login}`);
    return 'Blocked by repository owner (all repositories owned by this account)';
  } catch (error) {
    return `Failed: ${error.message}`;
  }
}

async function notify(api, root, current, result, policy) {
  // A bot-authored ledger prevents contributors from spoofing a suppression marker.
  const marker = `<!-- ecc-pr-burst:${current.user.id}:${result.until.slice(0, 10)} -->`;
  const issues = await listPages(api, `${root}/issues?state=all&sort=created&direction=desc`,
    batch => batch.some(issue => issue.created_at && issue.created_at.slice(0, 10) < result.until.slice(0, 10)));
  const existing = issues.find(issue => !issue.pull_request && issue.user.login === 'github-actions[bot]'
    && issue.body?.includes(marker));
  const escalation = '<!-- ecc-pr-burst:block-threshold -->';
  if (existing?.body.includes(escalation) && !result.block) return;
  const mentions = policy.notify.map(login => `@${login}`).join(' ');
  const body = [marker, result.block ? escalation : '', `${mentions}: PR submission moderation triggered.`,
    '', `Author: @${current.user.login} (user ID ${current.user.id}).`,
    `Observed: ${result.count} PR creations between ${result.since} and ${result.until}.`,
    `Policy: close PRs beyond ${policy.closeAbove}; block beyond ${policy.blockAbove} in ${policy.windowMinutes} minutes.`,
    `Denied account: ${result.denied}.`, `Blocking: ${result.blockStatus}.`,
    `Excess PRs across scanned windows: ${result.excess.map(pr => `#${pr.number}`).join(', ') || 'none'}.`,
    `Enforcement errors: ${result.errors.join('; ') || 'none'}.`,
    '', 'Counts include closed and draft PRs. Volume triggers moderation, not a judgment about individual patch quality.',
    'Review the Actions run and PR timeline before lifting an account block.'].filter(Boolean).join('\n');
  if (!existing) {
    await api('POST', `${root}/issues`, { title: `PR burst alert: ${current.user.login}`, body });
  } else {
    // Notify again only when a soft-limit alert escalates to blocking.
    if (result.block && !existing.body.includes(escalation)) {
      await api('POST', `${root}/issues/${existing.number}/comments`, {
        body: `${mentions}: the PR burst escalated. Blocking: ${result.blockStatus}.`,
      });
    }
    await api('PATCH', `${root}/issues/${existing.number}`, { body });
  }
}

async function moderate({ api, blockAPI, repository, number, action = 'opened', policy, dryRun = false, now = Date.now() }) {
  validatePolicy(policy);
  if (!/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(repository) || !Number.isSafeInteger(number) || number < 1) {
    throw new Error('Invalid repository or PR number');
  }
  if (!['opened', 'reopened'].includes(action)) throw new Error('Unsupported PR event');
  const root = `/repos/${repository}`;
  const repo = await api('GET', root);
  const current = await api('GET', `${root}/pulls/${number}`);
  if (!LOGIN.test(current.user.login)) throw new Error('Invalid PR author login');
  let permission;
  try {
    permission = (await api('GET', `${root}/collaborators/${current.user.login}/permission`)).permission;
  } catch (error) {
    if (error.status !== 404) throw error;
    permission = 'none';
  }
  if (['admin', 'maintain', 'write'].includes(permission)) return { exempt: true, author: current.user.login };
  // Anchor opened events to GitHub's creation time so Actions queue delays cannot erase a burst.
  const end = action === 'opened' ? Date.parse(current.created_at) : now;
  const since = end - policy.windowMinutes * 60000;
  const rows = await listPages(api, `${root}/pulls?state=all&sort=created&direction=desc`,
    batch => batch.some(pr => Date.parse(pr.created_at) < since));
  // Inspect later windows too: delivery order and replaced pending runs must not
  // let an older event conceal a newer burst already present in the API snapshot.
  const result = { ...strongestWindow(rows, current, policy, end), author: current.user.login,
    dryRun, errors: [], blockStatus: 'Below blocking threshold' };
  // Total open PRs is a separate, unwindowed list: the burst scan stops at the window edge.
  const openRows = await listPages(api, `${root}/pulls?state=open&sort=created&direction=desc`);
  Object.assign(result, capExcess(openRows, current, policy, new Set(result.excess.map(pr => pr.number))));
  if (dryRun) {
    if (result.block) result.blockStatus = 'Dry run: would attempt owner-scoped blocking';
    return result;
  }
  if (result.excess.length > 0) await enforceBurst({ api, blockAPI, root, repo, current, result, policy });
  for (const pr of result.capExcess) await enforceCap(api, root, pr, current, result);
  return result;
}

async function enforceBurst({ api, blockAPI, root, repo, current, result, policy }) {
  if (result.block) result.blockStatus = await blockAuthor(blockAPI, repo.owner, current.user.login);
  for (const pr of result.excess) {
    if (pr.state !== 'open') continue;
    try {
      await api('PATCH', `${root}/pulls/${pr.number}`, { state: 'closed' });
      await api('PUT', `${root}/issues/${pr.number}/lock`, { lock_reason: 'spam' });
    } catch (error) {
      result.errors.push(`#${pr.number}: ${error.message}`);
    }
  }
  await notify(api, root, current, result, policy);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const prIndex = process.argv.indexOf('--pr');
  const number = prIndex >= 0 ? Number(process.argv[prIndex + 1]) : event.pull_request?.number;
  const repository = process.env.GITHUB_REPOSITORY;
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, '../../.github/pr-burst-policy.json'), 'utf8'));
  const result = await moderate({ api: githubAPI(process.env.GITHUB_TOKEN),
    blockAPI: !dryRun && process.env.PR_MODERATION_BLOCK_TOKEN ? githubAPI(process.env.PR_MODERATION_BLOCK_TOKEN) : undefined,
    repository, number, action: event.action || 'opened', policy, dryRun });
  const report = JSON.stringify(result, null, 2);
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## PR burst guard\n\n\`\`\`json\n${report}\n\`\`\`\n`);
  if (result.errors?.length || /^(Failed|Unavailable):/.test(result.blockStatus || '')) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { evaluate, moderate, githubAPI, listPages, validatePolicy, strongestWindow, capExcess, blockAuthor };
