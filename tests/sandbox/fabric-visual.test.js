'use strict';

const assert = require('assert');

const { contractDigest } = require('../../scripts/sandbox/contracts');

const {
  normalizeVisualEvidence,
  verifyVisualEvidence,
} = require('../../scripts/sandbox/fabric/visual-evidence');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

function input(overrides = {}) {
  return {
    run_id: `run_${'a'.repeat(32)}`,
    verification: true,
    exploration: false,
    captured_at: '2026-08-25T12:00:00.000Z',
    transcript: [
      { seq: 1, action: 'click', target: 'button#save', x: 640, y: 360 },
      { seq: 2, action: 'keypress', key: 'Enter' },
      { seq: 3, action: 'screenshot', label: 'saved-state' },
    ],
    display: { width: 1280, height: 720, scale: 1 },
    environment: {
      os: 'macos',
      arch: 'arm64',
      backend: 'lume',
      tier: 2,
      identity_sha256: 'b'.repeat(64),
    },
    screenshots: [{
      action_seq: 3,
      path: 'screenshots/saved-state.png',
      bytes: 4096,
      sha256: 'c'.repeat(64),
      width: 1280,
      height: 720,
    }],
    cleanup: { pass: true, resources_remaining: 0 },
    ...overrides,
  };
}

console.log('\n=== ECC deterministic visual evidence tests ===\n');

test('normalizes fixed visual verification into a deterministic hash-bound record', () => {
  const first = normalizeVisualEvidence(input());
  const second = normalizeVisualEvidence(input());

  assert.deepStrictEqual(first, second);
  assert.strictEqual(first.schema_version, 1);
  assert.strictEqual(first.kind, 'ecc.sandbox.visual-evidence');
  assert.strictEqual(first.verification_eligible, true);
  assert.match(first.transcript_sha256, /^[a-f0-9]{64}$/);
  assert.match(first.screenshots_sha256, /^[a-f0-9]{64}$/);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.strictEqual(first.environment.identity_sha256, 'b'.repeat(64));
  assert.strictEqual(first.screenshots[0].sha256, 'c'.repeat(64));
  assert.strictEqual(verifyVisualEvidence(first), true);
});

test('binds resolution, environment identity, transcript, screenshots, and cleanup to the digest', () => {
  const baseline = normalizeVisualEvidence(input());
  const variants = [
    input({
      display: { width: 1440, height: 900, scale: 1 },
      screenshots: [{ ...input().screenshots[0], width: 1440, height: 900 }],
    }),
    input({ environment: { ...input().environment, identity_sha256: 'd'.repeat(64) } }),
    input({ transcript: [
      { seq: 1, action: 'click', target: 'button#cancel', x: 640, y: 360 },
      { seq: 2, action: 'keypress', key: 'Enter' },
      { seq: 3, action: 'screenshot', label: 'saved-state' },
    ] }),
    input({ screenshots: [{ ...input().screenshots[0], sha256: 'e'.repeat(64) }] }),
    input({ cleanup: { pass: false, resources_remaining: 1 } }),
  ];

  for (const variant of variants) {
    assert.notStrictEqual(normalizeVisualEvidence(variant).sha256, baseline.sha256);
  }
});

test('rejects exploration output as verification evidence', () => {
  assert.throws(
    () => normalizeVisualEvidence(input({ exploration: true })),
    /exploration.*verification evidence/i
  );
  assert.throws(
    () => normalizeVisualEvidence(input({ verification: false })),
    /verification channel/i
  );
});

test('requires a fixed contiguous action transcript and forbids raw typed text', () => {
  assert.throws(
    () => normalizeVisualEvidence(input({ transcript: [{ seq: 2, action: 'click', target: '#save', x: 1, y: 1 }] })),
    /contiguous.*1/i
  );
  assert.throws(
    () => normalizeVisualEvidence(input({ transcript: [{ seq: 1, action: 'shell', target: 'rm' }] })),
    /unsupported visual action/i
  );
  assert.throws(
    () => normalizeVisualEvidence(input({ transcript: [{ seq: 1, action: 'text', text: 'secret value' }] })),
    /raw typed text/i
  );
  const hashedText = normalizeVisualEvidence(input({
    transcript: [
      { seq: 1, action: 'text', target: '#query', text_sha256: 'f'.repeat(64) },
      { seq: 2, action: 'screenshot', label: 'query-result' },
    ],
    screenshots: [{ ...input().screenshots[0], action_seq: 2 }],
  }));
  assert.strictEqual(hashedText.transcript[0].text_sha256, 'f'.repeat(64));
});

test('rejects unbound or malformed screenshots and environment receipts', () => {
  assert.throws(
    () => normalizeVisualEvidence(input({ screenshots: [{ ...input().screenshots[0], action_seq: 2 }] })),
    /screenshot action/i
  );
  assert.throws(
    () => normalizeVisualEvidence(input({ screenshots: [{ ...input().screenshots[0], width: 800 }] })),
    /display resolution/i
  );
  assert.throws(
    () => normalizeVisualEvidence(input({ screenshots: [{ ...input().screenshots[0], sha256: 'bad' }] })),
    /screenshot.*sha256/i
  );
  assert.throws(
    () => normalizeVisualEvidence(input({ environment: { ...input().environment, identity_sha256: 'bad' } })),
    /environment.*identity_sha256/i
  );
  assert.throws(
    () => normalizeVisualEvidence(input({
      transcript: [
        ...input().transcript,
        { seq: 4, action: 'screenshot', label: 'missing-artifact' },
      ],
    })),
    /every screenshot action/i
  );
  assert.throws(
    () => normalizeVisualEvidence(input({
      screenshots: [input().screenshots[0], {
        ...input().screenshots[0],
        path: 'screenshots/duplicate-action.png',
        sha256: 'd'.repeat(64),
      }],
    })),
    /duplicate screenshot action/i
  );
});

test('marks failed cleanup inconclusive and detects record tampering', () => {
  const evidence = normalizeVisualEvidence(input({ cleanup: { pass: false, resources_remaining: 1 } }));
  assert.strictEqual(evidence.verification_eligible, false);
  assert.deepStrictEqual(evidence.blockers, [
    'visual verification cleanup did not pass',
    'visual verification left 1 resources',
  ]);
  assert.strictEqual(verifyVisualEvidence({
    ...evidence,
    display: { ...evidence.display, width: 1920 },
  }), false);
});

test('semantic verification rejects exploration records with a recomputed digest', () => {
  const evidence = normalizeVisualEvidence(input());
  const invalidPayload = { ...evidence, source: 'exploration' };
  delete invalidPayload.sha256;
  assert.strictEqual(verifyVisualEvidence({
    ...invalidPayload,
    sha256: contractDigest(invalidPayload),
  }), false);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
