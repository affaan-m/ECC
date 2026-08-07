/**
 * Contract tests for the installable, fail-closed Itô inference handoff.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

console.log("\n=== Testing Itô inference skill lifecycle ===\n");

const results = [
  test("uses the canonical serving trigger and fails closed while unavailable", () => {
    const skill = read("skills/ito-inference/SKILL.md");
    assert.match(skill, /^name: ito-inference$/m);
    assert.match(skill, /self-host|serve a model|OpenAI-compatible endpoint/i);
    assert.match(skill, /requests naming .*ito-serve/i);
    assert.match(skill, /completed booking/i);
    assert.match(skill, /never books, reserves,\s+or spends/i);
    assert.match(skill, /serving is unavailable today/i);
    assert.match(skill, /report the\s+missing capability and return/i);
    assert.match(skill, /stop before authentication/i);
    assert.match(skill, /no `serve` verb/i);
    assert.match(skill, /`inference`.*unsupported compatibility\s+probe/i);
    assert.match(skill, /never substitute a\s+local runner, SSH helper, browser workflow, purchase endpoint/i);
    assert.doesNotMatch(skill, /ssh\s+root@|serve-status\.sh/i);
    for (const gate of [
      /server-verified completed\s+booking/i,
      /fresh serving eligibility/i,
      /single-use confirmation/i,
      /account, action, manifest, and\s+cost/i,
      /idempotency/i,
      /status, logs, metrics, cancel, and cleanup/i,
      /structured JSON/i,
      /ambiguous transport/i,
      /reject symlinks/i,
      /without following links/i,
      /hash bytes from the opened descriptor/i,
      /digest must exactly equal/i,
    ]) assert.match(skill, gate);
    assert.match(skill, /--confirmation-ref <opaque-non-authorizing-reference>/i);
    assert.doesNotMatch(skill, /--confirmation-token|--api-key|--access-token/i);
  }),
  test("keeps unsupported serving outside the executable bridge", () => {
    const bridge = read("scripts/ito.js");
    assert.match(bridge, /SUPPORTED_COMMANDS[^\n]+login[^\n]+auth[^\n]+find[^\n]+status[^\n]+evals/);
    assert.doesNotMatch(bridge, /SUPPORTED_COMMANDS[^\n]+serve/);
    assert.match(bridge, /Unsupported Itô command/);

    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-ito-serve-reject-"));
    try {
      const canonicalDir = path.join(fixtureRoot, "cli", "ito-compute-cli", "dist", "bin");
      fs.mkdirSync(canonicalDir, { recursive: true });
      const marker = path.join(fixtureRoot, "spawned");
      const executable = path.join(canonicalDir, "ito.js");
      fs.writeFileSync(executable, `require("fs").writeFileSync(${JSON.stringify(marker)}, "spawned");\n`);
      const result = spawnSync(process.execPath, [
        path.join(REPO_ROOT, "scripts", "ecc.js"), "ito", "serve",
        "--booking", "booking_test", "--model", "model_test",
      ], {
        encoding: "utf8",
        env: { ...process.env, ECC_ITO_CLI_EXECUTABLE: executable },
      });
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stderr, /Unsupported Itô command "serve"/);
      assert.ok(!fs.existsSync(marker), "unsupported serve spawned the canonical child");
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }),
  test("ships canonical inference through the existing opt-in compute module", () => {
    const modules = readJson("manifests/install-modules.json").modules;
    const module = modules.find((candidate) => candidate.id === "ito-compute");
    assert.ok(module, "ito-compute install module is missing");
    assert.deepStrictEqual(module.paths, [
      "skills/ito-compute",
      "skills/ito-inference",
      "skills/ito-training",
    ]);
    assert.deepStrictEqual(module.dependencies, ["platform-configs"]);
    assert.strictEqual(module.defaultInstall, false);
    assert.strictEqual(module.stability, "beta");

    const components = readJson("manifests/install-components.json").components;
    assert.deepStrictEqual(
      components.find((candidate) => candidate.id === "capability:ito-compute"),
      {
        id: "capability:ito-compute",
        family: "capability",
        description: "Authenticated Itô GPU inventory, RFQ, status, and explicitly gated node-qualification workflows through the separately installed canonical CLI.",
        modules: ["ito-compute"],
      }
    );

    const profiles = readJson("manifests/install-profiles.json").profiles;
    assert.ok(profiles.full.modules.includes("ito-compute"));

    const packageFiles = readJson("package.json").files;
    assert.ok(packageFiles.includes("skills/ito-inference/"));
    assert.ok(packageFiles.includes("skills/ito-training/"));
  }),
];

const failed = results.filter((passed) => !passed).length;
console.log(`\nPassed: ${results.length - failed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
