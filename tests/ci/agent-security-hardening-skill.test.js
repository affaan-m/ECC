/**
 * Executes the workspace_path() example from the agent-security-hardening
 * skill so the documented guard is checked as code, not only as prose.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");
const SKILL_PATH = path.join(REPO_ROOT, "skills", "agent-security-hardening", "SKILL.md");

function findPython() {
  for (const candidate of ["python3", "python"]) {
    const probe = spawnSync(candidate, ["-c", "import sys; print(sys.version_info >= (3, 9))"], {
      encoding: "utf8",
    });
    if (probe.status === 0 && probe.stdout.trim() === "True") return candidate;
  }
  return null;
}

function workspacePathSnippet() {
  const skill = fs.readFileSync(SKILL_PATH, "utf8");
  const blocks = [...skill.matchAll(/```python\n([\s\S]*?)```/g)].map(match => match[1]);
  const snippet = blocks.find(block => block.includes("def workspace_path("));
  assert.ok(snippet, "workspace_path() python example missing from SKILL.md");
  return snippet;
}

const HARNESS = `
import json, sys
from pathlib import Path
namespace = {}
exec(sys.stdin.read(), namespace)
workspace_path = namespace["workspace_path"]
workspace = Path(sys.argv[1])
results = {}
for requested in json.loads(sys.argv[2]):
    try:
        workspace_path(workspace, requested)
        results[requested] = "accepted"
    except ValueError:
        results[requested] = "rejected"
print(json.dumps(results))
`;

function classify(python, requests) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-workspace-path-"));
  try {
    const result = spawnSync(python, ["-c", HARNESS, workspace, JSON.stringify(requests)], {
      input: workspacePathSnippet(),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, `python harness failed:\n${result.stderr}`);
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

const python = findPython();

test("accepts ordinary nested and look-alike workspace paths", () => {
  if (!python) return { skipped: "python >= 3.9 not available" };
  const requests = ["reports/q1.txt", "reports\\q1.txt", "console.txt", "CONFIG", "com10.txt", "nullable.md", ".env"];
  const results = classify(python, requests);
  for (const requested of requests) {
    assert.strictEqual(results[requested], "accepted", `${requested} should be accepted`);
  }
});

test("rejects traversal and absolute paths", () => {
  if (!python) return { skipped: "python >= 3.9 not available" };
  const requests = ["../outside.txt", "nested/../../outside.txt", "..\\outside.txt", "nested\\..\\..\\outside.txt", "\\\\server\\share\\file.txt", path.resolve(os.tmpdir(), "abs.txt")];
  const results = classify(python, requests);
  for (const requested of requests) {
    assert.strictEqual(results[requested], "rejected", `${requested} should be rejected`);
  }
});

test("rejects Windows reserved device names, trailing dots or spaces, and stream syntax", () => {
  if (!python) return { skipped: "python >= 3.9 not available" };
  const requests = [
    "CON",
    "nul",
    "nul.txt",
    "NUL.tar.gz",
    "aux",
    "prn.log",
    "com1",
    "COM9.txt",
    "lpt1",
    "LPT9.log",
    "COM¹",
    "lpt³.txt",
    "sub/CON/file.txt",
    "sub\\CON\\file.txt",
    "notes.",
    "notes ",
    "dir./file.txt",
    "report.txt:ads",
    "report.txt::$DATA",
    "C:\\Windows\\system32",
    "C:/Windows/system32",
  ];
  const results = classify(python, requests);
  for (const requested of requests) {
    assert.strictEqual(results[requested], "rejected", `${JSON.stringify(requested)} should be rejected`);
  }
});

let failed = 0;
let skipped = 0;
console.log("\n=== Testing agent-security-hardening skill ===\n");
for (const [name, fn] of tests) {
  try {
    const result = fn();
    if (result?.skipped) {
      skipped += 1;
      console.log(`  - SKIP ${name}: ${result.skipped}`);
      continue;
    }
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}
console.log(`\nPassed: ${tests.length - failed - skipped}`);
console.log(`Skipped: ${skipped}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
