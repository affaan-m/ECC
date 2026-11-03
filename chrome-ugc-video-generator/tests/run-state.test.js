import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextClip, inFlight, previousInteractionId, allDone, recoverInterrupted, patchPrompt } from '../src/lib/run-state.js';

const job = (statuses, extra = {}) => ({
  status: 'running',
  prompts: statuses.map((status, i) => ({ index: i + 1, status, interactionId: status === 'done' ? `i${i + 1}` : null })),
  ...extra,
});

test('nextClip picks the first pending or failed clip, honouring runOnly', () => {
  assert.equal(nextClip(job(['done', 'error', 'pending'])).index, 2);
  assert.equal(nextClip(job(['done', 'done', 'pending'], { runOnly: 3 })).index, 3);
  assert.equal(nextClip(job(['done', 'done'], { runOnly: 1 })), null);
  assert.equal(nextClip(job(['done', 'done'])), null);
  assert.equal(nextClip(null), null);
});

test('inFlight and allDone', () => {
  assert.equal(inFlight(job(['done', 'running', 'pending'])).index, 2);
  assert.equal(inFlight(job(['done'])), null);
  assert.equal(allDone(job(['done', 'done'])), true);
  assert.equal(allDone(job(['done', 'error'])), false);
  assert.equal(allDone({ prompts: [] }), false);
});

test('previousInteractionId chains from the clip just before, not the last finished', () => {
  const j = job(['done', 'error', 'done', 'done']);
  assert.equal(previousInteractionId(j, 2), 'i1');
  assert.equal(previousInteractionId(j, 4), 'i3');
  assert.equal(previousInteractionId(j, 1), undefined);
});

test('recoverInterrupted re-queues the running clip and unlocks the job', () => {
  const r = recoverInterrupted(job(['done', 'running', 'pending'], { runOnly: 2, stopRequested: true }));
  assert.equal(r.status, 'ready');
  assert.equal(r.prompts[1].status, 'error');
  assert.match(r.prompts[1].error, /Interrompido/);
  assert.equal(r.runOnly, null);
  assert.equal(recoverInterrupted({ status: 'ready', prompts: [] }).status, 'ready');
});

test('patchPrompt only touches the matching clip', () => {
  const r = patchPrompt(job(['pending', 'pending']), 2, { status: 'done' });
  assert.deepEqual(r.prompts.map(p => p.status), ['pending', 'done']);
});
