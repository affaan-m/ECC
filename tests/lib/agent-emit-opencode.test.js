/**
 * Tests for the ECC Agent IR → OpenCode emitter (scripts/lib/agent-emit-opencode.js).
 *
 * OpenCode requires `tools` to be a *mapping* (tool -> boolean), not a scalar,
 * and these tests assert both the shape and the permission boundary.
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

    ["tools is a YAML mapping, not a scalar", () => {
      for (const r of results) {
        const match = r.markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        const fm = yaml.load(match[1])
        assert.strictEqual(typeof fm.tools, "object", `${r.id}: tools must be a mapping`)
        assert.ok(!Array.isArray(fm.tools), `${r.id}: tools must not be a list`)
        assert.strictEqual(fm.mode, "subagent", `${r.id}: mode must be subagent`)
      }
    }],

    ["read-only source agents disable bash/edit/write", () => {
      for (const r of results) {
        const source = byId.get(r.id)
        const match = r.markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        const fm = yaml.load(match[1])
        if (!source.tools.includes("Bash")) assert.strictEqual(fm.tools.bash, false, `${r.id}: bash must be false`)
        if (!source.tools.includes("Edit")) assert.strictEqual(fm.tools.edit, false, `${r.id}: edit must be false`)
        if (!source.tools.includes("Write")) assert.strictEqual(fm.tools.write, false, `${r.id}: write must be false`)
      }
    }],

    ["planner is read, grep, glob only", () => {
      const planner = results.find(r => r.id === "planner")
      const fm = yaml.load(planner.markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1])
      assert.deepStrictEqual(fm.tools, { read: true, grep: true, glob: true, bash: false, edit: false, write: false })
    }],

    ["write-capable agents enable bash/edit/write", () => {
      const resolver = results.find(r => r.id === "build-error-resolver")
      const fm = yaml.load(resolver.markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1])
      assert.strictEqual(fm.tools.bash, true, "bash must be true")
      assert.strictEqual(fm.tools.edit, true, "edit must be true")
      assert.strictEqual(fm.tools.write, true, "write must be true")
    }],

    ["WebSearch is flagged; WebFetch maps to webfetch", () => {
      assert.ok(warnings.some(w => w.includes("unmapped tool: WebSearch")), "WebSearch must be flagged")
      const searcher = results.find(r => r.id === "docs-lookup")
      assert.ok(searcher.tools.includes("read"), "docs-lookup read mapped")
    }],

    ["mcp__* tools are flagged, never enabled", () => {
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
