'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const script = path.resolve(__dirname, '../../skills/frontend-design-direction/scripts/check-evidence.js');
const { checkEvidence } = require(script);

function report() {
  const observation = { status: 'pass', evidence: 'Observed in the local test run.' };
  return {
    contract: 'Settings: account owner can save changes and recover from failure.',
    targetViewports: ['390x844'],
    accessibility: { ...observation },
    responsive: { ...observation },
    contentStates: Object.fromEntries(['loading', 'empty', 'error', 'partial', 'success', 'permission']
      .map(state => [state, { ...observation }])),
    renderedEvidence: [{ viewport: '390x844', artifact: 'render.png', observation: 'Save action remains visible.' }]
  };
}

test('requires observed accessibility, responsive behavior and every content state', () => {
  const evidence = report();
  assert.deepEqual(checkEvidence(evidence), []);
  for (const key of ['contract', 'targetViewports', 'accessibility', 'responsive', 'contentStates', 'renderedEvidence']) {
    const missing = { ...evidence };
    delete missing[key];
    assert.ok(checkEvidence(missing).length, `accepted missing ${key}`);
  }
  for (const state of Object.keys(evidence.contentStates)) {
    const missing = { ...evidence, contentStates: { ...evidence.contentStates } };
    delete missing.contentStates[state];
    assert.ok(checkEvidence(missing).length, `accepted missing ${state}`);
  }
  for (const status of ['fail', 'untested', 'blocked', 'pass ']) {
    assert.ok(checkEvidence({ ...evidence, accessibility: { status, evidence: 'Unresolved.' } }).length);
  }
  assert.ok(checkEvidence({ ...evidence, responsive: { status: 'pass', evidence: ' ' } }).length);
});

test('requires rendered evidence for every declared target viewport', () => {
  const evidence = { ...report(), targetViewports: ['390x844', '1440x900'] };
  assert.ok(checkEvidence(evidence).length, 'mobile alone must not satisfy a desktop target');
  const desktop = { viewport: '1440x900', artifact: 'desktop.png', observation: 'Long labels fit.' };
  assert.deepEqual(checkEvidence({ ...evidence, renderedEvidence: [...evidence.renderedEvidence, desktop] }), []);
  for (const targetViewports of [[], '390x844', [' '], [null], ['390x844', 1440]]) {
    assert.ok(checkEvidence({ ...report(), targetViewports }).length, 'invalid targets must fail');
  }
});

test('normalizes viewport case and whitespace, deduplicates missing coverage, and preserves input', () => {
  const evidence = {
    ...report(),
    targetViewports: [' 390 X 844 PX ', '390x844px', '1440 X 900 PX'],
    renderedEvidence: [
      { viewport: '390x844PX', artifact: 'render.png', observation: 'Mobile layout fits.' },
      { viewport: ' 1440x900px ', artifact: 'desktop.png', observation: 'Desktop layout fits.' },
    ],
  };
  const before = JSON.parse(JSON.stringify(evidence));

  assert.deepEqual(checkEvidence(evidence), []);
  assert.deepEqual(evidence, before, 'viewport validation must not mutate the report');

  const missing = {
    ...evidence,
    renderedEvidence: [],
  };
  const missingErrors = checkEvidence(missing).filter(error => error.includes('missing target viewport'));
  assert.equal(missingErrors.length, 2, 'missing coverage should report one error per normalized target');
  assert.deepEqual(evidence, before, 'coverage checks must not mutate the report');

  for (const [targetViewport, renderedViewport] of [
    ['mobile-375', '375px'],
    ['375', '375px'],
  ]) {
    const aliases = {
      ...report(),
      targetViewports: [targetViewport],
      renderedEvidence: [{ viewport: renderedViewport, artifact: 'render.png', observation: 'Checked.' }],
    };
    assert.ok(
      checkEvidence(aliases).some(error => error.includes('missing target viewport')),
      `${targetViewport} must not alias ${renderedViewport}`
    );
  }
});

test('only content states may be not applicable with a reason', () => {
  const evidence = report();
  const contentStates = { ...evidence.contentStates, permission: { status: 'not-applicable', reason: 'Public view without restricted actions.' } };
  assert.deepEqual(checkEvidence({ ...evidence, contentStates }), []);
  assert.ok(checkEvidence({ ...evidence, contentStates: { ...contentStates, permission: { status: 'not-applicable' } } }).length);
  assert.ok(checkEvidence({ ...evidence, accessibility: contentStates.permission }).length);
});

test('rejects malformed reports and rendered evidence without inspection details', () => {
  for (const value of [null, [], false, 'passed', {}]) assert.ok(checkEvidence(value).length);
  for (const value of [[], [{}], [null], [{ viewport: '390x844', artifact: 'render.png' }]]) {
    assert.ok(checkEvidence({ ...report(), renderedEvidence: value }).length);
  }
});

test('CLI requires a nonempty local artifact and fails safely on invalid input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ui-evidence-'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ui-external-'));
  const input = path.join(dir, 'report.json');
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  try {
    fs.writeFileSync(input, JSON.stringify(report()));
    assert.equal(run(input).status, 1, 'missing artifact must fail');
    fs.writeFileSync(path.join(dir, 'render.png'), 'synthetic artifact fixture');
    assert.equal(run(input).status, 0);
    fs.writeFileSync(path.join(dir, 'render.png'), '');
    assert.equal(run(input).status, 1, 'empty artifact must fail');
    fs.writeFileSync(path.join(dir, 'render.png'), 'nonempty local artifact');
    fs.writeFileSync(path.join(external, 'render.png'), 'nonempty external artifact');
    fs.symlinkSync(path.join(dir, 'render.png'), path.join(dir, 'linked.png'));
    fs.symlinkSync(path.join(external, 'render.png'), path.join(dir, 'outside'));
    fs.symlinkSync(external, path.join(dir, 'external-dir'), 'junction');
    for (const artifact of ['.', 'https://example.com/render.png', path.join(dir, 'render.png'),
      '../render.png', 'C:\\render.png', 'linked.png', 'outside', 'external-dir/render.png']) {
      fs.writeFileSync(input, JSON.stringify({ ...report(), renderedEvidence: [{ viewport: '390x844', artifact, observation: 'Checked.' }] }));
      assert.equal(run(input).status, 1, 'directories and remote artifacts must fail');
    }
    fs.writeFileSync(input, JSON.stringify({ ...report(), accessibility: { status: 'untested' } }));
    assert.equal(run(input).status, 1, 'CLI must reject an incomplete gate');
    fs.writeFileSync(input, '{"private": "sensitive-test-marker"');
    const invalid = run(input);
    assert.equal(invalid.status, 1);
    assert.ok(!invalid.stderr.includes('sensitive-test-marker'));
    assert.equal(run().status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});
