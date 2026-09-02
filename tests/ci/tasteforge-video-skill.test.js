/**
 * Contract tests for the curated TasteForge video skill.
 * No test contacts Fal, generates media, or mutates any provider account.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assertExactDryRunBoundary(payload, label) {
  assert.ok(
    Number.isInteger(payload.provider_calls) && payload.provider_calls === 0,
    `${label} must require exact integer provider_calls:0`
  );
  assert.strictEqual(payload.provider_execution, false, `${label} must require provider_execution:false`);
  assert.strictEqual(payload.dry_run, true, `${label} must require dry_run:true`);
  assert.strictEqual(payload.submit, false, `${label} must require submit:false`);
}

function assertFiniteReal(value, label, { positive = false, nonnegative = false } = {}) {
  assert.strictEqual(typeof value, "number", `${label} must be a real number, not a boolean`);
  assert.ok(Number.isFinite(value), `${label} must be finite`);
  if (positive) assert.ok(value > 0, `${label} must be positive`);
  if (nonnegative) assert.ok(value >= 0, `${label} must be nonnegative`);
}

function assertFiniteEvidenceTree(value, label) {
  if (typeof value === "number" || typeof value === "boolean") {
    assertFiniteReal(value, label);
  } else if (Array.isArray(value)) {
    value.forEach((nested) => assertFiniteEvidenceTree(nested, label));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((nested) => assertFiniteEvidenceTree(nested, label));
  }
}

function validateFinalContractFixture(fixture) {
  for (const spec of fixture.genre_specs) {
    assert.strictEqual(spec.dry_run, true, `genre ${spec.number} must require dry_run:true`);
  }

  assertExactDryRunBoundary({ ...fixture.receipt, submit: false }, "receipt");
  const durationByDigest = new Map();
  for (const reference of fixture.receipt.references) {
    assertFiniteReal(reference.source_duration, "receipt source_duration", { positive: true });
    const prior = durationByDigest.get(reference.sha256);
    assert.ok(
      prior === undefined || prior === reference.source_duration,
      "duplicate digest has conflicting source durations"
    );
    durationByDigest.set(reference.sha256, reference.source_duration);
    assertFiniteEvidenceTree(reference.probe, "probe evidence");
    assert.strictEqual(reference.probe.duration, reference.source_duration);
    for (const time of [
      ...(reference.probe.sample_times || []),
      ...(reference.probe.scene_changes || []),
      ...(reference.probe.style_samples || []).map((sample) => sample.time),
    ]) {
      assertFiniteReal(time, "probe evidence time", { nonnegative: true });
      assert.ok(time <= reference.source_duration, "probe evidence time exceeds source duration");
    }
  }

  const recipe = fixture.effect_recipe;
  assertExactDryRunBoundary({ ...recipe, submit: false }, "effect recipe");
  assertFiniteReal(recipe.timeline_duration, "timeline duration", { positive: true });
  for (const event of recipe.events) {
    assertFiniteReal(event.time, "effect event time", { nonnegative: true });
    assertFiniteReal(event.duration, "effect event duration", { positive: true });
    assert.ok(
      event.time + event.duration <= recipe.timeline_duration,
      "effect event exceeds timeline duration"
    );
    const evidence = event.evidence;
    const evidenceDuration = durationByDigest.get(evidence.reference_sha256);
    assert.ok(evidenceDuration !== undefined, "effect evidence cites unknown SHA-256");
    assert.strictEqual(
      evidence.source_duration,
      evidenceDuration,
      "effect evidence duration must equal receipt reference duration"
    );
    assertFiniteReal(evidence.time, "effect evidence time", { nonnegative: true });
    assert.ok(evidence.time <= evidenceDuration, "effect evidence time exceeds source duration");
    if (event.requires_subject_anchor) {
      const anchor = event.subject_anchor;
      const anchorDuration = durationByDigest.get(anchor.source_ref_sha256);
      assert.ok(anchorDuration !== undefined, "subject anchor cites unknown SHA-256");
      assert.strictEqual(
        anchor.source_duration,
        anchorDuration,
        "subject-anchor duration must equal receipt reference duration"
      );
      assertFiniteReal(anchor.evidence_time, "subject-anchor evidence time", { nonnegative: true });
      assert.ok(anchor.evidence_time <= anchorDuration, "anchor evidence time exceeds source duration");
      assert.strictEqual(anchor.lost_policy, "disable_effect_until_track_recovers");
    }
  }

  for (const modality of ["image", "video", "3d_asset"]) {
    const manifest = fixture.manifests[modality];
    assert.ok(manifest, `missing ${modality} manifest`);
    assertExactDryRunBoundary(manifest, `${modality} manifest`);
    assert.ok(manifest.requests.length > 0, `${modality} requests must not be empty`);
    for (const request of manifest.requests) {
      assertExactDryRunBoundary(request, `${modality} request`);
      assert.strictEqual(request.provider_call_mode, "disabled");
    }
  }

  const binding = fixture.source_binding;
  assert.strictEqual(binding.probed_sha256, binding.before_probe_sha256);
  assert.strictEqual(binding.receipt_sha256, binding.before_probe_sha256);
  assert.strictEqual(
    binding.after_probe_sha256,
    binding.before_probe_sha256,
    "source mutation during probe must fail closed"
  );

  assert.ok(fixture.missing_media_tool_error.exit_code > 0, "missing media tool must exit nonzero");
  assert.ok(fixture.missing_media_tool_error.stderr.length < 256, "missing-tool error must stay bounded");
  assert.doesNotMatch(fixture.missing_media_tool_error.stderr, /Traceback/i);

  for (const entry of fixture.output_entries) {
    assert.ok(
      entry.type === "regular_file" || entry.type === "directory",
      `output ${entry.path} must reject symlinks and special files`
    );
  }
}

function validateRejectedContractFixture(fixture) {
  if (fixture.kind === "manifest") {
    assertExactDryRunBoundary(fixture.payload, "manifest");
    for (const request of fixture.payload.requests || []) {
      assertExactDryRunBoundary(request, "request");
      assert.strictEqual(request.provider_call_mode, "disabled");
    }
    return;
  }
  if (fixture.kind === "effect_recipe") {
    for (const event of fixture.payload.events || []) {
      if (event.requires_subject_anchor) {
        assert.strictEqual(
          event.subject_anchor?.lost_policy,
          "disable_effect_until_track_recovers",
          "anchored CV effects must disable_effect_until_track_recovers"
        );
      }
    }
    return;
  }
  assert.fail(`unknown fixture kind: ${fixture.kind}`);
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test("has valid discoverable frontmatter and trigger phrases", () => {
  const skill = read("skills/tasteforge-video/SKILL.md");
  assert.match(
    skill,
    /^---\nname: tasteforge-video\ndescription: [^\n]+\nmetadata:\n {2}origin: ECC\n---\n/
  );
  for (const trigger of [
    /interview .*video taste|video .*taste interview/i,
    /distill .*aesthetic .*structured/i,
    /validate a style pack/i,
    /apply a style pack to local footage/i,
    /export EDL\/FCPXML|export .*EDL.*FCPXML/i,
    /audit .*generated-media provenance|provenance audit/i,
  ]) assert.match(skill, trigger);

  const description = skill.match(/^description: ([^\n]+)$/m)?.[1] || "";
  for (const discoveryTerm of ["multimodal", "image", "video", "3D", "file-driven", "distill", "apply"]) {
    assert.match(description, new RegExp(discoveryTerm, "i"), `frontmatter misses ${discoveryTerm}`);
  }
  const triggers = skill.match(/## When to Use\n([\s\S]*?)\n## /)?.[1] || "";
  for (const discoveryTerm of ["multimodal", "image", "video", "3D", "file-driven", "distill", "apply"]) {
    assert.match(triggers, new RegExp(discoveryTerm, "i"), `triggers miss ${discoveryTerm}`);
  }
});

test("distinguishes local deterministic operations from provider generation", () => {
  const skill = read("skills/tasteforge-video/SKILL.md");
  assert.match(skill, /local, deterministic/i);
  assert.match(skill, /provider generation/i);
  assert.match(skill, /must fail closed/i);
  assert.match(skill, /explicit separately authorized execution/i);
  assert.match(skill, /ECC never calls Fal/i);
  assert.match(
    skill,
    /never\s+reads\s+any\s+API\s+key\s+or\s+other\s+credentials/i,
    "skill must state that no API key or credentials are read"
  );
});

test("never claims a Fal workflow is saved from a local reference", () => {
  const skill = read("skills/tasteforge-video/SKILL.md");
  assert.match(
    skill,
    /never (?:claim|means|treat)[^.]*provider-side workflow (?:is|was) saved/i
  );
  assert.match(skill, /reference[- ]only/i);
  assert.match(skill, /dry[- ]run|dry_run/i);
});

test("links to the canonical ito-video implementation instead of duplicating it", () => {
  const skill = read("skills/tasteforge-video/SKILL.md");
  assert.match(skill, /ito-video/i);
  assert.match(skill, /Ito-Markets\/ito-video/i);
  assert.match(skill, /python3 -m tasteforge/);
  assert.match(skill, /does not (?:vendor|duplicate|copy)/i);
});

test("describes the deterministic workflow surface faithfully", () => {
  const skill = read("skills/tasteforge-video/SKILL.md");
  for (const cmd of ["inspect", "validate", "interview", "distill", "apply", "export", "provenance"]) {
    assert.match(skill, new RegExp(`\\b${cmd}\\b`));
  }
  assert.match(skill, /schema/i);
  assert.match(skill, /cadence/i);
  assert.match(skill, /style pack/i);
});

test("defines the fail-closed file-driven multimodal contract", () => {
  const skill = read("skills/tasteforge-video/SKILL.md");
  assert.match(skill, /python3 -m tasteforge multimodal --config/);
  for (const phrase of [
    /Flash Ethereal/,
    /3D Cyber Glitch/,
    /Fluid Sketch/,
    /image.*video.*3D-asset/is,
    /seeded aperiodic/i,
    /subject anchor/i,
    /placement constraints/i,
    /provider_execution:\s*false/i,
    /path.*byte size.*SHA-256/is,
    /genre.*modality/is,
    /exact reference\/time provenance/i,
    /provider_calls:\s*0/i,
    /exact integer/i,
    /genre spec.*dry_run:\s*true/is,
    /effect recipe.*provider_calls:\s*0/is,
    /dry_run:\s*true/i,
    /submit:\s*false/i,
    /finite real/i,
    /booleans as invalid numbers/i,
    /duplicate occurrences.*digest.*agree.*duration/is,
    /effect evidence `source_duration`.*validated\s+receipt duration/is,
    /subject-anchor `source_duration`.*validated\s+receipt duration/is,
    /same stable bytes/i,
    /mutates while probing/i,
    /ffmpeg.*ffprobe.*bounded nonzero.*without a\s+Python traceback/is,
    /symlinks.*special files/is,
    /disable_effect_until_track_recovers/i,
  ]) assert.match(skill, phrase);
  assert.match(skill, /missing.*manifest.*fail closed/is);
  assert.match(skill, /tamper.*fail closed/is);
});

test("executable fixture enforces the independently passed final contract", () => {
  const baseline = readJson("tests/fixtures/tasteforge-video/final-contract.json");
  const clone = () => JSON.parse(JSON.stringify(baseline));
  assert.doesNotThrow(() => validateFinalContractFixture(clone()));

  const mutations = [
    ["genre dry_run false", (value) => { value.genre_specs[0].dry_run = false; }],
    ["receipt boolean provider_calls", (value) => { value.receipt.provider_calls = false; }],
    ["effect boolean provider_calls", (value) => { value.effect_recipe.provider_calls = false; }],
    ["manifest boolean provider_calls", (value) => { value.manifests.video.provider_calls = false; }],
    ["request boolean provider_calls", (value) => {
      value.manifests.video.requests[0].provider_calls = false;
    }],
    ["boolean timeline number", (value) => { value.effect_recipe.events[0].time = false; }],
    ["non-finite event duration", (value) => { value.effect_recipe.events[0].duration = NaN; }],
    ["non-finite evidence duration", (value) => {
      value.effect_recipe.events[0].evidence.source_duration = Infinity;
    }],
    ["boolean probe measurement", (value) => {
      value.receipt.references[0].probe.style_samples[0].luma = false;
    }],
    ["effect duration not bound to digest", (value) => {
      value.effect_recipe.events[0].evidence.source_duration = 5;
    }],
    ["anchor duration not bound to digest", (value) => {
      value.effect_recipe.events[0].subject_anchor.source_duration = 5;
    }],
    ["duplicate digest conflicting duration", (value) => {
      const duplicate = JSON.parse(JSON.stringify(value.receipt.references[0]));
      duplicate.source_duration = 7;
      duplicate.probe.duration = 7;
      value.receipt.references.push(duplicate);
    }],
    ["source mutation during probe", (value) => {
      value.source_binding.after_probe_sha256 = "b".repeat(64);
    }],
    ["missing-tool success exit", (value) => { value.missing_media_tool_error.exit_code = 0; }],
    ["missing-tool traceback", (value) => {
      value.missing_media_tool_error.stderr = "Traceback (most recent call last): secret\n";
    }],
    ["symlink output", (value) => {
      value.output_entries.push({ path: "resolve", type: "symlink" });
    }],
    ["special-file output", (value) => {
      value.output_entries.push({ path: "resolve/pipe", type: "fifo" });
    }],
  ];

  for (const [label, mutate] of mutations) {
    const fixture = clone();
    mutate(fixture);
    assert.throws(
      () => validateFinalContractFixture(fixture),
      undefined,
      `${label} was not rejected`
    );
  }
});

test("executable fixtures reject dry_run:false and continue_without_anchor", () => {
  for (const fixtureName of [
    "reject-dry-run-false.json",
    "reject-continue-without-anchor.json",
  ]) {
    const fixture = readJson(`tests/fixtures/tasteforge-video/${fixtureName}`);
    assert.strictEqual(fixture.expected, "reject");
    assert.throws(
      () => validateRejectedContractFixture(fixture),
      undefined,
      `${fixtureName} was not rejected`
    );
  }
});

test("ships through the opt-in media-generation install module and npm package", () => {
  const modules = readJson("manifests/install-modules.json").modules;
  const module = modules.find((candidate) => candidate.id === "media-generation");
  assert.ok(module, "media-generation install module is missing");
  assert.ok(
    module.paths.includes("skills/tasteforge-video"),
    "skills/tasteforge-video missing from media-generation paths"
  );
  assert.strictEqual(module.defaultInstall, false);
  const packed = readJson("package.json").files;
  assert.ok(
    packed.includes("skills/tasteforge-video/"),
    "skills/tasteforge-video/ missing from npm files"
  );
});

test("is discoverable in the source tree and in a simulated packed artifact", () => {
  const skillPath = path.join(REPO_ROOT, "skills", "tasteforge-video", "SKILL.md");
  assert.ok(fs.existsSync(skillPath), "SKILL.md missing in source tree");

  // Packed surface: npm includes the directory; the plugin manifest routes
  // ./skills/ wholesale; nothing ignores the directory.
  const npmignore = read(".npmignore");
  const ignoresSkill = npmignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .some((line) => {
      const normalized = line.replace(/\/+$/, "");
      return (
        normalized === "skills" ||
        normalized === "skills/tasteforge-video" ||
        normalized === "skills/tasteforge-video/SKILL.md"
      );
    });
  assert.ok(!ignoresSkill, ".npmignore must not exclude the skill");

  const claudePlugin = readJson(".claude-plugin/plugin.json");
  assert.ok(
    (claudePlugin.skills || []).includes("./skills/"),
    "claude plugin skills must route to the root skills/ directory"
  );

  // Simulated installed layout: the files entry must name the skill dir and
  // the SKILL.md must exist beneath it with non-empty content.
  const stat = fs.statSync(path.join(REPO_ROOT, "skills", "tasteforge-video"));
  assert.ok(stat.isDirectory(), "skill must be a directory");
  assert.ok(fs.readFileSync(skillPath, "utf8").trim().length > 200, "SKILL.md is empty-ish");
});

test("passes the curated skill validator", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "ci", "validate-skills.js")],
    { encoding: "utf8" }
  );
  assert.strictEqual(result.status, 0, `validate-skills failed:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout + result.stderr, /skill director/i, "validator output unrecognized");
});

// Opt-in slow path: verifies the real npm tarball contents. Enabled with
// ECC_TEST_NPM_PACK=1 (release/CI verification); the default suite relies on
// the files-array assertions above.
test("ships inside the real npm tarball (opt-in)", () => {
  if (process.env.ECC_TEST_NPM_PACK !== "1") {
    return { skipped: "set ECC_TEST_NPM_PACK=1 to run real npm pack inclusion" };
  }
  const result = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.strictEqual(result.status, 0, `npm pack failed:\n${result.stderr}`);
  assert.match(
    result.stdout + result.stderr,
    /skills\/tasteforge-video\/SKILL\.md/,
    "SKILL.md missing from npm tarball contents"
  );
});

let failed = 0;
let skipped = 0;
console.log("\n=== Testing TasteForge video skill ===\n");
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
if (failed) process.exit(1);
console.log(`\n${tests.length - failed - skipped}/${tests.length} passed, ${skipped} skipped`);
