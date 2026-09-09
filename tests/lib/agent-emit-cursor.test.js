/**
 * Tests for the ECC Agent IR → Cursor emitter (scripts/lib/agent-emit-cursor.js).
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

    ["frontmatter uses lowercase kebab-case names", () => {
      for (const r of results) {
        assert.ok(/^[a-z0-9-]+$/.test(r.name), `${r.id}: Cursor name must be lowercase/hyphens`)
        const match = r.markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        const fm = yaml.load(match[1])
        assert.strictEqual(fm.name, r.id, `${r.id}: name round-trip`)
        assert.ok(fm.description.length > 0, `${r.id}: missing description`)
      }
    }],

    ["read-only agents never gain run_terminal_cmd", () => {
      for (const r of results) {
        const source = byId.get(r.id)
        if (!source.tools.includes("Bash")) {
          assert.ok(!r.tools.includes("run_terminal_cmd"), `${r.id}: read-only agent must not gain shell`)
        }
      }
    }],

    ["planner maps to read_file, grep_search, list_dir", () => {
      const planner = results.find(r => r.id === "planner")
      assert.deepStrictEqual(planner.tools, ["read_file", "grep_search", "list_dir"])
    }],

    ["uncertain tools (Write/WebSearch/WebFetch) are flagged, not guessed", () => {
      assert.ok(warnings.some(w => w.includes("unmapped tool: Write")), "Write must be flagged")
      assert.ok(!warnings.some(w => w.includes("unmapped tool: Read")), "Read must not be flagged")
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
