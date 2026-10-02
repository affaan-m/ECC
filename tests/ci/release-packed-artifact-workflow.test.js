'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..', '..');
const workflowPaths = [
  '.github/workflows/release.yml',
  '.github/workflows/reusable-release.yml',
];
const {
  createGithubClient,
  requiredEnvironment,
  verifySignedAnnotatedTag,
  waitForExactShaGates,
} = require('../../scripts/ci/verify-release-gates.js');
const lifecycleRunnerSource = load('tests/ci/packed-artifact-lifecycle.js');

// A pending Promise alone does not keep Node alive. Only a completed queue
// may report success, including when a deadline regression leaves it unsettled.
process.exitCode = 1;
let passed = 0;
let failed = 0;
let pendingTests = Promise.resolve();

function test(name, fn) {
  pendingTests = pendingTests.then(async () => {
    try {
      await fn();
      pass(name);
    } catch (error) {
      fail(name, error);
    }
  });
}

function pass(name) {
  console.log(`  ✓ ${name}`);
  passed += 1;
}

function fail(name, error) {
  console.log(`  ✗ ${name}`);
  console.log(`    Error: ${error.message}`);
  failed += 1;
}

function load(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function jobBlock(source, jobName, nextJobName) {
  const startMarker = `\n  ${jobName}:\n`;
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${jobName} job`);

  if (!nextJobName) {
    return source.slice(start);
  }

  const end = source.indexOf(`\n  ${nextJobName}:\n`, start + startMarker.length);
  assert.ok(end > start, `missing ${nextJobName} job after ${jobName}`);
  return source.slice(start, end);
}

console.log('\n=== Testing packed-artifact release workflows ===\n');

for (const workflowPath of workflowPaths) {
  const source = load(workflowPath);

  test(`${workflowPath} verifies signed tags and exact-SHA CI gates before building`, () => {
    const verify = jobBlock(source, 'verify', 'lifecycle');
    const workflow = yaml.load(source);
    const verifyJob = workflow.jobs.verify;
    const gateStep = verifyJob.steps.find(
      step => step.name === 'Verify signed tag and exact-SHA CI gates'
    );
    const gateIndex = verify.indexOf('name: Verify signed tag and exact-SHA CI gates');
    const installIndex = verify.indexOf('name: Install dependencies');
    const effectivePermissions = verifyJob.permissions || workflow.permissions || {};

    assert.ok(gateIndex >= 0, 'missing release provenance gate');
    assert.ok(installIndex > gateIndex, 'release provenance must be verified before dependencies run');
    assert.ok(gateStep, 'missing named release provenance gate step');
    assert.match(gateStep.run, /node scripts\/ci\/verify-release-gates\.js/);
    assert.match(gateStep.run, /RELEASE_SHA=/);
    assert.ok(gateStep.env?.RELEASE_TAG, 'gate step must receive RELEASE_TAG');
    assert.strictEqual(effectivePermissions.actions, 'read');
    assert.strictEqual(effectivePermissions.checks, 'read');
  });

  test(`${workflowPath} packs once and exports the package name and SHA-256`, () => {
    assert.strictEqual(
      (source.match(/npm pack --json/g) || []).length,
      1,
      'release workflow must pack exactly once'
    );
    assert.match(source, /package_sha256:\s*\$\{\{ steps\.pack\.outputs\.package_sha256 \}\}/);
    assert.match(source, /createHash\(['"]sha256['"]\)/);
    assert.match(source, /package_sha256=['"]? \+ digest/);
  });

  test(`${workflowPath} invokes only test files present in the release source`, () => {
    const referencedTests = [...source.matchAll(/\bnode (tests\/[A-Za-z0-9_./-]+\.js)\b/g)]
      .map(match => match[1]);
    assert.ok(referencedTests.length > 0, 'release workflow should run repository tests');
    for (const testPath of referencedTests) {
      assert.ok(fs.existsSync(path.join(repoRoot, testPath)), `missing workflow test: ${testPath}`);
    }
  });

  test(`${workflowPath} selects reviewed release notes from the validated release version`, () => {
    const verify = jobBlock(source, 'verify', 'lifecycle');

    assert.match(verify, /RELEASE_VERSION="\$\{RELEASE_TAG#v\}"/);
    assert.match(
      verify,
      /RELEASE_NOTES="docs\/releases\/\$\{RELEASE_VERSION\}\/release-notes\.md"/
    );
    assert.match(verify, /if \[ ! -f "\$RELEASE_NOTES" \]/);
    assert.match(verify, /cp "\$RELEASE_NOTES" release_body\.md/);
    assert.doesNotMatch(
      verify,
      /cp docs\/releases\/2\.2\.0\/release-notes\.md/,
      'release workflows must not reuse 2.2.0 notes for later versions'
    );
  });

  test(`${workflowPath} disables generated additions to reviewed release notes`, () => {
    const publish = jobBlock(source, 'publish');
    assert.match(
      publish,
      /body_path:\s*release_body\.md[\s\S]{0,160}generate_release_notes:\s*false/
    );
    assert.doesNotMatch(publish, /generate_release_notes:\s*(?:true|\$\{\{)/);
  });

  test(`${workflowPath} uploads the one packed tgz as the release artifact`, () => {
    const verify = jobBlock(source, 'verify', 'lifecycle');
    const packIndex = verify.indexOf('name: Pack npm artifact');
    const uploadIndex = verify.indexOf('name: Upload release artifacts');

    assert.ok(packIndex >= 0, 'missing pack step');
    assert.ok(uploadIndex > packIndex, 'artifact upload must happen after pack and hash');
    assert.match(verify, /name:\s*ecc-release-artifacts/);
    assert.match(verify, /\$\{\{ steps\.pack\.outputs\.package_file \}\}/);
    assert.match(verify, /tests\/ci\/packed-artifact-lifecycle\.js/);
  });

  test(`${workflowPath} fails retries when npm already has different bytes`, () => {
    const verify = jobBlock(source, 'verify', 'lifecycle');
    assert.match(verify, /name:\s*Verify existing npm artifact matches candidate/);
    assert.match(verify, /if:\s*steps\.npm_publish_state\.outputs\.already_published == 'true'/);
    assert.match(verify, /npm view "\$\{PACKAGE_NAME\}@\$\{PACKAGE_VERSION\}" dist\.integrity/);
    assert.match(verify, /createHash\(['"]sha512['"]\)/);
    assert.match(verify, /Existing npm artifact does not match tested candidate/);
  });

  test(`${workflowPath} verifies the same tgz on Node 20 across three operating systems`, () => {
    const lifecycle = jobBlock(source, 'lifecycle', 'publish');

    assert.match(lifecycle, /needs:\s*verify/);
    assert.match(lifecycle, /os:\s*\[ubuntu-latest, macos-latest, windows-latest\]/);
    assert.match(lifecycle, /runs-on:\s*\$\{\{ matrix\.os \}\}/);
    assert.match(lifecycle, /node-version:\s*['"]20\.x['"]/);
    assert.match(lifecycle, /uses:\s*actions\/download-artifact@/);
    assert.match(lifecycle, /name:\s*ecc-release-artifacts/);
    assert.match(lifecycle, /ECC_RELEASE_PACKAGE:\s*release-artifacts\/\$\{\{ needs\.verify\.outputs\.package_file \}\}/);
    assert.match(lifecycle, /ECC_RELEASE_SHA256:\s*\$\{\{ needs\.verify\.outputs\.package_sha256 \}\}/);
    assert.match(lifecycle, /node release-artifacts\/tests\/ci\/packed-artifact-lifecycle\.js/);
    assert.doesNotMatch(lifecycle, /actions\/checkout@/);
    assert.doesNotMatch(lifecycle, /\bsecrets\s*:/, 'lifecycle job must not receive secrets');
    assert.doesNotMatch(lifecycle, /\$\{\{\s*secrets\./, 'lifecycle job must not reference secrets');
  });

  test(`${workflowPath} blocks publishing on packed-artifact lifecycle success`, () => {
    const publish = jobBlock(source, 'publish');

    assert.match(publish, /needs:\s*\[verify, lifecycle\]/);
    assert.match(publish, /ECC_RELEASE_PACKAGE:\s*\$\{\{ needs\.verify\.outputs\.package_file \}\}/);
    assert.match(publish, /npm publish "\.\/\$\{ECC_RELEASE_PACKAGE\}"/);
    assert.match(publish, /name:\s*Verify artifact before publish/);
    assert.match(publish, /ECC_RELEASE_SHA256:\s*\$\{\{ needs\.verify\.outputs\.package_sha256 \}\}/);
    assert.match(publish, /createHash\(['"]sha256['"]\)/);
    assert.match(publish, /ecc-universal-\[0-9A-Za-z\.\+-\]/);
    assert.ok(
      publish.indexOf('name: Verify artifact before publish')
        < publish.indexOf('name: Create GitHub Release'),
      'publish must verify the independently downloaded archive before creating the release'
    );
  });
}

// Synthetic repository facts mirror the trusted workflow/attempt API contracts.
const releaseSha = 'a'.repeat(40);
const tagSha = 'b'.repeat(40);
const repository = 'affaan-m/ECC';
const inputs = { repository, releaseSha, releaseTag: 'v1.2.3', token: 'synthetic-token' };
const repoIdentity = { id: 1136590548, full_name: repository, default_branch: 'main' };
const requiredNames = ['Analyze (actions)', 'Analyze (javascript-typescript)', 'Analyze (python)'];
const workflows = [
  { id: 228254391, path: '.github/workflows/ci.yml', state: 'active' },
  { id: 292501745, path: 'dynamic/github-code-scanning/codeql', state: 'active' },
];
function fixture() {
  const runs = workflows.map((workflow, index) => ({
    id: 10 + index, workflow_id: workflow.id, path: workflow.path,
    head_sha: releaseSha, head_branch: 'main', event: index ? 'dynamic' : 'push',
    run_attempt: 1, check_suite_id: 100 + index, status: 'completed', conclusion: 'success',
    repository: { ...repoIdentity }, head_repository: { ...repoIdentity },
  }));
  const checks = requiredNames.map((name, index) => ({
    id: 200 + index, name, head_sha: releaseSha, status: 'completed', conclusion: 'success',
    check_suite: { id: 101 }, app: { id: 15368, slug: 'github-actions' },
  }));
  const jobs = checks.map(check => ({
    id: check.id, name: check.name, run_id: 11, run_attempt: 1,
    head_sha: releaseSha, head_branch: 'main', status: 'completed', conclusion: 'success',
    check_run_url: `https://api.github.com/repos/${repository}/check-runs/${check.id}`,
  }));
  return { runs, checks, jobs, workflows: structuredClone(workflows), repo: { ...repoIdentity } };
}
function withItem(data, collection, index, changes) {
  return {
    ...data,
    [collection]: data[collection].map((item, position) => position === index ? { ...item, ...changes } : item),
  };
}
function response(payload, link = null) {
  return { ok: true, status: 200, headers: { get: () => link }, json: async () => payload };
}
function fakeApi(data = fixture(), modify = () => null) {
  let calls = [];
  const fetchImpl = async (url, options) => {
    calls = [...calls, url];
    const replacement = modify(url, options, calls);
    if (replacement) return replacement;
    const pathname = new URL(url).pathname.replace(`/repos/${repository}`, '');
    if (pathname === '') return response(data.repo);
    if (pathname === '/actions/workflows') return response({ total_count: data.workflows.length, workflows: data.workflows });
    if (pathname === '/actions/runs') return response({ total_count: data.runs.length, workflow_runs: data.runs });
    if (pathname === '/actions/runs/11/attempts/1/jobs') return response({ total_count: data.jobs.length, jobs: data.jobs });
    if (pathname === '/check-suites/101/check-runs') return response({ total_count: data.checks.length, check_runs: data.checks });
    if (pathname === '/git/ref/tags/v1.2.3') return response({ ref: 'refs/tags/v1.2.3', object: { type: 'tag', sha: tagSha } });
    if (pathname === `/git/tags/${tagSha}`) return response({ sha: tagSha, tag: 'v1.2.3', object: { type: 'commit', sha: releaseSha }, verification: { verified: true, reason: 'valid' } });
    throw new Error(`Unexpected synthetic API path ${pathname}`);
  };
  return { fetchImpl, get calls() { return calls; } };
}
const once = { attempts: 1, timeoutMs: 1000, requestTimeoutMs: 100 };
async function gates(data, modify) {
  const api = fakeApi(data, modify);
  await waitForExactShaGates(inputs, api.fetchImpl, async () => {}, once);
  return api.calls;
}

test('pre-install verifier loads with built-ins only and still rejects malformed responses', async () => {
  const vm = require('node:vm');
  const { isBuiltin } = require('node:module');
  const exported = {};
  const localModule = { exports: exported };
  vm.runInNewContext(load('scripts/ci/verify-release-gates.js'), {
    module: localModule, exports: exported,
    require: name => { assert.ok(isBuiltin(name), `pre-install dependency: ${name}`); return require(name); },
    process: { env: {} }, URL, AbortController, setTimeout, clearTimeout, fetch: () => { throw new Error('Unexpected live fetch'); },
  });
  await assert.rejects(localModule.exports.verifySignedAnnotatedTag(inputs, async () => response({ object: { type: 'tag' } })), /validation|Invalid/);
  assert.strictEqual(await localModule.exports.verifySignedAnnotatedTag(inputs, fakeApi().fetchImpl), tagSha);
  await localModule.exports.waitForExactShaGates(inputs, fakeApi().fetchImpl, async () => {}, once);
});

test('complete trusted CI and default CodeQL categories pass without display-name trust', async () => {
  const data = { ...fixture(), runs: fixture().runs.map((run, index) => ({ ...run, name: index ? 'Push on main' : 'Renamed CI' })) };
  const calls = await gates(data);
  assert.ok(calls.some(url => url.includes('/attempts/1/jobs')));
  assert.ok(calls.some(url => url.includes('/check-suites/101/check-runs')));
});

const rejectedFixtures = [
  ['impostor CI workflow', d => withItem(d, 'runs', 0, { workflow_id: 999, name: 'CI' })],
  ['wrong workflow path', d => withItem(d, 'runs', 0, { path: '.github/workflows/spoof.yml' })],
  ['wrong CI event', d => withItem(d, 'runs', 0, { event: 'pull_request' })],
  ['wrong main branch', d => withItem(d, 'runs', 0, { head_branch: 'release/x' })],
  ['wrong run SHA', d => withItem(d, 'runs', 0, { head_sha: 'c'.repeat(40) })],
  ['foreign run repository', d => withItem(d, 'runs', 0, { repository: { ...d.runs[0].repository, id: 1 } })],
  ['foreign head repository', d => withItem(d, 'runs', 0, { head_repository: { ...d.runs[0].head_repository, full_name: 'impostor/ECC' } })],
  ['untrusted check app', d => withItem(d, 'checks', 0, { app: { ...d.checks[0].app, id: 1 } })],
  ['wrong app slug', d => withItem(d, 'checks', 0, { app: { ...d.checks[0].app, slug: 'spoof' } })],
  ['wrong check suite', d => withItem(d, 'checks', 0, { check_suite: { id: 999 } })],
  ['wrong check SHA', d => withItem(d, 'checks', 0, { head_sha: 'c'.repeat(40) })],
  ['missing required category', d => ({ ...d, jobs: d.jobs.slice(0, -1) })],
  ['missing bound check', d => ({ ...d, checks: d.checks.slice(0, -1) })],
  ['new pending category', d => ({ ...d, jobs: [...d.jobs, { ...d.jobs[0], id: 999, name: 'Analyze (ruby)', status: 'queued', conclusion: null }] })],
  ['ambiguous category jobs', d => ({ ...d, jobs: [...d.jobs, { ...d.jobs[0], id: 999 }] })],
  ['wrong attempt job', d => withItem(d, 'jobs', 0, { run_attempt: 2 })],
  ['wrong run job', d => withItem(d, 'jobs', 0, { run_id: 90 })],
  ['wrong job branch', d => withItem(d, 'jobs', 0, { head_branch: 'feature' })],
  ['foreign check URL', d => withItem(d, 'jobs', 0, { check_run_url: 'https://api.github.com/repos/spoof/ECC/check-runs/200' })],
  ['job name does not match bound check', d => withItem(d, 'checks', 0, { name: 'CodeQL' })],
  ['ambiguous workflow metadata', d => ({ ...d, workflows: [...d.workflows, { ...d.workflows[0], id: 999 }] })],
  ['inactive trusted workflow', d => withItem(d, 'workflows', 0, { state: 'disabled_manually' })],
];
for (const [name, change] of rejectedFixtures) {
  test(`release gate rejects ${name}`, async () => {
    const original = fixture();
    const snapshot = structuredClone(original);
    const data = change(original);
    assert.deepStrictEqual(original, snapshot, 'fixture variants must leave their input unchanged');
    await assert.rejects(gates(data));
  });
}

for (const conclusion of ['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required']) {
  test(`required trusted check ${conclusion} fails despite newer spoof success`, async () => {
    const base = withItem(fixture(), 'checks', 0, { conclusion });
    const data = { ...base, checks: [...base.checks, { ...base.checks[0], id: 999, conclusion: 'success', app: { id: 1, slug: 'spoof' } }] };
    await assert.rejects(gates(data), /concluded/);
  });
}

test('newer display-name impostor cannot replace a failed trusted CI run', async () => {
  const base = withItem(fixture(), 'runs', 0, { conclusion: 'failure' });
  const data = { ...base, runs: [...base.runs, { ...base.runs[0], id: 999, workflow_id: 999, name: 'CI', conclusion: 'success' }] };
  await assert.rejects(gates(data), /CI concluded failure/);
});

test('workflow IDs come from exact-path metadata and unrelated spoof results do not gate', async () => {
  const base = fixture();
  const data = {
    ...base,
    workflows: base.workflows.map((workflow, index) => ({ ...workflow, id: 900 + index })),
    runs: [...base.runs.map((run, index) => ({ ...run, workflow_id: 900 + index })), { ...base.runs[0], id: 999, workflow_id: 999, name: 'CI', conclusion: 'failure' }],
    checks: [...base.checks, { ...base.checks[0], id: 999, conclusion: 'failure', app: { id: 1, slug: 'spoof' } }],
  };
  await gates(data);
});

test('newer trusted pending run does not reuse older success', async () => {
  const base = fixture();
  const data = { ...base, runs: [...base.runs, { ...base.runs[1], id: 12, status: 'queued', conclusion: null }] };
  await assert.rejects(gates(data), /Timed out|deadline/);
});

test('newer trusted attempt cannot reuse previous attempt jobs', async () => {
  const data = withItem(fixture(), 'runs', 1, { run_attempt: 2 });
  await assert.rejects(gates(data, url => url.includes('/attempts/2/jobs') ? response({ total_count: 2, jobs: data.jobs.slice(0, 2).map(job => ({ ...job, run_attempt: 2 })) }) : null));
});

test('a new trusted run appearing during collection fails readiness', async () => {
  const data = fixture(); let runReads = 0;
  await assert.rejects(gates(data, url => {
    if (url.includes('/actions/runs?') && ++runReads === 2) {
      return response({ total_count: 3, workflow_runs: [...data.runs, { ...data.runs[1], id: 12, status: 'queued', conclusion: null }] });
    }
    return null;
  }), /Timed out|deadline/);
});

test('failure on a later check page cannot be hidden', async () => {
  const data = withItem(fixture(), 'checks', 2, { conclusion: 'failure' });
  await assert.rejects(gates(data, url => {
    if (!url.includes('/check-runs?')) return null;
    return url.includes('page=2')
      ? response({ total_count: 3, check_runs: data.checks.slice(2) })
      : response({ total_count: 3, check_runs: data.checks.slice(0, 2) }, `<${url}&page=2>; rel="next"`);
  }), /concluded failure/);
});

// Pending diagnostics must identify the blocked gate without changing its decision.
for (const [name, change, reason] of [
  ['missing CI', d => ({ ...d, runs: d.runs.slice(1) }), 'CI run not found for release SHA'],
  ['missing CodeQL', d => ({ ...d, runs: d.runs.slice(0, 1) }), 'CodeQL run not found for release SHA'],
  ['running CI', d => withItem(d, 'runs', 0, { status: 'in_progress', conclusion: null }), 'CI is in_progress'],
  ['queued CodeQL', d => withItem(d, 'runs', 1, { status: 'queued', conclusion: null }), 'CodeQL is queued'],
  ['missing job', d => ({ ...d, jobs: d.jobs.slice(0, 2) }), 'CodeQL job "Analyze (python)" missing from selected attempt'],
  ['missing check', d => ({ ...d, checks: d.checks.slice(0, 2) }), 'CodeQL check "Analyze (python)" missing or not bound to trusted job'],
  ['untrusted check', d => withItem(d, 'checks', 0, { app: { id: 1, slug: 'spoof' } }), 'CodeQL check "Analyze (actions)" missing or not bound to trusted job'],
  ['running job', d => withItem(d, 'jobs', 0, { status: 'in_progress', conclusion: null }), 'CodeQL job "Analyze (actions)" is in_progress'],
  ['queued check', d => withItem(d, 'checks', 0, { status: 'queued', conclusion: null }), 'CodeQL check "Analyze (actions)" is queued'],
]) {
  test(`attempt exhaustion diagnoses ${name}`, async () => {
    const original = fixture();
    const snapshot = structuredClone(original);
    await assert.rejects(gates(change(original)), error => {
      assert.match(error.message, /Timed out/);
      assert.ok(error.message.endsWith(`last pending gate: ${reason}`), error.message);
      assert.ok(!error.message.includes(inputs.token));
      return true;
    });
    assert.deepStrictEqual(original, snapshot);
  });
}

test('attempt exhaustion reports a superseded trusted run', async () => {
  const data = fixture(); let reads = 0;
  await assert.rejects(gates(data, url => url.includes('/actions/runs?') && ++reads === 2
    ? response({ total_count: 3, workflow_runs: [...data.runs, { ...data.runs[1], id: 12, status: 'queued', conclusion: null }] })
    : null), /last pending gate: Trusted CI or CodeQL run changed during verification$/);
});

test('global deadline reports the latest pending gate and preserves its cause', async () => {
  const data = withItem(fixture(), 'runs', 0, { status: 'queued', conclusion: null });
  let reads = 0; let clock = 0;
  const api = fakeApi(data, url => url.includes('/actions/runs?') && ++reads > 1
    ? response({ total_count: 1, workflow_runs: [{ ...data.runs[0], status: 'completed', conclusion: 'success' }] })
    : null);
  await assert.rejects(waitForExactShaGates(inputs, api.fetchImpl, async delay => { clock += delay; }, {
    attempts: 3, delayMs: 10, timeoutMs: 15, requestTimeoutMs: 10, now: () => clock,
  }), error => {
    assert.match(error.message, /deadline exceeded; last pending gate: CodeQL run not found for release SHA$/);
    assert.match(error.cause.message, /deadline exceeded$/);
    return true;
  });
  assert.strictEqual(reads, 2);
});

test('request deadline before assessment reports that no gate was assessed', async () => {
  let signal;
  await assert.rejects(waitForExactShaGates(inputs, async (_url, options) => {
    signal = options.signal;
    return { ...response(null), json: () => new Promise(() => {}) };
  }, async () => {}, { ...once, requestTimeoutMs: 5 }), /deadline exceeded; last pending gate: no gate assessment completed$/);
  assert.strictEqual(signal.aborted, true);
});

test('non-deadline errors retain identity even when their message mentions deadline', async () => {
  const failure = new Error('synthetic deadline text is not a timeout classification');
  await assert.rejects(gates(fixture(), () => { throw failure; }), error => error === failure);
});

test('API requests reject redirects and carry abort signals without dependency loading', async () => {
  const api = fakeApi(fixture(), (_url, options) => {
    assert.strictEqual(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return null;
  });
  await verifySignedAnnotatedTag(inputs, api.fetchImpl);
});

test('release input and retry bounds reject unsafe or unbounded values', () => {
  const env = { GITHUB_REPOSITORY: repository, RELEASE_SHA: releaseSha, RELEASE_TAG: 'v1.2.3', GITHUB_TOKEN: inputs.token };
  assert.strictEqual(requiredEnvironment(env).releaseSha, releaseSha);
  for (const change of [
    { GITHUB_REPOSITORY: '../ECC' }, { RELEASE_SHA: 'short' },
    { RELEASE_TAG: 'v1.2.3\nextra' }, { GITHUB_TOKEN: '' }, { RELEASE_TAG_OBJECT_SHA: 'bad' },
  ]) assert.throws(() => requiredEnvironment({ ...env, ...change }));
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 600001 }, { requestTimeoutMs: 15001 }]) {
    assert.throws(() => createGithubClient(inputs, fakeApi().fetchImpl, options), /limits/);
  }
});

test('an aborted global deadline covers a stalled retry sleep', async () => {
  const data = withItem(fixture(), 'runs', 0, { status: 'queued', conclusion: null });
  let signal;
  await assert.rejects(waitForExactShaGates(inputs, fakeApi(data).fetchImpl, (_delay, provided) => {
    signal = provided;
    assert.ok(signal instanceof AbortSignal, 'abort signal required');
    return new Promise(() => {});
  }, { attempts: 2, timeoutMs: 20, requestTimeoutMs: 10 }), /deadline exceeded; last pending gate: CI is queued$/);
  assert.strictEqual(signal.aborted, true);
});

test('signed annotated tag binds full ref, object SHA, name and direct commit', async () => {
  assert.strictEqual(await verifySignedAnnotatedTag(inputs, fakeApi().fetchImpl), tagSha);
});
for (const [name, pathPart, change] of [
  ['different ref', '/git/ref/', p => ({ ...p, ref: 'refs/tags/v0.0.0' })],
  ['lightweight tag', '/git/ref/', p => ({ ...p, object: { ...p.object, type: 'commit' } })],
  ['malformed object SHA', '/git/ref/', p => ({ ...p, object: { ...p.object, sha: 'bad' } })],
  ['wrong signed name', '/git/tags/', p => ({ ...p, tag: 'v0.0.0' })],
  ['wrong returned object SHA', '/git/tags/', p => ({ ...p, sha: 'c'.repeat(40) })],
  ['unverified signature', '/git/tags/', p => ({ ...p, verification: { ...p.verification, verified: false } })],
  ['invalid verification reason', '/git/tags/', p => ({ ...p, verification: { ...p.verification, reason: 'unsigned' } })],
  ['nested tag', '/git/tags/', p => ({ ...p, object: { ...p.object, type: 'tag' } })],
  ['wrong target commit', '/git/tags/', p => ({ ...p, object: { ...p.object, sha: 'c'.repeat(40) } })],
]) {
  test(`signed tag rejects ${name}`, async () => {
    const base = fakeApi();
    let observed = [];
    await assert.rejects(verifySignedAnnotatedTag(inputs, async (url, options) => {
      const result = await base.fetchImpl(url, options);
      const payload = await result.json();
      const snapshot = structuredClone(payload);
      const changed = url.includes(pathPart) ? change(payload) : payload;
      observed = [...observed, { payload, snapshot }];
      return response(changed);
    }));
    for (const { payload, snapshot } of observed) {
      assert.deepStrictEqual(payload, snapshot, 'tag variants must leave their input unchanged');
    }
  });
}

test('final tag-only recheck requires the original verified object SHA', async () => {
  await assert.rejects(verifySignedAnnotatedTag({ ...inputs, tagObjectSha: 'c'.repeat(40) }, fakeApi().fetchImpl), /changed/);
  const api = fakeApi();
  assert.strictEqual(await verifySignedAnnotatedTag({ ...inputs, tagObjectSha: tagSha }, api.fetchImpl), tagSha);
  assert.strictEqual(api.calls.length, 2);
});

for (const [name, link] of [
  ['self loop', url => `<${url}>; rel="next"`],
  ['foreign host', () => '<https://evil.invalid/repos/affaan-m/ECC/actions/workflows?page=2>; rel="next"'],
  ['foreign repository', () => '<https://api.github.com/repos/other/ECC/actions/workflows?page=2>; rel="next"'],
  ['foreign endpoint', () => '<https://api.github.com/repos/affaan-m/ECC/actions/runs?per_page=100&page=2>; rel="next"'],
  ['changed query', url => `<${url.replace('per_page=100', 'per_page=1')}&page=2>; rel="next"`],
  ['malformed next', () => 'not-a-link; rel="next"'],
  ['duplicate next', url => `<${url}&page=2>; rel="next", <${url}&page=3>; rel="next"`],
]) {
  test(`API pagination rejects ${name}`, async () => {
    let requests = 0;
    await assert.rejects(gates(fixture(), url => {
      if (!url.includes('/actions/workflows?')) return null;
      requests += 1;
      assert.ok(requests <= 2, 'pagination must terminate');
      return response({ total_count: 2, workflows }, link(url));
    }));
    assert.ok(requests <= 2);
  });
}

test('API pagination rejects two-page cycles and incomplete totals', async () => {
  const first = `https://api.github.com/repos/${repository}/actions/workflows?per_page=100`;
  await assert.rejects(gates(fixture(), url => url.includes('/actions/workflows?')
    ? response({ total_count: 4, workflows: url.includes('page=2') ? workflows.map(workflow => ({ ...workflow, id: workflow.id + 2 })) : workflows }, `<${url.includes('page=2') ? first : first + '&page=2'}>; rel="next"`) : null), /cycle/);
  await assert.rejects(gates(fixture(), url => url.includes('/actions/workflows?')
    ? response({ total_count: 3, workflows }) : null), /complete|total/);
});

test('API page and item caps fail closed', async () => {
  await assert.rejects(gates(fixture(), url => url.includes('/actions/workflows?')
    ? response({ total_count: 1001, workflows }) : null), /cap|limit/);
  await assert.rejects(gates(fixture(), url => url.includes('/actions/workflows?')
    ? response({ total_count: 101, workflows: Array.from({ length: 101 }, (_, id) => ({ ...workflows[0], id: id + 1 })) }) : null), /cap|limit/);
  let page = 0;
  await assert.rejects(gates(fixture(), url => url.includes('/actions/workflows?')
    ? response({ total_count: 20, workflows: [{ ...workflows[0], id: ++page }] }, `<https://api.github.com/repos/${repository}/actions/workflows?per_page=100&page=${page + 1}>; rel="next"`) : null), /cap|limit/);
  assert.ok(page <= 10);
});

for (const status of [403, 500]) {
  test(`API ${status} fails without leaking the token`, async () => {
    await assert.rejects(gates(fixture(), () => ({ ok: false, status })), error => {
      assert.match(error.message, new RegExp(String(status)));
      assert.ok(!error.message.includes(inputs.token)); return true;
    });
  });
}

test('invalid JSON and malformed collection shapes fail closed', async () => {
  await assert.rejects(gates(fixture(), () => ({ ...response(null), json: async () => { throw new Error('invalid JSON'); } })), /JSON/);
  await assert.rejects(gates(fixture(), url => url.includes('/actions/workflows?') ? response({ workflows: 'wrong', total_count: 2 }) : null), /validation|Invalid/);
});

test('stalled headers and response bodies are aborted by the request deadline', async () => {
  for (const body of [false, true]) {
    let signal;
    const never = () => new Promise(() => {});
    await assert.rejects(verifySignedAnnotatedTag(inputs, async (_url, options) => {
      signal = options.signal;
      assert.ok(signal instanceof AbortSignal, 'abort signal required');
      return body ? { ...response(null), json: never } : never();
    }, { timeoutMs: 100, requestTimeoutMs: 5 }), /deadline|timed out/);
    assert.strictEqual(signal.aborted, true);
  }
});

test('global deadline includes retries and prevents further requests', async () => {
  const data = withItem(fixture(), 'runs', 0, { status: 'queued', conclusion: null });
  let clock = 0; let sleeps = 0;
  await assert.rejects(waitForExactShaGates(inputs, fakeApi(data).fetchImpl, async delay => { clock += delay; sleeps += 1; }, {
    attempts: 5, delayMs: 10, timeoutMs: 15, requestTimeoutMs: 10, now: () => clock,
  }), /deadline/);
  assert.strictEqual(sleeps, 2);
});

for (const workflowPath of workflowPaths) {
  test(`${workflowPath} rechecks captured tag identity immediately before publication`, () => {
    const workflow = yaml.load(load(workflowPath));
    const verify = workflow.jobs.verify;
    assert.strictEqual(verify.outputs.release_sha, '${{ steps.release_gate.outputs.release_sha }}');
    assert.strictEqual(verify.outputs.tag_object_sha, '${{ steps.release_gate.outputs.tag_object_sha }}');
    assert.strictEqual(verify.steps.find(step => step.name === 'Verify signed tag and exact-SHA CI gates').id, 'release_gate');
    const publish = workflow.jobs.publish;
    assert.deepStrictEqual(publish.permissions, { contents: 'write', 'id-token': 'write' });
    const checkout = publish.steps.find(step => step.uses?.startsWith('actions/checkout@'));
    assert.strictEqual(checkout.with.ref, workflowPath === '.github/workflows/release.yml'
      ? '${{ github.sha }}' : '${{ needs.verify.outputs.release_sha }}');
    assert.strictEqual(checkout.with['persist-credentials'], false);
    assert.strictEqual(checkout.with.path, 'release-gate-source');
    const index = publish.steps.findIndex(step => step.name === 'Recheck verified tag before publish');
    assert.ok(index > 0);
    assert.strictEqual(publish.steps[index + 1].name, 'Publish npm package');
    const gate = publish.steps[index];
    assert.strictEqual(gate.env.RELEASE_SHA, '${{ needs.verify.outputs.release_sha }}');
    assert.strictEqual(gate.env.RELEASE_TAG_OBJECT_SHA, '${{ needs.verify.outputs.tag_object_sha }}');
    assert.match(gate.run, /^node release-gate-source\/scripts\/ci\/verify-release-gates\.js --tag-only$/);
    assert.doesNotMatch(JSON.stringify(publish), /npm ci|npm install|actions:read|checks:read/);
  });
}

test('tag-push publish binds its event checkout to the verified release before loading code', () => {
  const workflow = yaml.load(load('.github/workflows/release.yml'));
  assert.deepStrictEqual(workflow.on, { push: { tags: ['v*'] } });
  const steps = workflow.jobs.publish.steps;
  const binding = steps.findIndex(step => step.name === 'Bind gate source to triggering commit');
  const checkout = steps.findIndex(step => step.name === 'Checkout verified gate source');
  assert.ok(binding >= 0 && binding < checkout);
  assert.strictEqual(steps[binding].if, undefined, 'binding must fail the job rather than silently skip');
  assert.strictEqual(steps[checkout].if, undefined);
  assert.deepStrictEqual(steps[binding].env, {
    EVENT_SHA: '${{ github.sha }}',
    VERIFIED_RELEASE_SHA: '${{ needs.verify.outputs.release_sha }}',
  });
  const program = /^node -e "([^\n"]+)"$/.exec(steps[binding].run);
  assert.ok(program, 'binding must be a fixed environment-only Node check');
  const execute = env => vm.runInNewContext(program[1], { process: { env: Object.freeze(env) } }, { timeout: 100 });
  assert.doesNotThrow(() => execute({ EVENT_SHA: releaseSha, VERIFIED_RELEASE_SHA: releaseSha }));
  for (const env of [
    {},
    { EVENT_SHA: releaseSha },
    { VERIFIED_RELEASE_SHA: releaseSha },
    { EVENT_SHA: releaseSha, VERIFIED_RELEASE_SHA: 'b'.repeat(40) },
    { EVENT_SHA: 'invalid', VERIFIED_RELEASE_SHA: 'invalid' },
    { EVENT_SHA: releaseSha + '\n', VERIFIED_RELEASE_SHA: releaseSha + '\n' },
  ]) assert.throws(() => execute(env), /Verified release differs from triggering commit/);
});

test('reusable release requires its input to resolve through the tag namespace', () => {
  const source = load('.github/workflows/reusable-release.yml');
  const verify = jobBlock(source, 'verify', 'lifecycle');
  assert.match(verify, /ref:\s*refs\/tags\/\$\{\{ inputs\.tag \}\}/);
});

test('pull-request CI packs once and exports the exact installer artifact identity', () => {
  const source = load('.github/workflows/ci.yml');
  const pack = jobBlock(source, 'pack-installer', 'packed-install-lifecycle');
  assert.strictEqual((pack.match(/npm pack --json/g) || []).length, 1);
  assert.match(pack, /package_file:\s*\$\{\{ steps\.pack\.outputs\.package_file \}\}/);
  assert.match(pack, /package_sha256:\s*\$\{\{ steps\.pack\.outputs\.package_sha256 \}\}/);
  assert.match(pack, /createHash\(['"]sha256['"]\)/);
  assert.match(pack, /name:\s*ecc-ci-installer-artifact/);
});

test('pull-request CI runs the same packed installer on Linux, macOS, and Windows', () => {
  const source = load('.github/workflows/ci.yml');
  const lifecycle = jobBlock(source, 'packed-install-lifecycle', 'validate');
  assert.match(lifecycle, /needs:\s*pack-installer/);
  assert.match(lifecycle, /os:\s*\[ubuntu-latest, macos-latest, windows-latest\]/);
  assert.match(lifecycle, /node-version:\s*['"]20\.x['"]/);
  assert.match(lifecycle, /name:\s*ecc-ci-installer-artifact/);
  assert.match(lifecycle, /ECC_RELEASE_PACKAGE:\s*release-artifacts\/\$\{\{ needs\.pack-installer\.outputs\.package_file \}\}/);
  assert.match(lifecycle, /ECC_RELEASE_SHA256:\s*\$\{\{ needs\.pack-installer\.outputs\.package_sha256 \}\}/);
  assert.match(lifecycle, /node tests\/ci\/packed-artifact-lifecycle\.js/);
  assert.doesNotMatch(lifecycle, /\$\{\{\s*secrets\./);
});

test('packed lifecycle invokes installed public bins, including setup help', () => {
  assert.match(lifecycleRunnerSource, /getNpmExecInvocation/);
  assert.match(lifecycleRunnerSource, /\['ecc-universal', 'setup', '--help'\]/);
  assert.match(lifecycleRunnerSource, /\['ecc', \.\.\.args\]/);
  assert.doesNotMatch(lifecycleRunnerSource, /node_modules.*scripts.*ecc\.js/);
});

test('packed lifecycle applies and updates README-primary Claude setup with a fake provider', () => {
  assert.match(lifecycleRunnerSource, /createFakeClaudeExecutable/);
  assert.match(
    lifecycleRunnerSource,
    /const claudeSetupArgs = \[\s*'ecc-universal', 'setup',\s*'--mode', 'claude-plugin',\s*'--scope', 'user',\s*\]/
  );
  assert.match(
    lifecycleRunnerSource,
    /runPublicCli\(\s*\[\.\.\.claudeSetupArgs, '--hooks', 'standard', '--dry-run', '--json'\]/
  );
  assert.match(lifecycleRunnerSource, /Claude setup dry-run must not mutate setup state/);
  assert.match(lifecycleRunnerSource, /runProcess\('git', \['--version'\]/);
  assert.match(lifecycleRunnerSource, /runPackedClaudeSetup\('standard'\)/);
  assert.match(lifecycleRunnerSource, /runPackedClaudeSetup\('strict'\)/);
  assert.match(lifecycleRunnerSource, /CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(lifecycleRunnerSource, /plugin marketplace add/);
  assert.match(lifecycleRunnerSource, /plugin update ecc@ecc/);
});

test('packed lifecycle mutates through the fully explicit guided Kimi install', () => {
  assert.match(
    lifecycleRunnerSource,
    /const guidedKimiInstallArgs = \[\s*'ecc-universal', 'install', '--guided',\s*'--harness', 'kimi',\s*'--profile', 'core',\s*\]/
  );
  assert.match(
    lifecycleRunnerSource,
    /runPublicCli\(\[\.\.\.guidedKimiInstallArgs, '--dry-run', '--json'\]\)/
  );
  assert.match(
    lifecycleRunnerSource,
    /runPublicCli\(\[\.\.\.guidedKimiInstallArgs, '--yes', '--json'\]\)/
  );
  assert.strictEqual(
    (lifecycleRunnerSource.match(/runGuidedKimiInstall\(\)/g) || []).length,
    2,
    'guided Kimi apply must run once initially and once as an idempotency check'
  );
  assert.match(
    lifecycleRunnerSource,
    /runPublicCli\(\['ecc', 'doctor', '--target', 'kimi', '--json'\]\)/
  );
  assert.match(
    lifecycleRunnerSource,
    /runPublicCli\(\['ecc', 'uninstall', '--target', 'kimi', '--json'\]\)/
  );
  assert.match(lifecycleRunnerSource, /guidedKimiSentinel/);
  assert.match(lifecycleRunnerSource, /dry-run must not mutate the Kimi target/);
  for (const credentialName of ['ANTHROPIC_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY']) {
    assert.match(lifecycleRunnerSource, new RegExp(credentialName));
  }
});

test('packed lifecycle validates canonical Antigravity and OpenCode installs', () => {
  assert.match(lifecycleRunnerSource, /target:\s*'antigravity'/);
  assert.match(lifecycleRunnerSource, /path\.join\(projectDir, '\.agents'\)/);
  assert.match(lifecycleRunnerSource, /target:\s*'opencode'/);
  assert.match(lifecycleRunnerSource, /path\.join\(homeDir, '\.config', 'opencode'\)/);
  assert.match(lifecycleRunnerSource, /\['doctor', '--target', options\.target, '--json'\]/);
  assert.match(lifecycleRunnerSource, /skill-comply[\s\S]*SKILL\.md/);
  assert.match(lifecycleRunnerSource, /!fs\.existsSync\(installedSkillPath\)/);
});

test('packed lifecycle installs and verifies the opt-in Ito distribution surface', () => {
  assert.match(
    lifecycleRunnerSource,
    /'--profile', 'core'[\s\S]*'--with', 'capability:ito-compute'[\s\S]*'--with', 'capability:prediction-markets'/
  );
  for (const moduleId of ['ito-compute', 'prediction-market-skills']) {
    assert.match(lifecycleRunnerSource, new RegExp(`moduleId === '${moduleId}'`));
  }
  for (const installedPath of [
    'skills/ito-baskets/SKILL.md',
    'skills/ito-baskets/agents/openai.yaml',
    'skills/ito-baskets/scripts/ito-baskets.js',
    'skills/ito-compute/SKILL.md',
    'skills/ito-compute/agents/openai.yaml',
    'skills/ito-inference/SKILL.md',
    'skills/ito-training/SKILL.md',
  ]) {
    assert.match(lifecycleRunnerSource, new RegExp(installedPath.replaceAll('.', '\\.')));
  }
  assert.match(lifecycleRunnerSource, /\['ito', 'status'\]/);
  assert.match(lifecycleRunnerSource, /canonical ito-compute-cli is unpublished/i);
  assert.match(lifecycleRunnerSource, /npx\|npm exec\|npm link\|install -g/i);
  assert.match(lifecycleRunnerSource, /installedStat\.isFile\(\)/);
  assert.match(lifecycleRunnerSource, /installedStat\.size > 0/);
  assert.match(lifecycleRunnerSource, /hostileItoSentinel/);
  assert.match(lifecycleRunnerSource, /must-not-reach-hostile-path/);
  assert.match(lifecycleRunnerSource, /packed Itô bridge executed a PATH collision/);
});

pendingTests.then(() => {
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
});
