/**
 * Tests for the ECC Agent IR → Cursor emitter (scripts/lib/agent-emit-cursor.js).
 *
 * Cursor restricts subagents via a binary `readonly` flag, not a tools list, so
 * these tests assert the permission boundary through `readonly`.
 */

const assert = require("assert")
const yaml = require("js-yaml")

const { parseAllAgents } = require("../../scripts/lib/agent-ir")
const { emitAllCursorAgents } = require("../../scripts/lib/agent-emit-cursor")

function runTest(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    return true
  } catch (error) {
    console.log(`  ✗ ${name}`)
    console.error(`    ${error.message}`)
    return false
  }
}

function main() {
  let passed = 0
  let failed = 0

  let irs
  let results
  let warnings
  try {
    irs = parseAllAgents()
    ;({ results, warnings } = emitAllCursorAgents(irs))
  } catch (error) {
    console.log(`  ✗ setup failed: ${error.message}`)
    console.log("\nPassed: 0")
    console.log("Failed: 1")
    process.exit(1)
  }

  const byId = new Map(irs.map(ir => [ir.id, ir]))

  const tests = [
    ["emits all 68 agents", () => {
      assert.strictEqual(results.length, 68)
    }],

    ["emits a readonly flag, not a tools scalar", () => {
      for (const r of results) {
        const match = r.markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        const fm = yaml.load(match[1])
        assert.strictEqual(typeof fm.readonly, "boolean", `${r.id}: readonly must be boolean`)
        assert.strictEqual(fm.tools, undefined, `${r.id}: must not emit a tools scalar (Cursor uses readonly)`)
        assert.ok(/^[a-z0-9-]+$/.test(fm.name), `${r.id}: name must be lowercase/hyphens`)
      }
    }],

    ["read-only source agents are emitted readonly: true", () => {
      for (const r of results) {
        const source = byId.get(r.id)
        const mutating = ["Bash", "Edit", "Write"].some(t => source.tools.includes(t))
        if (!mutating) {
          assert.strictEqual(r.readOnly, true, `${r.id}: read-only source must emit readonly: true`)
        }
      }
      const planner = results.find(r => r.id === "planner")
      assert.strictEqual(planner.readOnly, true, "planner (Read, Grep, Glob) must be readonly")
    }],

    ["write-capable source agents are emitted readonly: false", () => {
      const resolver = results.find(r => r.id === "build-error-resolver")
      assert.strictEqual(resolver.readOnly, false, "build-error-resolver (has Bash/Edit/Write) must not be readonly")
    }],

    ["mcp__* tools are flagged, never granted", () => {
      assert.ok(warnings.some(w => w.includes("docs-lookup") && w.includes("MCP tool")), "docs-lookup MCP must warn")
      assert.ok(!results.some(r => /tools:/.test(r.markdown)), "no tools scalar should ever be emitted")
    }],

    ["model tier is preserved as a comment", () => {
      const planner = results.find(r => r.id === "planner")
      assert.match(planner.markdown, /^---\n# source model tier: opus\n/m)
    }],

    ["emission is deterministic", () => {
      const a = emitAllCursorAgents(irs).results.map(r => r.markdown).join("\n")
      const b = emitAllCursorAgents(irs).results.map(r => r.markdown).join("\n")
      assert.strictEqual(a, b)
    }],
  ]

  for (const [name, fn] of tests) {
    if (runTest(name, fn)) {
      passed += 1
    } else {
      failed += 1
    }
  }

  console.log(`\nPassed: ${passed}`)
  console.log(`Failed: ${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
