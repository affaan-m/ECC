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

    ["REGRESSION GUARD: git tracks fewer than 10 files under .pi/ (adapter code only)", () => {
      let output
      try {
        output = execFileSync("git", ["ls-files", ".pi"], {
          cwd: repoRoot,
          encoding: "utf8",
        })
      } catch (error) {
        console.log(`    (skipped: git unavailable or \`git ls-files .pi\` failed: ${error.message})`)
        return
      }
      const trackedFiles = output.split("\n").filter(Boolean)
      assert.ok(
        trackedFiles.length < 10,
        `.pi/ must contain only adapter code, never copies of canonical assets (skills/agents/prompts) — found ${trackedFiles.length} tracked files: ${trackedFiles.join(", ")}`
      )
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
      const copyOrGenerateWord = /\b(copy|copies|copying|generate|generates|generated|generating)\b/i
      const pathUnderPi = /\.pi\//
      const paragraphs = readme.split(/\n\s*\n/)
      const instructsCopyingIntoPi = paragraphs.some(
        (paragraph) => copyOrGenerateWord.test(paragraph) && pathUnderPi.test(paragraph)
      )
      assert.ok(
        !instructsCopyingIntoPi,
        ".pi/README.md must not instruct users to copy or generate files into .pi/ (a paragraph mentions both a copy/generate word and a .pi/ path) — that documentation would reintroduce the PR #2352 regression"
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
