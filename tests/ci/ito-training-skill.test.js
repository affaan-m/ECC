/**
 * Contract tests for the Itô training skill.
 * No test contacts Itô, opens a browser, books capacity, or starts a run.
 */

"use strict";

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

test("keeps unsupported training outside the executable bridge", () => {
  const bridge = read("scripts/ito.js");
  assert.match(bridge, /SUPPORTED_COMMANDS[^\n]+login[^\n]+auth[^\n]+find[^\n]+status[^\n]+evals/);
  assert.doesNotMatch(bridge, /SUPPORTED_COMMANDS[^\n]+train/);
  assert.match(bridge, /Unsupported Itô command/);

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-ito-train-reject-"));
  try {
    const canonicalDir = path.join(fixtureRoot, "cli", "ito-compute-cli", "dist", "bin");
    fs.mkdirSync(canonicalDir, { recursive: true });
    const marker = path.join(fixtureRoot, "spawned");
    const executable = path.join(canonicalDir, "ito.js");
    fs.writeFileSync(executable, `require("fs").writeFileSync(${JSON.stringify(marker)}, "spawned");\n`);
    const result = spawnSync(process.execPath, [
      path.join(REPO_ROOT, "scripts", "ecc.js"), "ito", "train",
      "--booking", "booking_test", "--model-size", "8B",
    ], {
      encoding: "utf8",
      env: { ...process.env, ECC_ITO_CLI_EXECUTABLE: executable },
    });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported Itô command "train"/);
    assert.ok(!fs.existsSync(marker), "unsupported train spawned the canonical child");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
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
