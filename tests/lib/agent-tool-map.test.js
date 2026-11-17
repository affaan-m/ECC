'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLAUDE_TO_PI_TOOLS, CLAUDE_MODEL_TIERS, mapToolToPi } = require('../../scripts/lib/agent-tool-map');

// Pi built-ins per @earendil-works/pi-coding-agent dist/core/tools/index.d.ts.
// `powershell` is Windows-only and never emitted; `ls` has no Claude source.
const PI_BUILTINS = new Set(['read', 'bash', 'powershell', 'edit', 'write', 'grep', 'find', 'ls']);
const PI_READ_ONLY = new Set(['read', 'grep', 'find', 'ls']);
const CLAUDE_READ_ONLY = ['Read', 'Grep', 'Glob'];

test('the table covers exactly the six core Claude tools', () => {
  assert.deepEqual(Object.keys(CLAUDE_TO_PI_TOOLS).sort(), ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write']);
});

test('every target is a documented Pi built-in and powershell is never emitted', () => {
  for (const [claudeTool, piTool] of Object.entries(CLAUDE_TO_PI_TOOLS)) {
    assert.ok(PI_BUILTINS.has(piTool), `${claudeTool} -> ${piTool} is not a Pi built-in`);
    assert.notEqual(piTool, 'powershell', `${claudeTool} must not map to powershell`);
  }
});

test('read-only Claude tools never gain shell or write authority in Pi', () => {
  for (const claudeTool of CLAUDE_READ_ONLY) {
    const mapped = mapToolToPi(claudeTool);
    assert.equal(mapped.unsupported, false);
    assert.ok(PI_READ_ONLY.has(mapped.tool), `${claudeTool} -> ${mapped.tool} escalates a read-only tool`);
  }
});

test('mapped tools come back with their Pi name, unsupported false, and no note', () => {
  assert.deepEqual(mapToolToPi('Read'), { tool: 'read', unsupported: false });
  assert.deepEqual(mapToolToPi('Grep'), { tool: 'grep', unsupported: false });
  assert.deepEqual(mapToolToPi('Glob'), { tool: 'find', unsupported: false });
  assert.deepEqual(mapToolToPi('Bash'), { tool: 'bash', unsupported: false });
  assert.deepEqual(mapToolToPi('Edit'), { tool: 'edit', unsupported: false });
  assert.deepEqual(mapToolToPi('Write'), { tool: 'write', unsupported: false });
});

test('surrounding whitespace is trimmed before lookup', () => {
  assert.deepEqual(mapToolToPi('  Read '), { tool: 'read', unsupported: false });
  assert.deepEqual(mapToolToPi('\tBash\n'), { tool: 'bash', unsupported: false });
});

test('tool names are case sensitive, so a lowercase or shouted name is not guessed', () => {
  for (const name of ['read', 'BASH', 'write', 'Glob ']) {
    const mapped = mapToolToPi(name);
    if (name.trim() === 'Glob') continue;
    assert.equal(mapped.unsupported, true, `${JSON.stringify(name)} should be unsupported`);
    assert.equal(mapped.tool, null);
  }
});

test('WebSearch and WebFetch are deliberately unmapped', () => {
  for (const name of ['WebSearch', 'WebFetch']) {
    assert.deepEqual(mapToolToPi(name), {
      tool: null,
      unsupported: true,
      note: `unmapped tool: ${name} (not a Pi built-in)`
    });
  }
});

test('MCP tools are unsupported with a note that names the tool and the server step', () => {
  const name = 'mcp__context7__query-docs';
  const mapped = mapToolToPi(name);
  assert.equal(mapped.tool, null);
  assert.equal(mapped.unsupported, true);
  assert.ok(mapped.note.includes(name));
  assert.match(mapped.note, /configure the MCP server explicitly/);
  assert.doesNotMatch(mapped.note, /^unmapped tool:/);
});

test('an mcp__ prefix after whitespace is still recognised as an MCP tool', () => {
  assert.match(mapToolToPi('  mcp__x__y ').note, /^MCP tool mcp__x__y /);
});

test('unknown tools are reported, not dropped or guessed', () => {
  assert.deepEqual(mapToolToPi('Task'), {
    tool: null,
    unsupported: true,
    note: 'unmapped tool: Task (not a Pi built-in)'
  });
});

test('prototype property names are not treated as table entries', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    const mapped = mapToolToPi(name);
    assert.equal(mapped.tool, null, `${name} leaked a prototype member as a tool`);
    assert.equal(mapped.unsupported, true);
    assert.equal(typeof mapped.note, 'string');
  }
});

test('non-string and empty input is coerced and reported rather than thrown', () => {
  for (const input of [undefined, null, 42, '', '   ']) {
    const mapped = mapToolToPi(input);
    assert.equal(mapped.tool, null, `${String(input)} should not map`);
    assert.equal(mapped.unsupported, true);
    assert.match(mapped.note, /^unmapped tool: /);
  }
  assert.ok(mapToolToPi(undefined).note.includes('undefined'));
  assert.ok(mapToolToPi(42).note.includes('42'));
});

test('a result either carries a Pi tool or is unsupported, never both or neither', () => {
  const inputs = [...Object.keys(CLAUDE_TO_PI_TOOLS), 'WebFetch', 'mcp__a__b', 'Task', '', 'read'];
  for (const input of inputs) {
    const mapped = mapToolToPi(input);
    assert.equal(mapped.tool !== null, !mapped.unsupported, `${JSON.stringify(input)}`);
    assert.equal('note' in mapped, mapped.unsupported, `${JSON.stringify(input)} note presence`);
  }
});

test('the tables are frozen and the model tiers are the three Claude tiers in order', () => {
  assert.ok(Object.isFrozen(CLAUDE_TO_PI_TOOLS));
  assert.ok(Object.isFrozen(CLAUDE_MODEL_TIERS));
  assert.deepEqual(CLAUDE_MODEL_TIERS, ['haiku', 'sonnet', 'opus']);
  assert.throws(() => {
    CLAUDE_TO_PI_TOOLS.WebFetch = 'bash';
  }, TypeError);
  assert.equal(mapToolToPi('WebFetch').unsupported, true);
});
