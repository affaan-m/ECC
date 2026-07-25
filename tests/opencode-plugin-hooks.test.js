/**
 * Tests for the published OpenCode hook plugin surface.
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

async function loadPlugin() {
  const repoRoot = path.join(__dirname, "..")
  const buildResult = spawnSync("node", [path.join(repoRoot, "scripts", "build-opencode.js")], {
    cwd: repoRoot,
    encoding: "utf8",
  })
  assert.strictEqual(buildResult.status, 0, buildResult.stderr || buildResult.stdout)
  const pluginUrl = pathToFileURL(
    path.join(repoRoot, ".opencode", "dist", "plugins", "ecc-hooks.js")
  ).href
  return import(pluginUrl)
}

function createClient() {
  const logs = []
  return {
    logs,
    app: {
      log: ({ body }) => {
        logs.push(body)
        return Promise.resolve()
      },
    },
  }
}

function createFailingShell() {
  const calls = []
  const shell = (strings, ...values) => {
    calls.push(String.raw({ raw: strings }, ...values))
    const error = new Error("OpenCode plugin file probes must not use shell commands")
    return {
      then: (_resolve, reject) => reject(error),
      text: async () => {
        throw error
      },
    }
  }
  shell.calls = calls
  return shell
}

async function withTempProject(files, fn) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-opencode-plugin-"))
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
  console.log("\n=== Testing OpenCode plugin hooks ===\n")

  const { ECCHooksPlugin } = await loadPlugin()
  const tests = [
    [
      "plugin initializes and hooks stay usable when plugins/lib is missing",
      async () => withTempProject([], async (projectDir) => {
        const repoRoot = path.join(__dirname, "..")
        const libDir = path.join(repoRoot, ".opencode", "dist", "plugins", "lib")
        const backupDir = path.join(
          repoRoot,
          ".opencode",
          "dist",
          "plugins",
          "lib.missing-store-test-backup"
        )
        fs.renameSync(libDir, backupDir)
        try {
          const client = createClient()
          const $ = createFailingShell()

          // Plugin initialization must resolve even though changed-files-store.js
          // cannot be found -- it must not throw and crash session startup (#2530).
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          const disabledWarnings = client.logs.filter(
            (entry) =>
              entry.level === "warn" &&
              entry.message.includes("[ECC] changed-files tracking disabled") &&
              entry.message.includes("ecc repair --target opencode")
          )
          assert.strictEqual(
            disabledWarnings.length,
            1,
            "Expected exactly one warning when plugins/lib/changed-files-store.js cannot be loaded"
          )

          // Every hook that touches the store must remain callable and must not throw.
          await hooks["file.edited"]({ path: "src/example.ts" })
          await hooks["tool.execute.after"]({ tool: "edit", args: { path: "src/other.ts" } }, {})
          await hooks["session.deleted"]()
        } finally {
          fs.renameSync(backupDir, libDir)
        }
      }),
    ],
    [
      "changed-files tracking records and clears through the plugin hooks",
      async () => withTempProject([], async (projectDir) => {
        const client = createClient()
        const $ = createFailingShell()

        const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

        assert.ok(
          !client.logs.some(
            (entry) => entry.level === "warn" && entry.message.includes("changed-files tracking disabled")
          ),
          "Did not expect a disabled warning when plugins/lib is present"
        )

        const storeUrl = pathToFileURL(
          path.join(__dirname, "..", ".opencode", "dist", "plugins", "lib", "changed-files-store.js")
        ).href
        const store = await import(storeUrl)

        await hooks["file.edited"]({ path: "src/example.ts" })
        assert.ok(
          store.getChangedPaths().some((entry) => entry.path === "src/example.ts" && entry.changeType === "modified"),
          "Expected file.edited to record a change via the plugin hook"
        )

        await hooks["tool.execute.after"]({ tool: "edit", args: { path: "src/other.ts" } }, {})
        assert.ok(
          store.getChangedPaths().some((entry) => entry.path === "src/other.ts"),
          "Expected tool.execute.after to record a change for the edit tool"
        )

        await hooks["session.deleted"]()
        assert.ok(!store.hasChanges(), "Expected session.deleted to clear tracked changes")
      }),
    ],
    [
      "shell.env detects project markers without shelling out to test -f",
      async () => withTempProject(
        ["pnpm-lock.yaml", "tsconfig.json", "pyproject.toml"],
        async (projectDir) => {
          const client = createClient()
          const $ = createFailingShell()
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          const env = await hooks["shell.env"]()

          assert.deepStrictEqual($.calls, [], `Unexpected shell probes: ${$.calls.join(", ")}`)
          assert.strictEqual(env.PROJECT_ROOT, projectDir)
          assert.strictEqual(env.PACKAGE_MANAGER, "pnpm")
          assert.strictEqual(env.DETECTED_LANGUAGES, "typescript,python")
          assert.strictEqual(env.PRIMARY_LANGUAGE, "typescript")
          // Verify ECC_VERSION is not hardcoded
          assert.ok(env.ECC_VERSION !== "1.8.0", "ECC_VERSION should not be hardcoded to 1.8.0")
          assert.ok(env.ECC_VERSION.match(/^\d+\.\d+\.\d+$/), "ECC_VERSION should be a valid semver version")
        }
      ),
    ],
    [
      "session.created checks CLAUDE.md through fs instead of shell test",
      async () => withTempProject(["CLAUDE.md"], async (projectDir) => {
        const client = createClient()
        const $ = createFailingShell()
        const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

        await hooks["session.created"]()

        assert.deepStrictEqual($.calls, [], `Unexpected shell probes: ${$.calls.join(", ")}`)
        assert.ok(
          client.logs.some((entry) => entry.message === "[ECC] Found CLAUDE.md - loading project context"),
          "Expected CLAUDE.md detection log"
        )
      }),
    ],
    [
      "session.created ignores directories named CLAUDE.md",
      async () => {
        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-opencode-plugin-"))
        try {
          fs.mkdirSync(path.join(projectDir, "CLAUDE.md"))

          const client = createClient()
          const $ = createFailingShell()
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          await hooks["session.created"]()

          assert.deepStrictEqual($.calls, [], `Unexpected shell probes: ${$.calls.join(", ")}`)
          assert.ok(
            !client.logs.some((entry) => entry.message === "[ECC] Found CLAUDE.md - loading project context"),
            "Directory named CLAUDE.md should not be treated as project context"
          )
        } finally {
          fs.rmSync(projectDir, { recursive: true, force: true })
        }
      },
    ],
    [
      "shell.env ignores directories named like lockfiles and language markers",
      async () => {
        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-opencode-plugin-"))
        try {
          fs.mkdirSync(path.join(projectDir, "pnpm-lock.yaml"))
          fs.mkdirSync(path.join(projectDir, "tsconfig.json"))

          const client = createClient()
          const $ = createFailingShell()
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          const env = await hooks["shell.env"]()

          assert.deepStrictEqual($.calls, [], `Unexpected shell probes: ${$.calls.join(", ")}`)
          assert.ok(!("PACKAGE_MANAGER" in env), "Lockfile directory should not set PACKAGE_MANAGER")
          assert.ok(!("DETECTED_LANGUAGES" in env), "Marker directory should not set DETECTED_LANGUAGES")
          assert.ok(!("PRIMARY_LANGUAGE" in env), "Marker directory should not set PRIMARY_LANGUAGE")
        } finally {
          fs.rmSync(projectDir, { recursive: true, force: true })
        }
      },
    ],
    [
      "permission.ask handles read-only tools correctly",
      async () => withTempProject(
        [],
        async (projectDir) => {
          const client = createClient()
          const $ = createFailingShell()
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          // Test read-only tools
          const readResult = await hooks["permission.ask"]({ tool: "read", args: {} })
          assert.strictEqual(readResult.approved, true)
          assert.strictEqual(readResult.reason, "Read-only operation")

          const globResult = await hooks["permission.ask"]({ tool: "glob", args: {} })
          assert.strictEqual(globResult.approved, true)
          assert.strictEqual(globResult.reason, "Read-only operation")

          const grepResult = await hooks["permission.ask"]({ tool: "grep", args: {} })
          assert.strictEqual(grepResult.approved, true)
          assert.strictEqual(grepResult.reason, "Read-only operation")
        }
      ),
    ],
    [
      "permission.ask handles formatters correctly",
      async () => withTempProject(
        [],
        async (projectDir) => {
          const client = createClient()
          const $ = createFailingShell()
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          // Test formatter tools - note: args should be the command string, not object
          const prettierResult = await hooks["permission.ask"]({ 
            tool: "bash", 
            args: "npx prettier --write src/index.ts" 
          })
          console.log("prettierResult:", JSON.stringify(prettierResult))
          assert.strictEqual(prettierResult.approved, true)
          assert.strictEqual(prettierResult.reason, "Formatter execution")

          const biomeResult = await hooks["permission.ask"]({ 
            tool: "bash", 
            args: "npx @biomejs/biome format --write src/index.ts" 
          })
          console.log("biomeResult:", JSON.stringify(biomeResult))
          assert.strictEqual(biomeResult.approved, true)
          assert.strictEqual(biomeResult.reason, "Formatter execution")
        }
      ),
    ],
    [
      "permission.ask handles test execution correctly",
      async () => withTempProject(
        [],
        async (projectDir) => {
          const client = createClient()
          const $ = createFailingShell()
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          // Test test execution tools
          const npmTestResult = await hooks["permission.ask"]({ 
            tool: "bash", 
            args: { command: "npm test" } 
          })
          assert.strictEqual(npmTestResult.approved, true)
          assert.strictEqual(npmTestResult.reason, "Test execution")

          const vitestResult = await hooks["permission.ask"]({ 
            tool: "bash", 
            args: { command: "npx vitest run" } 
          })
          assert.strictEqual(vitestResult.approved, true)
          assert.strictEqual(vitestResult.reason, "Test execution")
        }
      ),
    ],
  ]

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
