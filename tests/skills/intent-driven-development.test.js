
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

const skill = fs.readFileSync(
  path.join(root, 'skills/intent-driven-development/SKILL.md'),
  'utf8'
);

const handoffExample =
  skill.split('### Existing-Issue Handoff Example')[1]
    ?.split('\n## ')[0] || '';

test('documents verified progress across issue updates', () => {
  assert.match(handoffExample, /Verified progress/i);
  assert.match(handoffExample, /Phase A/i);
  assert.match(handoffExample, /Phase B/i);
  assert.match(handoffExample, /evidence/i);
  assert.match(handoffExample, /acceptance check/i);
});

test('distinguishes unverified completion claims', () => {
  assert.match(handoffExample, /Unverified claim/i);
  assert.match(handoffExample, /uncertain/i);
});

test('distinguishes captured data from accepted work', () => {
  assert.match(handoffExample, /Captured versus accepted/i);
  assert.match(handoffExample, /unknown total/i);
  assert.match(handoffExample, /limited subset/i);
});

test('requires read-back after authorized issue edits', () => {
  const handoff = skill.split('## Handoff')[1] || '';
  assert.match(handoff, /read-back/i);
  assert.match(handoff, /authorized/i);
});


test('preserves authorization and original scope', () => {
  const handoff = skill.split('## Handoff')[1] || '';

  assert.match(
    handoff,
    /Preserve the original\s+scope unless an authorized change/i
  );

  assert.match(
    handoff,
    /Only modify the issue description when authorized/i
  );

  assert.match(
    handoff,
    /If verification\s+fails,\s+report the mismatch/i
  );
});


// Contract checks for the synthetic handoff scenarios.
// These verify documented rules, not real agent behavior.

function categoryRow(category) {
  const line = handoffExample.split('\n').find(
    line => new RegExp(`^\\|\\s*${category}\\s*\\|`).test(line)
  );

  assert.ok(line, `Missing category ${category}`);

  const cells = line.split('|').slice(1, -1).map(
    cell => cell.trim()
  );

  assert.equal(cells.length, 5, `Category ${category} needs five fields`);
  return cells;
}

test('provides a reconciled issue description as an unpublished draft', () => {
  const draft = handoffExample
    .split('**Reconciled issue state')[1]
    ?.split('**Unverified claim variant:**')[0] || '';

  assert.ok(draft, 'Missing reconciled issue state');
  assert.match(draft, /draft|proposed/i);
  assert.match(draft, /not published|authorization/i);
  assert.match(draft, /Phase A:\s*Completed/i);
  assert.match(draft, /review/i);
  assert.match(draft, /test/i);
  assert.match(draft, /Phase B:\s*(Pending|Still pending)/i);
  assert.match(draft, /API contract/i);
  assert.match(draft, /Next action:/i);
  assert.match(draft, /Prerequisite:/i);
  assert.match(draft, /Acceptance check:/i);
});

test('category table explicitly tracks missing prerequisites', () => {
  const header = handoffExample.split('\n').find(
    line => line.trim().startsWith('| Category |')
  );

  assert.ok(header, 'Missing category table');
  const columns = header.split('|').slice(1, -1).map(
    cell => cell.trim()
  );

  assert.deepEqual(columns, [
    'Category',
    'Verified state',
    'Missing prerequisite/evidence',
    'Next action',
    'Acceptance check',
  ]);
});

test('category A distinguishes captured from accepted records', () => {
  const row = categoryRow('A');
  assert.match(row[1], /captured.*not accepted/i);
  assert.match(row[2], /acceptance|validation|review/i);
  assert.match(row[3], /validate|review/i);
  assert.match(row[4], /checks pass|accepted|acceptance.*recorded/i);
});

test('category B preserves unknown source and unknown total', () => {
  const row = categoryRow('B');
  assert.match(row[1], /source not established/i);
  assert.match(row[1], /unknown total/i);
  assert.match(row[2], /authoritative source|source.*coverage/i);
  assert.match(row[3], /identify|establish/i);
  assert.match(row[4], /verified|confirmed/i);
});

test('category C does not infer global absence from a subset', () => {
  const row = categoryRow('C');
  assert.match(row[1], /limited subset.*zero records/i);
  assert.match(row[2], /subset|coverage|scope/i);
  assert.match(row[3], /determine|verify|establish/i);
  assert.match(row[4], /global absence.*not inferred|not.*global absence/i);
});
