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

test('reference mode adds a reference line without claiming the image shows a person', () => {
  const block = renderBibleBlock(BIBLE, { hasReference: true });
  assert.match(block, /^REFERENCE: the attached image is the visual reference/m);
  assert.match(block, /^CHARACTER \(identical in every shot\)/m);
});

test('placeholder values and trailing punctuation are dropped', () => {
  const b = normalizeBible({ character: { gender: 'man', face: 'Not visible', accessories: 'none.', outfit: 'Cream knit sweater.' }, product: { name: 'X', key_detail: 'N/A' } });
  assert.deepEqual(b.character, { gender: 'man', outfit: 'Cream knit sweater' });
  assert.deepEqual(b.product, { name: 'X' });
  assert.match(renderBibleBlock(b), /WEARING EXACTLY \(never changes\): Cream knit sweater\.$/m);
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
