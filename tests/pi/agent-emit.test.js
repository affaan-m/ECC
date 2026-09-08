/**
 * Tests for the ECC Agent IR → Pi emitter (scripts/lib/agent-emit-pi.js).
 *
 * Verifies that every IR object becomes a valid Pi subagent definition: correct
 * frontmatter shape, `ecc` package namespace, a strict tool allowlist that only
 * contains Pi tool names, no leaked Claude tool names, no model field, and a
 * lossless body.
 */

const assert = require("assert")

const { parseAllAgents } = require("../../scripts/lib/agent-ir")
const { emitAllPiAgents, PACKAGE } = require("../../scripts/lib/agent-emit-pi")
const { CLAUDE_TO_PI_TOOLS } = require("../../scripts/lib/agent-tool-map")

const VALID_PI_TOOLS = new Set([
  ...Object.values(CLAUDE_TO_PI_TOOLS),
  "mcp", // mcp__* family collapses onto Pi's single MCP gateway tool
])

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

function parseEmittedFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  assert.ok(match, "emitted markdown must start with a frontmatter block")
  const out = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":")
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    out[key] = line.slice(idx + 1).trim()
  }
  return out
}

function main() {
  let passed = 0
  let failed = 0

  const irs = parseAllAgents()
  const { results, warnings } = emitAllPiAgents(irs)

  const tests = [
    ["emits all 68 agents", () => {
      assert.strictEqual(results.length, 68, "expected 68 emitted agents")
    }],

    ["frontmatter has correct shape for every agent", () => {
      for (const r of results) {
        const fm = parseEmittedFrontmatter(r.markdown)
        assert.strictEqual(fm.package, PACKAGE, `${r.id}: package must be '${PACKAGE}'`)
        assert.strictEqual(fm.name, r.name, `${r.id}: name mismatch`)
        assert.ok(fm.description.length > 0, `${r.id}: empty description`)
        assert.strictEqual(fm.systemPromptMode, "replace", `${r.id}: systemPromptMode`)
        assert.strictEqual(fm.model, undefined, `${r.id}: model must be omitted (Pi default applies)`)
      }
    }],

    ["tool allowlist contains only valid Pi tool names", () => {
      for (const r of results) {
        for (const tool of r.tools) {
          assert.ok(VALID_PI_TOOLS.has(tool), `${r.id}: invalid Pi tool '${tool}'`)
        }
        assert.ok(r.tools.length > 0, `${r.id}: empty tool allowlist`)
      }
    }],

    ["no Claude tool name leaks into the Pi allowlist", () => {
      const claudeNames = new Set(["Read", "Grep", "Glob", "Bash", "Edit", "Write", "WebSearch", "WebFetch"])
      for (const r of results) {
        for (const tool of r.tools) {
          assert.ok(!claudeNames.has(tool), `${r.id}: leaked Claude tool '${tool}'`)
        }
      }
    }],

    ["no tool is silently dropped (no 'unmapped tool' warnings)", () => {
      const unmapped = warnings.filter(w => w.includes("unmapped tool"))
      assert.strictEqual(unmapped.length, 0, `unmapped tools must not exist: ${unmapped.join("; ")}`)
    }],

    ["body is preserved losslessly", () => {
      const byId = new Map(results.map(r => [r.id, r]))
      for (const ir of irs) {
        const emitted = byId.get(ir.id)
        assert.ok(emitted, `${ir.id}: missing emitted agent`)
        const body = ir.body.replace(/^\n+/, "").trimEnd()
        assert.ok(emitted.markdown.includes(body), `${ir.id}: body not preserved`)
      }
    }],

    ["mcp__* family collapses onto the single mcp tool with a note", () => {
      const docsLookup = results.find(r => r.id === "docs-lookup")
      assert.ok(docsLookup, "docs-lookup agent must exist")
      assert.ok(docsLookup.tools.includes("mcp"), "docs-lookup must map context7 -> mcp")
      assert.ok(
        warnings.some(w => w.startsWith("docs-lookup:") && w.includes("mcp")),
        "mcp family mapping must produce a warning note"
      )
    }],

    ["a specific agent maps its tools as expected", () => {
      const planner = results.find(r => r.id === "planner")
      assert.deepStrictEqual(planner.tools, ["read", "anchor_grep", "bash"], "planner tool map")
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
