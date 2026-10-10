/**
 * Tests for the ECC Agent IR → Pi emitter (scripts/lib/agent-emit-pi.js).
 *
 * Verifies that every IR object becomes a valid Pi subagent definition against
 * the verified `@tintinweb/pi-subagents@0.19.0` surface: `name` / `description`
 * / `tools` (comma-separated allowlist) / `prompt_mode`, with the prompt in the
 * body. Also enforces the permission boundary and the empty-allowlist guard.
 */

const assert = require("assert")
const yaml = require("js-yaml")

const { parseAllAgents } = require("../../scripts/lib/agent-ir")
const { emitPiAgent, emitAllPiAgents, RESERVED_AGENT_NAMES } = require("../../scripts/lib/agent-emit-pi")
const { CLAUDE_TO_PI_TOOLS, mapToolToPi } = require("../../scripts/lib/agent-tool-map")

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

  let irs
  let results
  let warnings
  try {
    irs = parseAllAgents()
    ;({ results, warnings } = emitAllPiAgents(irs))
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

    ["frontmatter uses the verified prompt_mode contract (no package, no systemPromptMode)", () => {
      for (const r of results) {
        const fm = parseEmittedFrontmatter(r.markdown)
        assert.strictEqual(fm.prompt_mode, "replace", `${r.id}: prompt_mode must be replace`)
        assert.strictEqual(fm.systemPromptMode, undefined, `${r.id}: systemPromptMode must not be emitted`)
        assert.strictEqual(fm.package, undefined, `${r.id}: package must not be emitted (name is the dispatch id)`)
        assert.strictEqual(fm.model, undefined, `${r.id}: model must be omitted (Pi default applies)`)
        assert.strictEqual(fm.name, r.name, `${r.id}: name mismatch`)
        assert.ok(fm.description.length > 0, `${r.id}: empty description`)
      }
    }],

    ["tool allowlist contains only verified Pi built-ins", () => {
      for (const r of results) {
        for (const tool of r.tools) {
          assert.ok(VALID_PI_TOOLS.has(tool), `${r.id}: invalid Pi tool '${tool}'`)
        }
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

    ["read-only agents never gain bash", () => {
      for (const r of results) {
        const source = byId.get(r.id)
        if (!source.tools.includes("Bash")) {
          assert.ok(!r.tools.includes("bash"), `${r.id}: read-only agent must not emit 'bash'`)
        }
      }
    }],

    ["mcp__* tools are never mapped to a tool", () => {
      assert.ok(!results.some(r => r.tools.includes("mcp")), "no 'mcp' tool should be emitted")
      assert.ok(warnings.some(w => w.includes("docs-lookup") && w.includes("MCP tool")), "docs-lookup MCP must warn")
    }],

    ["every unsupported source tool is warned, never silently dropped", () => {
      const unsupportedCount = irs.flatMap(ir => ir.tools).filter(t => mapToolToPi(t).unsupported).length
      const warnedCount = warnings.filter(w => /not a Pi built-in|unmapped tool/.test(w)).length
      assert.strictEqual(warnedCount, unsupportedCount, "each unsupported source tool must warn exactly once")
      assert.ok(unsupportedCount > 0, "expected WebSearch/WebFetch/mcp__* to be unsupported")
    }],

    ["empty allowlist is emitted as tools: none (never blank, never escalates)", () => {
      const noTools = { id: "x", name: "x", description: "x", tools: ["WebSearch"], body: "hi" }
      const { markdown, tools } = emitPiAgent(noTools)
      assert.deepStrictEqual(tools, [], "WebSearch-only agent must have an empty allowlist")
      assert.match(markdown, /^tools: none$/m, "empty allowlist must be emitted as 'tools: none'")
    }],

    ["reserved built-in agent names are warned", () => {
      const colliding = { id: "general-purpose", name: "general-purpose", description: "x", tools: ["Read"], body: "hi" }
      const { warnings: w } = emitPiAgent(colliding)
      assert.ok(w.some(x => x.includes("collides with a Pi built-in agent")), "built-in name collision must warn")
      assert.ok(RESERVED_AGENT_NAMES.has("general-purpose"), "reserved set is pinned")
    }],

    ["body is preserved losslessly", () => {
      for (const ir of irs) {
        const emitted = results.find(r => r.id === ir.id)
        const body = ir.body.replace(/^\n+/, "").trimEnd()
        assert.ok(emitted.markdown.includes(body), `${ir.id}: body not preserved`)
      }
    }],

    ["planner maps to read, grep, find", () => {
      const planner = results.find(r => r.id === "planner")
      assert.deepStrictEqual(planner.tools, ["read", "grep", "find"])
    }],

    ["emission is deterministic", () => {
      const a = emitAllPiAgents(irs).results.map(r => r.markdown).join("\n")
      const b = emitAllPiAgents(irs).results.map(r => r.markdown).join("\n")
      assert.strictEqual(a, b)
    }],

    ["emitted frontmatter is valid YAML and round-trips key fields", () => {
      for (const r of results) {
        const match = r.markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        const fm = yaml.load(match[1])
        assert.strictEqual(fm.name, r.name, `${r.id}: name round-trip`)
        assert.strictEqual(fm.prompt_mode, "replace", `${r.id}: prompt_mode round-trip`)
        assert.deepStrictEqual(String(fm.tools).split(", "), r.tools, `${r.id}: tools round-trip`)
      }
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
