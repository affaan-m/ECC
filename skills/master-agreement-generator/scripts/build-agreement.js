#!/usr/bin/env node
'use strict';

/**
 * Build a counterparty master agreement from a template and a JSON spec.
 *
 * Usage: node build-agreement.js <template.md> <spec.json> <out_dir>
 *
 * Writes "<out_dir>/<spec.file> MASTER.md" and, when pandoc is on PATH,
 * the matching .docx. No dependencies. Node >= 18.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BLANK = '______________________________';
const EMPTY_SCHEDULE_ROW = '| | | *(no entries at signing)* | | | |';

const ROLE_CLAUSES = {
  buyer: {
    title: 'REFERRAL FEE',
    role: '{cp} appoints Us on a non-exclusive basis to source and introduce counterparties for {cp}\'s requirements, and {cp} pays Us the fee in Section 3 on each Transaction with a Protected Counterparty.',
    fee: '{cp} pays Us a referral fee on each Transaction between {cp} (or its affiliates) and a Protected Counterparty introduced by Us.',
  },
  supplier: {
    title: 'SOURCING FEE',
    role: '{cp} offers capacity to Us and to buyers We introduce, and pays Us the fee in Section 3 on each Transaction with a Protected Counterparty; where We elect to buy as principal for an entry, We contract directly with {cp} on the terms stated on Schedule A.',
    fee: '{cp} pays Us a sourcing fee on each Transaction between {cp} (or its affiliates) and a Protected Counterparty introduced by Us.',
  },
  mutual: {
    title: 'REFERRAL AND SOURCING FEE',
    role: 'Each Party may introduce the other to counterparties. The Party that closes a Transaction with a Protected Counterparty introduced by the other pays the fee in Section 3; where We supply {cp} as principal, Our economics are in Our price and no fee is payable on that entry.',
    fee: 'The Party that closes a Transaction with a Protected Counterparty first introduced by the other Party pays the introducing Party the fee below.',
  },
};

function defaultDate(now = new Date()) {
  return now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderScheduleRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return EMPTY_SCHEDULE_ROW;
  }
  return rows.map(row => `| ${row.map(cell => String(cell)).join(' | ')} |`).join('\n');
}

function buildValues(spec, now) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('spec must be an object');
  }
  for (const key of ['file', 'short', 'role']) {
    if (typeof spec[key] !== 'string' || spec[key].trim() === '') {
      throw new Error(`spec.${key} is required`);
    }
  }
  const clauses = ROLE_CLAUSES[spec.role];
  if (!clauses) {
    throw new Error(`unknown role "${spec.role}"; expected one of ${Object.keys(ROLE_CLAUSES).join(', ')}`);
  }
  const cp = spec.short;
  const fill = text => text.split('{cp}').join(cp);
  const supplement = typeof spec.supplement === 'string' && spec.supplement.trim() ? `${spec.supplement.trim()}; ` : '';

  return {
    FEE_TITLE: clauses.title,
    CP_SHORT: cp,
    DATE: spec.date || defaultDate(now),
    CP_LEGAL: spec.legal || BLANK,
    CP_JURIS: spec.juris || BLANK,
    CP_ADDR: spec.addr || BLANK,
    ROLE_CLAUSE: fill(clauses.role),
    FEE_CLAUSE: fill(clauses.fee),
    SCHEDULE_ROWS: renderScheduleRows(spec.schedule),
    SUPPLEMENT_CLAUSE: supplement,
    CP_SIGBLOCK: (spec.legal || cp).toUpperCase(),
    CP_SIGNER: spec.signer || BLANK,
    CP_TITLE: spec.title || BLANK,
    CP_EMAIL: spec.email || BLANK,
  };
}

function render(template, spec, now) {
  const values = buildValues(spec, now);
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.split(`{{${key}}}`).join(value);
  }
  const leftover = output.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) {
    throw new Error(`template has unfilled placeholders: ${[...new Set(leftover)].join(', ')}`);
  }
  return output;
}

function pandocAvailable() {
  const probe = spawnSync('pandoc', ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

function build(templatePath, specPath, outDir, options = {}) {
  const template = fs.readFileSync(templatePath, 'utf8');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const markdown = render(template, spec, options.now);
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `${spec.file} MASTER`);
  const mdPath = `${base}.md`;
  fs.writeFileSync(mdPath, markdown, 'utf8');

  const result = { markdown: mdPath, docx: null, docxSkipped: false };
  const canConvert = options.pandoc === undefined ? pandocAvailable() : options.pandoc;
  if (!canConvert) {
    result.docxSkipped = true;
    return result;
  }
  const docxPath = `${base}.docx`;
  const converted = spawnSync('pandoc', [mdPath, '-o', docxPath], { encoding: 'utf8' });
  if (converted.error || converted.status !== 0) {
    throw new Error(`pandoc failed: ${converted.stderr || converted.error?.message || 'unknown error'}`);
  }
  result.docx = docxPath;
  return result;
}

function main(argv) {
  const [templatePath, specPath, outDir] = argv;
  if (!templatePath || !specPath || !outDir) {
    console.error('usage: build-agreement.js <template.md> <spec.json> <out_dir>');
    return 2;
  }
  try {
    const result = build(templatePath, specPath, outDir);
    console.log(`wrote ${result.markdown}`);
    if (result.docxSkipped) {
      console.log('docx skipped: pandoc not found on PATH');
    } else {
      console.log(`wrote ${result.docx}`);
    }
    return 0;
  } catch (error) {
    console.error(`build-agreement: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { ROLE_CLAUSES, EMPTY_SCHEDULE_ROW, BLANK, buildValues, render, renderScheduleRows, build, main };
