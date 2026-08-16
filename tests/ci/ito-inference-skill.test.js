/**
 * Contract tests for the installable, fail-closed Itô inference handoff.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { authorizeEccCapability } = require("../../scripts/lib/ito-capabilities");

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
  test("keeps workload-serving effects outside the executable policy", () => {
    const capability = Object.freeze({
      name: "serve",
      availability: "supported",
      auth: "required",
      network: "ito_api",
      side_effect: "workload_start",
      authority: "entitled_workload",
    });
    assert.throws(
      () => authorizeEccCapability({ commands: [capability] }, "serve"),
      /outside ECC's safe policy: workload_start/,
    );
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
        description: "Capability-validated Itô GPU inventory, RFQ, status, read-only workload inspection, device revocation, and explicitly gated node-qualification workflows through the separately installed canonical CLI.",
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
