'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { withFixture, write, update } = require('./helpers/context-fixture');
const { resolveTaskContext, resolveDeclinedFallback } = require('../../scripts/lib/context-selection');

const task = (values = {}) => ({ sessionId: 'session-1', taskId: 'task-1', revision: 1,
  phase: 'implement', query: '', explicitIds: [], proposedIds: [], ...values });
const resolve = (repoRoot, input, values = {}) => resolveTaskContext({ repoRoot, task: task(input), ...values });

test('Auto loads exact requested context and preserves the Lean base', () => withFixture(repoRoot => {
  const result = resolve(repoRoot, { explicitIds: ['skill:feature'] }, { load: true });
  assert.deepEqual(result.selectedIds, ['skill:feature']);
  assert.deepEqual(result.loadedIds, ['skill:feature']);
  assert.equal(result.profileId, 'lean@1');
  assert.equal(result.activation, 'context-returned');
  assert.match(result.resources[0].content, /# feature/);
  assert.equal(result.nativeInvocation, 'unobserved');
}));

test('simple tasks return an empty successful selection', () => withFixture(repoRoot => {
  const result = resolve(repoRoot, { noWorkflow: true, query: 'hello' }, { load: true });
  assert.deepEqual(result.selectedIds, []);
  assert.equal(result.reason, 'no-workflow-needed');
}));

test('suggest returns candidates without loading and manual ignores proposals', () => withFixture(repoRoot => {
  assert.deepEqual(resolve(repoRoot, { proposedIds: ['skill:feature'] }, { selectionMode: 'manual', load: true }).selectedIds, []);
  const suggestion = resolve(repoRoot, { proposedIds: ['skill:feature'] }, { selectionMode: 'suggest', load: true });
  assert.deepEqual(suggestion.selectedIds, ['skill:feature']);
  assert.deepEqual(suggestion.loadedIds, []);
}));

test('exclusions cannot be bypassed by explicit IDs or dependencies', () => withFixture(repoRoot => {
  assert.throws(() => resolve(repoRoot, { explicitIds: ['skill:feature'] }, { exclude: ['skill:feature'] }), /excluded/);
  update(repoRoot, 'manifests/context-packs/skill-registry@1.json', value => ({ ...value,
    overrides: [{ id: 'skill:feature', dependencies: ['skill:shared'], requiredResources: ['skills/feature/references/details.md'] }] }));
  assert.throws(() => resolve(repoRoot, { explicitIds: ['skill:feature'] }, { exclude: ['skill:shared'] }), /excluded/);
  const result = resolve(repoRoot, { explicitIds: ['skill:feature'] }, { load: true });
  assert.deepEqual(result.loadedIds, ['skill:feature', 'skill:shared']);
  assert.ok(result.resources.some(resource => resource.path.endsWith('details.md')));
}));

test('manual-only native policy rejects implicit proposals and allows explicit request', () => withFixture(repoRoot => {
  write(repoRoot, 'skills/feature/SKILL.md', '---\nname: feature\ndescription: Feature work\ndisable-model-invocation: true\n---\nFeature instructions');
  assert.throws(() => resolve(repoRoot, { proposedIds: ['skill:feature'] }, { load: true }), /manual-only/);
  assert.deepEqual(resolve(repoRoot, { explicitIds: ['skill:feature'] }, { load: true }).loadedIds, ['skill:feature']);
}));

test('manual-only dependencies require their own explicit request', () => withFixture(repoRoot => {
  write(repoRoot, 'skills/shared/agents/openai.yaml', 'policy:\n  allow_implicit_invocation: false\n');
  update(repoRoot, 'manifests/context-packs/skill-registry@1.json', value => ({ ...value,
    overrides: [{ id: 'skill:feature', dependencies: ['skill:shared'] }] }));
  assert.throws(() => resolve(repoRoot, { explicitIds: ['skill:feature'] }, { load: true }), /manual-only.*skill:shared/);
  const result = resolve(repoRoot, { explicitIds: ['skill:feature', 'skill:shared'] }, { load: true });
  assert.deepEqual(result.loadedIds, ['skill:feature', 'skill:shared']);
}));

for (const load of [false, true]) {
  test(`policy resource drift after registry compilation rejects selection (load=${load})`, context => withFixture(repoRoot => {
    const relative = 'skills/feature/agents/openai.yaml';
    write(repoRoot, relative, 'policy:\n  allow_implicit_invocation: false\n');
    const policyPath = path.join(fs.realpathSync(repoRoot), relative);
    const originalOpen = fs.openSync;
    const originalRead = fs.readSync;
    let policyOpens = 0;
    let changedDescriptor;
    let alteredReads = 0;
    context.mock.method(fs, 'openSync', (filename, ...args) => {
      const descriptor = originalOpen(filename, ...args);
      // First compile the profile, then reload the canonical registry. Only
      // the subsequent policy read observes replacement bytes.
      if (filename === policyPath && ++policyOpens === 3) changedDescriptor = descriptor;
      return descriptor;
    });
    context.mock.method(fs, 'readSync', (descriptor, buffer, offset, length, position) => {
      const count = originalRead(descriptor, buffer, offset, length, position);
      if (descriptor === changedDescriptor && count > 0) {
        const source = buffer.toString('utf8', offset, offset + count);
        const replacement = source.replace('false', 'true ');
        assert.notEqual(replacement, source);
        buffer.write(replacement, offset, count, 'utf8');
        alteredReads++;
      }
      return count;
    });
    try {
      assert.throws(() => resolve(repoRoot, { proposedIds: ['skill:feature'] }, { load }),
        /Context source changed during selection/);
      assert.equal(policyOpens, 3);
      assert.equal(alteredReads, 1);
    } finally { context.mock.restoreAll(); }
  }));
}

test('authority-bearing metadata cannot become automatic invocation', () => withFixture(repoRoot => {
  write(repoRoot, 'skills/feature/SKILL.md', '---\nname: feature\ndescription: Feature work\nallowed-tools: Bash\n---\nRun !`touch /tmp/never-run`');
  assert.throws(() => resolve(repoRoot, { proposedIds: ['skill:feature'] }, { load: true }), /authority|dynamic/);
}));

test('receipt pins source and task identity without retaining query text', () => withFixture(repoRoot => {
  const first = resolve(repoRoot, { proposedIds: ['skill:feature'], query: 'private task prose' });
  assert.ok(!JSON.stringify(first.receipt).includes('private task prose'));
  const second = resolve(repoRoot, { query: 'private task prose' }, { previous: first.receipt });
  assert.deepEqual(second.selectedIds, first.selectedIds);
  assert.equal(second.reused, true);
  const reworded = resolve(repoRoot, { query: 'reworded' }, { previous: first.receipt });
  assert.equal(reworded.reused, false);
  assert.notEqual(reworded.receipt.bindingDigest, first.receipt.bindingDigest);
  assert.throws(() => resolve(repoRoot, {}, { previous: { ...first.receipt, selectedIds: ['skill:shared'] } }), /receipt/);
  const changed = resolve(repoRoot, { sessionId: 'session-2' }, { previous: first.receipt });
  assert.equal(changed.reused, false);
}));

test('trigger changes invalidate a pinned Auto receipt', () => withFixture(repoRoot => {
  const first = resolve(repoRoot, { proposedIds: ['skill:feature'], query: 'feature work' });
  write(repoRoot, 'manifests/context-packs/skill-triggers@1.json', JSON.stringify({
    schemaVersion: 1, triggers: { 'skill:feature': ['feature work'] },
  }));
  const second = resolve(repoRoot, { query: 'feature work' }, { previous: first.receipt });
  assert.equal(second.reused, false);
  assert.notEqual(second.receipt.bindingDigest, first.receipt.bindingDigest);
}));

for (const [label, taskChanges, options] of [
  ['task', { taskId: 'task-2' }, {}],
  ['revision', { revision: 2 }, {}],
  ['phase', { phase: 'review' }, {}],
  ['manual mode', {}, { selectionMode: 'manual' }],
  ['suggest mode', {}, { selectionMode: 'suggest' }],
  ['profile', {}, { profileId: 'full@1' }],
  ['target', {}, { target: 'claude-project' }],
  ['exclusions', {}, { exclude: ['skill:feature'] }],
  ['inclusions', {}, { include: ['skill:shared'] }],
]) {
  test(`changing ${label} invalidates a pinned task selection`, () => withFixture(repoRoot => {
    const first = resolve(repoRoot, { explicitIds: ['skill:feature'] }, { load: true });
    const second = resolve(repoRoot, taskChanges, { previous: first.receipt, load: true, ...options });
    assert.equal(second.reused, false);
    assert.deepEqual(second.selectedIds, []);
    assert.deepEqual(second.loadedIds, []);
    assert.notEqual(second.receipt.bindingDigest, first.receipt.bindingDigest);
    assert.throws(() => resolve(repoRoot, taskChanges, { previous: first.receipt,
      expectedDigest: first.receipt.selectionDigest, load: true, ...options }), /stale/);
  }));
}

test('new explicit IDs replace a pinned selection and noWorkflow clears it', () => withFixture(repoRoot => {
  const first = resolve(repoRoot, { explicitIds: ['skill:feature'] });
  const next = resolve(repoRoot, { explicitIds: ['skill:shared'] }, { previous: first.receipt, load: true });
  assert.equal(next.reused, false);
  assert.deepEqual(next.loadedIds, ['skill:shared']);
  const cleared = resolve(repoRoot, { noWorkflow: true }, { previous: first.receipt, load: true });
  assert.equal(cleared.reused, false);
  assert.deepEqual(cleared.selectedIds, []);
  assert.deepEqual(cleared.loadedIds, []);
}));

test('source changes invalidate reuse and source-bound load preview', () => withFixture(repoRoot => {
  const first = resolve(repoRoot, { explicitIds: ['skill:feature'] });
  write(repoRoot, 'skills/feature/references/details.md', 'changed');
  assert.equal(resolve(repoRoot, {}, { previous: first.receipt }).reused, false);
  assert.throws(() => resolve(repoRoot, { explicitIds: ['skill:feature'] }, { load: true, expectedDigest: first.receipt.selectionDigest }), /stale/);
}));

test('bounded search uses canonical IDs and deterministic order', () => withFixture(repoRoot => {
  const result = resolve(repoRoot, { query: 'feature' });
  assert.equal(result.candidates[0].id, 'skill:feature');
  // A bare name mention ranks the skill but is not a directive citation.
  assert.deepEqual(result.selectedIds, []);
  assert.equal(result.reason, 'agent-selection-required');
  assert.ok(result.candidates.length <= 5);
}));

test('generic lexical relevance requests agent selection instead of loading the top score', () => withFixture(repoRoot => {
  write(repoRoot, 'skills/feature/SKILL.md', '---\nname: feature\ndescription: Diagnose memory leak symptoms\n---\nFeature instructions');
  const result = resolve(repoRoot, { query: 'Diagnose memory leak symptoms' }, { load: true });
  assert.equal(result.candidates[0].id, 'skill:feature');
  assert.deepEqual(result.selectedIds, []);
  assert.deepEqual(result.loadedIds, []);
  assert.equal(result.reason, 'agent-selection-required');
}));

test('a single complete canonical or native name auto-selects the cited skill', () => withFixture(repoRoot => {
  write(repoRoot, 'skills/feature/SKILL.md', '---\nname: native-feature\ndescription: Feature workflow\n---\nFeature instructions');
  for (const query of ['Use skill:feature.', 'Use the native-feature skill.', 'Use Native Feature guidance.']) {
    const result = resolve(repoRoot, { query }, { load: true });
    assert.deepEqual(result.loadedIds, ['skill:feature']);
    assert.equal(result.candidates[0].id, 'skill:feature');
    assert.equal(result.reason, 'auto-selection');
    assert.equal(result.receipt.autoSelection.exact, true);
  }
}));

test('multiple directive citations defer to an explicit agent proposal', () => withFixture(repoRoot => {
  const result = resolve(repoRoot, { query: 'Use feature and use shared guidance.' }, { load: true });
  assert.deepEqual(result.selectedIds, []);
  assert.equal(result.reason, 'agent-selection-required');
}));

test('name anchors require complete word boundaries', () => withFixture(repoRoot => {
  const result = resolve(repoRoot, { query: 'featurette sharedness' }, { load: true });
  assert.deepEqual(result.loadedIds, []);
}));

test('candidate descriptions stay useful and bounded with explicit truncation', () => withFixture(repoRoot => {
  const description = `Feature workflow ${'x'.repeat(3000)}`;
  write(repoRoot, 'skills/feature/SKILL.md', `---\nname: feature\ndescription: ${description}\n---\nFeature instructions`);
  const result = resolve(repoRoot, { query: 'feature' });
  assert.equal(result.candidates[0].description, description.slice(0, 2048));
  assert.equal(result.candidates[0].descriptionTruncated, true);
  const shared = resolve(repoRoot, { query: 'shared' }).candidates[0];
  assert.equal(shared.descriptionTruncated, false);
  assert.ok(shared.description.length < 2048);
}));

test('normalization cannot turn a native name into an empty-query anchor', () => withFixture(repoRoot => {
  write(repoRoot, 'skills/feature/SKILL.md', '---\nname: 日本語\ndescription: Japanese guidance\n---\nFeature instructions');
  assert.deepEqual(resolve(repoRoot, {}).selectedIds, []);
}));

// [label, query, expected]. Expected 'auto' arms must auto-select the pinned
// skill (reason 'auto-selection'); 'agent' arms must defer to the bounded
// proposal path (reason 'agent-selection-required', nothing loaded).
const QUERY_CORPUS = [
  ['small Python defect', 'Fix an off-by-one bug in a Python function that indexes a list.', 'agent'],
  ['React keyboard accessibility', 'Fix keyboard navigation and focus handling in our React settings form.', 'auto', 'skill:frontend-a11y'],
  ['PostgreSQL migration review', 'Review a PostgreSQL migration that adds an indexed nullable column without downtime.', 'auto', 'skill:database-migrations'],
  ['read-only JavaScript review', 'Review this JavaScript pull request for input validation bugs without modifying the code.', 'agent'],
  ['RAG literature research', 'Find recent papers about retrieval augmented generation and compare their experimental evidence.', 'agent'],
  ['npm release verification', 'Prepare a release checklist for our npm package, verifying the packed archive and test results.', 'agent'],
  ['API documentation', 'Update the API documentation to explain the new pagination response fields and include an example.', 'agent'],
  ['Rust memory diagnosis', 'Diagnose a memory leak in a Rust background worker service.', 'agent'],
  ['mixed-stack feature', 'Add a React preferences form and a Django endpoint that saves preferences in PostgreSQL.', 'agent'],
];

for (const [label, query, arm, expectedId] of QUERY_CORPUS) {
  test(`actual registry: ${label} ${arm === 'auto' ? 'auto-selects its skill' : 'needs an agent decision before loading'}`, () => {
    const result = resolveTaskContext({ task: task({ query }), load: true });
    assert.ok(result.candidates.length > 0 && result.candidates.length <= 5);
    if (arm === 'auto') {
      assert.deepEqual(result.selectedIds, [expectedId]);
      assert.deepEqual(result.loadedIds, [expectedId]);
      assert.equal(result.reason, 'auto-selection');
      assert.equal(result.receipt.autoSelection.id, expectedId);
      assert.equal(result.receipt.decision, 'selected');
    } else {
      assert.deepEqual(result.selectedIds, []);
      assert.deepEqual(result.loadedIds, []);
      assert.equal(result.reason, 'agent-selection-required');
      assert.equal(result.receipt.decision, 'pending');
    }
  });
}

test('actual registry: a declined proposal exposes a tier-2 fallback candidate', () => {
  const { tasks } = require('../../docker/context-profiles/ai-corpus.json');
  const query = tasks.find(item => item.id === 'rbac-middleware').query;
  const result = resolveTaskContext({ task: task({ query }), load: false });
  assert.equal(result.reason, 'agent-selection-required');
  assert.ok(result.fallback, 'expected a tier-2 fallback for the rbac task');
  const resolved = resolveDeclinedFallback({ task: task({ query }), load: true }, result);
  assert.equal(resolved.reason, 'auto-selection-fallback');
  assert.deepEqual(resolved.selectedIds, [result.fallback.id]);
  assert.equal(resolved.receipt.fallbackApplied, true);
  const { receiptDigest, ...body } = resolved.receipt;
  assert.equal(require('../../scripts/lib/context-profile-support').digestObject(body), receiptDigest);
});

test('actual registry: a near-tied wrong top candidate exposes no fallback', () => {
  const { tasks } = require('../../docker/context-profiles/ai-corpus.json');
  const query = tasks.find(item => item.id === 'slugify-regression-tests').query;
  const result = resolveTaskContext({ task: task({ query }), load: false });
  assert.equal(result.reason, 'agent-selection-required');
  assert.equal(result.fallback, null);
});

test('actual registry: a simple factual question needs no context', () => {
  const result = resolveTaskContext({ task: task({ query: 'What is the capital of Japan?' }), load: true });
  assert.deepEqual(result.selectedIds, []);
  assert.deepEqual(result.candidates, []);
});

test('actual registry: the full Python patterns name auto-selects the cited skill', () => {
  const result = resolveTaskContext({ task: task({ query: 'Use Python patterns for this change.' }), load: true });
  assert.deepEqual(result.loadedIds, ['skill:python-patterns']);
  assert.equal(result.candidates[0].id, 'skill:python-patterns');
  assert.equal(result.reason, 'auto-selection');
  assert.equal(result.receipt.autoSelection.exact, true);
});

test('invalid input and oversized bodies fail closed', () => withFixture(repoRoot => {
  assert.throws(() => resolve(repoRoot, { surprise: true }), /Unknown/);
  assert.throws(() => resolve(repoRoot, { query: 'x'.repeat(9000) }), /limit/);
  assert.throws(() => resolve(repoRoot, { explicitIds: ['skill:missing'] }), /Unknown/);
  write(repoRoot, 'skills/feature/references/details.md', 'x'.repeat(40000));
  update(repoRoot, 'manifests/context-packs/skill-registry@1.json', value => ({ ...value,
    overrides: [{ id: 'skill:feature', requiredResources: ['skills/feature/references/details.md'] }] }));
  assert.throws(() => resolve(repoRoot, { explicitIds: ['skill:feature'] }, { load: true }), /budget/);
}));

for (const query of [
  "You shouldn't use feature.",
  "You can\u2019t use feature.",
  "For feature, don't use the feature skill.",
  'For feature, never invoke feature.',
  'The phrase "Use feature" is an example.',
  'The phrase "Use feature." is an example.',
  'The phrase \u201cUse feature\u201d is an example.',
  'The phrase `Use feature` is an example.',
  "Don't use the feature skill.",
  'Don\u2019t use the feature skill.',
  'Do not use the feature skill.',
  'Never use the feature skill.',
  'Can I use the feature skill?',
  'Should we use the feature skill?',
  'Why use the feature skill?',
  'The README says to use the feature skill.',
  'The docs say use feature.',
  'The docs say to use feature.',
  'The docs said use feature.',
  '"Use the feature skill" is an example.',
]) {
  test('indirect name citation needs an agent decision: ' + query, () => withFixture(repoRoot => {
    const result = resolve(repoRoot, { query }, { load: true });
    assert.ok(result.candidates.some(candidate => candidate.id === 'skill:feature'));
    assert.deepEqual(result.loadedIds, []);
    assert.equal(result.reason, 'agent-selection-required');
    assert.equal(result.fallback, null);
  }));
}

test('a negated citation does not suppress a separate affirmative directive', () => withFixture(repoRoot => {
  for (const query of [
    "Don't use feature. Use shared guidance.",
    'Don\u2019t use feature; please use shared guidance.',
    'The document says use feature. Use shared guidance.',
  ]) {
    const result = resolve(repoRoot, { query }, { load: true });
    assert.deepEqual(result.loadedIds, ['skill:shared']);
  }
}));

test('ordinary and polite directives preserve automatic and explicit selection', () => withFixture(repoRoot => {
  for (const query of ['Please use the feature skill.', 'Can you use the feature skill?',
    'Use feature without changing the code.', 'Use feature to document the change.',
    'Use "feature".', 'Use `feature`.', 'Do use feature.', 'Please can you use feature?']) {
    assert.deepEqual(resolve(repoRoot, { query }, { load: true }).loadedIds, ['skill:feature']);
  }
  for (const field of ['explicitIds', 'proposedIds']) {
    assert.deepEqual(resolve(repoRoot, { query: 'Should we use feature?', [field]: ['skill:feature'] },
      { load: true }).loadedIds, ['skill:feature']);
  }
}));

for (const prefix of ["Don't use database-migrations.", 'Do not use database-migrations.',
  'Should we use database-migrations?', 'The README says use database-migrations.']) {
  test('strong retrieval cannot bypass an indirect citation: ' + prefix, () => {
    const query = prefix + ' Review a PostgreSQL migration that adds an indexed nullable column without downtime.';
    const result = resolveTaskContext({ task: task({ query }), load: true });
    const candidate = result.candidates.find(value => value.id === 'skill:database-migrations');
    assert.ok(candidate && candidate.bm25 >= 20, 'Exercise the BM25 auto-admission threshold');
    assert.deepEqual(result.loadedIds, []);
    assert.equal(result.fallback, null);
  });
}

test('routing policy changes invalidate receipts created by the old citation policy', () => withFixture(repoRoot => {
  const query = "Don't use feature.";
  const first = resolve(repoRoot, { query, explicitIds: ['skill:feature'] });
  const { digestObject } = require('../../scripts/lib/context-profile-support');
  const { compileContextProfile } = require('../../scripts/lib/context-profiles');
  const plan = compileContextProfile({ repoRoot, selectionMode: 'auto' });
  const bindingDigest = digestObject({ sessionId: 'session-1', taskId: 'task-1', revision: 1,
    phase: 'implement', planDigest: plan.planDigest, routingPolicyVersion: 5,
    triggersDigest: digestObject({}), queryDigest: digestObject(query) });
  const { receiptDigest: _receiptDigest, ...receipt } = first.receipt;
  const oldReceipt = { ...receipt, bindingDigest, explicitIds: [],
    selectionDigest: digestObject({ bindingDigest, selectedIds: ['skill:feature'], explicitIds: [] }) };
  const previous = { ...oldReceipt, receiptDigest: digestObject(oldReceipt) };
  const result = resolve(repoRoot, { query }, { previous, load: true });
  assert.equal(result.reused, false);
  assert.deepEqual(result.loadedIds, []);
}));

for (const query of [
  'Should we use feature? Use feature.',
  'Use feature. Should we use feature?',
  'The docs say use feature. Use feature.',
  'Use feature. The docs say use feature.',
  'The phrase "Use feature." is an example. Use feature.',
  'The docs say "Use feature." Use feature.',
  'The docs say "Should we use feature?" Use feature.',
  `Use feature. The docs say "don’t use feature."`,
  'Use feature. The phrase "Use feature." is an example.',
  "Don't use feature. Use feature.",
  'The docs say never use feature. Use feature.',
  'Use feature. The docs say never use feature.',
  'Use feature to inspect the essay.',
]) {
  test('a genuine directive survives surrounding discussion: ' + query, () => withFixture(repoRoot => {
    const result = resolve(repoRoot, { query }, { load: true });
    assert.deepEqual(result.loadedIds, ['skill:feature']);
    assert.equal(result.reason, 'auto-selection');
    assert.equal(result.receipt.autoSelection.exact, true);
  }));
}

for (const query of [
  "Use feature. Don't use feature.",
  'Use feature. Never use feature.',
  "Use feature. Don't use feature. Should we use feature?",
]) {
  test('a later rejection withdraws an earlier directive: ' + query, () => withFixture(repoRoot => {
    const result = resolve(repoRoot, { query }, { load: true });
    assert.deepEqual(result.loadedIds, []);
    assert.equal(result.fallback, null);
  }));
}

for (const prefix of [
  "Don't use the database migration skill.",
  'Don\u2019t use the database migration skill.',
  'Never use database migration.',
  'Should we use the database migration skill?',
  'The docs say use the database migration skill.',
]) {
  test('singular named references cannot bypass citation review: ' + prefix, () => {
    const query = prefix + ' Review a PostgreSQL migration that adds an indexed nullable column without downtime.';
    const result = resolveTaskContext({ task: task({ query }), load: true });
    const candidate = result.candidates.find(value => value.id === 'skill:database-migrations');
    assert.ok(candidate && candidate.bm25 >= 20, 'Exercise the BM25 auto-admission threshold');
    assert.equal(candidate.exact, false, 'Exercise the non-exact candidate path');
    assert.deepEqual(result.loadedIds, []);
    assert.equal(result.fallback, null);
  });
}

test('singular forms do not create exact directive admission', () => {
  const result = resolveTaskContext({ task: task({ query: 'Use the database migration skill.' }), load: true });
  assert.ok(result.candidates.some(candidate => candidate.id === 'skill:database-migrations'));
  assert.ok(!result.receipt.autoSelection || !result.receipt.autoSelection.exact);
});
