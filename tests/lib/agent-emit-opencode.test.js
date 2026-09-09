/**
 * Tests for the ECC Agent IR → OpenCode emitter (scripts/lib/agent-emit-opencode.js).
 */

const assert = require("assert")
const yaml = require("js-yaml")

const { parseAllAgents } = require("../../scripts/lib/agent-ir")
const { emitAllOpenCodeAgents } = require("../../scripts/lib/agent-emit-opencode")

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
    ;({ results, warnings } = emitAllOpenCodeAgents(irs))
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

    ["frontmatter uses mode: subagent and round-trips", () => {
      for (const r of results) {
        const match = r.markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        const fm = yaml.load(match[1])
        assert.strictEqual(fm.mode, "subagent", `${r.id}: must be a subagent`)
        assert.strictEqual(fm.name, r.name, `${r.id}: name round-trip`)
        assert.ok(fm.description.length > 0, `${r.id}: missing description`)
      }
    }],

    ["read-only agents never gain bash", () => {
      for (const r of results) {
        const source = byId.get(r.id)
        if (!source.tools.includes("Bash")) {
          assert.ok(!r.tools.includes("bash"), `${r.id}: read-only agent must not gain bash`)
        }
      }
    }],

    ["planner maps to read, grep, glob", () => {
      const planner = results.find(r => r.id === "planner")
      assert.deepStrictEqual(planner.tools, ["read", "grep", "glob"])
    }],

    ["WebSearch is flagged, Write and WebFetch are mapped", () => {
      assert.ok(warnings.some(w => w.includes("unmapped tool: WebSearch")), "WebSearch must be flagged")
      const writer = results.find(r => r.id === "build-error-resolver")
      assert.ok(writer.tools.includes("write"), "Write must map to write")
      assert.ok(!warnings.some(w => w.includes("unmapped tool: Write")), "Write must not be flagged")
    }],

    ["mcp__* tools are flagged, never mapped", () => {
      assert.ok(!results.some(r => r.tools.includes("mcp")), "no mcp tool should be emitted")
      assert.ok(warnings.some(w => w.includes("docs-lookup") && w.includes("MCP tool")), "docs-lookup MCP must warn")
    }],

    ["emission is deterministic", () => {
      const a = emitAllOpenCodeAgents(irs).results.map(r => r.markdown).join("\n")
      const b = emitAllOpenCodeAgents(irs).results.map(r => r.markdown).join("\n")
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
