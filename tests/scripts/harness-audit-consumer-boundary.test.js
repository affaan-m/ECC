"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { buildReport } = require("../../scripts/harness-audit");

test("consumer audit unmatched glob never enumerates linked directory targets", t => {
  const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ecc-audit-boundary-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, "project");
  const outside = path.join(temporary, "outside");
  fs.mkdirSync(path.join(project, "scan"), { recursive: true });
  fs.mkdirSync(path.join(outside, "nested"), { recursive: true });
  fs.writeFileSync(path.join(project, "pytest.ini"), "[pytest]\ntestpaths = scan/**/not-present\n");
  fs.writeFileSync(path.join(project, "test_owned.py"), "def test_owned(): pass\n");
  fs.writeFileSync(path.join(outside, "nested", "test_external.py"), "def test_external(): pass\n");
  for (const name of ["first", "second"]) {
    fs.symlinkSync(outside, path.join(project, "scan", name), "junction");
  }
  const original = fs.readdirSync;
  const outsideReads = [];
  fs.readdirSync = function (directory, ...args) {
    const resolved = fs.realpathSync(directory);
    if (resolved === outside || resolved.startsWith(outside + path.sep)) {
      outsideReads.push(String(directory));
    }
    return original.call(this, directory, ...args);
  };
  let report;
  try {
    report = buildReport("repo", { rootDir: project, targetMode: "consumer" });
  } finally {
    fs.readdirSync = original;
  }
  assert.equal(report.target_mode, "consumer");
  assert.ok(report.checks.find(check => check.id === "consumer-test-suite").pass);
  assert.equal(report.checks.find(check => check.id === "consumer-eval-coverage").pass, false);
  assert.deepEqual(outsideReads, [], "linked directories must not be enumerated, even through duplicate links");
});


test("consumer audit does not treat a linked directory as a matching testpath", t => {
  const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ecc-audit-link-match-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, "project");
  fs.mkdirSync(path.join(project, "scan"), { recursive: true });
  fs.writeFileSync(path.join(project, "pytest.ini"), "[pytest]\ntestpaths = scan/**/linked\n");
  fs.mkdirSync(path.join(project, "owned"));
  for (const name of ["test_one.py", "test_two.py", "test_three.py"]) {
    fs.writeFileSync(path.join(project, "owned", name), "def test_owned(): pass\n");
  }
  fs.symlinkSync(path.join(project, "owned"), path.join(project, "scan", "linked"), "junction");
  const report = buildReport("repo", { rootDir: project, targetMode: "consumer" });
  assert.ok(report.checks.find(check => check.id === "consumer-eval-coverage").pass,
    "an unmatched glob must fall back to the three regular owned test files");
});
