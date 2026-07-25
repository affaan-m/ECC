'use strict';

function nextId(companies) {
  return companies.reduce((max, company) => Math.max(max, company.id), 0) + 1;
}

function findCompanyOrThrow(companies, id) {
  const company = companies.find(item => item.id === id);
  if (!company) {
    throw new Error(`Company not found: ${id}`);
  }
  return company;
}

function createCompany(companies, { name, segment, stage = null, source = null, notes = null } = {}) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError('Company name must be a non-empty string');
  }
  if (typeof segment !== 'string' || segment.trim().length === 0) {
    throw new TypeError('Company segment must be a non-empty string');
  }

  const now = new Date().toISOString();
  const company = {
    id: nextId(companies),
    name: name.trim(),
    segment: segment.trim(),
    stage: stage && stage.trim().length > 0 ? stage.trim() : null,
    source: source && source.trim().length > 0 ? source.trim() : null,
    status: 'watching',
    notes: notes && notes.trim().length > 0 ? [{ text: notes.trim(), at: now }] : [],
    createdAt: now,
    updatedAt: now
  };

  return { companies: [...companies, company], company };
}

function listCompanies(companies, { all = false, segment = null } = {}) {
  let result = all ? companies.slice() : companies.filter(company => company.status !== 'archived');
  if (segment) {
    const target = segment.trim().toLowerCase();
    result = result.filter(company => company.segment.toLowerCase() === target);
  }
  return result;
}

function addNote(companies, id, text) {
  findCompanyOrThrow(companies, id);
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new TypeError('Note text must be a non-empty string');
  }

  const now = new Date().toISOString();
  return companies.map(company =>
    company.id === id
      ? { ...company, notes: [...company.notes, { text: text.trim(), at: now }], updatedAt: now }
      : company
  );
}

function archiveCompany(companies, id) {
  findCompanyOrThrow(companies, id);
  const now = new Date().toISOString();
  return companies.map(company =>
    company.id === id ? { ...company, status: 'archived', updatedAt: now } : company
  );
}

function removeCompany(companies, id) {
  findCompanyOrThrow(companies, id);
  return companies.filter(company => company.id !== id);
}

function segmentSummary(companies) {
  const counts = new Map();
  for (const company of companies) {
    if (company.status !== 'watching') continue;
    counts.set(company.segment, (counts.get(company.segment) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([segment, count]) => ({ segment, count }))
    .sort((a, b) => b.count - a.count || a.segment.localeCompare(b.segment));
}

module.exports = {
  createCompany,
  listCompanies,
  addNote,
  archiveCompany,
  removeCompany,
  segmentSummary,
  findCompanyOrThrow
};
