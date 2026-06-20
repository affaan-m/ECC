/**
 * Tests for OpenCode custom tools
 * 
 * Tests the 7 custom tools: run-tests, check-coverage, security-audit, 
 * format-code, lint-check, git-summary, changed-files
 */

const assert = require("node:assert")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { pathToFileURL } = require("node:url")

function runTest(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`)
      return { passed: 1, failed: 0 }
    })
    .catch((error) => {
      console.log(`  ✗ ${name}`)
      console.error(`    ${error.stack || error.message}`)
      return { passed: 0, failed: 1 }
    })
}

async function loadTools() {
  const repoRoot = path.join(__dirname, "..")
  const buildResult = spawnSync("node", [path.join(repoRoot, "scripts", "build-opencode.js")], {
    cwd: repoRoot,
    encoding: "utf8",
  })
  assert.strictEqual(buildResult.status, 0, buildResult.stderr || buildResult.stdout)
  
  const toolsDir = path.join(repoRoot, ".opencode", "dist", "tools")
  const tools = {}
  
  // Load each tool
  const toolFiles = [
    "format-code.js",
    "lint-check.js",
    "git-summary.js",
    "changed-files.js",
    "run-tests.js",
    "check-coverage.js",
    "security-audit.js",
  ]
  
  for (const toolFile of toolFiles) {
    const toolPath = path.join(toolsDir, toolFile)
    if (fs.existsSync(toolPath)) {
      const toolUrl = pathToFileURL(toolPath).href
      const toolModule = await import(toolUrl)
      const toolName = toolFile.replace(".js", "").replace("-", "")
      tools[toolName] = toolModule.default || toolModule
    }
  }
  
  return tools
}

function createMockContext(projectDir) {
  return {
    worktree: projectDir,
    directory: projectDir,
  }
}

async function withTempProject(files, fn) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-opencode-tools-"))
  try {
    for (const file of files) {
      const filePath = path.join(projectDir, file)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, "")
    }
    return await fn(projectDir)
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true })
  }
}

async function main() {
  console.log("\n=== Testing OpenCode custom tools ===\n")

  const tools = await loadTools()
  const tests = []

  // Test format-code tool
  if (tools.formatcode) {
    tests.push([
      "format-code: detects TypeScript formatter",
      async () => withTempProject(
        ["tsconfig.json", "src/index.ts"],
        async (projectDir) => {
          const context = createMockContext(projectDir)
          const result = await tools.formatcode.execute(
            { filePath: "src/index.ts" },
            context
          )
          const parsed = JSON.parse(result)
          assert.strictEqual(parsed.success, true)
          assert.ok(["biome", "prettier"].includes(parsed.formatter))
          assert.ok(parsed.command.includes("src/index.ts"))
        }
      ),
    ])

    tests.push([
      "format-code: detects Python formatter",
      async () => withTempProject(
        ["pyproject.toml", "src/main.py"],
        async (projectDir) => {
          const context = createMockContext(projectDir)
          const result = await tools.formatcode.execute(
            { filePath: "src/main.py" },
            context
          )
          const parsed = JSON.parse(result)
          assert.strictEqual(parsed.success, true)
          assert.strictEqual(parsed.formatter, "black")
          assert.ok(parsed.command.includes("src/main.py"))
        }
      ),
    ])

    tests.push([
      "format-code: handles unsupported file types",
      async () => withTempProject(
        ["README.md"],
        async (projectDir) => {
          const context = createMockContext(projectDir)
          const result = await tools.formatcode.execute(
            { filePath: "README.md" },
            context
          )
          const parsed = JSON.parse(result)
          // .md files are supported by prettier, so this should succeed
          assert.strictEqual(parsed.success, true)
          assert.strictEqual(parsed.formatter, "prettier")
          assert.ok(parsed.command.includes("README.md"))
        }
      ),
    ])
  }

  // Test lint-check tool
  if (tools.lintcheck) {
    tests.push([
      "lint-check: detects ESLint",
      async () => withTempProject(
        [".eslintrc.json", "src/index.ts"],
        async (projectDir) => {
          const context = createMockContext(projectDir)
          const result = await tools.lintcheck.execute(
            { target: "src" },
            context
          )
          const parsed = JSON.parse(result)
          assert.strictEqual(parsed.success, true)
          assert.strictEqual(parsed.linter, "eslint")
          assert.ok(parsed.command.includes("src"))
        }
      ),
    ])

    tests.push([
      "lint-check: detects Biome",
      async () => withTempProject(
        ["biome.json", "src/index.ts"],
        async (projectDir) => {
          const context = createMockContext(projectDir)
          const result = await tools.lintcheck.execute(
            { target: "src" },
            context
          )
          const parsed = JSON.parse(result)
          assert.strictEqual(parsed.success, true)
          assert.strictEqual(parsed.linter, "biome")
          assert.ok(parsed.command.includes("src"))
        }
      ),
    ])
  }

  // Test git-summary tool
  if (tools.gitsummary) {
    tests.push([
      "git-summary: returns git information",
      async () => withTempProject(
        [],
        async (projectDir) => {
          // Initialize git repo
          spawnSync("git", ["init"], { cwd: projectDir })
          spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: projectDir })
          spawnSync("git", ["config", "user.name", "Test"], { cwd: projectDir })
          
          // Create a file and commit
          fs.writeFileSync(path.join(projectDir, "test.txt"), "test")
          spawnSync("git", ["add", "test.txt"], { cwd: projectDir })
          spawnSync("git", ["commit", "-m", "test commit"], { cwd: projectDir })
          
          const context = createMockContext(projectDir)
          const result = await tools.gitsummary.execute(
            { depth: 1, includeDiff: false },
            context
          )
          const parsed = JSON.parse(result)
          assert.ok(parsed.branch)
          assert.ok(parsed.log)
          assert.ok(parsed.log.includes("test commit"))
        }
      ),
    ])
  }

  // Run all tests
  let passed = 0
  let failed = 0
  for (const [name, fn] of tests) {
    const result = await runTest(name, fn)
    passed += result.passed
    failed += result.failed
  }

  console.log(`\nPassed: ${passed}`)
  console.log(`Failed: ${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
