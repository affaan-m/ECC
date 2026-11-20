'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const reviewPrCommandPath = path.join(repoRoot, 'commands', 'review-pr.md');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function readReviewPrCommand() {
  return fs.readFileSync(reviewPrCommandPath, 'utf8');
}

console.log('\n=== Testing /review-pr command prompt ===\n');

test('/review-pr picks the provider from an explicit URL before the origin remote', () => {
  const source = readReviewPrCommand();

  assert.ok(
    source.includes('If the argument is a URL, its host decides'),
    'Expected an explicit PR or MR URL to select the provider',
  );
  assert.ok(
    source.includes('Otherwise (a number or no argument), use GitLab when the `origin` remote points to a GitLab host, and GitHub in every other case'),
    'Expected origin to be consulted only for a number or no argument, with GitHub as the fallback',
  );
});

test('/review-pr fetches both details and the diff on GitHub', () => {
  const source = readReviewPrCommand();

  assert.ok(source.includes('`gh pr view`'), 'Expected gh pr view for GitHub PR details');
  assert.ok(source.includes('`gh pr diff`'), 'Expected gh pr diff, since gh pr view does not return the diff');
});

test('/review-pr fetches both details and the diff on GitLab', () => {
  const source = readReviewPrCommand();

  assert.ok(source.includes('`glab mr view`'), 'Expected glab mr view for GitLab MR details');
  assert.ok(source.includes('`glab mr diff`'), 'Expected glab mr diff for the GitLab MR diff');
});

test('/review-pr gives the review agents the fetched diff, not local git state', () => {
  const source = readReviewPrCommand();

  assert.ok(
    source.includes('give each agent the diff from step 1 as its review input'),
    'Expected step 3 to pass the step 1 diff to each agent',
  );
  assert.ok(
    source.includes('do not let an agent substitute local `git diff` output'),
    'Expected step 3 to forbid substituting local git diff output',
  );
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
