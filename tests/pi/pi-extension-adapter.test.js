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
 *
 * Group 3 covers three fixes a code review added on top of the above: EPIPE
 * isolation on `child.stdin`, clearing stale `pendingContext` at session
 * start, and reading companion-package installs from Pi's own settings files
 * instead of `require.resolve`. Each fix gets a source-text assertion (so a
 * regression is caught even if the behavioral mirror still passes) plus a
 * real behavioral test wherever the fix is about runtime behavior rather
 * than pure control flow.
 */

const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync, execFile } = require("child_process")

async function runTest(name, fn) {
  try {
    await fn()
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
 * Mirror of the adapter's `extractAdditionalContext` (same file, same six
 * lines of logic) so the parsing contract can be exercised directly without
 * importing the TypeScript source. This copy proves the *behavior* below is
 * correct, but a copy cannot detect the real adapter's guards drifting out
 * from under it. The source-text assertions in the "additionalContext
 * extraction tolerates non-JSON hook passthrough" test below read the real
 * `extractAdditionalContext` out of `.pi/extensions/index.ts` and pin its
 * guards directly, so that kind of drift fails the test instead of passing
 * silently against this mirror.
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

/**
 * Mirror of the adapter's `normalizePiPackageName` (same file, same six
 * lines of logic) so the trailing-@version stripping can be exercised
 * directly without importing the TypeScript source. This copy proves the
 * *behavior* below is correct, but a copy cannot detect the real adapter's
 * guards drifting out from under it. The source-text assertions in the
 * "companion package detection reads Pi's package list" test below read the
 * real `normalizePiPackageName` text out of `.pi/extensions/index.ts` and pin
 * its actual guards directly, so that kind of drift fails the test instead
 * of passing silently against this mirror.
 */
function normalizePiPackageName(entry) {
  if (typeof entry !== "string" || !entry.startsWith("npm:")) {
    return undefined
  }
  const spec = entry.slice("npm:".length)
  // Strip a trailing @version without breaking the leading @ of a scoped name.
  const versionAt = spec.lastIndexOf("@")
  return versionAt > 0 ? spec.slice(0, versionAt) : spec
}

/**
 * Mirror of the per-file body of the adapter's `listInstalledPiPackages`
 * (same file, same read-parse-normalize-collect loop), applied to a single
 * settings file so the "npm entries only, missing/malformed settings degrade
 * to empty" contract can be exercised against a real temp file without
 * importing the TypeScript source or touching a real `~/.pi/agent`
 * directory. This copy proves the *behavior* below is correct, but a copy
 * cannot detect the real adapter's guards drifting out from under it. The
 * source-text assertions in the "companion package detection reads Pi's
 * package list" test above read the real `listInstalledPiPackages` /
 * `normalizePiPackageName` text out of `.pi/extensions/index.ts` and pin its
 * actual guards directly, so that kind of drift fails the test instead of
 * passing silently against this mirror.
 */
function readInstalledPackageNames(settingsFile) {
  const names = new Set()
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile, "utf8"))
    if (!Array.isArray(parsed.packages)) {
      return names
    }
    for (const entry of parsed.packages) {
      const name = normalizePiPackageName(entry)
      if (name) {
        names.add(name)
      }
    }
  } catch {
    // Missing or unreadable settings are simply "nothing installed here".
  }
  return names
}

async function main() {
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
      // Uses the same isolated skeleton as tests 8/9 (not repoRoot) so that
      // session-end-marker.js never executes against the real checkout: a
      // real run can leave marker artifacts behind and would make this
      // test's outcome depend on whatever state the repo happens to be in.
      const skeletonRoot = buildEccSkeleton(repoRoot)
      try {
        const disabledResult = runHookRunner(
          skeletonRoot,
          "session:end:marker",
          "scripts/hooks/session-end-marker.js",
          "minimal,standard,strict",
          { hook_event_name: "SessionEnd", reason: "quit", cwd: skeletonRoot, session_id: "pi-adapter-test" },
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
          skeletonRoot,
          "session:end:marker",
          "scripts/hooks/session-end-marker.js",
          "minimal,standard,strict",
          { hook_event_name: "SessionEnd", reason: "quit", cwd: skeletonRoot, session_id: "pi-adapter-test" },
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
      } finally {
        fs.rmSync(skeletonRoot, { recursive: true, force: true })
      }
    }],

    ["additionalContext extraction tolerates non-JSON hook passthrough", () => {
      // ---- Behavioral assertions on the LOCAL MIRROR --------------------
      // extractAdditionalContext (defined above) is a hand-copied mirror of
      // the real function in .pi/extensions/index.ts, kept because that file
      // is TypeScript loaded via jiti and cannot be require()'d from a plain
      // Node test. These assertions prove the mirror's behavior; they do NOT
      // by themselves prove the shipped adapter still behaves this way. The
      // source-text assertions further below read the real function's text
      // out of .pi/extensions/index.ts and pin its actual guards, so that a
      // real adapter regression fails here even though the mirror (and the
      // assertions run against it) would keep passing unchanged.
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

      // ---- Source-text assertions on the REAL adapter -------------------
      // Isolate the real extractAdditionalContext function's text out of
      // .pi/extensions/index.ts (up to the next top-level function
      // declaration) and pin its actual guards. If the adapter's real
      // startsWith("{") check, try/catch, hookSpecificOutput?.additionalContext
      // read, or non-empty-string requirement ever changes, these fail
      // regardless of what the mirror above still does.
      const functionStart = extensionSource.indexOf("function extractAdditionalContext")
      assert.ok(
        functionStart !== -1,
        "expected .pi/extensions/index.ts to define a function named extractAdditionalContext"
      )
      const nextFunctionStart = extensionSource.indexOf("\nfunction ", functionStart + 1)
      const extractContextSource =
        nextFunctionStart === -1
          ? extensionSource.slice(functionStart)
          : extensionSource.slice(functionStart, nextFunctionStart)

      assert.ok(
        /if\s*\(\s*!\s*trimmed\.startsWith\(\s*["'`]\{["'`]\s*\)\s*\)\s*\{\s*return undefined/.test(
          extractContextSource
        ),
        "expected extractAdditionalContext in .pi/extensions/index.ts to early-return " +
          "undefined unless the trimmed stdout starts with '{'; this is what makes " +
          "non-JSON stdout from a disabled hook a safe pass-through instead of a crash"
      )
      assert.ok(
        /try\s*\{[\s\S]*?JSON\.parse\(/.test(extractContextSource),
        "expected extractAdditionalContext in .pi/extensions/index.ts to parse the " +
          "trimmed stdout via JSON.parse(...) inside a try block"
      )
      assert.ok(
        /catch[^{]*\{\s*return undefined/.test(extractContextSource),
        "expected extractAdditionalContext in .pi/extensions/index.ts to catch a " +
          "JSON.parse failure and return undefined instead of throwing"
      )
      assert.ok(
        /hookSpecificOutput\?\.\s*additionalContext/.test(extractContextSource),
        "expected extractAdditionalContext in .pi/extensions/index.ts to read " +
          "hookSpecificOutput?.additionalContext from the parsed envelope"
      )
      assert.ok(
        /typeof\s+context\s*===\s*["'`]string["'`]\s*&&\s*context\.trim\(\)/.test(extractContextSource),
        "expected extractAdditionalContext in .pi/extensions/index.ts to require a " +
          'non-empty string (typeof context === "string" && context.trim()) before ' +
          "returning it, rejecting an empty-string additionalContext"
      )
    }],

    // ---- Group 3: code-review fixes -----------------------------------

    ["EPIPE isolation (source contract): child.stdin has an error listener, and the catch around child.stdin?.end(...) resolves rather than rethrows", () => {
      const withoutComments = stripComments(extensionSource)
      assert.ok(
        withoutComments.includes('child.stdin?.on("error"'),
        "expected runEccHook in .pi/extensions/index.ts to register an error listener on " +
          'child.stdin via child.stdin?.on("error", ...) as real code, not just described ' +
          "in a comment; stdin.end() writes asynchronously, so a hook that exits before " +
          "reading its payload raises an EPIPE `error` event that a try/catch around " +
          "child.stdin?.end(...) cannot see, and an unhandled `error` event on a stream " +
          "crashes the whole Pi session"
      )

      const runEccHookStart = extensionSource.indexOf("function runEccHook")
      assert.ok(
        runEccHookStart !== -1,
        "expected .pi/extensions/index.ts to define a function named runEccHook"
      )
      const nextFunctionStart = extensionSource.indexOf("\nfunction ", runEccHookStart + 1)
      const runEccHookSource =
        nextFunctionStart === -1
          ? extensionSource.slice(runEccHookStart)
          : extensionSource.slice(runEccHookStart, nextFunctionStart)

      const catchMatch = runEccHookSource.match(
        /try\s*\{\s*child\.stdin\?\.end\([\s\S]*?\)\)\s*\}\s*catch\s*\(error\)\s*\{([\s\S]*?)\n\s*\}\n/
      )
      assert.ok(
        catchMatch,
        "expected runEccHook in .pi/extensions/index.ts to wrap child.stdin?.end(...) in " +
          "a try { ... } catch (error) { ... } block"
      )
      const catchBody = catchMatch[1]
      assert.ok(
        /resolve\(/.test(catchBody),
        "expected the catch around child.stdin?.end(...) in .pi/extensions/index.ts to " +
          "call resolve(...); if it rethrows instead, a hook payload write failure " +
          "escapes the Promise executor as an unhandled exception instead of degrading " +
          "to a warning"
      )
      assert.ok(
        !/\bthrow\b/.test(catchBody),
        "found a rethrow inside the catch around child.stdin?.end(...) in " +
          ".pi/extensions/index.ts; this is the exact EPIPE-crashes-the-session " +
          "regression the surrounding error handling exists to prevent"
      )
    }],

    ["EPIPE isolation (real behavioral proof): a large stdin write to a child that exits without reading it survives as an `error` event or a clean resolution, never an uncaught exception", async () => {
      // Mirrors the exact pattern in runEccHook: execFile + process.execPath, an
      // `error` listener on child.stdin, and a try/catch around child.stdin.end(...).
      // The child below exits immediately without ever reading stdin, so a payload
      // larger than the OS pipe buffer (2MB) cannot be written synchronously and
      // reliably reproduces the EPIPE this pattern exists to isolate.
      const largePayload = "x".repeat(2 * 1024 * 1024)
      const uncaughtExceptions = []
      const onUncaughtException = error => uncaughtExceptions.push(error)
      process.on("uncaughtException", onUncaughtException)

      let outcome
      try {
        outcome = await new Promise((resolve, reject) => {
          let stdinErrorSeen = false
          let childErrorSeen = false
          let writeThrew = false
          // Safety net only, not a polling race: the assertions below depend on the
          // uncaughtException listener, which fires synchronously with the offending
          // event if it happens. This just stops the suite from hanging forever if
          // the execFile callback never fires for an unrelated reason.
          const safetyNet = setTimeout(
            () => reject(new Error("execFile callback never fired within the 5.5s safety window")),
            5500
          )

          const child = execFile(
            process.execPath,
            ["-e", "process.exit(0)"],
            { timeout: 5000, maxBuffer: 1024 * 1024 },
            () => {
              clearTimeout(safetyNet)
              resolve({ stdinErrorSeen, childErrorSeen, writeThrew })
            }
          )

          child.on("error", () => {
            childErrorSeen = true
          })

          child.stdin.on("error", () => {
            stdinErrorSeen = true
          })

          try {
            child.stdin.end(largePayload)
          } catch {
            writeThrew = true
          }
        })
      } finally {
        process.off("uncaughtException", onUncaughtException)
      }

      assert.strictEqual(
        uncaughtExceptions.length,
        0,
        "expected writing a 2MB payload to a child that exits before reading stdin to " +
          "never raise an uncaughtException; this is exactly the " +
          'EPIPE-crashes-the-Pi-session regression the child.stdin?.on("error", ...) ' +
          "listener in runEccHook exists to prevent"
      )
      assert.ok(
        outcome !== undefined,
        "expected the execFile callback to fire and the parent process to survive " +
          "writing to a child that never reads its stdin, instead of hanging or crashing"
      )
    }],

    ["stale context is cleared at session_start before awaiting the hook, and again after injection in before_agent_start", () => {
      const sessionStartIdx = extensionSource.indexOf('pi.on("session_start"')
      assert.ok(
        sessionStartIdx !== -1,
        "expected .pi/extensions/index.ts to register a session_start handler via pi.on(...)"
      )
      const beforeAgentStartIdx = extensionSource.indexOf('pi.on("before_agent_start"', sessionStartIdx)
      assert.ok(
        beforeAgentStartIdx !== -1 && beforeAgentStartIdx > sessionStartIdx,
        "expected a before_agent_start handler registered after session_start in .pi/extensions/index.ts"
      )
      const sessionShutdownIdx = extensionSource.indexOf('pi.on("session_shutdown"', beforeAgentStartIdx)
      assert.ok(
        sessionShutdownIdx !== -1 && sessionShutdownIdx > beforeAgentStartIdx,
        "expected a session_shutdown handler registered after before_agent_start in .pi/extensions/index.ts"
      )

      const sessionStartSource = stripComments(extensionSource.slice(sessionStartIdx, beforeAgentStartIdx))
      const clearIdx = sessionStartSource.indexOf("pendingContext = undefined")
      const hookCallIdx = sessionStartSource.indexOf("await runEccHook(")
      assert.ok(
        clearIdx !== -1,
        "expected the session_start handler in .pi/extensions/index.ts to clear " +
          "pendingContext = undefined; without this, a new session start can replay " +
          "context captured for a previous session"
      )
      assert.ok(
        hookCallIdx !== -1,
        "expected the session_start handler in .pi/extensions/index.ts to await runEccHook(...)"
      )
      assert.ok(
        clearIdx < hookCallIdx,
        "expected pendingContext = undefined to run BEFORE `await runEccHook(...)` in " +
          "the session_start handler; if the clear happens after (or is skipped when " +
          "the hook fails), a new session start begun while a previous SessionStart " +
          "hook is still running -- or one whose hook later fails -- can replay stale " +
          "context captured for the wrong project state"
      )

      const beforeAgentStartSource = stripComments(
        extensionSource.slice(beforeAgentStartIdx, sessionShutdownIdx)
      )
      const captureIdx = beforeAgentStartSource.indexOf("const context = pendingContext")
      const clearIdx2 = beforeAgentStartSource.indexOf("pendingContext = undefined")
      const returnIdx = beforeAgentStartSource.indexOf("return {")
      assert.ok(
        captureIdx !== -1,
        "expected the before_agent_start handler in .pi/extensions/index.ts to capture " +
          "pendingContext into a local variable before clearing it"
      )
      assert.ok(
        clearIdx2 !== -1,
        "expected the before_agent_start handler in .pi/extensions/index.ts to still " +
          "clear pendingContext = undefined after reading it for injection; without " +
          "this, an already-injected context value would be replayed into a later agent turn"
      )
      assert.ok(
        returnIdx !== -1,
        "expected the before_agent_start handler in .pi/extensions/index.ts to return " +
          "an object with an injected systemPrompt"
      )
      assert.ok(
        captureIdx < clearIdx2,
        "expected pendingContext to be captured into a local variable BEFORE being " +
          "cleared in before_agent_start; clearing first would lose the value before " +
          "it can be injected into the system prompt"
      )
      assert.ok(
        clearIdx2 < returnIdx,
        "expected pendingContext = undefined to run BEFORE the return statement in " +
          "before_agent_start; if the clear is removed or moved past the return it " +
          "never executes, and a later agent turn would replay the same context again"
      )
    }],

    ["companion package detection reads Pi's package list (source contract): require.resolve is gone, PI_CODING_AGENT_DIR is honored, and normalizePiPackageName's version-stripping guard is pinned", () => {
      // require.resolve is legitimately named in the doc comment above
      // listInstalledPiPackages to explain why it was replaced (the same
      // "documentation, not a regression" case stripComments exists for --
      // see its own jsdoc above). Strip comments first so this checks real
      // code, not prose.
      const withoutComments = stripComments(extensionSource)
      assert.ok(
        !withoutComments.includes("require.resolve"),
        "found require.resolve(...) used as executable code in .pi/extensions/index.ts; " +
          "Pi installs companion packages under its own config directory " +
          "(~/.pi/agent/npm, overridable via PI_CODING_AGENT_DIR), which is not on " +
          "Node's module resolution path from this file, so require.resolve reports " +
          "every companion as missing no matter what the user actually installed -- " +
          "this is the exact defect listInstalledPiPackages was introduced to replace"
      )
      assert.ok(
        extensionSource.includes("PI_CODING_AGENT_DIR"),
        "expected .pi/extensions/index.ts to honor the documented PI_CODING_AGENT_DIR " +
          "override when locating Pi's config directory"
      )

      const normalizeStart = extensionSource.indexOf("function normalizePiPackageName")
      assert.ok(
        normalizeStart !== -1,
        "expected .pi/extensions/index.ts to define a function named normalizePiPackageName"
      )
      const nextFunctionStart = extensionSource.indexOf("\nfunction ", normalizeStart + 1)
      const normalizeSource =
        nextFunctionStart === -1
          ? extensionSource.slice(normalizeStart)
          : extensionSource.slice(normalizeStart, nextFunctionStart)

      assert.ok(
        /typeof\s+entry\s*!==\s*["'`]string["'`]\s*\|\|\s*!\s*entry\.startsWith\(\s*["'`]npm:["'`]\s*\)/.test(
          normalizeSource
        ),
        "expected normalizePiPackageName in .pi/extensions/index.ts to return undefined " +
          "for any entry that is not a string starting with 'npm:' (git sources and " +
          "filesystem paths carry no comparable package name)"
      )
      assert.ok(
        /spec\s*=\s*entry\.slice\(\s*["'`]npm:["'`]\.length\)/.test(normalizeSource),
        'expected normalizePiPackageName in .pi/extensions/index.ts to strip the "npm:" ' +
          'prefix via entry.slice("npm:".length)'
      )
      assert.ok(
        /versionAt\s*=\s*spec\.lastIndexOf\(\s*["'`]@["'`]\s*\)/.test(normalizeSource),
        "expected normalizePiPackageName in .pi/extensions/index.ts to locate a " +
          'trailing @version with spec.lastIndexOf("@")'
      )
      assert.ok(
        /versionAt\s*>\s*0\s*\?\s*spec\.slice\(0,\s*versionAt\)\s*:\s*spec/.test(normalizeSource),
        "expected normalizePiPackageName in .pi/extensions/index.ts to only strip at " +
          "versionAt when it is greater than 0 (versionAt > 0 ? ... : spec); a scoped " +
          "package's leading '@' sits at index 0, so this is what keeps " +
          "'@juicesharp/rpiv-todo@1.4.2' from being mangled into an empty name the way " +
          'a naive split("@")[0] would'
      )
    }],

    ["companion package name normalization (behavioral mirror): strips a trailing version without breaking a scoped package name", () => {
      assert.strictEqual(
        normalizePiPackageName("npm:pi-subagents"),
        "pi-subagents",
        "expected a plain npm entry with no version to normalize to its bare package name"
      )
      assert.strictEqual(
        normalizePiPackageName("npm:pi-subagents@1.2.3"),
        "pi-subagents",
        "expected a plain npm entry with a version to have the version stripped"
      )
      assert.strictEqual(
        normalizePiPackageName("npm:@juicesharp/rpiv-todo"),
        "@juicesharp/rpiv-todo",
        "expected a versionless scoped npm entry to normalize to its full scoped name"
      )
      assert.strictEqual(
        normalizePiPackageName("npm:@juicesharp/rpiv-todo@1.4.2"),
        "@juicesharp/rpiv-todo",
        "expected a scoped npm entry WITH a version to strip only the trailing version " +
          'and keep the scope; a naive split("@")[0] gets this exact case wrong (it ' +
          "would return an empty string because the scoped name's leading '@' is not " +
          "the version separator)"
      )
      assert.strictEqual(
        normalizePiPackageName("git:https://github.com/example/pi-plugin.git"),
        undefined,
        "expected a git source to normalize to undefined; it carries no comparable npm package name"
      )
      assert.strictEqual(
        normalizePiPackageName("/Users/example/local-pi-plugin"),
        undefined,
        "expected a filesystem path entry to normalize to undefined"
      )
      assert.strictEqual(
        normalizePiPackageName(42),
        undefined,
        "expected a non-string entry to normalize to undefined instead of throwing"
      )
      assert.strictEqual(
        normalizePiPackageName(""),
        undefined,
        "expected an empty entry to normalize to undefined"
      )
    }],

    ["companion package detection reads Pi's settings.json (real filesystem): npm entries are recognized, path/git entries are ignored, missing/malformed settings degrade to an empty set", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-config-dir-test-"))
      try {
        const settingsFile = path.join(tmpDir, "settings.json")
        fs.writeFileSync(
          settingsFile,
          JSON.stringify({
            packages: [
              "npm:pi-subagents@2.0.0",
              "npm:@juicesharp/rpiv-todo@1.4.2",
              "/Users/example/local-pi-plugin",
              "git:https://github.com/example/pi-plugin.git",
            ],
          })
        )

        const installed = readInstalledPackageNames(settingsFile)
        assert.strictEqual(
          installed.size,
          2,
          "expected only the two npm: entries to be recognized out of a mixed packages " +
            `list (got: ${[...installed].join(", ")})`
        )
        assert.ok(
          installed.has("pi-subagents"),
          "expected the plain npm entry with a version to be recognized as pi-subagents"
        )
        assert.ok(
          installed.has("@juicesharp/rpiv-todo"),
          "expected the scoped npm entry with a version to be recognized as @juicesharp/rpiv-todo"
        )
        assert.ok(
          !installed.has("/Users/example/local-pi-plugin"),
          "expected the filesystem path entry to be ignored, not reported as an installed package"
        )
        assert.ok(
          ![...installed].some(name => name.startsWith("git:")),
          "expected the git: source entry to be ignored, not reported as an installed package"
        )

        const missingFile = path.join(tmpDir, "does-not-exist.json")
        assert.deepStrictEqual(
          readInstalledPackageNames(missingFile),
          new Set(),
          "expected a missing settings.json to yield an empty set instead of throwing"
        )

        const malformedFile = path.join(tmpDir, "malformed.json")
        fs.writeFileSync(malformedFile, "{ this is not valid json")
        assert.deepStrictEqual(
          readInstalledPackageNames(malformedFile),
          new Set(),
          "expected a malformed settings.json to yield an empty set instead of throwing"
        )
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    }],
  ]

  for (const [name, fn] of tests) {
    if (await runTest(name, fn)) {
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
