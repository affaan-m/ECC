'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDirectoryLink, withFixture } = require('./helpers/context-fixture');
const {
  MAX_QUERY_BYTES, MAX_SUGGESTIONS, suggestSkills, taskFor, truncateUtf8,
} = require('../../scripts/lib/skill-router');

test('suggestions come from the canonical registry, capped at three', () => withFixture(repoRoot => {
  const result = suggestSkills('help with the feature work', { repoRoot });
  assert.equal(result.profileId, 'lean@1');
  assert.ok(result.suggestions.length > 0 && result.suggestions.length <= MAX_SUGGESTIONS);
  assert.equal(result.suggestions[0].id, 'skill:feature');
  for (const suggestion of result.suggestions) {
    assert.match(suggestion.id, /^skill:[a-z0-9-]+$/);
    assert.equal(typeof suggestion.description, 'string');
  }
}));

test('suggest mode selects and loads nothing', () => withFixture(repoRoot => {
  // A query naming exactly one skill is admitted in auto mode; suggest mode
  // must still leave it a proposal.
  const result = suggestSkills('use the feature skill for this change', { repoRoot });
  assert.notEqual(result.reason, 'auto-selection');
  assert.equal(result.reason, 'agent-selection-required');
}));

test('the profile is a canonical context profile, aliases included', () => withFixture(repoRoot => {
  assert.equal(suggestSkills('help with the feature work', { repoRoot, profileId: 'full' }).profileId, 'full@1');
  assert.equal(suggestSkills('help with the feature work', { repoRoot, profileId: 'lean@1' }).profileId, 'lean@1');
  assert.throws(() => suggestSkills('help with the feature work', { repoRoot, profileId: 'developer' }), /Unknown context profile/);
}));

test('a symlink in the skill source tree fails closed instead of suggesting', () => withFixture(repoRoot => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'planted.md'), 'planted\n');
    createDirectoryLink(outside, path.join(repoRoot, 'skills', 'feature', 'linked'));
    assert.throws(() => suggestSkills('help with the feature work', { repoRoot }), /Symbolic link source is forbidden/);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
}));

test('task input satisfies the resolver contract for any prompt or session', () => {
  const task = taskFor('a prompt', 'b1f0c6e2-3d4a-4c5b-9e8f-0a1b2c3d4e5f');
  assert.deepEqual(task, { sessionId: 'b1f0c6e2-3d4a-4c5b-9e8f-0a1b2c3d4e5f', taskId: 'user-prompt',
    revision: 1, phase: 'user-prompt', query: 'a prompt' });
  assert.equal(taskFor('a prompt').sessionId, 'skill-router');
  assert.equal(taskFor('a prompt', '../not a session').sessionId, 'skill-router');
  assert.ok(Buffer.byteLength(taskFor('x'.repeat(20000)).query) <= MAX_QUERY_BYTES);
});

test('long prompts are cut on a character boundary', () => {
  assert.equal(truncateUtf8('short', 10), 'short');
  const cut = truncateUtf8('abéé', 3);
  assert.equal(cut, 'ab');
  assert.ok(!cut.includes('�'));
  assert.equal(truncateUtf8('\u{1F600}\u{1F600}', 6), '\u{1F600}');
});
