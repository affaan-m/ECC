#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '../../skills/autonomous-agent-harness/SKILL.md'), 'utf8');
const blocks = [...source.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(match => match[1]).join('\n');
const checks = [
  ['executable examples omit unpublished packages and the invented dispatch endpoint', () => {
    assert.doesNotMatch(blocks, /@anthropic\/(?:memory|scheduled-tasks|computer-use)-mcp-server/);
    assert.ok(!blocks.includes('api.anthropic.com/dispatch'));
  }],
  ['CLI examples use the working directory and native session scheduling', () => {
    assert.doesNotMatch(blocks, /--project\b|mcp__scheduled-tasks__/);
    assert.match(blocks, /cd "\/path\/to\/repo" && claude -p/);
    assert.match(blocks, /\/loop 30m/);
    assert.match(source, /session-scoped/);
    assert.match(source, /external scheduler/);
  }],
  ['optional memory configuration uses a pinned reference package and explicit data location', () => {
    const jsonBlock = source.match(/```json\n([\s\S]*?)```/);
    assert.ok(jsonBlock);
    const memory = JSON.parse(jsonBlock[1]).mcpServers.memory;
    assert.strictEqual(memory.command, 'npx');
    assert.match(memory.args[1], /^@modelcontextprotocol\/server-memory@\d{4}\.\d+\.\d+$/);
    assert.ok(path.posix.isAbsolute(memory.env.MEMORY_FILE_PATH));
  }],
  ['setup links to upstream memory, scheduling, CLI, and computer-use documentation', () => {
    for (const link of [
      'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
      'https://code.claude.com/docs/en/scheduled-tasks',
      'https://code.claude.com/docs/en/headless',
      'https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool'
    ]) assert.ok(source.includes(link), `missing primary source ${link}`);
  }]
];

let failed = 0;
for (const [name, check] of checks) {
  try { check(); console.log(`  PASS ${name}`); }
  catch (error) { failed++; console.error(`  FAIL ${name}: ${error.message}`); }
}
console.log(`Passed: ${checks.length - failed}\nFailed: ${failed}`);
process.exitCode = failed ? 1 : 0;
