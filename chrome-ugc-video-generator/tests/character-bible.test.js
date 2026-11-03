import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBibleBlock, bibleAnchors, normalizeBible } from '../src/lib/character-bible.js';
import { BIBLE } from './fixtures.js';

test('bible block is deterministic and repeats outfit and product', () => {
  const a = renderBibleBlock(BIBLE);
  const b = renderBibleBlock(BIBLE);
  assert.equal(a, b);
  assert.match(a, /WEARING EXACTLY \(never changes\): oversized cream linen shirt, gold hoop earrings, thin gold necklace\./);
  assert.match(a, /PRODUCT \(identical in every shot\): Glow Serum da Luma/);
  assert.match(a, /^CHARACTER \(identical in every shot\): early 30s woman, Brazilian/m);
});

test('reference mode labels the character as the reference person', () => {
  assert.match(renderBibleBlock(BIBLE, { hasReference: true }), /^SAME PERSON AS THE REFERENCE IMAGE/m);
});

test('normalizeBible drops unknown fields and collapses whitespace', () => {
  const b = normalizeBible({ character: { gender: ' man \n', hacker: 'x' }, setting: 'a  b' });
  assert.deepEqual(b.character, { gender: 'man' });
  assert.equal(b.setting, 'a b');
  assert.equal('hacker' in b, false);
});

test('anchors list the phrases every prompt must contain', () => {
  const anchors = bibleAnchors(BIBLE);
  assert.ok(anchors.includes('soft daylight from a window on the left'));
  assert.equal(anchors.length, 5);
});
