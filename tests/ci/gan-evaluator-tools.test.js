/**
 * Regression coverage for the GAN evaluator's live-browser capability.
 *
 * Run with: node tests/ci/gan-evaluator-tools.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const evaluatorPath = path.join(__dirname, '..', '..', 'agents', 'gan-evaluator.md');
const content = fs.readFileSync(evaluatorPath, 'utf8');
const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

assert.ok(frontmatter, 'gan-evaluator.md should have frontmatter');
const toolsLine = frontmatter[1].match(/^tools:\s*(.+)$/m);
assert.ok(toolsLine, 'gan-evaluator.md should declare tools');

const tools = new Set(toolsLine[1].split(',').map(tool => tool.trim()));
for (const tool of [
  'mcp__playwright__browser_navigate',
  'mcp__playwright__browser_click',
  'mcp__playwright__browser_take_screenshot',
  'mcp__playwright__browser_snapshot',
  'mcp__playwright__browser_type',
  'mcp__playwright__browser_fill_form',
]) {
  assert.ok(tools.has(tool), `gan-evaluator.md should grant ${tool}`);
}

assert.match(content, /\*\*Achieved:\*\* `playwright` \| `screenshot` \| `code-only`/);
assert.match(content, /mode that was actually completed/);

console.log('GAN evaluator tools and achieved-mode contract are present.');
