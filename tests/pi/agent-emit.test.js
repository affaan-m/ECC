/**
 * Tests for the ECC Agent IR → Pi emitter (scripts/lib/agent-emit-pi.js).
 *
 * Verifies that every IR object becomes a valid Pi subagent definition: correct
 * frontmatter shape, `ecc` package namespace, a strict tool allowlist that only
 * contains Pi tool names, no leaked Claude tool names, no model field, and a
 * lossless body.
 *
 * Also enforces the permission-boundary invariant: a converted agent must never
 * gain a tool with more authority than its source allowlist. In particular,
 * read-only agents (no `Bash` in source) must never emit `bash`, and `mcp__*`
 * operations are never collapsed onto the shared `mcp` gateway.
 */

const assert = require("assert")

const { parseAllAgents } = require("../../scripts/lib/agent-ir")
const { emitAllPiAgents, PACKAGE } = require("../../scripts/lib/agent-emit-pi")
const { CLAUDE_TO_PI_TOOLS } = require("../../scripts/lib/agent-tool-map")

const VALID_PI_TOOLS = new Set(Object.values(CLAUDE_TO_PI_TOOLS))

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
  const byId = new Map(irs.map(ir => [ir.id, ir]))

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

    ["read-only agents never gain bash (permission boundary)", () => {
      for (const r of results) {
        const source = byId.get(r.id)
        const hadBash = source.tools.includes("Bash")
        if (!hadBash) {
          assert.ok(!r.tools.includes("bash"), `${r.id}: read-only agent must not emit 'bash'`)
        }
      }
      // The canonical read-only example: planner has Read, Grep, Glob — no Bash.
      const planner = results.find(r => r.id === "planner")
      assert.ok(!planner.tools.includes("bash"), "planner must stay read-only")
    }],

    ["mcp__* operations are never auto-mapped onto the shared gateway", () => {
      for (const r of results) {
        assert.ok(!r.tools.includes("mcp"), `${r.id}: mcp__* must not collapse onto the 'mcp' gateway`)
      }
      assert.ok(
        warnings.some(w => w.includes("docs-lookup") && w.includes("MCP tool")),
        "docs-lookup (context7) must produce an explicit MCP warning"
      )
      assert.ok(
        warnings.some(w => w.includes("gan-evaluator") && w.includes("MCP tool")),
        "gan-evaluator (playwright) must produce an explicit MCP warning"
      )
    }],

    ["no source tool is dropped without a warning", () => {
      assert.ok(!warnings.some(w => w.includes("unmapped tool")), "no generic unmapped-tool warnings expected")
      // Every unsupported source tool (mcp__*) must be surfaced as a warning.
      const mcpToolCount = irs
        .flatMap(ir => ir.tools)
        .filter(t => t.startsWith("mcp__")).length
      const mcpWarnings = warnings.filter(w => w.includes("MCP tool")).length
      assert.strictEqual(mcpWarnings, mcpToolCount, "each mcp__* tool must warn exactly once")
    }],

    ["body is preserved losslessly", () => {
      for (const ir of irs) {
        const emitted = results.find(r => r.id === ir.id)
        assert.ok(emitted, `${ir.id}: missing emitted agent`)
        const body = ir.body.replace(/^\n+/, "").trimEnd()
        assert.ok(emitted.markdown.includes(body), `${ir.id}: body not preserved`)
      }
    }],

    ["a specific agent maps its tools as expected", () => {
      const planner = results.find(r => r.id === "planner")
      assert.deepStrictEqual(planner.tools, ["read", "anchor_grep"], "planner tool map (Read, Grep, Glob -> read, anchor_grep)")
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
