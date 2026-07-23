/**
 * Tests for the npm publish surface contract.
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

function normalizePublishPath(value) {
  return String(value).replace(/\\/g, "/").replace(/\/$/, "")
}

function isCoveredByAncestor(target, roots) {
  const parts = target.split("/")
  for (let index = 1; index < parts.length; index += 1) {
    const ancestor = parts.slice(0, index).join("/")
    if (roots.has(ancestor)) {
      return true
    }
  }
  return false
}

function buildExpectedPublishPaths(repoRoot) {
  const modules = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "manifests", "install-modules.json"), "utf8")
  ).modules

  const extraPaths = [
    "manifests",
    "scripts/ecc.js",
    "scripts/catalog.js",
    "scripts/ci/scan-supply-chain-iocs.js",
    "scripts/ci/supply-chain-advisory-sources.js",
    "scripts/consult.js",
    "scripts/control-pane.js",
    "scripts/dashboard-web.js",
    "scripts/discussion-audit.js",
    "scripts/doctor.js",
    "scripts/status.js",
    "scripts/sessions-cli.js",
    "scripts/work-items.js",
    "scripts/install-apply.js",
    "scripts/install-plan.js",
    "scripts/list-installed.js",
    "scripts/loop-status.js",
    "scripts/observability-readiness.js",
    "scripts/plan-canvas.js",
    "scripts/operator-readiness-dashboard.js",
    "scripts/platform-audit.js",
    "scripts/preview-pack-smoke.js",
    "scripts/release-approval-gate.js",
    "scripts/release-video-suite.js",
    "scripts/skill-create-output.js",
    "scripts/repair.js",
    "scripts/harness-adapter-compliance.js",
    "scripts/session-inspect.js",
    "scripts/uninstall.js",
    "scripts/gemini-adapt-agents.js",
    "scripts/sync-ecc-to-codex.sh",
    "scripts/codex/check-plugin-cache.js",
    "scripts/codex/merge-codex-config.js",
    "scripts/codex/merge-mcp-config.js",
    ".codex-plugin",
    "plugins/ecc",
    ".mcp.json",
    "install.sh",
    "install.ps1",
    "schemas",
    "agent.yaml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    "COMMANDS-QUICK-REF.md",
    "CONTRIBUTING.md",
    "VERSION",
    "assets/ecc-icon.svg",
    "assets/hero.png",
    "docs/CODEX-NAVIGATION-GUIDE.md",
    "docs/COMMAND-AGENT-MAP.md",
    "assets/images/sponsors",
  ]
  const exclusionPaths = [
    "!**/__pycache__/**",
    "!**/*.pyc",
    "!**/*.pyo",
    "!**/*.pyd",
    "!**/.pytest_cache/**",
  ]

  const combined = new Set(
    [...modules.flatMap((module) => module.paths || []), ...extraPaths, ...exclusionPaths].map(normalizePublishPath)
  )

  return [...combined]
    .filter((publishPath) => !isCoveredByAncestor(publishPath, combined))
    .sort()
}

function main() {
  console.log("\n=== Testing npm publish surface ===\n")

  let passed = 0
  let failed = 0

  const repoRoot = path.join(__dirname, "..", "..")
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
  )

  const expectedPublishPaths = buildExpectedPublishPaths(repoRoot)
  const actualPublishPaths = packageJson.files.map(normalizePublishPath).sort()

  const tests = [
    ["package.json files align to the module graph and explicit runtime allowlist", () => {
      assert.deepStrictEqual(actualPublishPaths, expectedPublishPaths)
    }],
    ["npm pack publishes the reduced runtime surface", () => {
      const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: repoRoot,
        encoding: "utf8",
        shell: process.platform === "win32",
      })
      assert.strictEqual(result.status, 0, result.error?.message || result.stderr)

      const packOutput = JSON.parse(result.stdout)
      const packagedPaths = new Set(packOutput[0]?.files?.map((file) => file.path) ?? [])

      for (const requiredPath of [
        "scripts/catalog.js",
        "scripts/ci/scan-supply-chain-iocs.js",
        "scripts/ci/supply-chain-advisory-sources.js",
        "scripts/consult.js",
        "scripts/control-pane.js",
        "scripts/discussion-audit.js",
        "scripts/operator-readiness-dashboard.js",
        "scripts/preview-pack-smoke.js",
        "scripts/release-approval-gate.js",
        "scripts/release-video-suite.js",
        "scripts/work-items.js",
        "scripts/platform-audit.js",
        "scripts/sync-ecc-to-codex.sh",
        "scripts/codex/check-plugin-cache.js",
        ".gemini/GEMINI.md",
        ".qwen/QWEN.md",
        ".claude-plugin/plugin.json",
        ".github/PULL_REQUEST_TEMPLATE.md",
        ".codex-plugin/plugin.json",
        "COMMANDS-QUICK-REF.md",
        "CONTRIBUTING.md",
        "plugins/ecc/.codex-plugin/plugin.json",
        "assets/ecc-icon.svg",
        "assets/hero.png",
        "docs/CODEX-NAVIGATION-GUIDE.md",
        "docs/COMMAND-AGENT-MAP.md",
        "schemas/install-state.schema.json",
        "skills/backend-patterns/SKILL.md",
      ]) {
        assert.ok(
          packagedPaths.has(requiredPath),
          `npm pack should include ${requiredPath}`
        )
      }

      for (const excludedPath of [
        "contexts/dev.md",
        "examples/CLAUDE.md",
        "plugins/README.md",
        "scripts/ci/catalog.js",
        "skills/skill-comply/SKILL.md",
      ]) {
        assert.ok(
          !packagedPaths.has(excludedPath),
          `npm pack should not include ${excludedPath}`
        )
      }

      for (const packagedPath of packagedPaths) {
        assert.ok(
          !packagedPath.includes("__pycache__/"),
          `npm pack should not include Python bytecode cache path ${packagedPath}`
        )
        assert.ok(
          !/\.py[cod]$/.test(packagedPath),
          `npm pack should not include Python bytecode file ${packagedPath}`
        )
      }
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
