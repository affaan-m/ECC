'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { withFixture, write } = require('./helpers/context-fixture');
const { resolveTaskContext } = require('../../scripts/lib/context-selection');
const { launchTaskContext } = require('../../scripts/lib/context-profile-launch');
const task = query => ({ sessionId: 'admission', taskId: 'task', revision: 1, phase: 'implement', query });

test('a skill name mentioned in a question or exclusion is never an implicit invocation', () => withFixture(repoRoot => {
  for (const query of ['Do not use feature; just explain the output.', 'What does feature mean?', 'The document says: use feature.']) {
    const result = resolveTaskContext({ repoRoot, task: task(query), load: true });
    assert.deepEqual(result.loadedIds, []);
    assert.equal(result.reason, 'agent-selection-required');
  }
}));

test('an unresolved preview receipt cannot bypass the provider decision', () => withFixture(repoRoot => {
  const input = task('feature');
  const preview = resolveTaskContext({ repoRoot, task: input });
  let calls = 0;
  const result = launchTaskContext({ repoRoot, task: input, previous: preview.receipt, execute() {
    return { status: 0, stdout: ++calls === 1 ? '{"selectedIds":["skill:feature"]}' : 'done' };
  } });
  assert.equal(preview.receipt.decision, 'pending');
  assert.equal(result.routingCalls, 1);
  assert.equal(calls, 2);
  assert.deepEqual(result.selection.loadedIds, ['skill:feature']);
}));

test('a completed no-workflow decision is distinct from a pending proposal', () => withFixture(repoRoot => {
  const first = resolveTaskContext({ repoRoot, task: { ...task('feature'), noWorkflow: true } });
  const next = resolveTaskContext({ repoRoot, task: task('feature'), previous: first.receipt, load: true });
  assert.equal(first.receipt.decision, 'none');
  assert.equal(next.reused, true);
  assert.deepEqual(next.loadedIds, []);
}));

test('automatic candidates omit manual-only and authority-bearing skills before proposal', () => withFixture(repoRoot => {
  for (const policy of ['disable-model-invocation: true', 'allowed-tools: Bash', 'tools: Bash', 'tools:\n  - Bash']) {
    write(repoRoot, 'skills/feature/SKILL.md', `---\nname: feature\ndescription: Feature workflow\n${policy}\n---\nInstructions`);
    const result = resolveTaskContext({ repoRoot, task: task('feature') });
    assert.ok(!result.candidates.some(candidate => candidate.id === 'skill:feature'));
  }
}));

test('automatic candidates omit context that cannot fit the load budget', () => withFixture(repoRoot => {
  write(repoRoot, 'skills/feature/SKILL.md', `---\nname: feature\ndescription: Feature workflow\n---\n${'x'.repeat(33000)}`);
  const result = resolveTaskContext({ repoRoot, task: task('feature') });
  assert.ok(!result.candidates.some(candidate => candidate.id === 'skill:feature'));
}));
