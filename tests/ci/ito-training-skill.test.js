/**
 * Contract tests for the Itô training skill.
 * No test contacts Itô, opens a browser, books capacity, or starts a run.
 */

"use strict";

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

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test("has valid discoverable frontmatter and trigger phrases", () => {
  const skill = read("skills/ito-training/SKILL.md");
  assert.match(skill, /^---\nname: ito-training\ndescription: [^\n]+\nmetadata:\n {2}origin: ECC\n {2}status: scaffold\n---\n/);
  assert.match(skill, /completed Itô compute booking/i);
  assert.match(skill, /pre-training, fine-tuning, or RL/i);
  assert.match(skill, /ECC implements no training stack of its own/i);
});

test("is fail-closed today and forbids substitutes", () => {
  const skill = read("skills/ito-training/SKILL.md");
  assert.match(skill, /training is unavailable today/i);
  assert.match(skill, /no\s+`train` verb/);
  assert.match(skill, /rejects\s+`train` before resolving or spawning/i);
  assert.match(skill, /stop before authentication or any command invocation/i);
  assert.match(skill, /report the\s+missing capability and return/i);
  assert.match(skill, /never substitute a\s+local trainer, SSH helper, browser workflow, or purchase endpoint/i);
  assert.match(skill, /remains a fail-closed availability check and documentation handoff/i);
});

test("requires server-verified booking entitlement before any confirmation", () => {
  const skill = read("skills/ito-training/SKILL.md");
  assert.match(skill, /server-verified completed\s+booking/i);
  assert.match(skill, /not proof\s+of entitlement/i);
  assert.match(skill, /fail\s+closed before confirmation/i);
  assert.match(skill, /authentication is identity, not workload authority/i);
});

test("specifies the future manifest, confirmation, and idempotency contract without secrets", () => {
  const skill = read("skills/ito-training/SKILL.md");
  for (const gate of [
    /--booking <server-verified-booking-id>/i,
    /--manifest <absolute-reviewed-json-file>/i,
    /--idempotency-key <stable-retry-key>/i,
    /budget ceiling in USD/i,
    /reject symlinks/i,
    /without following links/i,
    /hash bytes from the opened descriptor/i,
    /digest must exactly equal/i,
    /single-use confirmation bound to account, action, manifest, and\s+cost/i,
    /ambiguous transport failure/i,
    /status, logs, metrics, checkpoint listing, cancel, and cleanup/i,
  ]) assert.match(skill, gate);
  assert.match(skill, /--confirmation-ref <opaque-non-authorizing-reference>/i);
  assert.doesNotMatch(skill, /--confirmation-token|--api-key|--access-token/i);
});

test("labels backend stages as future and keeps eval gates human-honest", () => {
  const skill = read("skills/ito-training/SKILL.md");
  assert.match(skill, /describe the future backend \(Layer 0\.3\), not code that exists in\s+ECC/i);
  assert.match(skill, /never override a failed eval gate/i);
  assert.match(skill, /Loss-spike restart is a proposed, human-gated action/i);
});

test("keeps workload-training effects outside the executable policy", () => {
  const capability = Object.freeze({
    name: "train",
    availability: "supported",
    auth: "required",
    network: "ito_api",
    side_effect: "workload_start",
    authority: "entitled_workload",
  });
  assert.throws(
    () => authorizeEccCapability({ commands: [capability] }, "train"),
    /outside ECC's safe policy: workload_start/,
  );
});

test("ships through the existing opt-in compute module and npm package", () => {
  const modules = readJson("manifests/install-modules.json").modules;
  const module = modules.find((candidate) => candidate.id === "ito-compute");
  assert.ok(module, "ito-compute install module is missing");
  assert.deepStrictEqual(module.paths, [
    "skills/ito-compute",
    "skills/ito-inference",
    "skills/ito-training",
  ]);
  assert.strictEqual(module.defaultInstall, false);
  const packed = readJson("package.json").files;
  assert.ok(packed.includes("skills/ito-training/"), "ito-training missing from npm files");
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.error(`    ${error.message}`);
      failed += 1;
    }
  }
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  else console.log("PASS ito-training skill contract");
})();
