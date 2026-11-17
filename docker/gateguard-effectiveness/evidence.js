'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashFile(file) {
  return sha256(fs.readFileSync(file));
}

function hashDirectory(dir) {
  const entries = [];
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const child = path.join(current, entry.name);
      const name = path.posix.join(relative.split(path.sep).join('/'), entry.name);
      if (entry.isDirectory()) visit(child, name);
      else if (entry.isFile()) entries.push({ path: name, sha256: hashFile(child) });
      else throw new Error(`unsupported evidence input: ${child}`);
    }
  }
  visit(dir);
  return sha256(JSON.stringify(entries));
}

function validateRows(rows, trials) {
  const scheduled = new Map(trials.map(trial => [trial.key, trial]));
  const validKeys = new Set();
  for (const row of rows) {
    if (!row || typeof row.key !== 'string' || !scheduled.has(row.key)) {
      throw new Error(`result row has an unknown scheduled key: ${row && row.key}`);
    }
    const trial = scheduled.get(row.key);
    if (row.scenario !== trial.scenario.id || row.arm !== trial.arm || row.rep !== trial.rep) {
      throw new Error(`result row does not match its scheduled key: ${row.key}`);
    }
    if (!row.providerError && !row.timedOut && !row.judgeFailed) {
      if (validKeys.has(row.key)) throw new Error(`duplicate valid result row: ${row.key}`);
      validKeys.add(row.key);
    }
  }
  return validKeys;
}

function buildManifest({ meta, configuration, scenarioFingerprints, sourceFingerprints, outDir, rows = [] }) {
  const files = {};
  for (const name of ['meta.json', 'results.jsonl', 'holes.md', 'summary.json']) {
    const file = path.join(outDir, name);
    if (fs.existsSync(file)) files[name] = { bytes: fs.statSync(file).size, sha256: hashFile(file) };
  }
  const transcriptsDir = path.join(outDir, 'transcripts');
  if (fs.existsSync(transcriptsDir)) {
    for (const name of fs.readdirSync(transcriptsDir).sort()) {
      const file = path.join(transcriptsDir, name);
      if (fs.statSync(file).isFile()) files[`transcripts/${name}`] = { bytes: fs.statSync(file).size, sha256: hashFile(file) };
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    meta,
    configuration,
    scenarioFingerprints,
    sourceFingerprints,
    integrity: { rowTranscriptLinks: rows.length > 0 && rows.every(row => Boolean(row.transcript && row.transcriptSha256)) },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    files
  };
}

function verifyManifest(outDir) {
  const manifestPath = path.join(outDir, 'evidence.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== SCHEMA_VERSION || !manifest.files || typeof manifest.files !== 'object') {
    throw new Error('unsupported or malformed evidence manifest');
  }
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = path.resolve(outDir, name);
    if (!file.startsWith(`${path.resolve(outDir)}${path.sep}`)) throw new Error(`invalid evidence path: ${name}`);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`missing evidence artifact: ${name}`);
    const actual = hashFile(file);
    if (actual !== expected.sha256 || fs.statSync(file).size !== expected.bytes) {
      throw new Error(`evidence artifact checksum mismatch: ${name}`);
    }
  }
  if (manifest.integrity && manifest.integrity.rowTranscriptLinks) {
    const resultFile = path.join(outDir, 'results.jsonl');
    if (!fs.existsSync(resultFile)) throw new Error('results.jsonl is missing from a transcript-linked bundle');
    const rows = fs.readFileSync(resultFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    for (const row of rows) {
      const transcript = manifest.files[row.transcript];
      if (!transcript || transcript.sha256 !== row.transcriptSha256) {
        throw new Error(`result transcript link is missing or mismatched: ${row.key}`);
      }
    }
  }
  return manifest;
}

module.exports = { SCHEMA_VERSION, hashFile, hashDirectory, validateRows, buildManifest, verifyManifest };
