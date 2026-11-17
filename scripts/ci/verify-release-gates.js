'use strict';

const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

const API_VERSION = '2022-11-28';
const SHA = /^[0-9a-f]{40}$/;
const MAX_PAGES = 10;
const MAX_ITEMS = 1000;
const DEFAULT_ATTEMPTS = 20;
const DEFAULT_DELAY_MS = 30_000;
const TOTAL_TIMEOUT_MS = 600_000;
const REQUEST_TIMEOUT_MS = 15_000;
const CI_PATH = '.github/workflows/ci.yml';
const CODEQL_PATH = 'dynamic/github-code-scanning/codeql';
// Repository policy: default CodeQL must complete all three categories in ONE
// attempt. A new category requires an explicit policy update, not silent approval.
const REQUIRED_CODEQL = ['Analyze (actions)', 'Analyze (javascript-typescript)', 'Analyze (python)'];
const ACTIONS_APP = { id: 15368, slug: 'github-actions' };

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => Number.isSafeInteger(value) && value > 0;
const sha = value => typeof value === 'string' && SHA.test(value);
const text = value => typeof value === 'string' && value.length > 0;
const resultShape = value => record(value) && text(value.status)
  && (value.conclusion === null || text(value.conclusion));
const repoShape = value => record(value) && id(value.id) && text(value.full_name);
const objectShape = value => record(value) && text(value.type) && sha(value.sha);
const referenceShape = value => record(value) && text(value.ref) && objectShape(value.object);
const tagShape = value => record(value) && sha(value.sha) && text(value.tag)
  && objectShape(value.object) && record(value.verification)
  && typeof value.verification.verified === 'boolean' && text(value.verification.reason);
const workflowShape = value => record(value) && id(value.id) && text(value.path) && text(value.state);
const runShape = value => resultShape(value) && id(value.id) && id(value.workflow_id)
  && text(value.path) && sha(value.head_sha) && text(value.head_branch) && text(value.event)
  && id(value.run_attempt) && id(value.check_suite_id)
  && repoShape(value.repository) && repoShape(value.head_repository);
const checkShape = value => resultShape(value) && id(value.id) && text(value.name)
  && sha(value.head_sha) && record(value.check_suite) && id(value.check_suite.id)
  && record(value.app) && id(value.app.id) && text(value.app.slug);
const jobShape = value => resultShape(value) && id(value.id) && text(value.name)
  && id(value.run_id) && id(value.run_attempt) && sha(value.head_sha)
  && text(value.head_branch) && text(value.check_run_url);

function requiredEnvironment(env = process.env) {
  const inputs = {
    repository: env.GITHUB_REPOSITORY,
    releaseSha: env.RELEASE_SHA,
    releaseTag: env.RELEASE_TAG,
    token: env.GITHUB_TOKEN,
    tagObjectSha: env.RELEASE_TAG_OBJECT_SHA,
  };
  for (const name of ['repository', 'releaseSha', 'releaseTag', 'token']) {
    if (!text(inputs[name])) throw new Error(`Missing required release gate input: ${name}`);
  }
  validateInputs(inputs);
  return inputs;
}

function validateInputs(inputs) {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(inputs.repository || '')) {
    throw new Error('Invalid release repository');
  }
  if (!sha(inputs.releaseSha)) throw new Error('RELEASE_SHA must be a full lowercase commit SHA');
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(inputs.releaseTag || '')) {
    throw new Error('RELEASE_TAG is not a supported version tag');
  }
  if (!text(inputs.token)) throw new Error('Missing release gate token');
  if (inputs.tagObjectSha !== undefined && !sha(inputs.tagObjectSha)) {
    throw new Error('Invalid expected tag object SHA');
  }
}

function setting(value, fallback, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error('Release gate settings must be positive integers within their finite limits');
  }
  return parsed;
}

class ReleaseGateDeadlineError extends Error {}

function createGithubClient(inputs, fetchImpl = fetch, options = {}) {
  validateInputs(inputs);
  const now = options.now || (() => performance.now());
  const deadline = now() + setting(options.timeoutMs, TOTAL_TIMEOUT_MS, TOTAL_TIMEOUT_MS);
  const requestMs = setting(options.requestTimeoutMs, REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS);
  const base = `https://api.github.com/repos/${inputs.repository}`;

  function remaining() {
    const left = deadline - now();
    if (left <= 0) throw new ReleaseGateDeadlineError('Release gate global deadline exceeded');
    return left;
  }

  async function bounded(operation, limit) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => operation(controller.signal)),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new ReleaseGateDeadlineError('Release gate request or global deadline exceeded'));
          }, Math.min(limit, remaining()));
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function urlFor(pathOrUrl) {
    const url = new URL(pathOrUrl === '' || pathOrUrl.startsWith('/') ? base + pathOrUrl : pathOrUrl);
    if (url.origin !== 'https://api.github.com' || url.username || url.password || url.hash
      || (url.pathname !== `/repos/${inputs.repository}` && !url.pathname.startsWith(`/repos/${inputs.repository}/`))) {
      throw new Error('GitHub API URL escaped the release repository');
    }
    return url;
  }

  async function page(url, validator) {
    remaining();
    return bounded(async signal => {
      const response = await fetchImpl(url.toString(), {
        redirect: 'error', signal,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${inputs.token}`,
          'X-GitHub-Api-Version': API_VERSION,
        },
      });
      if (!response.ok) throw new Error(`GitHub API failed with status ${response.status}`);
      let payload;
      try { payload = await response.json(); } catch { throw new Error('Invalid GitHub API JSON response'); }
      if (!validator(payload)) throw new Error('GitHub API response validation failed');
      remaining();
      return { payload, link: response.headers?.get?.('link') };
    }, requestMs);
  }

  async function get(path, validator) {
    return (await page(urlFor(path), validator)).payload;
  }

  async function pages(path, key, itemValidator) {
    const first = urlFor(path);
    const seen = new Set();
    const identities = new Set();
    let next = first;
    let total;
    const items = [];
    while (next) {
      const identity = paginationIdentity(next, first);
      if (seen.has(identity)) throw new Error('GitHub API pagination cycle');
      if (seen.size >= MAX_PAGES) throw new Error('GitHub API page limit exceeded');
      seen.add(identity);
      const { payload, link } = await page(next, value => record(value)
        && Number.isSafeInteger(value.total_count) && value.total_count >= 0
        && Array.isArray(value[key]));
      if (payload.total_count > MAX_ITEMS || payload[key].length > 100) {
        throw new Error('GitHub API item limit exceeded');
      }
      if (total !== undefined && total !== payload.total_count) throw new Error('GitHub API collection total changed');
      total = payload.total_count;
      for (const item of payload[key]) {
        if (!itemValidator(item)) throw new Error('GitHub API response validation failed');
        if (identities.has(item.id)) throw new Error('Ambiguous duplicate GitHub API item');
        identities.add(item.id);
        items.push(item);
      }
      if (items.length > MAX_ITEMS || items.length > total) throw new Error('GitHub API item limit or total exceeded');
      const linkUrl = nextPageUrl(link);
      next = linkUrl ? urlFor(linkUrl) : null;
    }
    if (items.length !== total) throw new Error('Incomplete GitHub API collection total');
    return items;
  }

  return { get, pages, pause: sleep => bounded(signal => sleep(signal), remaining()), remaining };
}

function paginationIdentity(url, first) {
  const query = candidate => {
    const keys = [...candidate.searchParams.keys()];
    if (new Set(keys).size !== keys.length) throw new Error('Ambiguous pagination query');
    return [...candidate.searchParams].filter(([key]) => key !== 'page').sort().map(pair => JSON.stringify(pair)).join(',');
  };
  const page = url.searchParams.get('page');
  if (url.pathname !== first.pathname || query(url) !== query(first)
    || (page !== null && !/^[1-9][0-9]*$/.test(page))) {
    throw new Error('GitHub API pagination escaped the endpoint collection');
  }
  return `${url.pathname}?${query(url)}&page=${page || '1'}`;
}

function nextPageUrl(header) {
  if (!header) return null;
  let next = null;
  for (const entry of header.split(',')) {
    const match = entry.trim().match(/^<([^>]+)>;\s*rel="(next|prev|first|last)"$/);
    if (!match) throw new Error('Malformed GitHub API pagination Link');
    if (match[2] === 'next') {
      if (next) throw new Error('Ambiguous GitHub API next page');
      next = match[1];
    }
  }
  return next;
}

async function verifySignedAnnotatedTag(inputs, fetchImpl = fetch, options = {}) {
  validateInputs(inputs);
  const client = options.client || createGithubClient(inputs, fetchImpl, options);
  const reference = await client.get(`/git/ref/tags/${encodeURIComponent(inputs.releaseTag)}`, referenceShape);
  if (reference.ref !== `refs/tags/${inputs.releaseTag}` || reference.object.type !== 'tag') {
    throw new Error('Release ref must match the requested annotated tag; lightweight tags are rejected');
  }
  if (inputs.tagObjectSha && reference.object.sha !== inputs.tagObjectSha) {
    throw new Error('Release tag object changed after initial verification');
  }
  const tag = await client.get(`/git/tags/${reference.object.sha}`, tagShape);
  if (tag.sha !== reference.object.sha || tag.tag !== inputs.releaseTag) {
    throw new Error('Signed tag object identity or name does not match the release ref');
  }
  // GitHub signature validity is not a project-specific authorized-signer list.
  if (tag.verification.verified !== true || tag.verification.reason !== 'valid') {
    throw new Error('Release tag signature is not verified');
  }
  if (tag.object.type !== 'commit' || tag.object.sha !== inputs.releaseSha) {
    throw new Error('Verified release tag does not point at the checked-out commit');
  }
  return tag.sha;
}

async function trustedProducers(client, inputs) {
  const repository = await client.get('', value => repoShape(value) && value.default_branch === 'main');
  if (repository.full_name !== inputs.repository) throw new Error('Repository identity mismatch');
  const workflows = await client.pages('/actions/workflows?per_page=100', 'workflows', workflowShape);
  const select = path => {
    const matches = workflows.filter(workflow => workflow.path === path);
    if (matches.length !== 1 || matches[0].state !== 'active') throw new Error('Missing or ambiguous active trusted workflow');
    return matches[0];
  };
  return { repository, ci: select(CI_PATH), codeql: select(CODEQL_PATH) };
}

function selectRuns(runs, inputs, trusted) {
  const sameRepo = repo => repo.id === trusted.repository.id && repo.full_name === inputs.repository;
  const select = (workflow, event) => runs.filter(run => run.workflow_id === workflow.id
    && run.path === workflow.path && run.head_sha === inputs.releaseSha && run.head_branch === 'main'
    && run.event === event && sameRepo(run.repository) && sameRepo(run.head_repository))
    .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0];
  return { ci: select(trusted.ci, 'push'), codeql: select(trusted.codeql, 'dynamic') };
}

function statusOf(result, label, pendingLabel = label) {
  if (!result) return { state: 'pending', reason: `${pendingLabel} run not found for release SHA` };
  if (result.status !== 'completed') return { state: 'pending', reason: `${pendingLabel} is ${result.status}` };
  return result.conclusion === 'success' ? { state: 'passed' }
    : { state: 'failed', reason: `${label} concluded ${result.conclusion}` };
}

function assessExactShaGates(selected, checks, jobs, inputs) {
  for (const [name, run] of Object.entries(selected)) {
    const assessment = statusOf(run, name);
    if (assessment.state !== 'passed') return assessment;
  }
  const run = selected.codeql;
  if (jobs.some(job => !REQUIRED_CODEQL.includes(job.name))) {
    throw new Error('Unexpected CodeQL category; review the explicit required-category policy');
  }
  for (const name of REQUIRED_CODEQL) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length > 1) throw new Error('Ambiguous required CodeQL job');
    const job = matches[0];
    if (!job) return { state: 'pending', reason: `CodeQL job "${name}" missing from selected attempt` };
    if (job.run_id !== run.id || job.run_attempt !== run.run_attempt
      || job.head_sha !== inputs.releaseSha || job.head_branch !== 'main') {
      throw new Error('CodeQL job does not belong to the selected run attempt');
    }
    const check = checks.find(candidate => job.check_run_url
      === `https://api.github.com/repos/${inputs.repository}/check-runs/${candidate.id}`);
    if (!check || check.name !== name || check.head_sha !== inputs.releaseSha
      || check.check_suite.id !== run.check_suite_id || check.app.id !== ACTIONS_APP.id
      || check.app.slug !== ACTIONS_APP.slug) {
      return { state: 'pending', reason: `CodeQL check "${name}" missing or not bound to trusted job` };
    }
    for (const [kind, result] of [['job', job], ['check', check]]) {
      const assessment = statusOf(result, name, `CodeQL ${kind} "${name}"`);
      if (assessment.state !== 'passed') return assessment;
    }
  }
  return { state: 'passed' };
}

function defaultSleep(delay, signal) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, delay);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

async function waitForExactShaGates(inputs, fetchImpl = fetch, sleep = defaultSleep, options = {}) {
  const client = options.client || createGithubClient(inputs, fetchImpl, options);
  const attempts = setting(options.attempts ?? process.env.RELEASE_GATE_ATTEMPTS, DEFAULT_ATTEMPTS, DEFAULT_ATTEMPTS);
  const delay = setting(options.delayMs ?? process.env.RELEASE_GATE_DELAY_MS, DEFAULT_DELAY_MS, DEFAULT_DELAY_MS);
  let lastReason = 'no gate assessment completed';
  try {
    const trusted = await trustedProducers(client, inputs);
    const readRuns = async () => selectRuns(await client.pages(
      `/actions/runs?head_sha=${inputs.releaseSha}&branch=main&per_page=100`, 'workflow_runs', runShape
    ), inputs, trusted);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const selected = await readRuns();
      let assessment = statusOf(selected.ci, 'CI');
      if (assessment.state === 'passed') assessment = statusOf(selected.codeql, 'CodeQL');
      if (assessment.state === 'passed') {
        const run = selected.codeql;
        const jobs = await client.pages(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, 'jobs', jobShape);
        const checks = await client.pages(`/check-suites/${run.check_suite_id}/check-runs?filter=all&per_page=100`, 'check_runs', checkShape);
        assessment = assessExactShaGates(selected, checks, jobs, inputs);
        if (assessment.state === 'passed') {
          // Do not approve an attempt superseded while its jobs/checks were read.
          const finalRuns = await readRuns();
          if (JSON.stringify(finalRuns) === JSON.stringify(selected)) return;
          assessment = { state: 'pending', reason: 'Trusted CI or CodeQL run changed during verification' };
        }
      }
      if (assessment.state === 'failed') throw new Error(assessment.reason);
      lastReason = assessment.reason;
      if (attempt < attempts) await client.pause(signal => sleep(delay, signal));
    }
  } catch (error) {
    if (error instanceof ReleaseGateDeadlineError) {
      throw new Error(`${error.message}; last pending gate: ${lastReason}`, { cause: error });
    }
    throw error;
  }
  throw new Error(`Timed out waiting for successful exact-SHA CI and CodeQL checks; last pending gate: ${lastReason}`);
}

async function main() {
  const inputs = requiredEnvironment();
  const tagOnly = process.argv.includes('--tag-only');
  if (tagOnly && !inputs.tagObjectSha) throw new Error('Tag-only recheck requires the original tag object SHA');
  const client = createGithubClient(inputs);
  const tagObjectSha = await verifySignedAnnotatedTag(inputs, fetch, { client });
  if (!tagOnly) await waitForExactShaGates(inputs, fetch, defaultSleep, { client });
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `release_sha=${inputs.releaseSha}\ntag_object_sha=${tagObjectSha}\n`);
  }
  console.log(tagOnly ? 'Verified unchanged release tag snapshot.'
    : 'Verified signed annotated tag and successful exact-SHA CI/CodeQL gates.');
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Release gate verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { assessExactShaGates, createGithubClient, requiredEnvironment, verifySignedAnnotatedTag, waitForExactShaGates };
