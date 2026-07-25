'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCompany,
  listCompanies,
  addNote,
  archiveCompany,
  removeCompany,
  segmentSummary
} = require('../src/watchlist-store');

test('createCompany adds a watching company with a sequential id', () => {
  const { companies, company } = createCompany([], { name: 'Voltus', segment: 'Demand Response' });
  assert.equal(companies.length, 1);
  assert.equal(company.id, 1);
  assert.equal(company.name, 'Voltus');
  assert.equal(company.segment, 'Demand Response');
  assert.equal(company.status, 'watching');
  assert.deepEqual(company.notes, []);
});

test('createCompany assigns increasing ids based on existing companies', () => {
  const existing = [{ id: 1, name: 'a', segment: 's', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' }];
  const { company } = createCompany(existing, { name: 'b', segment: 's' });
  assert.equal(company.id, 2);
});

test('createCompany does not mutate the original companies array', () => {
  const original = [];
  createCompany(original, { name: 'a', segment: 's' });
  assert.equal(original.length, 0);
});

test('createCompany rejects a missing or blank name', () => {
  assert.throws(() => createCompany([], { name: '', segment: 's' }), /name/i);
  assert.throws(() => createCompany([], { name: '   ', segment: 's' }), /name/i);
});

test('createCompany rejects a missing or blank segment', () => {
  assert.throws(() => createCompany([], { name: 'Voltus', segment: '' }), /segment/i);
});

test('createCompany stores optional stage, source and an initial note', () => {
  const { company } = createCompany([], {
    name: 'Voltus',
    segment: 'Demand Response',
    stage: 'Series C',
    source: 'https://example.com/voltus',
    notes: 'Piloting with two utilities'
  });
  assert.equal(company.stage, 'Series C');
  assert.equal(company.source, 'https://example.com/voltus');
  assert.equal(company.notes.length, 1);
  assert.equal(company.notes[0].text, 'Piloting with two utilities');
});

test('listCompanies returns only watching companies by default', () => {
  const companies = [
    { id: 1, name: 'a', segment: 's', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' },
    { id: 2, name: 'b', segment: 's', status: 'archived', notes: [], createdAt: 'x', updatedAt: 'x' }
  ];
  const result = listCompanies(companies);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 1);
});

test('listCompanies returns archived companies too when all is set', () => {
  const companies = [
    { id: 1, name: 'a', segment: 's', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' },
    { id: 2, name: 'b', segment: 's', status: 'archived', notes: [], createdAt: 'x', updatedAt: 'x' }
  ];
  const result = listCompanies(companies, { all: true });
  assert.equal(result.length, 2);
});

test('listCompanies filters by segment case-insensitively', () => {
  const companies = [
    { id: 1, name: 'a', segment: 'DERMS', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' },
    { id: 2, name: 'b', segment: 'VPP', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' }
  ];
  const result = listCompanies(companies, { segment: 'derms' });
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'a');
});

test('addNote appends a timestamped note without touching other companies', () => {
  const companies = [
    { id: 1, name: 'a', segment: 's', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' },
    { id: 2, name: 'b', segment: 's', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' }
  ];
  const result = addNote(companies, 1, 'Raised Series B');
  const updated = result.find(item => item.id === 1);
  assert.equal(updated.notes.length, 1);
  assert.equal(updated.notes[0].text, 'Raised Series B');
  assert.ok(updated.notes[0].at);
  assert.equal(result.find(item => item.id === 2).notes.length, 0);
});

test('addNote rejects blank note text', () => {
  const companies = [{ id: 1, name: 'a', segment: 's', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' }];
  assert.throws(() => addNote(companies, 1, '  '), /note/i);
});

test('addNote throws for an unknown id', () => {
  assert.throws(() => addNote([], 99, 'text'), /not found/i);
});

test('archiveCompany marks a company archived and is idempotent', () => {
  const companies = [{ id: 1, name: 'a', segment: 's', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' }];
  const once = archiveCompany(companies, 1);
  assert.equal(once.find(item => item.id === 1).status, 'archived');
  const twice = archiveCompany(once, 1);
  assert.equal(twice.find(item => item.id === 1).status, 'archived');
});

test('archiveCompany throws for an unknown id', () => {
  assert.throws(() => archiveCompany([], 99), /not found/i);
});

test('removeCompany deletes only the matching company', () => {
  const companies = [
    { id: 1, name: 'a', segment: 's', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' },
    { id: 2, name: 'b', segment: 's', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' }
  ];
  const result = removeCompany(companies, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 2);
});

test('removeCompany throws for an unknown id', () => {
  assert.throws(() => removeCompany([], 99), /not found/i);
});

test('segmentSummary counts watching companies per segment, sorted by count then name', () => {
  const companies = [
    { id: 1, name: 'a', segment: 'DERMS', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' },
    { id: 2, name: 'b', segment: 'VPP', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' },
    { id: 3, name: 'c', segment: 'DERMS', status: 'watching', notes: [], createdAt: 'x', updatedAt: 'x' },
    { id: 4, name: 'd', segment: 'VPP', status: 'archived', notes: [], createdAt: 'x', updatedAt: 'x' }
  ];
  const summary = segmentSummary(companies);
  assert.deepEqual(summary, [
    { segment: 'DERMS', count: 2 },
    { segment: 'VPP', count: 1 }
  ]);
});
