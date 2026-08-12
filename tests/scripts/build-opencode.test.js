/**
 * Tests for scripts/build-opencode.js
 */

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

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

          const plugin = await mod.default({
            client: { app: { log: () => {} } },
            $: async () => { throw new Error("$ must not be called during plugin init") },
            directory: process.cwd(),
            worktree: process.cwd(),
          })
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
    ["npm pack includes the compiled OpenCode dist payload", () => {
      const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: repoRoot,
        encoding: "utf8",
        shell: process.platform === "win32",
      })
      assert.strictEqual(result.status, 0, result.error?.message || result.stderr)

      const packOutput = JSON.parse(result.stdout)
      const packagedPaths = new Set(packOutput[0]?.files?.map((file) => file.path) ?? [])

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
