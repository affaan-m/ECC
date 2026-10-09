'use strict';

function tagFor(name) {
  const slug = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return { name, slug };
}

module.exports = { tagFor };
