/**
 * Lifecycle contract tests for the installable Itô Data Atlas design skill.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const SKILL_PATH = path.join(REPO_ROOT, "skills", "ito-data-atlas-agent", "SKILL.md");

function readSkill() {
  return fs.readFileSync(SKILL_PATH, "utf8");
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

const cases = [
  ["has valid discovery metadata and explicit trigger examples", () => {
    const skill = readSkill();
    assert.match(skill, /^---\nname: ito-data-atlas-agent\n/);
    assert.match(skill, /description: .*(?:Data Atlas|data atlas)/);
    assert.match(skill, /Trigger examples/i);
    for (const phrase of ["discover data sources", "draft a basket", "background research agent"]) {
      assert.ok(skill.toLowerCase().includes(phrase), `missing trigger phrase: ${phrase}`);
    }
  }],
  ["documents the canonical API and SDK while separating compute auth", () => {
    const skill = readSkill();
    assert.match(skill, /https:\/\/itomarkets\.com\/api\/v1/i);
    assert.match(skill, /ito-markets/);
    assert.match(skill, /markets:read/);
    assert.match(skill, /baskets:read/);
    assert.match(skill, /\/api\/baskets\/bootstrap/);
    assert.match(skill, /\/api\/markets\/hot/);
    assert.match(skill, /do not reuse[\s\S]*compute[\s\S]*device credential/i);
    assert.match(skill, /Never invent an endpoint/i);
  }],
  ["documents authentication handoff and safe recovery", () => {
    const skill = readSkill();
    for (const term of [
      "originating agent",
      "verification URL",
      "device code",
      "timeout",
      "revoked",
      "retry",
      "read-only",
    ]) assert.match(skill, new RegExp(term, "i"), `missing auth/recovery term: ${term}`);
    assert.match(skill, /never.*(?:print|echo|log).*(?:token|secret|API key)/i);
    assert.match(skill, /ambiguous[\s\S]*failure or response[\s\S]*do not retry/i);
  }],
  ["requires source-grounded, privacy-preserving structured output", () => {
    const skill = readSkill();
    for (const field of [
      "status",
      "objective",
      "sources",
      "access_gates",
      "candidate_spec",
      "approval_required",
      "errors",
      "next_safe_action",
    ]) assert.match(skill, new RegExp(`\\b${field}\\b`), `missing output field: ${field}`);
    assert.match(skill, /source (?:URL|identifier)/i);
    assert.match(skill, /retrieved_at/i);
    assert.match(skill, /prompt injection/i);
    assert.match(skill, /data minimization/i);
  }],
  ["keeps every state-changing action behind confirmation", () => {
    const skill = readSkill();
    assert.match(skill, /explicit human confirmation/i);
    assert.match(skill, /orders?|publish|provision|supplier|customer/i);
    assert.match(skill, /never treat[\s\S]*draft[\s\S]*approval/i);
  }],
];

console.log("\n=== Testing Itô Data Atlas agent skill lifecycle ===\n");
let passed = 0;
for (const [name, fn] of cases) if (test(name, fn)) passed += 1;
console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${cases.length - passed}`);
process.exit(passed === cases.length ? 0 : 1);
