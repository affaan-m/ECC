/**
 * Contract and lifecycle tests for the Itô basket comparison skill.
 * No test contacts Itô, opens a browser, or submits an RFQ/order.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");
const SKILL_PATH = path.join(REPO_ROOT, "skills", "ito-basket-compare", "SKILL.md");

function run(name, test) {
  try {
    test();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

function install(args, home, cwd) {
  return spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "install-apply.js"), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

function uninstall(home, cwd) {
  return spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "uninstall.js"), "--target", "claude", "--json"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
}

function main() {
  const skill = fs.readFileSync(SKILL_PATH, "utf8");
  const tests = [
    ["has valid discoverable frontmatter and representative trigger phrases", () => {
      assert.match(skill, /^---\nname: ito-basket-compare\ndescription: [^\n]+\nmetadata:\n {2}origin: ECC\n---\n/);
      for (const phrase of ["compare this basket", "basket vs", "gap analysis", "stale assumptions", "watchlist"]) {
        assert.match(skill.toLowerCase(), new RegExp(phrase));
      }
    }],
    ["documents the real auth handoff and return to the originating agent", () => {
      assert.match(skill, /ecc ito login/);
      assert.match(skill, /ecc ito login --no-browser/);
      assert.match(skill, /ecc ito auth --json/);
      assert.match(skill, /validation-only/i);
      assert.match(skill, /cannot unlock basket reads/i);
      assert.match(skill, /public catalog\/detail endpoints require no login/i);
      assert.match(skill, /macOS Keychain/i);
      assert.match(skill, /return to the originating agent/i);
      assert.match(skill, /never.*(?:print|echo|expose).*secret/is);
    }],
    ["fails closed around unsupported or state-changing CLI and API behavior", () => {
      assert.match(skill, /does not expose a\s+basket-read command/i);
      assert.match(skill, /do not run `ecc ito find`/i);
      assert.match(skill, /RFQ/i);
      assert.match(skill, /do not.*(?:order|purchase|trade|reserve)/is);
      assert.match(skill, /explicitly authorized read-only/i);
    }],
    ["aligns public, keyed, and SDK reads with the canonical product contract", () => {
      assert.match(skill, /Anonymous, rate-limited GET routes/i);
      assert.match(skill, /\/api\/baskets\/\{basket_id\}\/bootstrap/);
      assert.match(skill, /\/api\/markets\/hot/);
      assert.match(skill, /valid live product reads without a private key/i);
      assert.match(skill, /https:\/\/itomarkets\.com\/api\/v1/);
      assert.match(skill, /Authorization: Bearer/);
      assert.match(skill, /ito-markets/);
      assert.match(skill, /imported as `ito`/);
      assert.match(skill, /GET \/baskets/);
      assert.match(skill, /GET \/markets\/search/);
      assert.match(skill, /baskets:read/);
      assert.match(skill, /markets:read/);
      assert.match(skill, /Never use a\s+write scope/i);
    }],
    ["defines deterministic normalization, provenance, freshness, and comparison", () => {
      for (const token of ["basket_id", "underlier_id", "retrieved_at", "as_of", "source_uri", "source_type", "freshness_status"]) {
        assert.match(skill, new RegExp(`\\b${token}\\b`));
      }
      assert.match(skill, /Unicode NFKC/i);
      assert.match(skill, /sort.*underlier_id/is);
      assert.match(skill, /duplicate.*underlier_id/is);
      assert.match(skill, /freshness threshold/i);
      assert.match(skill, /same normalized input[\s\S]*same output/i);
    }],
    ["defines structured success and error output without advice", () => {
      assert.match(skill, /schema_version/);
      assert.match(skill, /"status": "ok"/);
      assert.match(skill, /"status": "blocked"/);
      for (const code of ["AUTH_REQUIRED", "AUTH_REVOKED", "AUTH_FORBIDDEN", "SOURCE_TIMEOUT", "STALE_SOURCE", "INVALID_INPUT", "UNSUPPORTED_OPERATION"]) {
        assert.match(skill, new RegExp(code));
      }
      assert.match(skill, /"incomplete": true/);
      assert.match(skill, /informational and not investment or trading advice/i);
    }],
    ["installs, uninstalls, and reinstalls only the selected skill in a clean home", () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-basket-home-"));
      const project = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-basket-project-"));
      const installed = path.join(home, ".claude", "skills", "ito-basket-compare", "SKILL.md");
      try {
        const first = install(["--skills", "ito-basket-compare"], home, project);
        assert.strictEqual(first.status, 0, first.stderr);
        assert.ok(fs.existsSync(installed));
        assert.strictEqual(fs.readFileSync(installed, "utf8"), skill);

        const removed = uninstall(home, project);
        assert.strictEqual(removed.status, 0, removed.stderr);
        assert.ok(!fs.existsSync(installed));

        const second = install(["--skills", "ito-basket-compare"], home, project);
        assert.strictEqual(second.status, 0, second.stderr);
        assert.strictEqual(fs.readFileSync(installed, "utf8"), skill);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(project, { recursive: true, force: true });
      }
    }],
  ];

  let passed = 0;
  for (const [name, test] of tests) passed += run(name, test) ? 1 : 0;
  const failed = tests.length - passed;
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
