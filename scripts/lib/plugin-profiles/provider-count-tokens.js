#!/usr/bin/env node
/**
 * One-shot Anthropic count_tokens call, driven over stdin/stdout.
 *
 * The ledger API is synchronous everywhere else. Rather than make every
 * caller async for one optional, opt-in path, `--measure provider` spawns
 * this script with `{ text, model }` on stdin and reads
 * `{ inputTokens }` from stdout.
 *
 * This is the ONLY place in plugin-profiles that touches the network, and it
 * only runs when the operator explicitly passes `--measure provider`. It
 * refuses without ANTHROPIC_API_KEY rather than degrading to an estimate.
 *
 * Usage:
 *   echo '{"text":"...","model":"claude-sonnet-4-5"}' | node provider-count-tokens.js
 */

'use strict';

const API_URL = 'https://api.anthropic.com/v1/messages/count_tokens';
const API_VERSION = '2023-06-01';

function readStdin() {
  return new Promise((resolve, reject) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { raw += chunk; });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write('ANTHROPIC_API_KEY is not set\n');
    process.exit(1);
  }

  const { text, model } = JSON.parse(await readStdin());
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: String(text || '') }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    process.stderr.write(`count_tokens returned ${response.status}: ${detail.slice(0, 400)}\n`);
    process.exit(1);
  }

  const payload = await response.json();
  process.stdout.write(JSON.stringify({ inputTokens: payload.input_tokens }));
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
