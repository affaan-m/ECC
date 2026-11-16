/**
 * ECC Plugin Hooks for OpenCode (V2 plugin API, V1-compatible factory surface)
 *
 * Migrated from the OpenCode V1 plugin format for OpenCode 2.x.
 * V1 plugins default-exported an async function that returned a map of
 * string-keyed hooks; V2 requires a default-exported definition object with
 * an `id` and a `setup(ctx)` function, and hooks are registered on their
 * owning domain instead of being returned by key.
 *
 * ## Active Plugin: ECC v2.2.3
 * (kept in sync with package.json — enforced by tests/plugin-manifest.test.js)
 *
 * This module intentionally exposes BOTH surfaces:
 * - `ECCHooksPlugin` (named): the retained V1 factory used by behavioral
 *   tests and explicit migration callers. The default module is V2-only:
 *   OpenCode 1.x's function-only module loader cannot load this entry.
 * - default export: the V2 definition `{ id, setup(ctx) }` that OpenCode 2.x
 *   actually loads. `setup` builds the same runtime once and adapts its hook
 *   map onto the V2 domains.
 *
 * Hook Event Mapping (V1 key -> V2 registration):
 * - tool.execute.before        -> ctx.tool.hook("execute.before")
 * - tool.execute.after         -> ctx.tool.hook("execute.after")
 * - file.edited / file.watcher / session.* / todo.updated
 *                              -> ctx.event.subscribe() filtered by type
 * - shell.env                  -> ctx.shell.hook("create.before")
 * - experimental.session.compacting -> ctx.session.hook("compaction")
 * - permission.ask             -> ctx.permission.hook("evaluate")
 * - tool record                -> ctx.tool.transform(editor => editor.add)
 *
 * The Bun `$` shell helper is not part of the V2 context, so every command
 * here runs through `child_process.spawn` instead, and the console.log audit
 * uses `fs` + regex rather than `grep` so it works on Windows too. The `$`
 * parameter is still accepted by the factory for V1 call-signature parity,
 * but is never invoked (asserted by tests/opencode-plugin-hooks.test.js).
 */

import * as fs from "fs"
import * as path from "path"
import { spawn } from "child_process"
import { fileURLToPath, pathToFileURL } from "url"

/**
 * Directory of this module.
 *
 * The plugin is ESM: tsc compiles it to .opencode/dist/plugins/*.js and OpenCode
 * loads the .ts directly, so `__dirname` is not defined there. Reading it used to
 * throw inside a try/catch and silently degrade the reported ECC version to the
 * default. `import.meta.url` is the ESM source of truth; the `__dirname` check is
 * kept first only so a CJS consumer of this module still resolves correctly.
 */
function resolvePluginDir(): string {
  // Node 24 leaks the eval context's `__dirname` ("." under `node -e`) into
  // modules imported from it, which would resolve relative to the *process*
  // cwd instead of this file. Only a genuine absolute __dirname is trusted;
  // import.meta.url is correct in every layout (OpenCode's TS loader and
  // plain ESM both give the module's own URL).
  if (typeof __dirname === "string" && path.isAbsolute(__dirname)) return __dirname
  return path.dirname(fileURLToPath(import.meta.url))
}

const PLUGIN_DIR = resolvePluginDir()

/** Loose aliases: the runtime ctx/event shapes come from the server, not the pinned SDK. */
type LooseRecord = Record<string, any>

interface ToolArgs {
  filePath?: string
  file_path?: string
  path?: string
  command?: string
  [key: string]: unknown
}

interface ToolInput {
  tool: string
  callID?: string
  args?: ToolArgs
}

interface PermissionEvent {
  tool: string
  args: unknown
}

/**
 * Artifacts that identify an ECC root, one per capability this plugin needs.
 *
 * These are required runtime files, never optional content: `skills/` belongs to
 * the optional `workflow-quality` module, so probing for a skill rejected
 * supported modular installs (e.g. `platform-configs` + `hooks-runtime` without
 * `workflow-quality`) that still ship both the plugin and the tracker — silently
 * disabling skill telemetry and the shell root export for those users.
 *
 * Each probe is the exact artifact the caller is about to use, so detection is
 * layout detection rather than an authenticity control: a directory only
 * qualifies because it contains what we are going to read.
 */
const ECC_ROOT_PROBES = {
  // scripts/lib/utils.js is the shared library every scripts/ module requires.
  root: [path.join("scripts", "lib", "utils.js")],
  // What the skill-run telemetry hook imports at runtime.
  skillTracker: [path.join("scripts", "hooks", "skill-run-tracker.js")],
  // What the resolver embedded in commands requires once they read
  // CLAUDE_PLUGIN_ROOT, and the version lookup for shell.env.
  resolver: [path.join("scripts", "lib", "resolve-ecc-root.js")],
} as const

/**
 * Walk upwards from `startDir` looking for an ancestor that contains every
 * relative path in `probes`.
 *
 * The plugin ships in three layouts — `<root>/plugins` (installed), `<root>/dist/plugins`
 * (compiled) and `<repo>/.opencode/plugins` (repo checkout) — so the number of
 * levels back to the root is not fixed. Probing beats a hardcoded `..`: a wrong
 * root would make every command resolve against a directory that has no scripts.
 *
 * The walk is bounded to 5 levels so it cannot wander into unrelated ancestors.
 *
 * Returns null when no ancestor qualifies, so callers can leave the capability
 * disabled instead of advertising a root that does not hold the artifact.
 */
function findEccRootDir(startDir: string, probes: readonly string[]): string | null {
  let current = startDir
  for (let depth = 0; depth < 5; depth += 1) {
    if (probes.every((probe) => fs.existsSync(path.join(current, probe)))) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/**
 * Read the ECC version from package.json.
 *
 * Candidates are tried in order — the resolved ECC root first, then the two
 * plausible parent depths of the plugin — because the layout differs between an
 * installed root (`<root>/plugins`), the compiled bundle (`<root>/dist/plugins`)
 * and a repo checkout (`<repo>/.opencode/plugins`). Falls back to a default if
 * no package.json can be read.
 */
function getECCVersion(eccRootDir?: string | null): string {
  const candidates = [
    eccRootDir,
    path.resolve(PLUGIN_DIR, ".."),
    path.resolve(PLUGIN_DIR, "..", ".."),
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf-8"))
      if (typeof packageJson.version === "string" && packageJson.version) {
        return packageJson.version
      }
    } catch {
      // Try the next candidate.
    }
  }

  return "2.0.0"
}

/**
 * On Windows, npx/npm/pnpm/yarn/bun are `.cmd` shims that CreateProcess
 * cannot launch directly from a bare command name. Node's own guidance for
 * this case is to spawn the exact `.cmd` file through `cmd.exe /d /s /c`
 * with `windowsVerbatimArguments` and quoted args — NOT `shell: true`,
 * which concatenates the command and arguments into one string that shell
 * metacharacters (&, |, ;) in any argument (e.g. a file path) could inject
 * into. The command is fixed here (never user input); only known package
 * managers get the cmd-shim treatment, and their arguments stay separated.
 */
function spawnCommand(
  command: string,
  args: string[],
): { file: string; spawnArgs: string[]; verbatim: boolean } {
  if (
    process.platform === "win32" &&
    /^(npx|npm|pnpm|yarn|bun)(\.cmd)?$/i.test(command)
  ) {
    // R2-2: cmd.exe expands %VAR% and honours embedded quotes even inside
    // "double quotes", so backslash-escaping a quote here is not safe. Reject
    // any argument carrying a quote, percent sign, or line break outright
    // (line breaks would also terminate the /c command string). Legitimate
    // package-manager invocations never need these characters; callers already
    // surface the rejection through run()'s rejection path.
    const unsafe = args.find((value) => /["%\r\n]/.test(value))
    if (unsafe !== undefined) {
      throw new Error(
        `Refusing to launch package-manager shim with unsafe argument: ${JSON.stringify(unsafe)}`,
      )
    }
    const shim = `${command.replace(/\.cmd$/i, "")}.cmd`
    const quote = (value: string) => `"${value}"`
    // Canonical `/s` form: wrap the whole command string in one outer pair of
    // quotes. cmd strips exactly that outer pair and executes the remainder
    // verbatim, so the quoted shim path resolves instead of being re-split.
    const inner = [shim, ...args].map(quote).join(" ")
    return {
      file: process.env.ComSpec || "cmd.exe",
      spawnArgs: ["/d", "/s", "/c", `"${inner}"`],
      verbatim: true,
    }
  }
  return { file: command, spawnArgs: args, verbatim: false }
}

/** Run a command, resolving with its output regardless of exit code. */
function run(
  command: string,
  args: string[],
  options: { cwd?: string; detached?: boolean } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const resolved = spawnCommand(command, args)
    const child = spawn(resolved.file, resolved.spawnArgs, {
      cwd: options.cwd,
      shell: false,
      windowsVerbatimArguments: resolved.verbatim,
      windowsHide: true,
      detached: options.detached === true,
      stdio: options.detached === true ? "ignore" : ["ignore", "pipe", "pipe"],
    })
    // T03: the error listener must exist before any early return below, so a
    // missing binary (ENOENT) rejects this promise instead of surfacing as an
    // unhandled 'error' event that can crash the host process.
    let settled = false
    child.on("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    if (options.detached === true) {
      child.unref()
      settled = true
      resolve({ code: 0, stdout: "", stderr: "" })
      return
    }
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)))
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)))
    child.on("close", (code) => {
      if (settled) return
      settled = true
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

/** Count console.log occurrences in a file with fs+regex (cross-platform grep replacement). */
async function countConsoleLogs(filePath: string): Promise<number> {
  const content = await fs.promises.readFile(filePath, "utf-8")
  return (content.match(/console\.log\s*\(/g) ?? []).length
}

// A location loads plugins from both the global config dir and its own
// .opencode/plugins; OpenCode 2.x also treats plugins/index.ts and the
// directory entrypoint as separate load entries. The directory config now
// points at ecc-hooks.ts directly and plugins/index.ts is an inert
// distinct-id stub, but we keep a per-directory guard so the V2 hook set is
// registered only once per process *and* per project directory even if a
// future layout double-instantiates this module. The guard applies to V2
// domain registration only; the V1 factory stays constructible on demand
// (tests and legacy loaders instantiate it per project).
const GUARD_KEY = Symbol.for("ecc.hooks.registered-directories")
const registeredDirectories: Set<string> =
  ((globalThis as any)[GUARD_KEY] as Set<string> | undefined) ??
  ((globalThis as any)[GUARD_KEY] = new Set<string>())

type HookProfile = "minimal" | "standard" | "strict"

/**
 * The custom tool definitions V1 exposed through `plugin.tool` and V2 exposes
 * through ctx.tool.transform. Loaded lazily and cached per name: this file is
 * OpenCode's startup entry point, and a static top-level import of a missing
 * tools/ module used to crash the whole session before any hook could load
 * (#2530). A failed load degrades to an execute-time error message instead.
 */
const toolModuleCache = new Map<string, Promise<any>>()

/**
 * Resolve a tool module by URL rather than by a literal specifier: tsc only
 * rewrites `.ts` extensions in statically-analyzable specifiers, and the
 * compiled layout ships `.js` while a repo/source install ships `.ts`.
 */
async function loadToolModule(name: string): Promise<{ description: string; args: any; execute: (args: any, context: any) => Promise<unknown> }> {
  let pending = toolModuleCache.get(name)
  if (!pending) {
    const toolsDir = path.resolve(PLUGIN_DIR, "..", "tools")
    const candidates = [path.join(toolsDir, `${name}.js`), path.join(toolsDir, `${name}.ts`)]
    pending = (async () => {
      let lastError: unknown
      for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue
        try {
          return await import(pathToFileURL(candidate).href)
        } catch (error) {
          lastError = error
        }
      }
      throw lastError ?? new Error(`neither ${name}.js nor ${name}.ts found under ${toolsDir}`)
    })()
      .then((mod: any) => {
        const definition = mod?.default ?? mod
        if (!definition || typeof definition.execute !== "function") {
          throw new Error(`${name}: module exposes no tool definition with an execute()`)
        }
        return definition
      })
      .catch((error: unknown) => {
        toolModuleCache.delete(name)
        throw new Error(
          `${name} tool: could not load ECC tool module. Run \`ecc repair --target opencode\` to restore the missing files. (${
            error instanceof Error ? error.message : String(error)
          })`,
        )
      })
    toolModuleCache.set(name, pending)
  }
  return pending
}

/** The shared runtime: every hook body lives here exactly once. */
interface EccRuntime {
  /** V1-shaped hook map (also used by the V2 adapters below). */
  hooks: Record<string, any>
  /** V1-shaped custom tool record. */
  tool: Record<string, unknown>
  /** ECC context block preserved through compaction (V2 registration uses it). */
  buildCompactionContext: () => string
  /** The project directory this runtime was built for. */
  worktreePath: string
}

async function createEccRuntime(input: {
  client?: { app?: { log?: (event: { body: LooseRecord }) => unknown } }
  $?: unknown
  directory?: string
  worktree?: string
}): Promise<EccRuntime> {
  const { client } = input
  const worktreePath = input.worktree || input.directory || process.cwd()

  const editedFiles = new Set<string>()
  const pendingToolChanges = new Map<string, { path: string; type: "added" | "modified" }>()
  let writeCounter = 0

  function resolvePath(p: string): string {
    if (path.isAbsolute(p)) return p
    return path.join(worktreePath, p)
  }

  function hasProjectFile(relativePath: string): boolean {
    try {
      return fs.statSync(resolvePath(relativePath)).isFile()
    } catch {
      return false
    }
  }

  function getFilePath(args: ToolArgs | undefined): string | null {
    if (!args) return null
    const p = (args.filePath ?? args.file_path ?? args.path) as string | undefined
    return typeof p === "string" && p.trim() ? p : null
  }

  // V1 logged through the SDK client; V2 has no client.app.log, so the console
  // fallback writes into the server log, which is where those messages ended
  // up anyway.
  const log = (level: "debug" | "info" | "warn" | "error", message: string) => {
    if (typeof client?.app?.log === "function") {
      return client.app.log({ body: { service: "ecc", level, message } })
    }
    try {
      const line = `[ecc] ${message}`
      if (level === "error") console.error(line)
      else if (level === "warn") console.warn(line)
      else if (level === "debug") console.debug(line)
      else console.info(line)
    } catch {
      // Logging must never break a hook.
    }
  }

  // Loaded lazily (instead of via a top-level import) so that a missing or
  // partially-installed `~/.opencode/plugins/lib` directory (e.g. an
  // interrupted or partial ECC install on Termux/Android) only disables
  // changed-files tracking, rather than throwing during module evaluation.
  // This plugin is OpenCode's startup entry point, so a static import
  // failure here previously crashed the whole plugin -- and with it, the
  // entire OpenCode session -- before any hooks could load (see #2530).
  // The relative ".ts" specifier is rewritten to ".js" by tsc in the compiled
  // layout and resolved natively by OpenCode's TS loader in a source layout.
  let changedFilesStore: typeof import("./lib/changed-files-store.ts") | undefined
  try {
    const store = await import("./lib/changed-files-store.ts")
    store.initStore?.(worktreePath)
    changedFilesStore = store
  } catch {
    // Best-effort diagnostic only: deferred via .then() (rather than
    // Promise.resolve(log(...))) so that even a *synchronous* throw inside
    // log() -- not just an async rejection -- is caught here instead of
    // escaping this catch block. The raw loader error is intentionally not
    // included in the message since it can contain absolute filesystem
    // paths; this whole block exists to guarantee startup resilience even
    // when things go wrong.
    Promise.resolve()
      .then(() =>
        log(
          "warn",
          "[ECC] changed-files tracking disabled: could not load the changed-files store. " +
            "Run `ecc repair --target opencode` to restore the missing files. Other ECC hooks are unaffected.",
        ),
      )
      .catch(() => {})
  }

  // Claude Code routes post:skill:track through
  // scripts/hooks/posttooluse-dispatcher.js, which OpenCode never invokes.
  // Without a caller here, nothing ever writes skill-runs.jsonl and
  // `skills-health.js --dashboard` has no data to report on any skill (#2463).
  //
  // The tracker module is reused rather than reimplemented so its identifier
  // validation, length bounds and "never persist prompt text" guarantees stay
  // the ones that were written and audited for the Claude Code path.
  //
  // Loaded lazily, for the same reason as the store above. A runtime file URL
  // also keeps tsc from resolving a relative specifier that exists in no
  // compiled layout.
  let recordSkillRun: ((payload: unknown) => void) | undefined
  // Detection is scoped to the tracker itself, so a modular install that omits
  // optional content still gets telemetry.
  const trackerRoot = findEccRootDir(PLUGIN_DIR, ECC_ROOT_PROBES.skillTracker)
  // The root advertised to commands is a different question: those commands
  // require the resolver, so a root without it would break them again.
  const eccRoot =
    findEccRootDir(PLUGIN_DIR, ECC_ROOT_PROBES.resolver) ?? findEccRootDir(PLUGIN_DIR, ECC_ROOT_PROBES.root)
  try {
    const trackerPath = trackerRoot ? path.join(trackerRoot, "scripts", "hooks", "skill-run-tracker.js") : null
    if (!trackerPath || !fs.existsSync(trackerPath)) {
      throw new Error("skill-run-tracker.js not found")
    }
    // CJS module loaded from ESM: run() is on the namespace in Node/Bun, but a
    // transpiled default export must stay supported.
    const loaded = (await import(pathToFileURL(trackerPath).href)) as {
      run?: (payload: unknown) => void
      default?: { run?: (payload: unknown) => void }
    }
    const entry = typeof loaded.run === "function" ? loaded : loaded.default
    if (!entry || typeof entry.run !== "function") {
      throw new Error("skill-run-tracker.js exposes no run()")
    }
    recordSkillRun = entry.run
  } catch {
    // Same deferred-log rationale as the store above: guarantee that a
    // telemetry failure can never escape this catch and abort startup.
    Promise.resolve()
      .then(() =>
        log(
          "warn",
          "[ECC] skill-run telemetry disabled: could not load scripts/hooks/skill-run-tracker.js. " +
            "Run `ecc repair --target opencode` to restore the missing files. Other ECC hooks are unaffected.",
        ),
      )
      .catch(() => {})
  }

  const normalizeProfile = (value: string | undefined): HookProfile => {
    if (value === "minimal" || value === "strict") return value
    return "standard"
  }

  const currentProfile = normalizeProfile(process.env.ECC_HOOK_PROFILE)
  const disabledHooks = new Set(
    (process.env.ECC_DISABLED_HOOKS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )

  const profileOrder: Record<HookProfile, number> = { minimal: 0, standard: 1, strict: 2 }

  const profileAllowed = (required: HookProfile | HookProfile[]): boolean => {
    if (Array.isArray(required)) {
      return required.some((entry) => profileOrder[currentProfile] >= profileOrder[entry])
    }
    return profileOrder[currentProfile] >= profileOrder[required]
  }

  const hookEnabled = (
    hookId: string,
    requiredProfile: HookProfile | HookProfile[] = "standard",
  ): boolean => {
    if (disabledHooks.has(hookId)) return false
    return profileAllowed(requiredProfile)
  }

  /**
   * Prettier auto-format + console.log warning + change tracking.
   * (Equivalent to Claude Code PostToolUse hook for prettier.)
   */
  const onFileEdited = async (event: { path: string }) => {
    try {
      editedFiles.add(event.path)
      changedFilesStore?.recordChange?.(event.path, "modified")

      // Auto-format JS/TS files (strict profile only: it shells out).
      if (hookEnabled("post:edit:format", ["strict"]) && /\.(ts|tsx|js|jsx)$/.test(event.path)) {
        try {
          const result = await run("npx", ["prettier", "--write", event.path], { cwd: worktreePath })
          // T11: a non-zero exit is a failure, not a success. Only log
          // "Formatted" when prettier actually ran and wrote the file.
          if (result.code === 0) {
            log("info", `[ECC] Formatted: ${event.path}`)
          } else {
            const detail = (result.stderr || result.stdout || "").trim().slice(0, 200)
            log("warn", `[ECC] Prettier failed for ${event.path} (exit ${result.code})${detail ? `: ${detail}` : ""}`)
          }
        } catch (error: unknown) {
          // Prettier could not be spawned at all - log but continue
          const errorMessage = error instanceof Error ? error.message : String(error)
          log("debug", `[ECC] Prettier formatting failed for ${event.path}: ${errorMessage}`)
        }
      }

      // Console.log warning check (fs+regex: grep is not available on Windows).
      if (hookEnabled("post:edit:console-warn", ["standard", "strict"]) && /\.(ts|tsx|js|jsx)$/.test(event.path)) {
        const count = await countConsoleLogs(resolvePath(event.path)).catch(() => 0)
        if (count > 0) {
          log(
            "warn",
            `[ECC] console.log found in ${event.path} (${count} occurrence${count > 1 ? "s" : ""})`,
          )
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log("debug", `[ECC] file.edited hook failed: ${errorMessage}`)
    }
  }

  /**
   * Advisory pre-tool callback: change bookkeeping, git-push/tmux reminders,
   * and doc-file warnings. This does not invoke canonical ECC Bash guards.
   */
  const onToolBefore = async (input: ToolInput) => {
    try {
      if (input.tool === "write") {
        const filePath = getFilePath(input.args)
        if (filePath) {
          const absPath = resolvePath(filePath)
          let type: "added" | "modified" = "modified"
          try {
            type = fs.existsSync(absPath) ? "modified" : "added"
          } catch {
            type = "modified"
          }
          const key = input.callID ?? `write-${++writeCounter}-${filePath}`
          pendingToolChanges.set(key, { path: filePath, type })
        }
      }

      // Git push review reminder
      if (hookEnabled("pre:bash:git-push-reminder", "strict") && input.tool === "bash") {
        const cmd = String(input.args?.command ?? input.args ?? "")
        if (cmd.includes("git push")) {
          log("info", "[ECC] Remember to review changes before pushing: git diff origin/main...HEAD")
        }
      }

      // Warn about potentially unnecessary documentation files
      if (hookEnabled("pre:write:doc-file-warning", ["standard", "strict"]) && input.tool === "write") {
        const filePath = getFilePath(input.args)
        if (
          filePath &&
          /\.(md|txt)$/i.test(filePath) &&
          !filePath.includes("README") &&
          !filePath.includes("CHANGELOG") &&
          !filePath.includes("LICENSE") &&
          !filePath.includes("CONTRIBUTING")
        ) {
          log("warn", `[ECC] Creating ${filePath} - consider if this documentation is necessary`)
        }
      }

      // Long-running command reminder
      if (hookEnabled("pre:bash:tmux-reminder", "strict") && input.tool === "bash") {
        const cmd = String(input.args?.command ?? input.args ?? "")
        if (
          cmd.match(/^(npm|pnpm|yarn|bun)\s+(install|build|test|run)/) ||
          cmd.match(/^cargo\s+(build|test|run)/) ||
          cmd.match(/^go\s+(build|test|run)/)
        ) {
          log("info", "[ECC] Long-running command detected - consider using background execution")
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log("debug", `[ECC] tool.execute.before hook failed: ${errorMessage}`)
    }
  }

  /**
   * Post-tool: change recording, typecheck, PR log, skill telemetry.
   * (Equivalent to Claude Code PostToolUse hook for tsc.)
   */
  const onToolAfter = async (input: ToolInput, output: unknown) => {
    try {
      const filePath = getFilePath(input.args)
      if (input.tool === "edit" && filePath) {
        changedFilesStore?.recordChange?.(filePath, "modified")
      }
      if (input.tool === "write" && filePath) {
        const key = input.callID ?? `write-${++writeCounter}-${filePath}`
        const pending = pendingToolChanges.get(key)
        if (pending) {
          changedFilesStore?.recordChange?.(pending.path, pending.type)
          pendingToolChanges.delete(key)
        } else {
          changedFilesStore?.recordChange?.(filePath, "modified")
        }
      }

      // Check if a TypeScript file was edited
      if (
        hookEnabled("post:edit:typecheck", ["strict"]) &&
        input.tool === "edit" &&
        typeof input.args?.filePath === "string" &&
        /\.tsx?$/.test(input.args.filePath)
      ) {
        const result = await run("npx", ["tsc", "--noEmit"], { cwd: worktreePath }).catch(() => null)
        if (result && result.code === 0) {
          log("info", "[ECC] TypeScript check passed")
        } else if (result) {
          log("warn", "[ECC] TypeScript errors detected:")
          const out = (result.stdout || result.stderr || "").split("\n").slice(0, 5)
          out.forEach((line) => line.trim() && log("warn", `  ${line}`))
        }
      }

      // PR creation logging
      if (
        hookEnabled("post:bash:pr-created", ["standard", "strict"]) &&
        input.tool === "bash" &&
        String(input.args?.command ?? input.args ?? "").includes("gh pr create")
      ) {
        log("info", "[ECC] PR created - check GitHub Actions status")
      }

      // Skill telemetry (#2463). OpenCode's tool is named `skill`, so the
      // harness-side name is matched here (case-insensitively) and the payload
      // is handed over in the shape the tracker already understands.
      if (
        hookEnabled("post:skill:track", ["standard", "strict"]) &&
        typeof input.tool === "string" &&
        input.tool.trim().toLowerCase() === "skill"
      ) {
        try {
          recordSkillRun?.({
            tool_name: "Skill",
            tool_input: input.args ?? {},
            tool_response: output,
          })
        } catch {
          // Telemetry is best-effort; never let it affect the tool result.
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log("debug", `[ECC] tool.execute.after hook failed: ${errorMessage}`)
    }
  }

  /** Session Created Hook (Equivalent to Claude Code SessionStart hook). */
  const onSessionCreated = async () => {
    if (!hookEnabled("session:start", ["minimal", "standard", "strict"])) return
    log("info", `[ECC] Session started - profile=${currentProfile}`)
    if (hasProjectFile("CLAUDE.md")) {
      log("info", "[ECC] Found CLAUDE.md - loading project context")
    }
  }

  /**
   * Session Idle Hook (Equivalent to Claude Code Stop hook): console.log
   * audit on all edited files + desktop notification.
   */
  const onSessionIdle = async () => {
    if (!hookEnabled("stop:check-console-log", ["minimal", "standard", "strict"])) return
    if (editedFiles.size === 0) return

    log("info", "[ECC] Session idle - running console.log audit")

    let totalConsoleLogCount = 0
    const filesWithConsoleLogs: string[] = []

    for (const file of editedFiles) {
      if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue
      const count = await countConsoleLogs(resolvePath(file)).catch(() => 0)
      if (count > 0) {
        totalConsoleLogCount += count
        filesWithConsoleLogs.push(file)
      }
    }

    if (totalConsoleLogCount > 0) {
      log(
        "warn",
        `[ECC] Audit: ${totalConsoleLogCount} console.log statement(s) in ${filesWithConsoleLogs.length} file(s)`,
      )
      filesWithConsoleLogs.forEach((f) => log("warn", `  - ${f}`))
      log("warn", "[ECC] Remove console.log statements before committing")
    } else {
      log("info", "[ECC] Audit passed: No console.log statements found")
    }

    // Desktop notification, best effort and never blocking. The V1 Windows
    // path opened a modal MessageBox on the server; that is replaced with a
    // fire-and-forget balloon tip, and every branch is detached.
    try {
      if (process.platform === "darwin") {
        await run("osascript", ["-e", 'display notification "Task completed!" with title "OpenCode ECC"'], {
          detached: true,
        }).catch(() => {})
      } else if (process.platform === "win32") {
        const ps =
          "$ni = New-Object System.Windows.Forms.NotifyIcon; $ni.Icon = [System.Drawing.SystemIcons]::Information; " +
          "$ni.Visible = $true; $ni.ShowBalloonTip('OpenCode ECC', 'Task completed!', 'Info'); " +
          "Start-Sleep -Seconds 5; $ni.Dispose()"
        await run(
          "powershell",
          ["-NoProfile", "-WindowStyle", "Hidden", "-Command", `Add-Type -AssemblyName System.Windows.Forms; ${ps}`],
          { detached: true },
        ).catch(() => {})
      } else if (process.platform === "linux") {
        await run("notify-send", ["OpenCode ECC", "Task completed!"], { detached: true }).catch(() => {})
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log("debug", `[ECC] Desktop notification failed: ${errorMessage}`)
    }

    // Clear tracked files for next task
    editedFiles.clear()
  }

  /** Session Deleted Hook (Equivalent to Claude Code SessionEnd hook). */
  const onSessionDeleted = async () => {
    if (!hookEnabled("session:end-marker", ["minimal", "standard", "strict"])) return
    log("info", "[ECC] Session ended - cleaning up")
    editedFiles.clear()
    changedFilesStore?.clearChanges?.()
    pendingToolChanges.clear()
  }

  /** File Watcher Hook (OpenCode-only): keeps tracking in sync with external edits. */
  const onFileWatcherUpdated = async (event: { path: string; type: string }) => {
    let changeType: "added" | "modified" | "deleted" = "modified"
    if (event.type === "create" || event.type === "add") changeType = "added"
    else if (event.type === "delete" || event.type === "remove") changeType = "deleted"
    changedFilesStore?.recordChange?.(event.path, changeType)
    if (event.type === "change" && /\.(ts|tsx|js|jsx)$/.test(event.path)) {
      editedFiles.add(event.path)
    }
  }

  /** Todo Updated Hook (OpenCode-only): logs progress. */
  const onTodoUpdated = async (event: { todos: Array<{ text?: string; done: boolean }> }) => {
    const todos = Array.isArray(event.todos) ? event.todos : []
    const completed = todos.filter((t) => t.done).length
    const total = todos.length
    if (total > 0) {
      log("info", `[ECC] Progress: ${completed}/${total} tasks completed`)
    }
  }

  /**
   * Shell Environment Hook (OpenCode-specific): inject ECC context into
   * shell commands. PROJECT_ROOT/PACKAGE_MANAGER/... are computed per call
   * because project marker files can appear after plugin init.
   */
  const onShellEnv = async (_input: { cwd: string }, output: { env: Record<string, string> }) => {
    const env: Record<string, string> = {
      ECC_VERSION: getECCVersion(eccRoot),
      ECC_PLUGIN: "true",
      ECC_HOOK_PROFILE: currentProfile,
      ECC_DISABLED_HOOKS: process.env.ECC_DISABLED_HOOKS || "",
      PROJECT_ROOT: worktreePath,
    }

    // Detect package manager (fs only: no shell probing, so this works on Windows).
    const lockfiles: Record<string, string> = {
      "bun.lockb": "bun",
      "pnpm-lock.yaml": "pnpm",
      "yarn.lock": "yarn",
      "package-lock.json": "npm",
    }
    for (const [lockfile, pm] of Object.entries(lockfiles)) {
      if (hasProjectFile(lockfile)) {
        env.PACKAGE_MANAGER = pm
        break
      }
    }

    // Detect languages
    const langDetectors: Record<string, string> = {
      "tsconfig.json": "typescript",
      "go.mod": "go",
      "pyproject.toml": "python",
      "Cargo.toml": "rust",
      "Package.swift": "swift",
    }
    const detected: string[] = []
    for (const [file, lang] of Object.entries(langDetectors)) {
      if (hasProjectFile(file)) {
        detected.push(lang)
      }
    }
    if (detected.length > 0) {
      env.DETECTED_LANGUAGES = detected.join(",")
      env.PRIMARY_LANGUAGE = detected[0]
    }

    // resolve-ecc-root.js only probes ~/.claude and Claude Code's plugin
    // cache, so under OpenCode it fell back to ~/.claude and every command
    // carrying the inlined resolver failed to find its scripts. That resolver
    // reads CLAUDE_PLUGIN_ROOT first, so exporting the root here fixes them
    // through the mechanism ECC already provides -- rather than editing the
    // command files that embed the locator.
    //
    // Only set when a root actually exists, and never replace a root someone
    // else already chose: neither the process environment (set by the user)
    // nor `output.env` (set by an earlier plugin). The final merge below
    // overwrites output.env, so checking it only in `env` would clobber it.
    const rootAlreadySet = Boolean(
      (process.env.CLAUDE_PLUGIN_ROOT || "").trim() || (output.env?.CLAUDE_PLUGIN_ROOT || "").trim(),
    )
    if (eccRoot && !rootAlreadySet) {
      env.CLAUDE_PLUGIN_ROOT = eccRoot
    }

    // OpenCode reads the supplied output object and ignores callback return values.
    output.env = { ...output.env, ...env }
  }

  /** ECC context block preserved through compaction. */
  function buildCompactionContext(): string {
    const contextBlock = [
      "# ECC Context (preserve across compaction)",
      "",
      `## Active Plugin: ECC v${getECCVersion(eccRoot)}`,
      "- Hooks: file.edited, tool.execute.before/after, session.created/idle/deleted, shell.env, compacting, permission.ask",
      "- Tools: changed-files, dependency-analyzer",
      "",
      "## Key Principles",
      "- TDD: write tests first, 80%+ coverage",
      "- Immutability: never mutate, always return new copies",
      "- Security: validate inputs, no hardcoded secrets",
      "",
    ]

    // Include recently edited files
    if (editedFiles.size > 0) {
      contextBlock.push("## Recently Edited Files")
      for (const f of editedFiles) {
        contextBlock.push(`- ${f}`)
      }
      contextBlock.push("")
    }

    return [
      contextBlock.join("\n"),
      "Focus on preserving: 1) Current task status and progress, 2) Key decisions made, 3) Files created/modified, 4) Remaining work items, 5) Any security concerns flagged. Discard: verbose tool outputs, intermediate exploration, redundant file listings.",
    ].join("\n\n")
  }

  /**
   * Session Compacting Hook (OpenCode-specific): append ECC context without
   * replacing the host (or an earlier plugin's) compaction prompt.
   */
  const onSessionCompacting = async (
    _input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => {
    const eccContext = buildCompactionContext()
    // OpenCode requires output assignment and skips context when a prompt is set.
    if (output.prompt !== undefined) {
      output.prompt = [output.prompt, eccContext].join("\n\n")
    } else {
      output.context = [...output.context, eccContext]
    }
  }

  /**
   * Permission Auto-Approve Hook (OpenCode-specific): auto-approve reads,
   * formatters, and test commands on top of the configured rules.
   */
  const onPermissionAsk = async (event: PermissionEvent) => {
    log("info", `[ECC] Permission requested for: ${event.tool}`)

    try {
      // Handle both string args and object args with command property
      let cmd: string
      if (typeof event.args === "string") {
        cmd = event.args
      } else if (event.args && typeof event.args === "object") {
        cmd = String((event.args as Record<string, unknown>).command || "")
      } else {
        cmd = String(event.args || "")
      }
      if (cmd) {
        log("debug", `[ECC] Permission resource: ${cmd.slice(0, 120)}`)
      }

      // Auto-approve: read/search tools
      if (["read", "glob", "grep", "search", "list"].includes(event.tool)) {
        log("debug", `[ECC] Auto-approved read-only tool: ${event.tool}`)
        return { approved: true, reason: "Read-only operation" }
      }

      // T02: no shell-command auto-approval. A regex over the leading
      // characters of a free-form shell string is not a safe allow-list —
      // cmd/powershell argument modes, quoting, and subshell syntax can all
      // defeat it (e.g. `prettier --write x.ts & curl evil.co`, or PowerShell
      // `(prettier)`). Formatter and test commands fall through to the user's
      // permission system instead.

      // Everything else: let user decide
      log("debug", `[ECC] Permission requires user approval: ${event.tool}`)
      return { approved: undefined }
    } catch (error: unknown) {
      // Error in permission handling - log and deny for safety
      const errorMessage = error instanceof Error ? error.message : String(error)
      log("error", `[ECC] Permission handling error for ${event.tool}: ${errorMessage}`)
      return { approved: false, reason: `Error: ${errorMessage}` }
    }
  }

  // V1 custom tool record: definitions load lazily; a broken tools/ install
  // surfaces only when a tool is actually invoked, never at startup.
  const tool: Record<string, unknown> = {}
  for (const name of ["changed-files", "dependency-analyzer"]) {
    try {
      const definition = await loadToolModule(name)
      tool[name] = definition
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log("warn", `[ECC] Custom tool ${name} disabled: ${errorMessage}`)
    }
  }

  const hooks: Record<string, any> = {
    "file.edited": onFileEdited,
    "tool.execute.before": onToolBefore,
    "tool.execute.after": onToolAfter,
    "session.created": onSessionCreated,
    "session.idle": onSessionIdle,
    "session.deleted": onSessionDeleted,
    "file.watcher.updated": onFileWatcherUpdated,
    "todo.updated": onTodoUpdated,
    "shell.env": onShellEnv,
    "experimental.session.compacting": onSessionCompacting,
    "permission.ask": onPermissionAsk,
  }

  return { hooks, tool, buildCompactionContext, worktreePath }
}

/**
 * V1 factory surface. OpenCode 1.x (and ECC's own discovery tests) call this
 * with { client, $, directory, worktree } and receive the keyed hook map.
 * OpenCode 2.x never calls it — it loads the default-exported V2 definition
 * below, whose setup() builds this very runtime.
 *
 * `input.$` is accepted for signature parity and deliberately unused: V2 has
 * no Bun shell, and spawning through `$` broke on Windows.
 */
export const ECCHooksPlugin = async (input: {
  client: any
  $?: any
  directory?: string
  worktree?: string
}): Promise<Record<string, unknown>> => {
  const runtime = await createEccRuntime(input)
  return { ...runtime.hooks, tool: runtime.tool }
}

export const ECCHooksPluginDefinition = {
  id: "ecc-hooks",
  async setup(ctx: any): Promise<() => void> {
    const directory: string = ctx?.location?.directory ?? process.cwd()

    if (registeredDirectories.has(directory)) {
      return () => {}
    }
    registeredDirectories.add(directory)

    const runtime = await createEccRuntime({ directory, worktree: directory })
    const { hooks, worktreePath } = runtime

    // Normalize a V2 tool-hook event into the V1 ToolInput shape so both
    // surfaces share one implementation.
    const toToolInput = (event: LooseRecord): ToolInput => ({
      tool: String(event.tool ?? event.name ?? ""),
      callID: event.callID ?? event.id,
      args: (event.input ?? event.args) as ToolArgs | undefined,
    })

    logStartup(directory)

    // ------------------------------------------------------------------
    // Registration on the V2 domains (each guarded so a missing domain in an
    // older 2.x runtime downgrades to "capability off", not "plugin crash").
    // ------------------------------------------------------------------

    const registrations: { dispose?: () => Promise<void> | void }[] = []
    const controller = new AbortController()

    const safe =
      <T extends (...args: any[]) => any>(label: string, fn: T) =>
      async (...args: Parameters<T>) => {
        try {
          return await fn(...args)
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          console.debug(`[ecc] ${label} hook failed: ${errorMessage}`)
          return undefined
        }
      }

    // All domain registrations happen inside registerDomains() so a failure
    // half-way through can be rolled back (T10): already-registered hooks are
    // disposed and the directory guard is released for a later retry.
    const registerDomains = async (): Promise<void> => {
    if (typeof ctx?.tool?.hook === "function") {
      registrations.push(await ctx.tool.hook("execute.before", safe("execute.before", (event: LooseRecord) => hooks["tool.execute.before"](toToolInput(event), {}))))
      registrations.push(
        await ctx.tool.hook("execute.after", safe("execute.after", (event: LooseRecord) =>
          // R2-1: hand the shared handler the tool output object directly. The
          // skill tracker reads error fields (isError/is_error/status/error) off
          // `tool_response` itself; a `{ result: … }` wrapper made failed skill
          // runs look like successes.
          hooks["tool.execute.after"](toToolInput(event), event.status === "error"
            ? { is_error: true }
            : event.result ?? event.output),
        )),
      )
    }

    if (typeof ctx?.shell?.hook === "function") {
      registrations.push(
        await ctx.shell.hook(
          "create.before",
          safe("shell.env", async (event: LooseRecord) => {
            const output = { env: { ...(event.env ?? {}) } as Record<string, string> }
            await hooks["shell.env"]({ cwd: worktreePath }, output)
            event.env = output.env
          }),
        ),
      )
    }

    if (typeof ctx?.session?.hook === "function") {
      registrations.push(
        await ctx.session.hook(
          "compaction",
          safe("compaction", (event: LooseRecord) => {
            event.system = event.system ?? []
            event.system.push({ type: "text", text: runtime.buildCompactionContext() })
          }),
        ),
      )
    }

    if (typeof ctx?.permission?.hook === "function") {
      registrations.push(
        await ctx.permission.hook(
          "evaluate",
          safe("permission.evaluate", async (event: LooseRecord) => {
            const action = String(event.action ?? "")
            const resource = String(event.resources?.[0] ?? "")
            const decision = await hooks["permission.ask"]({ tool: action, args: resource })
            // approved === true -> allow; approved undefined/false -> keep the
            // configured decision (V1 semantics, never a hard deny on drift).
            if (decision?.approved === true) {
              event.effect = "allow"
              event.message = `ECC: ${decision.reason}`
            }
          }),
        ),
      )
    }

    // Custom tools: registered through a transform, resolving the V1 tool
    // modules lazily inside execute so a broken tools/ install only affects
    // these two tools when actually invoked.
    if (typeof ctx?.tool?.transform === "function") {
      registrations.push(
        await ctx.tool.transform((editor: any) => {
          editor.add({
            name: "changed-files",
            description:
              "List files changed by agents in this session as a navigable tree. Shows added (+), modified (~), and deleted (-) indicators. Use filter to show only specific change types. Returns paths for git diff.",
            input: {
              type: "object",
              properties: {
                filter: { type: "string", enum: ["all", "added", "modified", "deleted"], description: "Filter by change type (default: all)" },
                format: { type: "string", enum: ["tree", "json"], description: "Output format: tree for terminal display, json for structured data (default: tree)" },
              },
              additionalProperties: false,
            },
            execute: async (input: any, context: any) => {
              const mod = await loadToolModule("changed-files")
              const result = await mod.execute(input ?? {}, context ?? { directory: worktreePath, worktree: worktreePath })
              return { content: String(result) }
            },
          })
          editor.add({
            name: "dependency-analyzer",
            description:
              "Analyze project dependencies for outdated packages, security vulnerabilities, and unused dependencies. Supports npm, pnpm, yarn, and bun.",
            input: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["all", "outdated", "security", "unused"], description: "Type of analysis to run (default: all)" },
                fix: { type: "boolean", description: "Attempt to fix issues automatically (default: false)" },
                depth: { type: "number", description: "Depth of dependency analysis (default: 1)" },
              },
              additionalProperties: false,
            },
            execute: async (input: any, context: any) => {
              const mod = await loadToolModule("dependency-analyzer")
              const result = await mod.execute(input ?? {}, context ?? { directory: worktreePath, worktree: worktreePath })
              return { content: String(result) }
            },
          })
        }),
      )
    }

    // Event-driven hooks: V1 returned keyed handlers; V2 delivers these as
    // public server events on a subscription stream.
    if (typeof ctx?.event?.subscribe === "function") {
      void (async () => {
        try {
          for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
            const type: string = event?.type ?? ""
            const props: LooseRecord = event?.properties ?? event ?? {}
            try {
              switch (type) {
                case "file.edited": {
                  const p = props.file ?? props.path ?? props.filePath
                  if (typeof p === "string") await hooks["file.edited"]({ path: p })
                  break
                }
                case "file.watcher.updated": {
                  const p = props.file ?? props.path
                  if (typeof p === "string") await hooks["file.watcher.updated"]({ path: p, type: String(props.type ?? "") })
                  break
                }
                case "session.created":
                  await hooks["session.created"]()
                  break
                case "session.idle":
                  await hooks["session.idle"]()
                  break
                case "session.deleted":
                  await hooks["session.deleted"]()
                  break
                case "todo.updated":
                  await hooks["todo.updated"]({ todos: Array.isArray(props.todos) ? props.todos : [] })
                  break
                default:
                  break
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error)
              console.debug(`[ecc] event ${type} handler failed: ${errorMessage}`)
            }
          }
        } catch (error: unknown) {
          // T12: distinguish a normal unload abort from a real stream failure.
          if (controller.signal.aborted) return // expected during disposal
          const errorMessage = error instanceof Error ? error.message : String(error)
          console.warn(`[ecc] event subscription failed (hooks still registered): ${errorMessage}`)
        }
      })()
    }
    }

    // T10: if any registration after the guard was taken throws, dispose the
    // registrations already made and release the directory guard so a later
    // load attempt can succeed instead of being silently skipped forever.
    try {
      await registerDomains()
    } catch (error: unknown) {
      controller.abort()
      registeredDirectories.delete(directory)
      await disposeRegistrations(registrations)
      throw error
    }

    return async () => {
      controller.abort()
      registeredDirectories.delete(directory)
      await disposeRegistrations(registrations)
    }
  },
}

/** Dispose every registration, awaiting promises so no rejection is unhandled. */
async function disposeRegistrations(
  registrations: { dispose?: () => Promise<void> | void }[],
): Promise<void> {
  for (const registration of registrations) {
    try {
      // T13: the dispose result may be a promise; chain a catch so a
      // rejection is never left unhandled, and await it in this loop.
      await Promise.resolve().then(() => registration?.dispose?.())
    } catch {
      // Best-effort dispose.
    }
  }
}

function logStartup(directory: string) {
  // Mirrors the V1 startup line used in server-log triage (TROUBLESHOOTING.md).
  console.info(`[ecc] hooks plugin v${getECCVersion(findEccRootDir(PLUGIN_DIR, ECC_ROOT_PROBES.root))} loaded (directory=${directory})`)
}

export default ECCHooksPluginDefinition
