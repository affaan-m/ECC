'use strict';

/** Parses the nightly supplier feed, which is comma separated. */
function parseFeed(text) {
  return text.split('\n').filter(Boolean).map(line => line.split(','));
}

module.exports = { parseFeed };
