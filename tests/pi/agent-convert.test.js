/**
 * Tests for the ECC Agent IR converter CLI (scripts/agent-convert.js).
 *
 * Verifies the CLI contract: `--check`, `--json`, `--out` (write and
 * side-effect-free `--dry-run`), and argument/exit-code behavior.
 */

const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { execFileSync } = require("child_process")

const CLI = path.join(__dirname, "..", "..", "scripts", "agent-convert.js")
const NODE = process.execPath

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

function runCli(args) {
  return execFileSync(NODE, [CLI, ...args], { encoding: "utf8" })
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ecc-agent-convert-"))
}

function main() {
  let passed = 0
  let failed = 0

  const tests = [
    ["--check exits 0 and reports 68 agents", () => {
      const out = runCli(["--check"])
      assert.match(out, /OK: 68 agents parsed and validated/)
    }],

    ["--json emits a machine-readable summary", () => {
      const out = runCli(["--from", "claude", "--to", "pi", "--json"])
      const summary = JSON.parse(out)
      assert.strictEqual(summary.schema, "ecc.agent-ir.v1")
      assert.strictEqual(summary.from, "claude")
      assert.strictEqual(summary.to, "pi")
      assert.strictEqual(summary.converted, 68)
      assert.ok(Array.isArray(summary.warningsDetail))
    }],

    ["--out writes 68 files", () => {
      const dir = tmpdir()
      runCli(["--from", "claude", "--to", "pi", "--out", dir])
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".md"))
      assert.strictEqual(files.length, 68, "expected 68 emitted files")
      const planner = fs.readFileSync(path.join(dir, "planner.md"), "utf8")
      assert.match(planner, /^---\nname: planner\npackage: ecc\n/m)
    }],

    ["--out --dry-run writes nothing", () => {
      const dir = tmpdir()
      const out = runCli(["--from", "claude", "--to", "pi", "--out", dir, "--dry-run"])
      assert.match(out, /\[dry-run\] would write/)
      assert.strictEqual(fs.readdirSync(dir).length, 0, "dry-run must not create files")
    }],

    ["unsupported conversion exits non-zero", () => {
      assert.throws(() => runCli(["--from", "claude", "--to", "cursor"]), /unsupported conversion/)
    }],

    ["unknown flag exits non-zero", () => {
      assert.throws(() => runCli(["--bogus"]), /unknown argument/)
    }],

    ["--json --out keeps stdout parseable JSON", () => {
      const dir = tmpdir()
      const out = runCli(["--from", "claude", "--to", "pi", "--out", dir, "--json"])
      const summary = JSON.parse(out)
      assert.strictEqual(summary.converted, 68)
      assert.strictEqual(summary.schema, "ecc.agent-ir.v1")
    }],

    ["missing value for --out exits non-zero", () => {
      assert.throws(() => runCli(["--from", "claude", "--to", "pi", "--out"]), /missing value for --out/)
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
