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

/**
 * Build a fake ECC installation root and copy the compiled plugin into it.
 *
 * Reproduces a *modular* install: the runtime scripts the plugin needs are
 * present, but `skills/` is absent because that directory belongs to the optional
 * `workflow-quality` module. `options.withSkills` adds it back so the same helper
 * can prove the difference is what matters.
 *
 * @param {{withSkills?: boolean}} [options]
 * @returns {string} path to the fake installation root
 */
function createModularInstallRoot(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-opencode-install-"))
  const distSource = path.join(__dirname, "..", ".opencode", "dist")
  const repoRoot = path.join(__dirname, "..")

  for (const dir of ["plugins", "tools"]) {
    fs.cpSync(path.join(distSource, dir), path.join(root, dir), { recursive: true })
  }

  // The runtime files an install without `workflow-quality` still ships. Copied
  // whole rather than file-by-file: scripts/lib has transitive requires (utils.js
  // alone pulls in agent-data-home), and a partial copy would fail the import for
  // reasons unrelated to what this test is about.
  for (const dir of ["hooks", "lib"]) {
    fs.cpSync(path.join(repoRoot, "scripts", dir), path.join(root, "scripts", dir), {
      recursive: true,
    })
  }

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "ecc-universal", version: "0.0.0-test", type: "module" })
  )
  fs.writeFileSync(path.join(root, "scripts", "package.json"), JSON.stringify({ type: "commonjs" }))

  // The plugin's tools import @opencode-ai/plugin, which resolves through
  // node_modules — a real installation has it, an isolated temp dir would not.
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(root, "node_modules"), "junction")

  if (options.withSkills) {
    fs.mkdirSync(path.join(root, "skills", "continuous-learning-v2"), { recursive: true })
    fs.writeFileSync(path.join(root, "skills", "continuous-learning-v2", "SKILL.md"), "# sentinel\n")
  }

  return root
}

/** Load the compiled plugin from a fake install root instead of the repo dist. */
async function loadPluginFrom(root) {
  return import(pathToFileURL(path.join(root, "plugins", "ecc-hooks.js")).href)
}

/**
 * Restore environment variables saved with Object.fromEntries of name -> value.
 *
 * @param {Record<string, string | undefined>} saved
 * @returns {void}
 */
function restoreEnv(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

/**
 * Read the skill-runs sink the tracker wrote under `homeDir`.
 *
 * The tracker resolves the sink from the *current* home, so the telemetry tests
 * move HOME/USERPROFILE to a temp dir and read from there.
 *
 * @param {string} homeDir
 * @returns {Array<Record<string, unknown>>}
 */
function readRecordedRuns(homeDir) {
  const runsFilePath = path.join(homeDir, ".claude", "state", "skill-runs.jsonl")
  if (!fs.existsSync(runsFilePath)) return []
  return fs
    .readFileSync(runsFilePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
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
          store
            .getChangedPaths()
            .some(
              (entry) =>
                entry.path === path.normalize("src/example.ts") &&
                entry.changeType === "modified"
            ),
          "Expected file.edited to record a change via the plugin hook"
        )

        await hooks["tool.execute.after"]({ tool: "edit", args: { path: "src/other.ts" } }, {})
        assert.ok(
          store
            .getChangedPaths()
            .some((entry) => entry.path === path.normalize("src/other.ts")),
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

          const existingEnv = Object.freeze({ EXISTING_ENV: "preserved" })
          const output = { env: existingEnv }
          await hooks["shell.env"]({ cwd: projectDir }, output)
          const { env } = output

          assert.deepStrictEqual($.calls, [], `Unexpected shell probes: ${$.calls.join(", ")}`)
          assert.strictEqual(env.EXISTING_ENV, "preserved")
          assert.notStrictEqual(env, existingEnv)
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

          const output = { env: {} }
          await hooks["shell.env"]({ cwd: projectDir }, output)
          const { env } = output

          assert.deepStrictEqual($.calls, [], `Unexpected shell probes: ${$.calls.join(", ")}`)
          assert.strictEqual(env.PROJECT_ROOT, projectDir)
          assert.ok(!("PACKAGE_MANAGER" in env), "Lockfile directory should not set PACKAGE_MANAGER")
          assert.ok(!("DETECTED_LANGUAGES" in env), "Marker directory should not set DETECTED_LANGUAGES")
          assert.ok(!("PRIMARY_LANGUAGE" in env), "Marker directory should not set PRIMARY_LANGUAGE")
        } finally {
          fs.rmSync(projectDir, { recursive: true, force: true })
        }
      },
    ],
    [
      "compacting appends ECC context without replacing the host compaction prompt",
      async () => withTempProject([], async (projectDir) => {
        const client = createClient()
        const $ = createFailingShell()
        const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })
        const existingContext = Object.freeze(["Existing plugin context"])
        const output = { context: existingContext }

        await hooks["experimental.session.compacting"]({ sessionID: "session-1" }, output)

        assert.strictEqual(output.context[0], "Existing plugin context")
        assert.notStrictEqual(output.context, existingContext)
        const prompt = output.prompt ?? ["Default compaction prompt", ...output.context].join("\n\n")
        assert.ok(prompt.includes("Default compaction prompt"))
        assert.ok(prompt.includes("# ECC Context"))
        assert.ok(prompt.includes("Current task status and progress"))
        assert.deepStrictEqual($.calls, [])
      }),
    ],
    [
      "compacting appends ECC guidance to custom prompts, including an empty prompt",
      async () => withTempProject([], async (projectDir) => {
        const client = createClient()
        const $ = createFailingShell()
        const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

        for (const customPrompt of ["Another plugin's custom prompt", ""]) {
          const existingContext = Object.freeze(["Existing plugin context"])
          const output = { context: existingContext, prompt: customPrompt }
          await hooks["experimental.session.compacting"]({ sessionID: "session-1" }, output)

          const prompt = output.prompt ?? ["Default compaction prompt", ...output.context].join("\n\n")
          assert.ok(prompt.startsWith(`${customPrompt}\n\n`))
          assert.ok(prompt.includes("# ECC Context"))
          assert.ok(prompt.includes("Current task status and progress"))
          assert.strictEqual(output.context, existingContext)
        }
        assert.deepStrictEqual($.calls, [])
      }),
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
    [
      "skill telemetry records a run through the shared tracker (#2463)",
      async () => withTempProject([], async (projectDir) => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-opencode-skill-home-"))
        const previousHome = process.env.HOME
        const previousUserProfile = process.env.USERPROFILE
        process.env.HOME = homeDir
        process.env.USERPROFILE = homeDir
        try {
          const client = createClient()
          const $ = createFailingShell()
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          assert.ok(
            !client.logs.some(
              (entry) =>
                entry.level === "warn" && entry.message.includes("skill-run telemetry disabled")
            ),
            "Did not expect telemetry to be disabled when scripts/hooks/skill-run-tracker.js is present"
          )

          // OpenCode names the tool `skill`; the id arrives on `name`.
          await hooks["tool.execute.after"]({ tool: "skill", args: { name: "code-review" } }, {})

          const records = readRecordedRuns(homeDir)

          assert.strictEqual(records.length, 1, "Expected exactly one recorded skill run")
          assert.strictEqual(records[0].skill_id, "code-review")
          assert.strictEqual(records[0].outcome, "success")
        } finally {
          restoreEnv({ HOME: previousHome, USERPROFILE: previousUserProfile })
          fs.rmSync(homeDir, { recursive: true, force: true })
        }
      }),
    ],
    [
      "skill telemetry records nothing for other tools",
      async () => withTempProject([], async (projectDir) => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-opencode-skill-home-"))
        const previousHome = process.env.HOME
        const previousUserProfile = process.env.USERPROFILE
        process.env.HOME = homeDir
        process.env.USERPROFILE = homeDir
        try {
          const client = createClient()
          const $ = createFailingShell()
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          await hooks["tool.execute.after"]({ tool: "edit", args: { path: "src/a.ts" } }, {})
          await hooks["tool.execute.after"]({ tool: "bash", args: { command: "ls" } }, {})

          assert.strictEqual(readRecordedRuns(homeDir).length, 0)
        } finally {
          restoreEnv({ HOME: previousHome, USERPROFILE: previousUserProfile })
          fs.rmSync(homeDir, { recursive: true, force: true })
        }
      }),
    ],
    [
      "skill telemetry respects the minimal hook profile",
      async () => withTempProject([], async (projectDir) => {
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-opencode-skill-home-"))
        const previousHome = process.env.HOME
        const previousUserProfile = process.env.USERPROFILE
        const previousProfile = process.env.ECC_HOOK_PROFILE
        process.env.HOME = homeDir
        process.env.USERPROFILE = homeDir
        process.env.ECC_HOOK_PROFILE = "minimal"
        try {
          const client = createClient()
          const $ = createFailingShell()
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          await hooks["tool.execute.after"]({ tool: "skill", args: { name: "code-review" } }, {})

          assert.strictEqual(readRecordedRuns(homeDir).length, 0)
        } finally {
          restoreEnv({
            HOME: previousHome,
            USERPROFILE: previousUserProfile,
            ECC_HOOK_PROFILE: previousProfile,
          })
          fs.rmSync(homeDir, { recursive: true, force: true })
        }
      }),
    ],
    [
      "shell.env exports CLAUDE_PLUGIN_ROOT so commands can resolve the ECC root",
      async () => withTempProject([], async (projectDir) => {
        const previousRoot = process.env.CLAUDE_PLUGIN_ROOT
        delete process.env.CLAUDE_PLUGIN_ROOT
        try {
          const client = createClient()
          const $ = createFailingShell()
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          const output = { env: {} }
          await hooks["shell.env"]({ cwd: projectDir }, output)

          assert.deepStrictEqual($.calls, [], `Unexpected shell probes: ${$.calls.join(", ")}`)
          assert.ok(output.env.CLAUDE_PLUGIN_ROOT, "Expected CLAUDE_PLUGIN_ROOT to be exported")

          // The resolver consumes this variable verbatim, so it must be a
          // directory that actually carries the ECC script tree.
          const root = output.env.CLAUDE_PLUGIN_ROOT
          assert.ok(
            fs.existsSync(path.join(root, "scripts", "lib", "resolve-ecc-root.js")),
            `Expected ${root} to contain scripts/lib/resolve-ecc-root.js`
          )
        } finally {
          restoreEnv({ CLAUDE_PLUGIN_ROOT: previousRoot })
        }
      }),
    ],
    [
      "shell.env does not override a CLAUDE_PLUGIN_ROOT the user set",
      async () => withTempProject([], async (projectDir) => {
        const explicitRoot = path.join(projectDir, "explicit-root")
        const previousRoot = process.env.CLAUDE_PLUGIN_ROOT
        process.env.CLAUDE_PLUGIN_ROOT = explicitRoot
        try {
          const client = createClient()
          const $ = createFailingShell()
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          const output = { env: {} }
          await hooks["shell.env"]({ cwd: projectDir }, output)

          assert.strictEqual(
            output.env.CLAUDE_PLUGIN_ROOT,
            undefined,
            "the plugin must not inject its own root over one the user set"
          )
          assert.strictEqual(
            process.env.CLAUDE_PLUGIN_ROOT,
            explicitRoot,
            "the user's value must survive untouched"
          )
        } finally {
          restoreEnv({ CLAUDE_PLUGIN_ROOT: previousRoot })
        }
      }),
    ],
    [
      "shell.env does not clobber a root another plugin already put in output.env",
      async () => withTempProject([], async (projectDir) => {
        const previousRoot = process.env.CLAUDE_PLUGIN_ROOT
        delete process.env.CLAUDE_PLUGIN_ROOT
        try {
          const client = createClient()
          const $ = createFailingShell()
          const hooks = await ECCHooksPlugin({ client, $, directory: projectDir })

          // An earlier plugin chose a root. The final merge below spreads our env
          // over output.env, so a guard that only checked process.env would
          // replace this value.
          const output = { env: { CLAUDE_PLUGIN_ROOT: path.join(projectDir, "other-plugin-root") } }
          await hooks["shell.env"]({ cwd: projectDir }, output)

          assert.strictEqual(
            output.env.CLAUDE_PLUGIN_ROOT,
            path.join(projectDir, "other-plugin-root"),
            "an existing output.env root must be preserved"
          )
        } finally {
          restoreEnv({ CLAUDE_PLUGIN_ROOT: previousRoot })
        }
      }),
    ],
    [
      "telemetry and root export work in a modular install without optional skills",
      async () => {
        // Regression: root detection probed skills/continuous-learning-v2, which
        // belongs to the optional workflow-quality module. An install with
        // platform-configs + hooks-runtime but without workflow-quality still
        // ships the plugin and the tracker, and it lost both fixes.
        const root = createModularInstallRoot()
        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-opencode-modular-"))
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-opencode-skill-home-"))
        const previousHome = process.env.HOME
        const previousUserProfile = process.env.USERPROFILE
        const previousRoot = process.env.CLAUDE_PLUGIN_ROOT
        process.env.HOME = homeDir
        process.env.USERPROFILE = homeDir
        delete process.env.CLAUDE_PLUGIN_ROOT
        try {
          assert.ok(
            !fs.existsSync(path.join(root, "skills")),
            "the fixture must not contain skills/, or it would not test the modular case"
          )

          const { ECCHooksPlugin: modularPlugin } = await loadPluginFrom(root)
          const client = createClient()
          const hooks = await modularPlugin({
            client,
            $: createFailingShell(),
            directory: projectDir,
          })

          assert.ok(
            !client.logs.some(
              (entry) =>
                entry.level === "warn" && entry.message.includes("skill-run telemetry disabled")
            ),
            "telemetry must stay enabled when the optional skills module is absent"
          )

          await hooks["tool.execute.after"]({ tool: "skill", args: { name: "code-review" } }, {})
          assert.strictEqual(readRecordedRuns(homeDir).length, 1, "expected the run to be recorded")

          const output = { env: {} }
          await hooks["shell.env"]({ cwd: projectDir }, output)
          assert.strictEqual(output.env.CLAUDE_PLUGIN_ROOT, fs.realpathSync(root))
          assert.strictEqual(output.env.ECC_VERSION, "0.0.0-test")
        } finally {
          restoreEnv({
            HOME: previousHome,
            USERPROFILE: previousUserProfile,
            CLAUDE_PLUGIN_ROOT: previousRoot,
          })
          fs.rmSync(root, { recursive: true, force: true })
          fs.rmSync(projectDir, { recursive: true, force: true })
          fs.rmSync(homeDir, { recursive: true, force: true })
        }
      },
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
