const AGENT_COUNT = require('fs').readdirSync(require('path').join(__dirname,'../../agents')).filter(f => f.endsWith('.md')).length;
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
    ["--check exits 0 and reports AGENT_COUNT agents", () => {
      const out = runCli(["--check"])
      assert.match(out, new RegExp(`OK: ${AGENT_COUNT} agents parsed and validated`))
    }],

    ["--json emits a machine-readable summary", () => {
      const out = runCli(["--from", "claude", "--to", "pi", "--json"])
      const summary = JSON.parse(out)
      assert.strictEqual(summary.schema, "ecc.agent-ir.v1")
      assert.strictEqual(summary.from, "claude")
      assert.strictEqual(summary.to, "pi")
      assert.strictEqual(summary.converted, AGENT_COUNT)
      assert.ok(Array.isArray(summary.warningsDetail))
    }],

    ["--out writes AGENT_COUNT files", () => {
      const dir = tmpdir()
      runCli(["--from", "claude", "--to", "pi", "--out", dir])
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".md"))
      assert.strictEqual(files.length, AGENT_COUNT, "expected AGENT_COUNT emitted files")
      const planner = fs.readFileSync(path.join(dir, "planner.md"), "utf8")
      assert.match(planner, /name: planner\n/);
      assert.match(planner, /prompt_mode: replace/);
    }],

    ["--out preserves user-owned agents before writing any output", () => {
      const dir = tmpdir();
      const target = path.join(dir, "planner.md");
      fs.writeFileSync(target, "USER_OWNED_AGENT\n");
      assert.throws(() => runCli(["--out", dir]), /refusing to overwrite existing agent/);
      assert.strictEqual(fs.readFileSync(target, "utf8"), "USER_OWNED_AGENT\n");
      assert.deepStrictEqual(fs.readdirSync(dir), ["planner.md"]);
    }],

    ["--out rejects a file created at exclusive-open time without overwriting bytes", () => {
      const root = tmpdir();
      const dir = path.join(root, "out");
      const preload = path.join(root, "race.js");
      fs.mkdirSync(dir);
      fs.writeFileSync(preload, `
        const fs = require('fs');
        const open = fs.openSync;
        let injected = false;
        fs.openSync = function(file, flags, mode) {
          if (!injected && flags === 'wx' && String(file).endsWith('.md')) {
            injected = true;
            const fd = open(file, 'wx', 0o600);
            try { fs.writeFileSync(fd, 'RACED_OPERATOR_BYTES'); }
            finally { fs.closeSync(fd); }
          }
          return open(file, flags, mode);
        };
      `);
      try {
        assert.throws(() => execFileSync(NODE, ["--require", preload, CLI, "--out", dir], { encoding: "utf8", stdio: "pipe" }), /EEXIST/);
        const files = fs.readdirSync(dir);
        assert.strictEqual(files.length, 1);
        assert.strictEqual(fs.readFileSync(path.join(dir, files[0]), "utf8"), "RACED_OPERATOR_BYTES");
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }],

    ["--out fails closed when existing output changes after batch preflight", () => {
      const root = tmpdir();
      const dir = path.join(root, "out");
      const preload = path.join(root, "change.js");
      runCli(["--out", dir]);
      const target = path.join(dir, fs.readdirSync(dir).sort()[0]);
      fs.writeFileSync(preload, `
        const fs = require('fs');
        const mkdir = fs.mkdirSync;
        fs.mkdirSync = function(file, options) {
          if (String(file) === ${JSON.stringify(dir)}) fs.writeFileSync(${JSON.stringify(target)}, 'CHANGED_AFTER_PREFLIGHT');
          return mkdir(file, options);
        };
      `);
      try {
        assert.throws(() => execFileSync(NODE, ["--require", preload, CLI, "--out", dir], { encoding: "utf8", stdio: "pipe" }), /refusing to overwrite existing agent/);
        assert.strictEqual(fs.readFileSync(target, "utf8"), "CHANGED_AFTER_PREFLIGHT");
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }],

    ["--out repeats identical output without changing bytes", () => {
      const dir = tmpdir();
      runCli(["--out", dir]);
      const target = path.join(dir, "planner.md");
      const before = fs.readFileSync(target, "utf8");
      runCli(["--out", dir]);
      assert.strictEqual(fs.readFileSync(target, "utf8"), before);
    }],

    ["--out --dry-run writes nothing", () => {
      const dir = tmpdir()
      const out = runCli(["--from", "claude", "--to", "pi", "--out", dir, "--dry-run"])
      assert.match(out, /\[dry-run\] would write/)
      assert.strictEqual(fs.readdirSync(dir).length, 0, "dry-run must not create files")
    }],

    ["unsupported conversion exits non-zero", () => {
      assert.throws(() => runCli(["--from", "claude", "--to", "zed"]), /unsupported conversion/);
    }],

    ["unknown flag exits non-zero", () => {
      assert.throws(() => runCli(["--bogus"]), /unknown argument/)
    }],

    ["--json --out keeps stdout parseable JSON", () => {
      const dir = tmpdir()
      const out = runCli(["--from", "claude", "--to", "pi", "--out", dir, "--json"])
      const summary = JSON.parse(out)
      assert.strictEqual(summary.converted, AGENT_COUNT)
      assert.strictEqual(summary.schema, "ecc.agent-ir.v1")
    }],

    ["missing value for --out exits non-zero", () => {
      assert.throws(() => runCli(["--from", "claude", "--to", "pi", "--out"]), /missing value for --out/)
    }],

    ["--check --json emits JSON", () => {
      const out = runCli(["--check", "--json"])
      const summary = JSON.parse(out)
      assert.strictEqual(summary.ok, true)
      assert.strictEqual(summary.checked, AGENT_COUNT)
    }],

    ["--out followed by a flag is rejected (no unintended write)", () => {
      const dir = tmpdir()
      assert.throws(() => runCli(["--from", "claude", "--to", "pi", "--out", "--dry-run"]), /missing value for --out/)
      assert.strictEqual(fs.readdirSync(dir).length, 0, "must not write anything")
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
