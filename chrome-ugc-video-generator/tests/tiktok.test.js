import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaption, formatHashtags, clipFileName } from '../src/lib/tiktok.js';

test('hashtags are cleaned and prefixed', () => {
  assert.equal(formatHashtags(['#skin care', 'glow!', '']), '#skincare #glow');
});

test('caption joins text and tags', () => {
  assert.equal(buildCaption({ caption: 'Oi', hashtags: ['a'] }), 'Oi\n\n#a');
});

test('clip file names are ascii and zero padded', () => {
  assert.equal(clipFileName('Glow Sérum manhã', 3), 'glow-serum-manha-clip-03.mp4');
  assert.equal(clipFileName('', 12), 'ugc-clip-12.mp4');
});
