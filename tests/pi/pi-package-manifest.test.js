/**
 * Tests for the Pi coding agent package manifest (`pi` key in package.json)
 * and the `.pi/` adapter directory.
 *
 * This is the regression guard for PR #2352, which generated ~440 copied
 * files (skills/agents/prompts/commands) under `.pi/`. The Pi integration
 * must stay a thin adapter: `.pi/` holds only adapter code, and the `pi`
 * manifest points directly at ECC's canonical `skills/` and `commands/`
 * directories rather than at duplicated copies.
 */

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")

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

function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  return match ? match[1] : null
}

/**
 * Manual recursive file walk. Node 18 (the repo's minimum supported version,
 * see `engines` in package.json) does not support
 * `fs.readdirSync(dir, { recursive: true })` — that option was only added in
 * Node 20 — so this walk is done by hand instead.
 */
function walkFiles(dir) {
  let files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files = files.concat(walkFiles(fullPath))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

const COPY_OR_GENERATE_WORD = /\b(copy|copies|copying|generate|generates|generated|generating)\b/i
const PATH_UNDER_PI = /\.pi\//
const NEGATION_WORD = /\b(no|not|never|nothing|without|isn't|aren't|don't|doesn't)\b/i
const COPY_INTO_PI_SHAPE = /\b(copy|copies|copying|generate|generates|generating)\b[^.!?\n]*\.pi\//i

/**
 * Splits markdown text into sentence-ish chunks: paragraphs first, then each
 * paragraph on sentence-ending punctuation. Good enough for this heuristic —
 * it does not need to be a real sentence parser, only to stop treating an
 * entire multi-sentence paragraph as one unit.
 */
function splitIntoSentences(text) {
  return text
    .split(/\n\s*\n/)
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

/**
 * Detects an actual imperative instruction to copy or generate files into
 * `.pi/` (e.g. "Copy your skills into .pi/skills/ before installing."),
 * while explicitly allowing negated phrasing that documents the opposite
 * (e.g. "no generated copies", "Nothing is copied or generated under .pi/").
 * A naive "copy/generate word AND .pi/ path in the same paragraph" proximity
 * check flags that legitimate negated documentation as a violation; this
 * requires copy/generate word and .pi/ path to appear in the same sentence
 * with no negation word, which is what an actual instruction looks like.
 */
function findImperativeCopyIntoPiInstruction(text) {
  return splitIntoSentences(text).some((sentence) => {
    if (!COPY_OR_GENERATE_WORD.test(sentence) || !PATH_UNDER_PI.test(sentence)) {
      return false
    }
    if (NEGATION_WORD.test(sentence)) {
      return false
    }
    return COPY_INTO_PI_SHAPE.test(sentence)
  })
}

function main() {
  console.log("\n=== Testing Pi package manifest (pi key + .pi/ adapter) ===\n")

  let passed = 0
  let failed = 0

  const repoRoot = path.join(__dirname, "..", "..")
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
  )

  const tests = [
    ["package.json pi key has exactly extensions, skills, prompts (not agents or chains)", () => {
      assert.ok(
        packageJson.pi && typeof packageJson.pi === "object",
        "package.json must have a top-level `pi` key for Pi coding agent integration"
      )
      const keys = Object.keys(packageJson.pi).sort()
      assert.deepStrictEqual(
        keys,
        ["extensions", "prompts", "skills"],
        `pi manifest must contain exactly extensions, prompts, skills — got: ${keys.join(", ")}`
      )
      assert.ok(
        !("agents" in packageJson.pi),
        "pi.agents is not supported by Pi's core manifest — subagent conversion belongs to the pi-subagents companion package and would be silently ignored if placed here"
      )
      assert.ok(
        !("chains" in packageJson.pi),
        "pi.chains is not supported by Pi's core manifest — chains belong to the pi-subagents companion package and would be silently ignored if placed here"
      )
    }],

    ["pi.extensions is exactly the single ECC adapter entry file, and it exists on disk", () => {
      assert.deepStrictEqual(
        packageJson.pi.extensions,
        ["./.pi/extensions/index.ts"],
        `pi.extensions must be exactly ["./.pi/extensions/index.ts"] — got ${JSON.stringify(packageJson.pi.extensions)}`
      )
      const extensionPath = path.join(repoRoot, ".pi", "extensions", "index.ts")
      assert.ok(
        fs.existsSync(extensionPath),
        `${extensionPath} does not exist, but pi.extensions references it — Pi would fail to load the adapter`
      )
    }],

    ["pi.skills and pi.prompts point at ECC's canonical top-level directories, never at .pi/", () => {
      assert.deepStrictEqual(
        packageJson.pi.skills,
        ["./skills"],
        `pi.skills must be exactly ["./skills"] (ECC's canonical skills directory) — got ${JSON.stringify(packageJson.pi.skills)}`
      )
      assert.deepStrictEqual(
        packageJson.pi.prompts,
        ["./commands"],
        `pi.prompts must be exactly ["./commands"] (ECC's canonical commands directory) — got ${JSON.stringify(packageJson.pi.prompts)}`
      )
      for (const entry of [...packageJson.pi.skills, ...packageJson.pi.prompts]) {
        assert.ok(
          !entry.startsWith("./.pi") && !entry.includes(".pi/"),
          `pi.skills/pi.prompts entry "${entry}" must not point under .pi/ — Pi must mount ECC's canonical assets directly, never a copy generated into the adapter directory`
        )
      }
    }],

    ["REGRESSION GUARD: .pi/ contains no generated resource directories (PR #2352 regenerated this)", () => {
      const forbiddenDirs = [".pi/skills", ".pi/agents", ".pi/prompts", ".pi/chains", ".pi/commands", ".pi/rules"]
      for (const relativeDir of forbiddenDirs) {
        const fullPath = path.join(repoRoot, relativeDir)
        assert.ok(
          !fs.existsSync(fullPath),
          `${relativeDir} must not exist — .pi/ may contain adapter code only; a generated resource directory here means canonical skills/agents/prompts were copied instead of referenced by the pi manifest (the PR #2352 regression)`
        )
      }
    }],

    ["REGRESSION GUARD: fewer than 10 files exist on disk under .pi/ (adapter code only)", () => {
      // Authoritative check: walk .pi/ on disk so untracked files (e.g.
      // regenerated skill copies that were never `git add`ed) cannot bypass
      // this guard the way a git-only check would.
      const piDir = path.join(repoRoot, ".pi")
      const onDiskFiles = walkFiles(piDir)
      assert.ok(
        onDiskFiles.length < 10,
        ".pi/ must contain only adapter code, never copies of canonical assets " +
          `(skills/agents/prompts) — found ${onDiskFiles.length} files on disk: ` +
          `${onDiskFiles.map((file) => path.relative(repoRoot, file)).join(", ")}`
      )

      // Additional signal only, not authoritative: git ls-files reports what
      // is tracked, which is useful corroborating evidence but is silently
      // bypassed by untracked files, so it never replaces the on-disk walk above.
      let trackedFiles
      try {
        const output = execFileSync("git", ["ls-files", ".pi"], {
          cwd: repoRoot,
          encoding: "utf8",
        })
        trackedFiles = output.split("\n").filter(Boolean)
      } catch (error) {
        console.log(`    (git signal skipped: git unavailable or \`git ls-files .pi\` failed: ${error.message})`)
      }
      if (trackedFiles) {
        assert.ok(
          trackedFiles.length < 10,
          `.pi/ must contain only adapter code, never copies of canonical assets (skills/agents/prompts) — found ${trackedFiles.length} tracked files: ${trackedFiles.join(", ")}`
        )
      }
    }],

    ["package.json files array ships the .pi/ adapter and the canonical assets the manifest depends on", () => {
      const files = packageJson.files
      assert.ok(Array.isArray(files), "package.json must have a `files` array to control what npm publishes")
      assert.ok(
        files.includes(".pi/"),
        "package.json files array must include \".pi/\" so the Pi adapter ships in the published npm package"
      )
      assert.ok(
        files.includes("commands/"),
        "package.json files array must include \"commands/\" — pi.prompts (\"./commands\") depends on this canonical directory being published"
      )
      assert.ok(
        files.some((entry) => entry.startsWith("skills/")),
        "package.json files array must include at least one skills/... entry — pi.skills (\"./skills\") depends on the canonical skills directory being published"
      )
    }],

    ["canonical commands/ is Pi-compatible without transformation (prompt-template format)", () => {
      const commandsDir = path.join(repoRoot, "commands")
      const commandFiles = fs.readdirSync(commandsDir).filter((name) => name.endsWith(".md"))
      assert.ok(
        commandFiles.length >= 50,
        `commands/ must contain at least 50 .md files for Pi's prompt-template format — found ${commandFiles.length}`
      )

      const planCommandPath = path.join(commandsDir, "plan.md")
      const planCommand = fs.readFileSync(planCommandPath, "utf8")
      const planFrontmatter = extractFrontmatter(planCommand)
      assert.ok(
        planFrontmatter !== null,
        `${planCommandPath} must start with a --- YAML frontmatter block for Pi to parse it as a prompt template`
      )
      assert.ok(
        /^description:/m.test(planFrontmatter),
        `${planCommandPath} frontmatter must contain a description: field — Pi's prompt-template format requires it`
      )
    }],

    ["canonical skills/ is Pi-compatible without transformation (Agent Skills standard)", () => {
      const skillsDir = path.join(repoRoot, "skills")
      const skillDirNames = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
      const skillDirsWithManifest = skillDirNames.filter((name) =>
        fs.existsSync(path.join(skillsDir, name, "SKILL.md"))
      )
      assert.ok(
        skillDirsWithManifest.length >= 100,
        `skills/ must contain at least 100 subdirectories with a SKILL.md for Pi's Agent Skills implementation — found ${skillDirsWithManifest.length}`
      )

      const sampleSkillPath = path.join(skillsDir, "frontend-patterns", "SKILL.md")
      const sampleSkill = fs.readFileSync(sampleSkillPath, "utf8")
      const sampleFrontmatter = extractFrontmatter(sampleSkill)
      assert.ok(
        sampleFrontmatter !== null,
        `${sampleSkillPath} must start with a --- YAML frontmatter block for Pi to parse it as an Agent Skill`
      )
      assert.ok(
        /^name:/m.test(sampleFrontmatter),
        `${sampleSkillPath} frontmatter must contain a name: field — the Agent Skills standard Pi implements requires it`
      )
      assert.ok(
        /^description:/m.test(sampleFrontmatter),
        `${sampleSkillPath} frontmatter must contain a description: field — the Agent Skills standard Pi implements requires it`
      )
    }],

    [".pi/README.md documents the single-source-of-truth principle without instructing copies into .pi/", () => {
      const readmePath = path.join(repoRoot, ".pi", "README.md")
      assert.ok(
        fs.existsSync(readmePath),
        `${readmePath} must exist to document the adapter's single-source-of-truth design principle`
      )
      const readme = fs.readFileSync(readmePath, "utf8")
      assert.ok(
        readme.includes("skills/"),
        ".pi/README.md must mention skills/ as the canonical directory Pi mounts directly"
      )
      assert.ok(
        readme.includes("commands/"),
        ".pi/README.md must mention commands/ as the canonical directory Pi mounts directly"
      )

      // Detects actual imperative instructions to copy/generate into .pi/,
      // not mere word proximity — a naive "copy/generate word + .pi/ path in
      // the same paragraph" check would flag legitimate negated documentation
      // (e.g. "no generated copies", "Nothing is copied or generated under
      // .pi/") as a violation. Verified against the current .pi/README.md
      // content below (must pass) and the detector's own behavior further down.
      assert.ok(
        !findImperativeCopyIntoPiInstruction(readme),
        ".pi/README.md must not instruct users to copy or generate files into .pi/ " +
          "— that documentation would reintroduce the PR #2352 regression"
      )

      // Sanity-check the detector itself so the assertion above is not
      // vacuously true: it must still catch a real instruction...
      assert.ok(
        findImperativeCopyIntoPiInstruction("Copy your skills into .pi/skills/ before installing."),
        "the copy-into-.pi/ detector must flag an actual instruction to copy files " +
          "into .pi/ (this checks the detector, not .pi/README.md itself)"
      )
      // ...and it must explicitly allow the negated phrasing named in the
      // PR #2352 regression-guard rationale, rather than flagging it.
      assert.ok(
        !findImperativeCopyIntoPiInstruction("This adapter ships with no generated copies under `.pi/`."),
        'the copy-into-.pi/ detector must not flag negated phrasing (e.g. "no generated ' +
          'copies... .pi/") as an instruction (this checks the detector, not .pi/README.md itself)'
      )
      assert.ok(
        !findImperativeCopyIntoPiInstruction("Nothing is copied or generated under `.pi/`."),
        'the copy-into-.pi/ detector must not flag negated phrasing (e.g. "Nothing is copied ' +
          'or generated under .pi/") as an instruction (this checks the detector, not .pi/README.md itself)'
      )
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
