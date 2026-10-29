'use strict';

const MAX_SLUG = 60;

function slugify(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/, '');
}

function excerpt(text, words = 30) {
  return String(text).split(/\s+/).slice(0, words).join(' ');
}

module.exports = { slugify, excerpt };
