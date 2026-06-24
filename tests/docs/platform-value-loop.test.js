'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

console.log('\n=== Testing ECC platform value loop docs ===\n');

test('platform value loop doc defines the three-layer ECC 2.0 direction', () => {
  const source = read('docs/architecture/platform-value-loop.md');

  for (const marker of [
    'Meta-harness',
    'Dedicated ECC agent',
    'Control pane / agentic IDE',
    'reproducible demo',
    'ECC can be used full-stack as a meta-harness + agent + control pane',
  ]) {
    assert.ok(source.includes(marker), `platform value loop doc missing ${marker}`);
  }
});

test('platform value loop doc records the OSS-to-managed value thesis', () => {
  const source = read('docs/architecture/platform-value-loop.md');

  for (const marker of [
    'open-source infrastructure playbook',
    'team memory and session routing',
    'managed evals, release gates, and evidence packs',
    'security review, supply-chain findings, and policy enforcement',
    'sponsors',
    'Pro interest',
    'consulting leads',
  ]) {
    assert.ok(source.includes(marker), `platform value loop doc missing value marker ${marker}`);
  }
});

test('product integration contract keeps external products useful but separate', () => {
  const source = read('docs/architecture/platform-value-loop.md');

  for (const marker of [
    'Skill pack',
    'Gated API',
    'Fixtures and docs',
    'Eval and risk gates',
    'Case study',
    'a public workflow that works without private credentials',
    'a separate gated path for live product data or actions',
    'a clear business boundary so billing and ownership are not blurred',
  ]) {
    assert.ok(source.includes(marker), `platform value loop doc missing contract marker ${marker}`);
  }
});

test('Ito example preserves non-advisory and gated-access boundaries', () => {
  const source = read('docs/architecture/platform-value-loop.md');

  for (const marker of [
    'Ito is a separate prediction-market basket product',
    'visualize market/concept relationships and backtesting outputs',
    'ITO_API_KEY',
    'do not place trades',
    'do not provide investment advice',
    'do not merge ECC Tools billing with Ito billing',
  ]) {
    assert.ok(source.includes(marker), `platform value loop doc missing Ito boundary ${marker}`);
  }
});

test('release docs link the platform value loop into the rc surface', () => {
  const crossHarness = read('docs/architecture/cross-harness.md');
  const previewManifest = read('docs/releases/2.0.0-rc.1/preview-pack-manifest.md');
  const itoPack = read('docs/releases/2.0.0-rc.1/ito-prediction-market-skill-pack.md');
  const hypergrowth = read('docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md');

  for (const source of [crossHarness, previewManifest, itoPack, hypergrowth]) {
    assert.ok(
      source.includes('platform-value-loop.md'),
      'expected release/cross-harness surface to link platform-value-loop.md'
    );
  }

  assert.ok(previewManifest.includes('Product integration and full-stack platform thesis'));
  assert.ok(hypergrowth.includes('Product integrations should behave like repeatable distribution loops'));
});

test('platform value loop does not overclaim release status or trading ability', () => {
  const source = read('docs/architecture/platform-value-loop.md');
  const forbidden = [
    'ORCA/CONDUCTOR-grade parity is live',
    'control pane is GA',
    'native-payments readiness is live',
    'official plugin-directory listing is live',
    'public ECC skills place trades',
  ];

  for (const phrase of forbidden) {
    assert.ok(!source.includes(phrase), `platform value loop should not include overclaim: ${phrase}`);
  }
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);

