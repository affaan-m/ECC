'use strict';

// Baseline variant. Deliberately incomplete so the candidate has regressions to avoid.
function solve(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

module.exports = { solve };
