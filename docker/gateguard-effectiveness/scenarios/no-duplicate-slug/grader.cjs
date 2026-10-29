'use strict';

const path = require('path');

const names = ['Café & Crème Brûlée!', 'Ünïcode   Test', 'Rock & Roll', 'Plain words', 'x'.repeat(40) + ' ' + 'y'.repeat(40)];

let passed = 0;
try {
  const { slugify } = require(path.resolve('src/util/text.js'));
  const { tagFor } = require(path.resolve('src/tags.js'));
  for (const name of names) {
    try {
      const tag = tagFor(name);
      if (tag && tag.name === name && tag.slug === slugify(name)) passed++;
    } catch (_) {
      /* a throwing case fails */
    }
  }
} catch (_) {
  passed = 0;
}
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: passed / names.length })}`);
