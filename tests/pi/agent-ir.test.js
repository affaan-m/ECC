/**
 * Tests for the ECC Agent IR parser (scripts/lib/agent-ir.js).
 *
 * Verifies the canonical-agent parse path: every Claude-format agent under
 * agents/ must parse into a valid ecc.agent-ir.v1 object, deterministically,
 * with lossless frontmatter retention.
 */

const assert = require("assert")
const fs = require("fs")
const path = require("path")

const { parseAgentFile, parseAllAgents, IR_SCHEMA_CONST } = require("../../scripts/lib/agent-ir")

const REPO_ROOT = path.join(__dirname, "..", "..")
const AGENTS_DIR = path.join(REPO_ROOT, "agents")

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

  const tests = [
    ["parses all 68 agents", () => {
      const agents = parseAllAgents()
      assert.strictEqual(agents.length, 68, "expected 68 agents")
      for (const ir of agents) {
        assert.strictEqual(ir.schema, IR_SCHEMA_CONST, `${ir.id}: wrong schema const`)
        assert.ok(/^[a-z0-9-]+$/.test(ir.id), `${ir.id}: id must be kebab-case`)
        assert.ok(ir.name.length > 0, `${ir.id}: empty name`)
        assert.ok(ir.description.length > 0, `${ir.id}: empty description`)
        assert.ok(Array.isArray(ir.tools) && ir.tools.length > 0, `${ir.id}: empty tools`)
        assert.ok(ir.body.length > 0, `${ir.id}: empty body`)
      }
    }],

    ["is deterministic (stable key order + sorted ids)", () => {
      const a = JSON.stringify(parseAllAgents())
      const b = JSON.stringify(parseAllAgents())
      assert.strictEqual(a, b, "parseAllAgents must be deterministic")
    }],

    ["retains model tier distribution (58 sonnet / 6 haiku / 4 opus)", () => {
      const agents = parseAllAgents()
      for (const ir of agents) {
        assert.ok(ir.model, `${ir.id}: missing model tier`)
      }
      const tally = agents.reduce(
        (acc, ir) => ({ ...acc, [ir.model]: (acc[ir.model] || 0) + 1 }),
        {}
      )
      assert.strictEqual(tally.sonnet, 58, "sonnet count")
      assert.strictEqual(tally.haiku, 6, "haiku count")
      assert.strictEqual(tally.opus, 4, "opus count")
    }],

    ["retains source-only color metadata", () => {
      const agents = parseAllAgents()
      const withColor = agents.filter(ir => ir.color)
      assert.strictEqual(withColor.length, 5, "exactly 5 agents carry color")
      for (const ir of withColor) {
        assert.ok(typeof ir.color === "string" && ir.color.length > 0, `${ir.id}: bad color`)
      }
    }],

    ["parses a known agent losslessly", () => {
      const ir = parseAgentFile(path.join(AGENTS_DIR, "planner.md"))
      assert.strictEqual(ir.id, "planner")
      assert.strictEqual(ir.name, "planner")
      assert.strictEqual(ir.model, "opus")
      assert.deepStrictEqual(ir.tools, ["Read", "Grep", "Glob"])
      assert.ok(ir.frontmatter, "raw frontmatter must be retained")
      assert.strictEqual(ir.frontmatter.name, "planner", "frontmatter.name lossless")
      assert.ok(ir.body.includes("You are an expert planning specialist"), "body preserved")
    }],

    ["throws on a missing frontmatter block", () => {
      const badPath = path.join(__dirname, "..", "fixtures", "agent-no-frontmatter.md")
      fs.mkdirSync(path.dirname(badPath), { recursive: true })
      fs.writeFileSync(badPath, "# no frontmatter here\n")
      try {
        assert.throws(() => parseAgentFile(badPath), /missing frontmatter/)
      } finally {
        fs.rmSync(badPath, { force: true })
      }
    }],

    ["throws on an invalid model tier instead of silently dropping it", () => {
      const badPath = path.join(__dirname, "..", "fixtures", "agent-invalid-model.md")
      fs.mkdirSync(path.dirname(badPath), { recursive: true })
      fs.writeFileSync(badPath, "---\nname: x\ndescription: x\ntools: Read\nmodel: sonnet4\n---\n\nbody\n")
      try {
        assert.throws(() => parseAgentFile(badPath), /invalid model tier 'sonnet4'/)
      } finally {
        fs.rmSync(badPath, { force: true })
      }
    }],

    ["throws when the agents directory is absent", () => {
      const missingDir = path.join(__dirname, "..", "fixtures", "agents-does-not-exist")
      assert.throws(() => parseAllAgents(missingDir), /agents directory not found/)
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
