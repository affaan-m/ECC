#!/usr/bin/env node
/**
 * Calibrate the offline chars-per-token estimate against the real tokenizer.
 *
 * This is a MANUAL tool, not a CI step: it makes network calls and needs an
 * API key. Run it once, read the reported ratio, and record it (with the
 * date and the model) in docs/PLUGIN-PROFILES.md under "The Token Ledger".
 * That is how CONSERVATIVE_CHARS_PER_TOKEN stops being an assertion and
 * becomes a measurement.
 *
 * Method: measure every corpus file with Anthropic count_tokens, compute the
 * observed chars/token per file, then report the ratio that would make the
 * estimate conservative (over-count) at the 95th percentile. Being
 * conservative means dividing by a SMALL chars/token number, so the ratio to
 * adopt is the 5th percentile of the observed values — the densest text in
 * the corpus, where a token buys the fewest characters.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... node scripts/ci/calibrate-token-estimate.js
 *   ANTHROPIC_API_KEY=... node scripts/ci/calibrate-token-estimate.js --model claude-opus-4-1
 *   node scripts/ci/calibrate-token-estimate.js --help
 *
 * The corpus lives in tests/fixtures/token-calibration/*.txt and should hold
 * real listing payloads, because that is the only text this estimate is ever
 * applied to.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  CONSERVATIVE_CHARS_PER_TOKEN,
  DEFAULT_PROVIDER_MODEL,
} = require('../lib/plugin-profiles/constants');
const { createProviderMeasurer } = require('../lib/plugin-profiles/ledger');

const CORPUS_DIR = path.resolve(__dirname, '../../tests/fixtures/token-calibration');

const HELP = `Usage: node scripts/ci/calibrate-token-estimate.js [--model <id>] [--corpus <dir>]

Measures tests/fixtures/token-calibration/*.txt with Anthropic count_tokens and
reports the chars-per-token ratio that keeps the offline estimate conservative.

Requires ANTHROPIC_API_KEY. Manual tool: not wired into CI.
`;

function parseArgs(argv) {
  const options = { model: DEFAULT_PROVIDER_MODEL, corpus: CORPUS_DIR, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--help' || argv[i] === '-h') {
      options.help = true;
    } else if (argv[i] === '--model') {
      options.model = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--corpus') {
      options.corpus = path.resolve(argv[i + 1]);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return options;
}

/**
 * Percentile of a sorted numeric array, by nearest rank.
 *
 * @param {Array<number>} sorted Ascending values.
 * @param {number} fraction Percentile in [0, 1].
 * @returns {number} Value at that percentile.
 */
function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return NaN;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function listCorpus(corpusDir) {
  if (!fs.existsSync(corpusDir)) {
    throw new Error(`Corpus directory not found: ${corpusDir}`);
  }
  const files = fs.readdirSync(corpusDir)
    .filter(name => name.endsWith('.txt'))
    .sort()
    .map(name => path.join(corpusDir, name));
  if (files.length === 0) {
    throw new Error(`No .txt files in ${corpusDir}`);
  }
  return files;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const measurer = createProviderMeasurer({ model: options.model });
  const files = listCorpus(options.corpus);
  const observed = [];

  console.log(`model: ${options.model}`);
  console.log(`corpus: ${options.corpus}`);
  console.log('');
  console.log('chars    tokens   chars/token  file');

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const tokens = measurer.measure(text);
    const ratio = text.length / tokens;
    observed.push(ratio);
    console.log(`${String(text.length).padStart(8)} ${String(tokens).padStart(8)} `
      + `${ratio.toFixed(3).padStart(12)}  ${path.basename(file)}`);
  }

  const sorted = [...observed].sort((a, b) => a - b);
  const p5 = percentile(sorted, 0.05);
  const median = percentile(sorted, 0.5);
  const min = sorted[0];

  console.log('');
  console.log(`observed chars/token: min ${min.toFixed(3)}, p5 ${p5.toFixed(3)}, median ${median.toFixed(3)}`);
  console.log(`current CONSERVATIVE_CHARS_PER_TOKEN: ${CONSERVATIVE_CHARS_PER_TOKEN}`);
  console.log('');
  console.log(`Adopt ${Math.floor(p5 * 100) / 100} to over-count at the 95th percentile.`);
  console.log(`Current setting is ${CONSERVATIVE_CHARS_PER_TOKEN <= p5 ? 'CONSERVATIVE' : 'NOT CONSERVATIVE'} `
    + `against this corpus.`);
  console.log('');
  console.log('Record the model, the date, and these numbers in');
  console.log('docs/PLUGIN-PROFILES.md under "The Token Ledger".');
}

try {
  main();
} catch (error) {
  console.error(`calibrate-token-estimate: ${error.message}`);
  process.exitCode = 1;
}
