import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planScenes, clipCountFor, totalSeconds, FORMATS } from '../src/lib/plan.js';

test('45s target with 8s clips plans 6 clips totalling 48s', () => {
  const scenes = planScenes({ targetSeconds: 45, clipSeconds: 8 });
  assert.equal(scenes.length, 6);
  assert.equal(totalSeconds(scenes), 48);
  assert.equal(scenes[0].role, 'hook');
  assert.equal(scenes[5].role, 'cta');
});

test('clip count is clamped between 3 and 10', () => {
  assert.equal(clipCountFor(10, 8), 3);
  assert.equal(clipCountFor(500, 8), 10);
  assert.equal(clipCountFor(undefined, undefined), 6);
});

test('fewer clips than beats keeps hook, reveal and cta', () => {
  assert.deepEqual(planScenes({ targetSeconds: 24, clipSeconds: 8 }).map(s => s.role), ['hook', 'reveal', 'cta']);
  assert.deepEqual(planScenes({ targetSeconds: 32, clipSeconds: 8 }).map(s => s.role), ['hook', 'reveal', 'demo', 'cta']);
  assert.deepEqual(planScenes({ targetSeconds: 40, clipSeconds: 8 }).map(s => s.role), ['hook', 'reveal', 'demo', 'proof', 'cta']);
});

test('more clips than beats adds numbered filler beats before cta', () => {
  const scenes = planScenes({ targetSeconds: 64, clipSeconds: 8 });
  assert.equal(scenes.length, 8);
  assert.equal(scenes[7].role, 'cta');
  assert.deepEqual(scenes.slice(5, 7).map(s => s.role), ['demo_2', 'proof_2']);
  assert.deepEqual(planScenes({ targetSeconds: 80, clipSeconds: 8 }).map(s => s.role).slice(5, 9), ['demo_2', 'proof_2', 'demo_3', 'proof_3']);
});

test('product format uses product beats', () => {
  const scenes = planScenes({ format: FORMATS.PRODUCT, targetSeconds: 45 });
  assert.match(scenes[0].goal, /hero shot/i);
});
