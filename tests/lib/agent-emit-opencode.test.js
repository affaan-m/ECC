/**
 * Tests for the ECC Agent IR → OpenCode emitter (scripts/lib/agent-emit-opencode.js).
 *
 * Verified against OpenCode v2.0.25: agents use `description` / `mode` /
 * `permission` (a mapping), the filename is the agent name, and permissions
 * MERGE with global config (global default `*: allow`). These tests assert the
 * DENY BASELINE: `"*": deny` first, then only source-authorized grants.
 */

const assert = require("assert")
const yaml = require("js-yaml")

const { parseAllAgents } = require("../../scripts/lib/agent-ir")
const { emitOpenCodeAgent, emitAllOpenCodeAgents } = require("../../scripts/lib/agent-emit-opencode")

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

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  assert.ok(match, "emitted markdown must start with a frontmatter block")
  return yaml.load(match[1])
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

    ["frontmatter uses description/mode/permission, no name field, no tools field", () => {
      for (const r of results) {
        const fm = parseFrontmatter(r.markdown)
        assert.strictEqual(fm.mode, "subagent", `${r.id}: mode must be subagent`)
        assert.ok(fm.description.length > 0, `${r.id}: missing description`)
        assert.strictEqual(fm.name, undefined, `${r.id}: name is the filename, not a frontmatter field`)
        assert.strictEqual(fm.tools, undefined, `${r.id}: tools is deprecated, must not be emitted`)
        assert.strictEqual(typeof fm.permission, "object", `${r.id}: permission must be a mapping`)
      }
    }],

    ["permission is a deny baseline (*: deny first)", () => {
      for (const r of results) {
        const fm = parseFrontmatter(r.markdown)
        const keys = Object.keys(fm.permission)
        assert.strictEqual(keys[0], "*", `${r.id}: '*' must be the first permission key`)
        assert.strictEqual(fm.permission["*"], "deny", `${r.id}: '*' must be deny`)
      }
    }],

    ["read-only source grants only read-only keys (no bash/edit)", () => {
      for (const r of results) {
        const source = byId.get(r.id)
        const fm = parseFrontmatter(r.markdown)
        if (!source.tools.includes("Bash")) assert.notStrictEqual(fm.permission.bash, "allow", `${r.id}: bash must not be allowed`)
        if (!source.tools.includes("Edit") && !source.tools.includes("Write")) {
          assert.notStrictEqual(fm.permission.edit, "allow", `${r.id}: edit must not be allowed`)
        }
      }
    }],

    ["planner grants read, grep, glob only", () => {
      const planner = results.find(r => r.id === "planner")
      const fm = parseFrontmatter(planner.markdown)
      assert.strictEqual(fm.permission.read, "allow", "read must be allowed")
      assert.strictEqual(fm.permission.grep, "allow", "grep must be allowed")
      assert.strictEqual(fm.permission.glob, "allow", "glob must be allowed")
      assert.strictEqual(fm.permission.bash, undefined, "bash must not be granted")
      assert.strictEqual(fm.permission.edit, undefined, "edit must not be granted")
    }],

    ["write-capable source grants bash and edit", () => {
      const resolver = results.find(r => r.id === "build-error-resolver")
      const fm = parseFrontmatter(resolver.markdown)
      assert.strictEqual(fm.permission.bash, "allow", "bash must be allowed")
      assert.strictEqual(fm.permission.edit, "allow", "edit must be allowed")
    }],

    ["a no-tools source emits only the deny baseline (grants nothing)", () => {
      const { markdown } = emitOpenCodeAgent({ id: "x", name: "x", description: "x", tools: [], body: "hi" })
      const fm = parseFrontmatter(markdown)
      assert.deepStrictEqual(fm.permission, { "*": "deny" }, "no-tools source must deny everything and grant nothing")
    }],

    ["mcp__* and WebSearch are denied by the baseline and warned", () => {
      assert.ok(warnings.some(w => w.includes("docs-lookup") && w.includes("MCP tool")), "docs-lookup MCP must warn")
      assert.ok(!warnings.some(w => w.includes("unmapped tool")), "every non-mcp Claude tool must map to an OpenCode permission key")
      const docsLookup = results.find(r => r.id === "docs-lookup")
      const fm = parseFrontmatter(docsLookup.markdown)
      assert.strictEqual(fm.permission["*"], "deny", "mcp tools must be caught by the deny baseline")
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
