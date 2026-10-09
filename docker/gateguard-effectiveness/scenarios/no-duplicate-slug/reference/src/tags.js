'use strict';

const { slugify } = require('./util/text');

function tagFor(name) {
  return { name, slug: slugify(name) };
}

module.exports = { tagFor };
