'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixtureRoot = path.join(repoRoot, 'examples', 'evaluator-rag-prototype');

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

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, fileName), 'utf8'));
}

function readFixtureJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, relativePath), 'utf8'));
}

console.log('\n=== Testing evaluator RAG prototype ===\n');

test('architecture doc records the artifact contract and reference pressure', () => {
  const source = read('docs/architecture/evaluator-rag-prototype.md');

  for (const required of [
    'Scenario spec',
    'Trace',
    'Report',
    'Candidate playbook',
    'Verifier result',
    'Meta-Harness',
    'Autocontext',
    'Claude HUD',
    'Hermes Agent',
    'dmux, Orca, Superset, and Ghast',
    'ECC Tools'
  ]) {
    assert.ok(source.includes(required), `Missing doc requirement: ${required}`);
  }
});

test('fixtures use one scenario id and declare read-only behavior', () => {
  const scenario = readJson('scenario.json');
  const trace = readJson('trace.json');
  const report = readJson('report.json');
  const verifier = readJson('verifier-result.json');

  assert.strictEqual(scenario.schema_version, 'ecc.evaluator-rag.scenario.v1');
  assert.strictEqual(trace.schema_version, 'ecc.evaluator-rag.trace.v1');
  assert.strictEqual(report.schema_version, 'ecc.evaluator-rag.report.v1');
  assert.strictEqual(verifier.schema_version, 'ecc.evaluator-rag.verifier.v1');

  for (const artifact of [trace, report, verifier]) {
    assert.strictEqual(artifact.scenario_id, scenario.scenario_id);
    assert.strictEqual(artifact.read_only, true);
  }
});

test('trace covers the full self-improving harness loop', () => {
  const trace = readJson('trace.json');
  const phases = trace.events.map(event => event.phase);

  for (const phase of ['observation', 'retrieval', 'proposal', 'verification', 'promotion']) {
    assert.ok(phases.includes(phase), `Missing trace phase ${phase}`);
  }

  assert.ok(trace.events.some(event => event.promoted_candidate_id === 'maintainer-salvage-branch'));
});

test('scenario blocks unsafe write actions and release actions', () => {
  const scenario = readJson('scenario.json');
  const forbidden = scenario.forbidden_actions.join('\n');

  for (const blocked of [
    'closing, reopening, or commenting on PRs',
    'merging PRs',
    'creating release tags',
    'publishing packages or plugins',
    'copying private paths, secrets, or raw personal context',
    'blindly cherry-picking bulk localization'
  ]) {
    assert.ok(forbidden.includes(blocked), `Missing forbidden action: ${blocked}`);
  }
});

test('verifier accepts maintainer salvage and rejects blind translation imports', () => {
  const verifier = readJson('verifier-result.json');
  const accepted = verifier.candidates.find(candidate => candidate.candidate_id === 'maintainer-salvage-branch');
  const rejected = verifier.candidates.find(candidate => candidate.candidate_id === 'blind-cherry-pick-translations');

  assert.ok(accepted, 'Missing accepted maintainer salvage candidate');
  assert.ok(rejected, 'Missing rejected blind cherry-pick candidate');
  assert.strictEqual(accepted.decision, 'accepted');
  assert.strictEqual(rejected.decision, 'rejected');
  assert.strictEqual(verifier.promoted_candidate_id, accepted.candidate_id);
  assert.ok(accepted.score > rejected.score);
  assert.ok(rejected.reasons.join('\n').includes('translator/manual review'));
});

test('candidate playbook preserves stale-salvage operating rules', () => {
  const playbook = read('examples/evaluator-rag-prototype/candidate-playbook.md');

  for (const required of [
    'docs/stale-pr-salvage-ledger.md',
    'source PR',
    'maintainer-owned branch',
    'Preserve attribution',
    'translator/manual review',
    'private operator context',
    'git diff --check'
  ]) {
    assert.ok(playbook.includes(required), `Missing playbook rule: ${required}`);
  }
});

test('roadmap points to the evaluator RAG prototype and hosted PR check', () => {
  const roadmap = read('docs/ECC-2.0-GA-ROADMAP.md');

  assert.ok(roadmap.includes('docs/architecture/evaluator-rag-prototype.md'));
  assert.ok(roadmap.includes('examples/evaluator-rag-prototype/'));
  assert.ok(roadmap.includes('Deterministic hosted PR check, cached output scoring, retrieval planning, judge contract, and gated model execution integrated'));
});

test('billing readiness scenario rejects launch copy overclaims', () => {
  const scenario = readFixtureJson('billing-marketplace-readiness/scenario.json');
  const trace = readFixtureJson('billing-marketplace-readiness/trace.json');
  const report = readFixtureJson('billing-marketplace-readiness/report.json');
  const verifier = readFixtureJson('billing-marketplace-readiness/verifier-result.json');
  const playbook = read('examples/evaluator-rag-prototype/billing-marketplace-readiness/candidate-playbook.md');

  assert.strictEqual(scenario.scenario_id, 'billing-marketplace-readiness');
  assert.strictEqual(trace.scenario_id, scenario.scenario_id);
  assert.strictEqual(report.scenario_id, scenario.scenario_id);
  assert.strictEqual(verifier.scenario_id, scenario.scenario_id);
  assert.strictEqual(trace.read_only, true);
  assert.strictEqual(report.read_only, true);
  assert.strictEqual(verifier.read_only, true);

  for (const blocked of [
    'creating or editing GitHub Marketplace listings',
    'changing plan limits, subscriptions, seats, or entitlements',
    'posting announcement copy',
    'claiming live billing readiness from dry-run evidence alone'
  ]) {
    assert.ok(scenario.forbidden_actions.includes(blocked), `Missing billing forbidden action: ${blocked}`);
  }

  const accepted = verifier.candidates.find(candidate => candidate.candidate_id === 'evidence-backed-billing-check');
  const rejected = verifier.candidates.find(candidate => candidate.candidate_id === 'announcement-first-billing-copy');

  assert.ok(accepted, 'Missing accepted billing evidence candidate');
  assert.ok(rejected, 'Missing rejected announcement-overclaim candidate');
  assert.strictEqual(accepted.decision, 'accepted');
  assert.strictEqual(rejected.decision, 'rejected');
  assert.strictEqual(verifier.promoted_candidate_id, accepted.candidate_id);
  assert.ok(rejected.reasons.join('\n').includes('roadmap acceptance criteria'));
  assert.ok(playbook.includes('remove-before-publication'));
  assert.ok(playbook.includes('https://github.com/marketplace/ecc-tools'));
});

test('ci failure diagnosis scenario rejects rerun-only fixes', () => {
  const scenario = readFixtureJson('ci-failure-diagnosis/scenario.json');
  const trace = readFixtureJson('ci-failure-diagnosis/trace.json');
  const report = readFixtureJson('ci-failure-diagnosis/report.json');
  const verifier = readFixtureJson('ci-failure-diagnosis/verifier-result.json');
  const playbook = read('examples/evaluator-rag-prototype/ci-failure-diagnosis/candidate-playbook.md');

  assert.strictEqual(scenario.scenario_id, 'ci-failure-diagnosis');
  assert.strictEqual(trace.scenario_id, scenario.scenario_id);
  assert.strictEqual(report.scenario_id, scenario.scenario_id);
  assert.strictEqual(verifier.scenario_id, scenario.scenario_id);
  assert.strictEqual(trace.read_only, true);
  assert.strictEqual(report.read_only, true);
  assert.strictEqual(verifier.read_only, true);

  for (const blocked of [
    'rerunning CI until it passes without diagnosing the failure',
    'pushing speculative fixes without a captured failing log excerpt',
    'weakening or deleting tests to silence a failure',
    'merging or publishing while required checks are red'
  ]) {
    assert.ok(scenario.forbidden_actions.includes(blocked), `Missing CI forbidden action: ${blocked}`);
  }

  for (const required of [
    'failing job and step are named',
    'captured log excerpt is linked or summarized',
    'changed-file context is compared to the failing step',
    'local reproduction or regression command is named'
  ]) {
    assert.ok(scenario.acceptance_gates.includes(required), `Missing CI acceptance gate: ${required}`);
  }

  const accepted = verifier.candidates.find(candidate => candidate.candidate_id === 'log-backed-minimal-fix');
  const rejected = verifier.candidates.find(candidate => candidate.candidate_id === 'rerun-only-green-wait');

  assert.ok(accepted, 'Missing accepted log-backed CI candidate');
  assert.ok(rejected, 'Missing rejected rerun-only CI candidate');
  assert.strictEqual(accepted.decision, 'accepted');
  assert.strictEqual(rejected.decision, 'rejected');
  assert.strictEqual(verifier.promoted_candidate_id, accepted.candidate_id);
  assert.ok(rejected.reasons.join('\n').includes('failing log excerpt'));
  assert.ok(playbook.includes('gh run view <run-id> --log-failed'));
  assert.ok(playbook.includes('Full required GitHub Actions matrix before merge'));
});

test('harness config quality scenario rejects unsupported parity claims', () => {
  const scenario = readFixtureJson('harness-config-quality/scenario.json');
  const trace = readFixtureJson('harness-config-quality/trace.json');
  const report = readFixtureJson('harness-config-quality/report.json');
  const verifier = readFixtureJson('harness-config-quality/verifier-result.json');
  const playbook = read('examples/evaluator-rag-prototype/harness-config-quality/candidate-playbook.md');

  assert.strictEqual(scenario.scenario_id, 'harness-config-quality');
  assert.strictEqual(trace.scenario_id, scenario.scenario_id);
  assert.strictEqual(report.scenario_id, scenario.scenario_id);
  assert.strictEqual(verifier.scenario_id, scenario.scenario_id);
  assert.strictEqual(trace.read_only, true);
  assert.strictEqual(report.read_only, true);
  assert.strictEqual(verifier.read_only, true);

  for (const blocked of [
    'claiming native support for instruction-backed or reference-only harnesses',
    'copying Claude hook semantics into Codex, Gemini, Zed, or OpenCode without adapter evidence',
    'silently overwriting existing user MCP, hook, plugin, command, or rule config',
    'publishing packages or plugins from this evaluator run'
  ]) {
    assert.ok(scenario.forbidden_actions.includes(blocked), `Missing harness forbidden action: ${blocked}`);
  }

  for (const required of [
    'adapter state is retrieved from the matrix',
    'install or onramp path is named',
    'verification command is named',
    'config-preservation behavior is explicit'
  ]) {
    assert.ok(scenario.acceptance_gates.includes(required), `Missing harness acceptance gate: ${required}`);
  }

  const accepted = verifier.candidates.find(candidate => candidate.candidate_id === 'adapter-matrix-backed-drift-check');
  const rejected = verifier.candidates.find(candidate => candidate.candidate_id === 'unsupported-hook-parity-claim');

  assert.ok(accepted, 'Missing accepted adapter-matrix candidate');
  assert.ok(rejected, 'Missing rejected unsupported parity candidate');
  assert.strictEqual(accepted.decision, 'accepted');
  assert.strictEqual(rejected.decision, 'rejected');
  assert.strictEqual(verifier.promoted_candidate_id, accepted.candidate_id);
  assert.ok(rejected.reasons.join('\n').includes('native support'));
  assert.ok(playbook.includes('npm run harness:adapters -- --check'));
  assert.ok(playbook.includes('node tests/docs/mcp-management-docs.test.js'));
});

test('AgentShield policy exception scenario rejects blanket suppression', () => {
  const scenario = readFixtureJson('agentshield-policy-exception/scenario.json');
  const trace = readFixtureJson('agentshield-policy-exception/trace.json');
  const report = readFixtureJson('agentshield-policy-exception/report.json');
  const verifier = readFixtureJson('agentshield-policy-exception/verifier-result.json');
  const playbook = read('examples/evaluator-rag-prototype/agentshield-policy-exception/candidate-playbook.md');

  assert.strictEqual(scenario.scenario_id, 'agentshield-policy-exception');
  assert.strictEqual(trace.scenario_id, scenario.scenario_id);
  assert.strictEqual(report.scenario_id, scenario.scenario_id);
  assert.strictEqual(verifier.scenario_id, scenario.scenario_id);
  assert.strictEqual(trace.read_only, true);
  assert.strictEqual(report.read_only, true);
  assert.strictEqual(verifier.read_only, true);

  for (const blocked of [
    'approving policy exceptions without SARIF or report evidence',
    'treating expired exceptions as active',
    'blanket-suppressing AgentShield policy packs or organization-policy gates',
    'editing AgentShield code or policy files from this ECC evaluator run'
  ]) {
    assert.ok(scenario.forbidden_actions.includes(blocked), `Missing AgentShield forbidden action: ${blocked}`);
  }

  for (const required of [
    'SARIF or report evidence is named',
    'owner, ticket, scope, and expiry state are recorded',
    'expired exceptions stay rejected or enforced',
    'remediation versus time-boxed exception decision is explicit'
  ]) {
    assert.ok(scenario.acceptance_gates.includes(required), `Missing AgentShield acceptance gate: ${required}`);
  }

  const accepted = verifier.candidates.find(candidate => candidate.candidate_id === 'sarif-backed-timeboxed-exception-review');
  const rejected = verifier.candidates.find(candidate => candidate.candidate_id === 'blanket-policy-suppression');

  assert.ok(accepted, 'Missing accepted AgentShield exception candidate');
  assert.ok(rejected, 'Missing rejected blanket suppression candidate');
  assert.strictEqual(accepted.decision, 'accepted');
  assert.strictEqual(rejected.decision, 'rejected');
  assert.strictEqual(verifier.promoted_candidate_id, accepted.candidate_id);
  assert.ok(rejected.reasons.join('\n').includes('blanket-suppresses'));
  assert.ok(playbook.includes('agentshield-policy/*'));
  assert.ok(playbook.includes('owner, ticket, scope, expiry'));
  assert.ok(playbook.includes('npx ecc-agentshield scan --format json'));
});

test('skill quality evidence scenario rejects vague rewrites', () => {
  const scenario = readFixtureJson('skill-quality-evidence/scenario.json');
  const trace = readFixtureJson('skill-quality-evidence/trace.json');
  const report = readFixtureJson('skill-quality-evidence/report.json');
  const verifier = readFixtureJson('skill-quality-evidence/verifier-result.json');
  const playbook = read('examples/evaluator-rag-prototype/skill-quality-evidence/candidate-playbook.md');

  assert.strictEqual(scenario.scenario_id, 'skill-quality-evidence');
  assert.strictEqual(trace.scenario_id, scenario.scenario_id);
  assert.strictEqual(report.scenario_id, scenario.scenario_id);
  assert.strictEqual(verifier.scenario_id, scenario.scenario_id);
  assert.strictEqual(trace.read_only, true);
  assert.strictEqual(report.read_only, true);
  assert.strictEqual(verifier.read_only, true);

  for (const blocked of [
    'promoting a skill rewrite without examples, validation, or observed failure evidence',
    'adding broad multi-domain skills that duplicate existing focused skills',
    'copying private operator context, secrets, tokens, or personal paths into skills',
    'claiming a skill-quality improvement without a reference set or regression command'
  ]) {
    assert.ok(scenario.forbidden_actions.includes(blocked), `Missing skill-quality forbidden action: ${blocked}`);
  }

  for (const required of [
    'changed skill or guidance surface is named',
    'observed failure, user feedback, or reference-set gap is recorded',
    'validation command is named',
    'example or regression evidence is attached'
  ]) {
    assert.ok(scenario.acceptance_gates.includes(required), `Missing skill-quality acceptance gate: ${required}`);
  }

  const accepted = verifier.candidates.find(candidate => candidate.candidate_id === 'evidence-backed-skill-amendment');
  const rejected = verifier.candidates.find(candidate => candidate.candidate_id === 'vague-skill-rewrite');

  assert.ok(accepted, 'Missing accepted skill-quality candidate');
  assert.ok(rejected, 'Missing rejected vague rewrite candidate');
  assert.strictEqual(accepted.decision, 'accepted');
  assert.strictEqual(rejected.decision, 'rejected');
  assert.strictEqual(verifier.promoted_candidate_id, accepted.candidate_id);
  assert.ok(rejected.reasons.join('\n').includes('does not include working examples'));
  assert.ok(playbook.includes('docs/SKILL-DEVELOPMENT-GUIDE.md'));
  assert.ok(playbook.includes('node scripts/ci/validate-skills.js'));
  assert.ok(playbook.includes('observed skill-run failure'));
});

test('deep analyzer evidence scenario rejects no-corpus analyzer changes', () => {
  const scenario = readFixtureJson('deep-analyzer-evidence/scenario.json');
  const trace = readFixtureJson('deep-analyzer-evidence/trace.json');
  const report = readFixtureJson('deep-analyzer-evidence/report.json');
  const verifier = readFixtureJson('deep-analyzer-evidence/verifier-result.json');
  const playbook = read('examples/evaluator-rag-prototype/deep-analyzer-evidence/candidate-playbook.md');

  assert.strictEqual(scenario.scenario_id, 'deep-analyzer-evidence');
  assert.strictEqual(trace.scenario_id, scenario.scenario_id);
  assert.strictEqual(report.scenario_id, scenario.scenario_id);
  assert.strictEqual(verifier.scenario_id, scenario.scenario_id);
  assert.strictEqual(trace.read_only, true);
  assert.strictEqual(report.read_only, true);
  assert.strictEqual(verifier.read_only, true);

  for (const blocked of [
    'promoting repository, commit, architecture, or deep-analysis changes without analyzer corpus evidence',
    'suppressing the Deep Analyzer Evidence risk bucket without co-located corpus, snapshot, fixture, or benchmark evidence',
    'changing analyzer thresholds or classifications without expected-output comparison',
    'posting PR comments, check runs, or Linear sync updates from this read-only evaluator run'
  ]) {
    assert.ok(scenario.forbidden_actions.includes(blocked), `Missing deep-analyzer forbidden action: ${blocked}`);
  }

  for (const required of [
    'changed analyzer surface is named',
    'maintained corpus or reference-set path is included',
    'expected analyzer outputs are compared',
    'representative repository shape or commit history is described',
    'regression command is named'
  ]) {
    assert.ok(scenario.acceptance_gates.includes(required), `Missing deep-analyzer acceptance gate: ${required}`);
  }

  const accepted = verifier.candidates.find(candidate => candidate.candidate_id === 'corpus-backed-analyzer-change');
  const rejected = verifier.candidates.find(candidate => candidate.candidate_id === 'threshold-only-analyzer-rewrite');

  assert.ok(accepted, 'Missing accepted deep-analyzer candidate');
  assert.ok(rejected, 'Missing rejected threshold-only analyzer candidate');
  assert.strictEqual(accepted.decision, 'accepted');
  assert.strictEqual(rejected.decision, 'rejected');
  assert.strictEqual(verifier.promoted_candidate_id, accepted.candidate_id);
  assert.ok(rejected.reasons.join('\n').includes('does not compare expected outputs'));
  assert.ok(playbook.includes('../ECC-Tools/src/analyzers/fixtures/deep-analyzer-corpus.ts'));
  assert.ok(playbook.includes('npm test -- src/analyzers/deep-analyzer-corpus.test.ts src/lib/analyzer.compare.test.ts'));
  assert.ok(playbook.includes('Deep Analyzer Evidence'));
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
