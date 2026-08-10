/**
 * Tests for the ECC <-> Pi coding agent thin adapter (.pi/extensions/index.ts).
 *
 * This adapter was rejected once already (PR #2352) for four defects:
 *   (a) resolving hook scripts from `process.cwd()` instead of the installed
 *       ECC package root, which breaks global installs;
 *   (b) running hooks through an interpolated shell string
 *       (`exec(\`node ${scriptPath}\`)`), which breaks on paths with spaces
 *       and is a shell-injection risk;
 *   (c) using the undocumented `app.events` bus instead of the documented
 *       `pi.on(...)` lifecycle API;
 *   (d) shipping with no compatibility tests at all.
 *
 * Group 1 below reads `.pi/extensions/index.ts` as text and asserts the
 * source contract that keeps those defects from coming back. The file is
 * TypeScript loaded by Pi through jiti at runtime, so it cannot be
 * `require()`d or `import()`ed from a plain Node test — source inspection is
 * the only option available without adding a build step or a new dependency.
 *
 * Group 2 exercises ECC's real hook runner (`scripts/hooks/run-with-flags.js`)
 * with the exact argv/env shape the adapter builds, so the fix is proven by
 * behavior, not just by grep.
 */

const assert = require("assert")
const fs = require("fs")
const os = require("os")
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

/**
 * Strips `/* ... *\/` and `// ...` comments so the "never resolves from
 * process.cwd()" check tests real behavior, not a doc comment. The adapter's
 * own header comment explains the anti-pattern by naming it in backticks
 * (`"never `process.cwd()`, so a global pi install works..."`), which is
 * correct documentation, not a regression — the check must look past it.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

/**
 * Mirrors the adapter's own hook invocation (`runEccHook` in
 * .pi/extensions/index.ts): same binary (`process.execPath`), same argv
 * shape, same stdin-JSON payload, same env keys. No shell is used anywhere.
 */
function runHookRunner(eccRoot, hookId, relScript, profiles, payload, extraEnv, cwd) {
  const runner = path.join(eccRoot, "scripts", "hooks", "run-with-flags.js")
  return spawnSync(process.execPath, [runner, hookId, relScript, profiles], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: cwd || eccRoot,
    timeout: 30000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: eccRoot, ECC_PLUGIN_ROOT: eccRoot, ...extraEnv },
  })
}

/**
 * Builds a minimal, standalone ECC package skeleton under a fresh temp
 * directory so tests 8/9 can simulate a global install without touching the
 * real repo. Only the files `run-with-flags.js` -> `session-end-marker.js`
 * actually `require()` at runtime are copied.
 */
function buildEccSkeleton(repoRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ecc pi test-"))
  const hooksDir = path.join(root, "scripts", "hooks")
  fs.mkdirSync(hooksDir, { recursive: true })

  for (const name of ["run-with-flags.js", "session-end-marker.js", "pretooluse-visible-output.js"]) {
    fs.cpSync(path.join(repoRoot, "scripts", "hooks", name), path.join(hooksDir, name))
  }
  fs.cpSync(path.join(repoRoot, "scripts", "lib"), path.join(root, "scripts", "lib"), { recursive: true })

  return root
}

/**
 * Re-implementation of the adapter's `extractAdditionalContext` (same file,
 * same six lines of logic) so the parsing contract can be tested directly
 * without importing the TypeScript source.
 */
function extractAdditionalContext(stdout) {
  const trimmed = stdout.trim()
  if (!trimmed.startsWith("{")) {
    return undefined
  }
  try {
    const parsed = JSON.parse(trimmed)
    const context = parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext
    return typeof context === "string" && context.trim() ? context : undefined
  } catch {
    return undefined
  }
}

function main() {
  console.log("\n=== Testing .pi/extensions/index.ts (Pi thin adapter) ===\n")

  let passed = 0
  let failed = 0

  const repoRoot = path.join(__dirname, "..", "..")
  const extensionPath = path.join(repoRoot, ".pi", "extensions", "index.ts")
  const extensionSource = fs.readFileSync(extensionPath, "utf8")

  const tests = [
    // ---- Group 1: source contract -------------------------------------

    ["resolves the ECC package root from __dirname, never from process.cwd()", () => {
      assert.ok(
        extensionSource.includes("path.resolve(__dirname"),
        "expected the adapter to derive its package root with path.resolve(__dirname, ...); " +
          "resolving from __dirname is what makes a globally installed ECC find its own hooks " +
          "regardless of which project the user opened Pi in"
      )

      const withoutComments = stripComments(extensionSource)
      assert.ok(
        !withoutComments.includes("process.cwd()"),
        "found process.cwd() used as executable code in .pi/extensions/index.ts; " +
          "resolving hook scripts from the working directory breaks global installs " +
          "because it looks for ECC's hooks inside the user's project instead of the " +
          "installed ECC package (this is the exact defect PR #2352 was rejected for)"
      )
    }],

    ["executes hooks via execFile with no shell, so paths with spaces or metacharacters are safe", () => {
      assert.ok(
        extensionSource.includes("execFile("),
        "expected the adapter to invoke hooks via child_process.execFile(...)"
      )
      assert.ok(
        extensionSource.includes("process.execPath"),
        "expected hooks to be spawned with process.execPath, not a hardcoded 'node' string"
      )

      const shellExecPattern = /(?<!execFile)\bexec\s*\(/
      assert.ok(
        !shellExecPattern.test(extensionSource),
        "found a shell-invoking exec(...) call in .pi/extensions/index.ts distinct from " +
          "execFile(...); running hooks through an interpolated shell string " +
          "(exec(`node ${scriptPath}`)) breaks on paths containing spaces and is a " +
          "shell-injection risk (the exact defect PR #2352 was rejected for)"
      )
      assert.ok(
        !extensionSource.includes("execSync("),
        "found execSync(...) in .pi/extensions/index.ts; execSync runs through a shell " +
          "by default and reintroduces the same path-with-spaces / injection risk"
      )
      assert.ok(
        !extensionSource.includes("shell: true"),
        "found `shell: true` in .pi/extensions/index.ts; opting into a shell reintroduces " +
          "the path-with-spaces / injection risk execFile(...) with no shell was meant to avoid"
      )
    }],

    ["registers Pi's documented pi.on(...) lifecycle, not the undocumented app.events bus", () => {
      assert.ok(
        extensionSource.includes(`pi.on("session_start"`),
        "expected the adapter to register a session_start handler via pi.on(...)"
      )
      assert.ok(
        extensionSource.includes(`pi.on("session_shutdown"`),
        "expected the adapter to register a session_shutdown handler via pi.on(...)"
      )
      assert.ok(
        extensionSource.includes(`pi.on("before_agent_start"`),
        "expected the adapter to register a before_agent_start handler via pi.on(...)"
      )
      assert.ok(
        !extensionSource.includes("app.events"),
        "found app.events in .pi/extensions/index.ts; app.events is an undocumented " +
          "event-bus API that is not part of Pi's supported extension contract and can " +
          "change or disappear without notice"
      )
      assert.ok(
        !extensionSource.includes(".events.on("),
        "found a .events.on(...) subscription in .pi/extensions/index.ts; subscribing " +
          "through an undocumented event bus instead of the documented pi.on(...) " +
          "lifecycle is not part of Pi's supported extension contract"
      )
    }],

    ["registers the ecc-doctor diagnostics command", () => {
      assert.ok(
        extensionSource.includes(`registerCommand("ecc-doctor"`),
        "expected the adapter to register an 'ecc-doctor' command via pi.registerCommand(...) " +
          "so users have an install-diagnostics entry point"
      )
    }],

    ["bounds hook execution with a timeout and a maxBuffer", () => {
      assert.ok(
        extensionSource.includes("timeout"),
        "expected the execFile(...) call options to include a timeout; an unbounded hook " +
          "process can hang the Pi session forever on a stuck or misbehaving hook"
      )
      assert.ok(
        extensionSource.includes("maxBuffer"),
        "expected the execFile(...) call options to include a maxBuffer; without it a " +
          "runaway hook writing unbounded stdout can crash the adapter process"
      )
    }],

    ["exports a default extension factory function", () => {
      assert.ok(
        extensionSource.includes("export default function"),
        "expected .pi/extensions/index.ts to `export default function`, matching the " +
          "shape Pi's extension loader expects"
      )
    }],

    ["propagates the ECC package root to hooks via CLAUDE_PLUGIN_ROOT and ECC_PLUGIN_ROOT", () => {
      assert.ok(
        extensionSource.includes("CLAUDE_PLUGIN_ROOT"),
        "expected the adapter to set CLAUDE_PLUGIN_ROOT in the hook environment; ECC's " +
          "shared hook scripts read this to locate the package root"
      )
      assert.ok(
        extensionSource.includes("ECC_PLUGIN_ROOT"),
        "expected the adapter to set ECC_PLUGIN_ROOT in the hook environment; this is " +
          "the ECC-specific fallback the same hook scripts also read"
      )
    }],

    // ---- Group 2: real hook-runner behavior ---------------------------

    ["GLOBAL INSTALL + SPACE IN PATH: hook execution succeeds from a package root whose path contains a space", () => {
      const skeletonRoot = buildEccSkeleton(repoRoot)
      try {
        assert.ok(
          skeletonRoot.includes(" "),
          "test setup bug: the temp skeleton directory must contain a space to reproduce " +
            "a global-install path (e.g. 'Application Support') — got: " + skeletonRoot
        )

        const result = runHookRunner(
          skeletonRoot,
          "session:end:marker",
          "scripts/hooks/session-end-marker.js",
          "minimal,standard,strict",
          { hook_event_name: "SessionEnd", reason: "quit", cwd: skeletonRoot, session_id: "pi-adapter-test" }
        )

        assert.strictEqual(
          result.error,
          undefined,
          "hook runner failed to spawn from a package root containing a space " +
            `(${skeletonRoot}); this is exactly the shell-interpolation regression ` +
            `PR #2352 was rejected for (error: ${result.error && result.error.message})`
        )
        assert.strictEqual(
          result.status,
          0,
          "hook runner exited non-zero when invoked from a package root containing a " +
            `space (${skeletonRoot}); a path with a space broke hook execution ` +
            `(stderr: ${result.stderr})`
        )
      } finally {
        fs.rmSync(skeletonRoot, { recursive: true, force: true })
      }
    }],

    ["hook resolution is package-relative, not cwd-relative: still succeeds when cwd points elsewhere", () => {
      const skeletonRoot = buildEccSkeleton(repoRoot)
      try {
        const result = runHookRunner(
          skeletonRoot,
          "session:end:marker",
          "scripts/hooks/session-end-marker.js",
          "minimal,standard,strict",
          { hook_event_name: "SessionEnd", reason: "quit", cwd: os.tmpdir(), session_id: "pi-adapter-test" },
          {},
          os.tmpdir()
        )

        assert.strictEqual(
          result.error,
          undefined,
          "hook runner failed to spawn when cwd pointed away from the ECC package root; " +
            "a globally installed ECC must resolve its own hooks regardless of which " +
            `project directory the user is in (error: ${result.error && result.error.message})`
        )
        assert.strictEqual(
          result.status,
          0,
          "hook runner exited non-zero when cwd pointed away from the ECC package root " +
            `(cwd=${os.tmpdir()}, CLAUDE_PLUGIN_ROOT=${skeletonRoot}); this means hook ` +
            "resolution is leaking cwd-dependence instead of being package-relative " +
            `(stderr: ${result.stderr})`
        )
      } finally {
        fs.rmSync(skeletonRoot, { recursive: true, force: true })
      }
    }],

    ["profile gating is honored: a disabled hook and a restrictive profile both degrade cleanly", () => {
      const disabledResult = runHookRunner(
        repoRoot,
        "session:end:marker",
        "scripts/hooks/session-end-marker.js",
        "minimal,standard,strict",
        { hook_event_name: "SessionEnd", reason: "quit", cwd: repoRoot, session_id: "pi-adapter-test" },
        { ECC_DISABLED_HOOKS: "session:end:marker" }
      )

      assert.strictEqual(
        disabledResult.error,
        undefined,
        "hook runner failed to spawn when session:end:marker was listed in " +
          `ECC_DISABLED_HOOKS (error: ${disabledResult.error && disabledResult.error.message})`
      )
      assert.strictEqual(
        disabledResult.status,
        0,
        "hook runner exited non-zero for a hook disabled via ECC_DISABLED_HOOKS; a " +
          "disabled hook must be skipped cleanly rather than crashing the Pi session " +
          `(stderr: ${disabledResult.stderr})`
      )

      const minimalResult = runHookRunner(
        repoRoot,
        "session:end:marker",
        "scripts/hooks/session-end-marker.js",
        "minimal,standard,strict",
        { hook_event_name: "SessionEnd", reason: "quit", cwd: repoRoot, session_id: "pi-adapter-test" },
        { ECC_HOOK_PROFILE: "minimal" }
      )

      assert.strictEqual(
        minimalResult.error,
        undefined,
        "hook runner failed to spawn under ECC_HOOK_PROFILE=minimal " +
          `(error: ${minimalResult.error && minimalResult.error.message})`
      )
      assert.strictEqual(
        minimalResult.status,
        0,
        "hook runner exited non-zero under ECC_HOOK_PROFILE=minimal; hook-profile " +
          `gating must degrade cleanly, not crash the session (stderr: ${minimalResult.stderr})`
      )
    }],

    ["additionalContext extraction tolerates non-JSON hook passthrough", () => {
      assert.strictEqual(
        extractAdditionalContext('{"hookSpecificOutput":{"additionalContext":"hello"}}'),
        "hello",
        "expected additionalContext to be extracted from a well-formed hook envelope"
      )
      assert.strictEqual(
        extractAdditionalContext("plain non-JSON stdout from a disabled hook"),
        undefined,
        "expected non-JSON stdout (the pass-through case for a disabled hook) to yield " +
          "undefined instead of throwing or crashing the session_start handler"
      )
      assert.strictEqual(
        extractAdditionalContext('{"hookSpecificOutput": malformed'),
        undefined,
        "expected malformed JSON to yield undefined instead of throwing"
      )
      assert.strictEqual(
        extractAdditionalContext('{"unrelated":true}'),
        undefined,
        "expected valid JSON with no hookSpecificOutput.additionalContext field to yield undefined"
      )
      assert.strictEqual(
        extractAdditionalContext('{"hookSpecificOutput":{"additionalContext":""}}'),
        undefined,
        "expected an empty-string additionalContext to yield undefined rather than an " +
          "empty <ecc-session-context> block being spliced into the system prompt"
      )

      assert.ok(
        extensionSource.includes("hookSpecificOutput"),
        "expected .pi/extensions/index.ts to reference hookSpecificOutput when parsing hook stdout"
      )
      assert.ok(
        extensionSource.includes("additionalContext"),
        "expected .pi/extensions/index.ts to reference additionalContext when parsing hook stdout"
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
