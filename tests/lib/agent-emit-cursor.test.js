/**
 * Tests for the ECC Agent IR → Cursor emitter (scripts/lib/agent-emit-cursor.js).
 *
 * Cursor restricts subagents via a binary `readonly` flag with no per-tool
 * allowlist, so these tests assert the permission boundary AND the lossy
 * conversion rejection (Edit/Write-only or empty sources cannot be faithfully
 * represented and must be skipped unless --allow-lossy is passed).
 */

const assert = require("assert")
const yaml = require("js-yaml")

const { parseAllAgents } = require("../../scripts/lib/agent-ir")
const { emitAllCursorAgents, emitCursorAgent, classifyCursorAuthority } = require("../../scripts/lib/agent-emit-cursor")

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
  let skipped
  let warnings
  try {
    irs = parseAllAgents()
    ;({ results, skipped, warnings } = emitAllCursorAgents(irs))
  } catch (error) {
    console.log(`  ✗ setup failed: ${error.message}`)
    console.log("\nPassed: 0")
    console.log("Failed: 1")
    process.exit(1)
  }

  const byId = new Map(irs.map(ir => [ir.id, ir]))

  const tests = [
    ["every agent is either emitted or explicitly skipped", () => {
      assert.strictEqual(results.length + skipped.length, 68, "emitted + skipped must equal 68")
    }],

    ["emitted frontmatter uses the binary readonly flag, not a tools scalar", () => {
      for (const r of results) {
        const match = r.markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        const fm = yaml.load(match[1])
        assert.strictEqual(typeof fm.readonly, "boolean", `${r.id}: readonly must be boolean`)
        assert.strictEqual(fm.tools, undefined, `${r.id}: must not emit a tools scalar`)
        assert.ok(/^[a-z0-9-]+$/.test(fm.name), `${r.id}: name must be lowercase/hyphens`)
      }
    }],

    ["read-only sources are emitted readonly: true", () => {
      for (const r of results) {
        const source = byId.get(r.id)
        if (classifyCursorAuthority(source.tools) === "readonly") {
          assert.strictEqual(r.readOnly, true, `${r.id}: read-only source must be readonly: true`)
        }
      }
    }],

    ["Bash sources are emitted readonly: false", () => {
      for (const r of results) {
        const source = byId.get(r.id)
        if (classifyCursorAuthority(source.tools) === "writable") {
          assert.strictEqual(r.readOnly, false, `${r.id}: Bash source must be readonly: false`)
        }
      }
    }],

    ["Edit/Write-only and empty sources are skipped by default (lossy)", () => {
      const lossy = irs.filter(ir => classifyCursorAuthority(ir.tools) === "lossy").map(ir => ir.id)
      for (const id of lossy) {
        assert.ok(skipped.some(s => s.id === id), `${id}: lossy source must be skipped by default`)
        assert.ok(!results.some(r => r.id === id), `${id}: lossy source must not be emitted by default`)
      }
      assert.ok(lossy.length > 0, "expected at least one lossy agent")
    }],

    ["empty allowlist is skipped", () => {
      const out = emitCursorAgent({ id: "x", name: "x", description: "x", tools: [], body: "hi" })
      assert.strictEqual(out.skipped, true, "empty allowlist must be skipped")
    }],

    ["--allow-lossy emits lossy sources as writable with a warning", () => {
      const lossyIrs = irs.filter(ir => classifyCursorAuthority(ir.tools) === "lossy")
      const { results: allowed, warnings: w } = emitAllCursorAgents(irs, { allowLossy: true })
      for (const ir of lossyIrs) {
        const r = allowed.find(x => x.id === ir.id)
        assert.ok(r, `${ir.id}: lossy source must be emitted under --allow-lossy`)
        assert.strictEqual(r.readOnly, false, `${ir.id}: --allow-lossy emits writable`)
      }
      assert.ok(w.some(x => x.includes("lossy conversion")), "lossy conversion must warn under --allow-lossy")
    }],

    ["mcp__* tools are flagged", () => {
      assert.ok(warnings.some(w => w.includes("docs-lookup") && w.includes("MCP tool")), "docs-lookup MCP must warn")
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
