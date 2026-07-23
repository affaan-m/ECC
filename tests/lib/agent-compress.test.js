/**
 * Tests for scripts/lib/agent-compress.js
 *
 * Run with: node tests/lib/agent-compress.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { parseFrontmatter, extractSummary, loadAgent, loadAgents, compressToCatalog, compressToSummary, buildAgentCatalog, lazyLoadAgent } = require('../../scripts/lib/agent-compress');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing agent-compress ===\n');

  let passed = 0;
  let failed = 0;

  // --- parseFrontmatter ---

  if (
    test('parseFrontmatter extracts YAML frontmatter and body', () => {
      const content = '---\nname: test-agent\ndescription: A test\ntools: ["Read", "Grep"]\nmodel: sonnet\n---\n\nBody text here.';
      const { frontmatter, body } = parseFrontmatter(content);
      assert.strictEqual(frontmatter.name, 'test-agent');
      assert.strictEqual(frontmatter.description, 'A test');
      assert.deepStrictEqual(frontmatter.tools, ['Read', 'Grep']);
      assert.strictEqual(frontmatter.model, 'sonnet');
      assert.ok(body.includes('Body text here.'));
    })
  )
    passed++;
  else failed++;

  if (
    test('parseFrontmatter handles content without frontmatter', () => {
      const content = 'Just a regular markdown file.';
      const { frontmatter, body } = parseFrontmatter(content);
      assert.deepStrictEqual(frontmatter, {});
      assert.strictEqual(body, content);
    })
  )
    passed++;
  else failed++;

  if (
    test('parseFrontmatter handles colons in values', () => {
      const content = '---\nname: test\ndescription: Use this: it works\n---\n\nBody.';
      const { frontmatter } = parseFrontmatter(content);
      assert.strictEqual(frontmatter.description, 'Use this: it works');
    })
  )
    passed++;
  else failed++;

  if (
    test('parseFrontmatter strips surrounding quotes', () => {
      const content = '---\nname: "quoted-name"\n---\n\nBody.';
      const { frontmatter } = parseFrontmatter(content);
      assert.strictEqual(frontmatter.name, 'quoted-name');
    })
  )
    passed++;
  else failed++;

  if (
    test('parseFrontmatter handles content ending right after closing ---', () => {
      const content = '---\nname: test\ndescription: No body\n---';
      const { frontmatter, body } = parseFrontmatter(content);
      assert.strictEqual(frontmatter.name, 'test');
      assert.strictEqual(frontmatter.description, 'No body');
      assert.strictEqual(body, '');
    })
  )
    passed++;
  else failed++;

  // --- extractSummary ---

  if (
    test('extractSummary returns the first paragraph of the body', () => {
      const body = '# Heading\n\nThis is the first paragraph. It has two sentences.\n\nSecond paragraph.';
      const summary = extractSummary(body);
      assert.strictEqual(summary, 'This is the first paragraph.');
    })
  )
    passed++;
  else failed++;

  if (
    test('extractSummary returns empty string for empty body', () => {
      assert.strictEqual(extractSummary(''), '');
      assert.strictEqual(extractSummary('# Only Headings\n\n## Another'), '');
    })
  )
    passed++;
  else failed++;

  if (
    test('extractSummary skips code blocks', () => {
      const body = '```\ncode here\n```\n\nActual summary sentence.';
      const summary = extractSummary(body);
      assert.strictEqual(summary, 'Actual summary sentence.');
    })
  )
    passed++;
  else failed++;

  if (
    test('extractSummary respects maxSentences', () => {
      const body = 'First sentence. Second sentence. Third sentence.';
      const one = extractSummary(body, 1);
      const two = extractSummary(body, 2);
      assert.strictEqual(one, 'First sentence.');
      assert.strictEqual(two, 'First sentence. Second sentence.');
    })
  )
    passed++;
  else failed++;

  if (
    test('extractSummary skips plain bullet items', () => {
      const body = '- plain bullet\n- another bullet\n\nActual paragraph here.';
      const summary = extractSummary(body);
      assert.strictEqual(summary, 'Actual paragraph here.');
    })
  )
    passed++;
  else failed++;

  if (
    test('extractSummary skips asterisk bullets and numbered lists', () => {
      const body = '* star bullet\n1. numbered item\n2. second item\n\nReal paragraph.';
      const summary = extractSummary(body);
      assert.strictEqual(summary, 'Real paragraph.');
    })
  )
    passed++;
  else failed++;

  // --- loadAgent / loadAgents ---

  // Create a temp directory with test agent files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-compress-test-'));
  const agentContent = '---\nname: test-agent\ndescription: A test agent\ntools: ["Read"]\nmodel: haiku\n---\n\nTest agent body paragraph.\n\n## Details\nMore info.';
  fs.writeFileSync(path.join(tmpDir, 'test-agent.md'), agentContent);
  fs.writeFileSync(path.join(tmpDir, 'not-an-agent.txt'), 'ignored');

  if (
    test('loadAgent reads and parses a single agent file', () => {
      const agent = loadAgent(path.join(tmpDir, 'test-agent.md'));
      assert.strictEqual(agent.name, 'test-agent');
      assert.strictEqual(agent.description, 'A test agent');
      assert.deepStrictEqual(agent.tools, ['Read']);
      assert.strictEqual(agent.model, 'haiku');
      assert.ok(agent.body.includes('Test agent body paragraph'));
      assert.strictEqual(agent.fileName, 'test-agent');
      assert.ok(agent.byteSize > 0);
    })
  )
    passed++;
  else failed++;

  if (
    test('loadAgents reads all .md files from a directory', () => {
      const agents = loadAgents(tmpDir);
      assert.strictEqual(agents.length, 1);
      assert.strictEqual(agents[0].name, 'test-agent');
    })
  )
    passed++;
  else failed++;

  if (
    test('loadAgents returns empty array for non-existent directory', () => {
      const agents = loadAgents(path.join(os.tmpdir(), 'does-not-exist-agent-compress-test'));
      assert.deepStrictEqual(agents, []);
    })
  )
    passed++;
  else failed++;

  // --- compressToCatalog / compressToSummary ---

  const sampleAgent = loadAgent(path.join(tmpDir, 'test-agent.md'));

  if (
    test('compressToCatalog strips body and keeps only metadata', () => {
      const catalog = compressToCatalog(sampleAgent);
      assert.strictEqual(catalog.name, 'test-agent');
      assert.strictEqual(catalog.description, 'A test agent');
      assert.deepStrictEqual(catalog.tools, ['Read']);
      assert.strictEqual(catalog.model, 'haiku');
      assert.strictEqual(catalog.body, undefined);
      assert.strictEqual(catalog.byteSize, undefined);
    })
  )
    passed++;
  else failed++;

  if (
    test('compressToSummary includes first paragraph summary', () => {
      const summary = compressToSummary(sampleAgent);
      assert.strictEqual(summary.name, 'test-agent');
      assert.ok(summary.summary.includes('Test agent body paragraph'));
      assert.strictEqual(summary.body, undefined);
    })
  )
    passed++;
  else failed++;

  // --- buildAgentCatalog ---

  if (
    test('buildAgentCatalog in catalog mode produces minimal output with stats', () => {
      const result = buildAgentCatalog(tmpDir, { mode: 'catalog' });
      assert.strictEqual(result.agents.length, 1);
      assert.strictEqual(result.agents[0].body, undefined);
      assert.strictEqual(result.stats.totalAgents, 1);
      assert.strictEqual(result.stats.mode, 'catalog');
      assert.ok(result.stats.originalBytes > 0);
      assert.ok(result.stats.compressedBytes < result.stats.originalBytes);
      assert.ok(result.stats.compressedTokenEstimate > 0);
    })
  )
    passed++;
  else failed++;

  if (
    test('buildAgentCatalog in summary mode includes summaries', () => {
      const result = buildAgentCatalog(tmpDir, { mode: 'summary' });
      assert.ok(result.agents[0].summary);
      assert.strictEqual(result.agents[0].body, undefined);
    })
  )
    passed++;
  else failed++;

  if (
    test('buildAgentCatalog in full mode preserves body', () => {
      const result = buildAgentCatalog(tmpDir, { mode: 'full' });
      assert.ok(result.agents[0].body);
    })
  )
    passed++;
  else failed++;

  if (
    test('buildAgentCatalog throws on invalid mode', () => {
      assert.throws(() => buildAgentCatalog(tmpDir, { mode: 'invalid' }), /Invalid mode "invalid"/);
    })
  )
    passed++;
  else failed++;

  if (
    test('buildAgentCatalog supports filter function', () => {
      // Add a second agent
      fs.writeFileSync(path.join(tmpDir, 'other-agent.md'), '---\nname: other\ndescription: Other agent\ntools: ["Bash"]\nmodel: opus\n---\n\nOther body.');
      const result = buildAgentCatalog(tmpDir, {
        filter: a => a.model === 'opus'
      });
      assert.strictEqual(result.agents.length, 1);
      assert.strictEqual(result.agents[0].name, 'other');
      // Clean up
      fs.unlinkSync(path.join(tmpDir, 'other-agent.md'));
    })
  )
    passed++;
  else failed++;

  // --- lazyLoadAgent ---

  if (
    test('lazyLoadAgent loads a single agent by name', () => {
      const agent = lazyLoadAgent(tmpDir, 'test-agent');
      assert.ok(agent);
      assert.strictEqual(agent.name, 'test-agent');
      assert.ok(agent.body.includes('Test agent body paragraph'));
    })
  )
    passed++;
  else failed++;

  if (
    test('lazyLoadAgent returns null for non-existent agent', () => {
      const agent = lazyLoadAgent(tmpDir, 'does-not-exist');
      assert.strictEqual(agent, null);
    })
  )
    passed++;
  else failed++;

  if (
    test('lazyLoadAgent rejects path traversal attempts', () => {
      const agent = lazyLoadAgent(tmpDir, '../etc/passwd');
      assert.strictEqual(agent, null);
    })
  )
    passed++;
  else failed++;

  if (
    test('lazyLoadAgent rejects names with invalid characters', () => {
      const agent = lazyLoadAgent(tmpDir, 'foo/bar');
      assert.strictEqual(agent, null);
      const agent2 = lazyLoadAgent(tmpDir, 'foo bar');
      assert.strictEqual(agent2, null);
    })
  )
    passed++;
  else failed++;

  // --- Real agents directory ---

  const realAgentsDir = path.resolve(__dirname, '../../agents');
  if (
    test('buildAgentCatalog works with real agents directory', () => {
      if (!fs.existsSync(realAgentsDir)) return; // skip if not present
      const result = buildAgentCatalog(realAgentsDir, { mode: 'catalog' });
      assert.ok(result.agents.length > 0, 'Should find at least one agent');
      assert.ok(result.stats.compressedBytes < result.stats.originalBytes, 'Catalog should be smaller than original');
      // Verify significant compression ratio
      const ratio = result.stats.compressedBytes / result.stats.originalBytes;
      assert.ok(ratio < 0.5, `Compression ratio ${ratio.toFixed(2)} should be < 0.5`);
    })
  )
    passed++;
  else failed++;

  if (
    test('catalog mode token estimate is under 6000 for real agents', () => {
      if (!fs.existsSync(realAgentsDir)) return;
      const result = buildAgentCatalog(realAgentsDir, { mode: 'catalog' });
      // Canary tracks catalog growth: raised 5000 -> 6000 for the 67-agent catalog
      // after adding spec-miner (#2253), agent-evaluator (#2220), vue-reviewer (#2241).
      assert.ok(result.stats.compressedTokenEstimate < 6000, `Token estimate ${result.stats.compressedTokenEstimate} exceeds 6000`);
    })
  )
    passed++;
  else failed++;

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
