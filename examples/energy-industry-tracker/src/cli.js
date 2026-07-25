'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  createCompany,
  listCompanies,
  addNote,
  archiveCompany,
  removeCompany,
  segmentSummary,
  findCompanyOrThrow
} = require('./watchlist-store');

const DEFAULT_FILE = '.energy-tracker.json';

function loadCompanies(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  return raw.length === 0 ? [] : JSON.parse(raw);
}

function saveCompanies(filePath, companies) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(companies, null, 2)}\n`);
}

function parseArgs(argv) {
  const positional = [];
  const options = { file: DEFAULT_FILE, all: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file') {
      options.file = argv[++i];
    } else if (arg === '--segment') {
      options.segment = argv[++i];
    } else if (arg === '--stage') {
      options.stage = argv[++i];
    } else if (arg === '--source') {
      options.source = argv[++i];
    } else if (arg === '--notes') {
      options.notes = argv[++i];
    } else if (arg === '--all') {
      options.all = true;
    } else {
      positional.push(arg);
    }
  }

  return { positional, options };
}

function formatCompanyLine(company) {
  const flag = company.status === 'archived' ? '[archived]' : '[watching]';
  const stage = company.stage ? ` (${company.stage})` : '';
  return `${flag} #${company.id} ${company.name} — ${company.segment}${stage}`;
}

function cmdAdd(positional, options, companies, streams) {
  const name = positional[0];
  if (!options.segment) {
    streams.stderr.write('Error: --segment is required\n');
    return 1;
  }

  const { companies: updated, company } = createCompany(companies, {
    name,
    segment: options.segment,
    stage: options.stage,
    source: options.source,
    notes: options.notes
  });

  saveCompanies(options.file, updated);
  streams.stdout.write(`Added #${company.id} ${company.name}\n`);
  return 0;
}

function cmdList(_positional, options, companies, streams) {
  const result = listCompanies(companies, { all: options.all, segment: options.segment });
  if (result.length === 0) {
    streams.stdout.write('No companies tracked.\n');
    return 0;
  }
  for (const company of result) {
    streams.stdout.write(`${formatCompanyLine(company)}\n`);
  }
  return 0;
}

function cmdShow(positional, _options, companies, streams) {
  const id = Number(positional[0]);
  const company = findCompanyOrThrow(companies, id);
  streams.stdout.write(`${formatCompanyLine(company)}\n`);
  if (company.source) {
    streams.stdout.write(`Source: ${company.source}\n`);
  }
  if (company.notes.length === 0) {
    streams.stdout.write('No notes.\n');
  } else {
    streams.stdout.write('Notes:\n');
    for (const note of company.notes) {
      streams.stdout.write(`  - [${note.at}] ${note.text}\n`);
    }
  }
  return 0;
}

function cmdNote(positional, options, companies, streams) {
  const id = Number(positional[0]);
  const text = positional.slice(1).join(' ');
  const updated = addNote(companies, id, text);
  saveCompanies(options.file, updated);
  streams.stdout.write(`Noted on #${id}\n`);
  return 0;
}

function cmdArchive(positional, options, companies, streams) {
  const id = Number(positional[0]);
  const updated = archiveCompany(companies, id);
  saveCompanies(options.file, updated);
  streams.stdout.write(`Archived #${id}\n`);
  return 0;
}

function cmdRm(positional, options, companies, streams) {
  const id = Number(positional[0]);
  const updated = removeCompany(companies, id);
  saveCompanies(options.file, updated);
  streams.stdout.write(`Removed #${id}\n`);
  return 0;
}

function cmdSegments(_positional, _options, companies, streams) {
  const summary = segmentSummary(companies);
  if (summary.length === 0) {
    streams.stdout.write('No segments tracked.\n');
    return 0;
  }
  for (const { segment, count } of summary) {
    streams.stdout.write(`${segment}\t${count}\n`);
  }
  return 0;
}

const COMMANDS = {
  add: cmdAdd,
  list: cmdList,
  show: cmdShow,
  note: cmdNote,
  archive: cmdArchive,
  rm: cmdRm,
  segments: cmdSegments
};

function main(argv, streams = { stdout: process.stdout, stderr: process.stderr }) {
  const { positional, options } = parseArgs(argv);
  const [command, ...commandArgs] = positional;
  const handler = COMMANDS[command];

  if (!handler) {
    streams.stderr.write(`Error: unknown command "${command || ''}"\n`);
    streams.stderr.write(`Available commands: ${Object.keys(COMMANDS).join(', ')}\n`);
    return 1;
  }

  try {
    const companies = loadCompanies(options.file);
    return handler(commandArgs, options, companies, streams);
  } catch (error) {
    streams.stderr.write(`Error: ${error.message}\n`);
    return 1;
  }
}

module.exports = { main };
