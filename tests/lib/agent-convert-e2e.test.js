/**
 * End-to-end test for the agent-convert CLI: runs the real CLI for each target,
 * reads the emitted files back off disk, re-parses them as YAML, and asserts
 * the verified contract per harness plus the permission boundary.
 */

const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const yaml = require("js-yaml")
const { execFileSync } = require("child_process")

const REPO = path.join(__dirname, "..", "..")
const CLI = path.join(REPO, "scripts", "agent-convert.js")

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

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ecc-e2e-"))
}

function runCli(args) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" })
}

function readAgents(dir) {
  const out = {}
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".md"))) {
    const markdown = fs.readFileSync(path.join(dir, f), "utf8")
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    assert.ok(match, `${f}: missing frontmatter`)
    out[f.replace(/\.md$/, "")] = { markdown, fm: yaml.load(match[1]) }
  }
  return out
}

function main() {
  let passed = 0
  let failed = 0

  const tests = [
    ["pi: 68 files with the verified prompt_mode contract, no package, no systemPromptMode", () => {
      const dir = tmpdir()
      runCli(["--from", "claude", "--to", "pi", "--out", dir])
      const agents = readAgents(dir)
      assert.strictEqual(Object.keys(agents).length, 68, "68 pi agents")
      for (const [id, a] of Object.entries(agents)) {
        assert.strictEqual(a.fm.prompt_mode, "replace", `${id}: prompt_mode`)
        assert.strictEqual(a.fm.package, undefined, `${id}: no package`)
        assert.strictEqual(a.fm.systemPromptMode, undefined, `${id}: no systemPromptMode`)
      }
      const planner = agents.planner.fm
      assert.deepStrictEqual(String(planner.tools).split(", "), ["read", "grep", "find"], "planner tools")
    }],

    ["cursor: emits 66 + skips 2 lossy by default; 68 with --allow-lossy", () => {
      const dir = tmpdir()
      const json = JSON.parse(runCli(["--from", "claude", "--to", "cursor", "--out", dir, "--json"]))
      const agents = readAgents(dir)
      assert.strictEqual(Object.keys(agents).length, 66, "66 cursor agents (2 lossy skipped)")
      assert.strictEqual(json.skipped, 2, "2 skipped")
      for (const [id, a] of Object.entries(agents)) {
        assert.strictEqual(typeof a.fm.readonly, "boolean", `${id}: readonly boolean`)
        assert.strictEqual(a.fm.tools, undefined, `${id}: no tools scalar`)
      }

      const dir2 = tmpdir()
      const json2 = JSON.parse(runCli(["--from", "claude", "--to", "cursor", "--out", dir2, "--allow-lossy", "--json"]))
      assert.strictEqual(json2.skipped, 0, "no skips under --allow-lossy")
      assert.strictEqual(Object.keys(readAgents(dir2)).length, 68, "68 cursor agents under --allow-lossy")
    }],

    ["opencode: 68 files with a deny-baseline permission mapping and no name/tools field", () => {
      const dir = tmpdir()
      runCli(["--from", "claude", "--to", "opencode", "--out", dir])
      const agents = readAgents(dir)
      assert.strictEqual(Object.keys(agents).length, 68, "68 opencode agents")
      for (const [id, a] of Object.entries(agents)) {
        assert.strictEqual(a.fm.mode, "subagent", `${id}: mode`)
        assert.strictEqual(a.fm.name, undefined, `${id}: no name field`)
        assert.strictEqual(a.fm.tools, undefined, `${id}: no tools field`)
        const keys = Object.keys(a.fm.permission)
        assert.strictEqual(keys[0], "*", `${id}: '*' first`)
        assert.strictEqual(a.fm.permission["*"], "deny", `${id}: deny baseline`)
      }
      const planner = agents.planner.fm.permission
      assert.strictEqual(planner.bash, undefined, "planner must not grant bash")
      assert.strictEqual(planner.edit, undefined, "planner must not grant edit")
      assert.strictEqual(planner.read, "allow", "planner read allowed")
    }],

    ["permission boundary holds across all three harnesses (read-only never gains mutating tools)", () => {
      // planner source tools = Read, Grep, Glob (read-only)
      for (const target of ["pi", "cursor", "opencode"]) {
        const dir = tmpdir()
        runCli(["--from", "claude", "--to", target, "--out", dir])
        const agents = readAgents(dir)
        const planner = agents.planner
        if (target === "pi") {
          const tools = String(planner.fm.tools).split(", ")
          assert.ok(!tools.includes("bash"), "pi planner must not have bash")
          assert.ok(!tools.includes("edit"), "pi planner must not have edit")
        } else if (target === "cursor") {
          assert.strictEqual(planner.fm.readonly, true, "cursor planner must be readonly")
        } else {
          assert.strictEqual(planner.fm.permission.bash, undefined, "opencode planner must not grant bash")
          assert.strictEqual(planner.fm.permission.edit, undefined, "opencode planner must not grant edit")
        }
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
