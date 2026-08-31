/**
 * Tests for scripts/ci/generate-discovery-index.js and scripts/lib/discovery-index.js
 */

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'ci', 'generate-discovery-index.js');
const { buildCatalog, countByType } = require('../../scripts/lib/discovery-index');
const {
  buildArtifacts,
  renderLlmsTxt,
  renderSitemap,
  findStale,
} = require('../../scripts/ci/generate-discovery-index');

function run(args = []) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
  }
}

console.log('\ngenerate-discovery-index');

const entries = buildCatalog();

test('indexes skills, agents, and commands', () => {
  const counts = countByType(entries);
  assert.ok(counts.skill > 200, `expected 200+ skills, got ${counts.skill}`);
  assert.ok(counts.agent > 50, `expected 50+ agents, got ${counts.agent}`);
  assert.ok(counts.command > 50, `expected 50+ commands, got ${counts.command}`);
});

test('every entry has a slug, summary, and site url', () => {
  const broken = entries.filter(entry => (
    !entry.slug || !entry.summary || !entry.url.startsWith('https://ecc.tools/')
  ));
  assert.strictEqual(broken.length, 0, `incomplete entries: ${broken.slice(0, 3).map(e => e.slug).join(', ')}`);
});

test('entry urls are unique per surface', () => {
  const urls = entries.map(entry => entry.url);
  assert.strictEqual(new Set(urls).size, urls.length, 'duplicate catalog urls');
});

test('summaries stay within a meta-description budget', () => {
  const tooLong = entries.filter(entry => entry.summary.length > 300);
  assert.strictEqual(tooLong.length, 0, `oversized summaries: ${tooLong.length}`);
});

test('llms.txt follows the llmstxt.org shape', () => {
  const llms = renderLlmsTxt(entries);
  assert.ok(llms.startsWith('# ECC\n'), 'missing H1 title');
  assert.ok(llms.includes('\n> '), 'missing blockquote summary');
  assert.ok(llms.includes('## Overview'), 'missing Overview section');
  assert.ok(llms.includes('npx ecc-universal setup'), 'missing install command');
});

test('sitemap fragment lists one url per surface', () => {
  const sitemap = renderSitemap(entries);
  const locCount = (sitemap.match(/<loc>/g) || []).length;
  assert.strictEqual(locCount, entries.length, 'sitemap url count mismatch');
  assert.ok(sitemap.startsWith('<?xml'), 'missing xml declaration');
});

test('committed artifacts are up to date', () => {
  const stale = findStale(buildArtifacts(entries));
  assert.strictEqual(stale.length, 0, `stale: ${stale.join(', ')}`);
});

test('--check passes against committed artifacts', () => {
  const result = run(['--check']);
  assert.strictEqual(result.code, 0, result.stderr);
});

test('--json emits a parseable index', () => {
  const result = run(['--json']);
  assert.strictEqual(result.code, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.entries.length, parsed.total);
});

test('rejects unknown arguments', () => {
  const result = run(['--nope']);
  assert.strictEqual(result.code, 1);
  assert.ok(result.stderr.includes('Unknown argument'), result.stderr);
});

if (failures > 0) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log('\nAll generate-discovery-index tests passed');
