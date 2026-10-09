'use strict';

const { slugify, excerpt } = require('./util/text');

function postSummary(post) {
  return { title: post.title, slug: slugify(post.title), excerpt: excerpt(post.body) };
}

module.exports = { postSummary };
