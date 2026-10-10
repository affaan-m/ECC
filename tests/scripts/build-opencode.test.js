/**
 * Tests for scripts/build-opencode.js
 */

const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const { pathToFileURL } = require("url")
const { getNpmPackEntry } = require("../lib/npm-pack-output")
const { createManifestInstallPlan, applyInstallPlan } = require("../../scripts/lib/install-executor")
const { withHookConsent } = require("../../scripts/lib/install/hook-consent")

function checkRuntime(runtimeRoot, extension, loader) {
  const check = `
    const assert = require("node:assert/strict")
    const path = require("node:path")
    const { pathToFileURL } = require("node:url")
    const [root, extension] = process.argv.slice(1)
    const load = (name) => import(pathToFileURL(path.join(root, name + extension)).href)

    async function main() {
      const tools = await load("tools/index")
      assert.deepEqual(Object.keys(tools).sort(), [
        "changedFiles", "checkCoverage", "dependencyAnalyzer", "formatCode",
        "gitSummary", "lintCheck", "runTests", "securityAudit",
      ])
      for (const tool of Object.values(tools)) {
        assert.equal(typeof tool.description, "string")
        assert.equal(typeof tool.execute, "function")
      }

      const plugins = await load("plugins/index")
      const entry = await load("index")
      assert.deepEqual(Object.keys(entry), ["default"])
      assert.equal(entry.default, plugins.default)
      const logs = []
      const plugin = await entry.default({
        client: { app: { log: (event) => logs.push(event.body) } },
        $: () => { throw new Error("Unexpected shell execution") },
        directory: process.cwd(),
        worktree: process.cwd(),
      })
      assert.equal(typeof plugin["session.created"], "function")
      await plugin["file.edited"]({ path: path.join(process.cwd(), "example.txt") })
      const changed = JSON.parse(await tools.changedFiles.execute({ format: "json" }, {}))
      assert.equal(changed.changed, true)
      assert.deepEqual(changed.files, [{ path: "example.txt", changeType: "modified" }])
      assert.ok(!logs.some((log) => log.message.includes("tracking disabled")))
    }
    main().catch((error) => { console.error(error); process.exit(1) })
  `
  const args = loader ? ["--loader", pathToFileURL(loader).href] : []
  const result = spawnSync(process.execPath, [...args, "-e", check, runtimeRoot, extension], {
    cwd: path.join(__dirname, "..", ".."),
    encoding: "utf8",
  })
  assert.strictEqual(result.status, 0, result.error?.message || result.stderr || result.stdout)
}

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

function main() {
  console.log("\n=== Testing build-opencode.js ===\n")

  let passed = 0
  let failed = 0

  const repoRoot = path.join(__dirname, "..", "..")
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
  )
  const buildScript = path.join(repoRoot, "scripts", "build-opencode.js")
  const distEntry = path.join(repoRoot, ".opencode", "dist", "index.js")
  const tests = [
    ["package.json exposes the OpenCode build and prepack hooks", () => {
      assert.strictEqual(packageJson.scripts["build:opencode"], "node scripts/build-opencode.js")
      assert.strictEqual(packageJson.scripts.prepack, "npm run build:opencode")
      assert.ok(packageJson.files.includes(".opencode/"))
    }],
    ["build script generates .opencode/dist", () => {
      const result = spawnSync("node", [buildScript], {
        cwd: repoRoot,
        encoding: "utf8",
      })
      assert.strictEqual(result.status, 0, result.stderr)
      assert.ok(fs.existsSync(distEntry), ".opencode/dist/index.js should exist after build")
    }],
    ["package.json declares a resolvable OpenCode plugin entry", () => {
      assert.strictEqual(packageJson.main, ".opencode/dist/index.js")
      assert.ok(packageJson.exports, "package.json must declare an exports map")
      assert.deepStrictEqual(packageJson.exports["."], {
        types: "./.opencode/dist/index.d.ts",
        import: "./.opencode/dist/index.js",
        default: "./.opencode/dist/index.js",
      })
    }],
    ["installed package resolves and imports its root module by name", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-opencode-entry-"))
      try {
        fs.mkdirSync(path.join(tempDir, "node_modules"), { recursive: true })
        fs.symlinkSync(
          repoRoot,
          path.join(tempDir, "node_modules", "ecc-universal"),
          process.platform === "win32" ? "junction" : "dir"
        )
        const probe = `
          const resolved = import.meta.resolve("ecc-universal")
          if (!resolved.endsWith("/.opencode/dist/index.js")) {
            throw new Error("unexpected entry resolution: " + resolved)
          }
          const mod = await import("ecc-universal")
          if (Object.keys(mod).join(",") !== "default" || typeof mod.default !== "function") {
            throw new Error("root module must export exactly the plugin function")
          }
        `
        const probePath = path.join(tempDir, "probe.mjs")
        fs.writeFileSync(probePath, probe)
        const result = spawnSync(process.execPath, [probePath], {
          cwd: tempDir,
          encoding: "utf8",
        })
        assert.strictEqual(result.status, 0, result.stderr)
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    }],
    ["OpenCode TypeScript sources resolve their relative imports in place", () => {
      const opencodeDir = path.join(repoRoot, ".opencode")
      const sourceFiles = []
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const entryPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name !== "node_modules" && entry.name !== "dist") walk(entryPath)
          } else if (entry.name.endsWith(".ts")) {
            sourceFiles.push(entryPath)
          }
        }
      }
      walk(opencodeDir)
      assert.ok(sourceFiles.length > 0, "expected OpenCode TypeScript sources")
      const unresolved = []
      for (const sourceFile of sourceFiles) {
        const source = fs.readFileSync(sourceFile, "utf8")
        for (const match of source.matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]+)"/g)) {
          const target = path.resolve(path.dirname(sourceFile), match[1])
          if (!fs.existsSync(target)) {
            unresolved.push(`${path.relative(repoRoot, sourceFile)} -> ${match[1]}`)
          }
        }
      }
      assert.deepStrictEqual(unresolved, [])
    }],
    ["built OpenCode entry exports only the plugin function", () => {
      const check = `
        const assert = require("assert")
        const { pathToFileURL } = require("url")

        async function main() {
          let mod
          try {
            mod = await import(pathToFileURL(process.argv[1]).href)
          } catch (error) {
            console.error(error)
            process.exit(1)
          }
          assert.deepStrictEqual(Object.keys(mod).sort(), ["default"])
          assert.strictEqual(typeof mod.default, "function")

          let shellCalls = 0
          const plugin = await mod.default({
            client: { app: { log: () => {} } },
            $: async () => {
              shellCalls += 1
              throw new Error("$ must not be called during plugin init")
            },
            directory: process.cwd(),
            worktree: process.cwd(),
          })
          assert.strictEqual(shellCalls, 0, "$ must not be called during plugin init")
          assert.ok(plugin && typeof plugin === "object", "default export must return a plugin record")
          const expectedHooks = [
            "file.edited",
            "tool.execute.after",
            "tool.execute.before",
            "session.created",
            "session.idle",
            "session.deleted",
            "file.watcher.updated",
            "todo.updated",
            "shell.env",
            "experimental.session.compacting",
            "permission.ask",
          ]
          for (const hook of expectedHooks) {
            assert.strictEqual(typeof plugin[hook], "function", "missing hook: " + hook)
          }
          assert.ok(plugin.tool && typeof plugin.tool === "object", "plugin record must expose a tool object")
          assert.deepStrictEqual(
            Object.keys(plugin.tool).sort(),
            ["changed-files", "dependency-analyzer"],
            "plugin.tool must expose exactly the custom tools"
          )
          for (const toolName of ["changed-files", "dependency-analyzer"]) {
            const toolDefinition = plugin.tool[toolName]
            assert.ok(toolDefinition && typeof toolDefinition === "object", "missing tool: " + toolName)
            assert.strictEqual(typeof toolDefinition.description, "string", toolName + " must declare a description")
            assert.ok(toolDefinition.args && typeof toolDefinition.args === "object", toolName + " must declare args")
            assert.strictEqual(typeof toolDefinition.execute, "function", toolName + " must declare an execute function")
          }
        }

        main().catch((error) => {
          console.error(error)
          process.exit(1)
        })
      `
      const result = spawnSync(process.execPath, ["-e", check, distEntry], {
        cwd: repoRoot,
        encoding: "utf8",
      })
      assert.strictEqual(result.status, 0, result.stderr)
    }],
    ["compiled barrels load and share the lazy changed-files store", () => {
      checkRuntime(path.dirname(distEntry), ".js")
    }],
    ["full home install loads TypeScript barrels and the lazy changed-files store", () => {
      // Keep the fixture beneath the repo so the installed tools can resolve
      // the real SDK dependency without installing packages in the user's home.
      const fixture = fs.mkdtempSync(path.join(repoRoot, "tests", ".opencode-home-"))
      try {
        const homeDir = path.join(fixture, "home")
        const projectRoot = path.join(fixture, "project")
        fs.mkdirSync(homeDir)
        fs.mkdirSync(projectRoot)
        const plan = withHookConsent(createManifestInstallPlan({
          sourceRoot: repoRoot,
          homeDir,
          projectRoot,
          env: {},
          target: "opencode",
          profileId: "full",
        }), "enabled")
        applyInstallPlan(plan)
        const config = JSON.parse(fs.readFileSync(path.join(plan.targetRoot, "opencode.json"), "utf8"))
        assert.deepStrictEqual(config.skills.paths, ["./skills"])
        assert.ok(fs.existsSync(path.join(plan.targetRoot, config.skills.paths[0], "tdd-workflow", "SKILL.md")))
        assert.ok(!fs.existsSync(path.join(plan.targetRoot, "tools", "run-tests.js")))
        checkRuntime(
          plan.targetRoot,
          ".ts",
          path.join(repoRoot, "tests", "fixtures", "opencode-ts-loader.mjs"),
        )
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true })
      }
    }],
    ["npm pack includes the compiled OpenCode dist payload", () => {
      fs.rmSync(path.dirname(distEntry), { recursive: true, force: true })
      const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts=false"], {
        cwd: repoRoot,
        encoding: "utf8",
        shell: process.platform === "win32",
      })
      assert.strictEqual(result.status, 0, result.error?.message || result.stderr)

      const packOutput = JSON.parse(result.stdout)
      const packEntry = getNpmPackEntry(packOutput, packageJson.name)
      const packagedPaths = new Set(packEntry?.files?.map((file) => file.path) ?? [])

      assert.ok(
        packagedPaths.has(".opencode/dist/index.js"),
        "npm pack should include .opencode/dist/index.js"
      )
      assert.ok(
        packagedPaths.has(".opencode/dist/plugins/index.js"),
        "npm pack should include compiled OpenCode plugin output"
      )
      assert.ok(
        packagedPaths.has(".opencode/dist/tools/index.js"),
        "npm pack should include compiled OpenCode tool output"
      )
      assert.ok(
        packagedPaths.has(".claude-plugin/marketplace.json"),
        "npm pack should include .claude-plugin/marketplace.json"
      )
      assert.ok(
        packagedPaths.has(".claude-plugin/plugin.json"),
        "npm pack should include .claude-plugin/plugin.json"
      )
      assert.ok(
        packagedPaths.has(".codex-plugin/plugin.json"),
        "npm pack should include .codex-plugin/plugin.json"
      )
      assert.ok(
        packagedPaths.has(".agents/plugins/marketplace.json"),
        "npm pack should include .agents/plugins/marketplace.json"
      )
      assert.ok(
        packagedPaths.has(".opencode/package.json"),
        "npm pack should include .opencode/package.json"
      )
      assert.ok(
        packagedPaths.has(".opencode/package-lock.json"),
        "npm pack should include .opencode/package-lock.json"
      )
      assert.ok(
        packagedPaths.has("agent.yaml"),
        "npm pack should include agent.yaml"
      )
      assert.ok(
        packagedPaths.has("AGENTS.md"),
        "npm pack should include AGENTS.md"
      )
      assert.ok(
        packagedPaths.has("VERSION"),
        "npm pack should include VERSION"
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
