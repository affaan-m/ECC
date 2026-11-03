/**
 * ECC Plugin Hooks for OpenCode (V2 plugin API)
 *
 * Migrated from the OpenCode V1 plugin format for OpenCode 2.x.
 * V1 plugins default-exported an async function that returned a map of
 * string-keyed hooks; V2 requires a default-exported definition object with
 * an `id` and a `setup(ctx)` function, and hooks are registered on their
 * owning domain instead of being returned by key.
 *
 * Hook Event Mapping (V1 -> V2):
 * - tool.execute.before        -> ctx.tool.hook("execute.before")
 * - tool.execute.after         -> ctx.tool.hook("execute.after")
 * - file.edited / session.* /  -> ctx.event.subscribe() filtered by type
 *   todo.updated / watcher
 * - shell.env                  -> ctx.shell.hook("create.before")
 * - experimental.session.compacting -> ctx.session.hook("compaction")
 * - permission.ask             -> ctx.permission.hook("evaluate")
 * - tool map                   -> ctx.tool.transform(editor => editor.add)
 *
 * The Bun `$` shell helper is not part of the V2 context, so every command
 * here runs through `child_process.spawn` instead, and the console.log audit
 * uses `fs` + regex rather than `grep` so it works on Windows too.
 */

import * as fs from "fs"
import * as path from "path"
import { spawn } from "child_process"
import { fileURLToPath, pathToFileURL } from "url"

/**
 * Directory of this module. See the note in the V1 file: `import.meta.url` is
 * the ESM source of truth; `__dirname` is kept first only for CJS consumers.
 */
function resolvePluginDir(): string {
  if (typeof __dirname === "string" && __dirname) return __dirname
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

/**
 * Artifacts that identify an ECC root, one per capability this plugin needs.
 * Each probe is the exact artifact the caller is about to use, so detection is
 * layout detection rather than an authenticity control.
 */
const ECC_ROOT_PROBES = {
  // scripts/lib/utils.js is the shared library every scripts/ module requires.
  root: [path.join("scripts", "lib", "utils.js")],
  // What the skill-run telemetry hook imports at runtime.
  skillTracker: [path.join("scripts", "hooks", "skill-run-tracker.js")],
  // What the resolver embedded in commands requires once they read
  // CLAUDE_PLUGIN_ROOT, and the version lookup for the shell env hook.
  resolver: [path.join("scripts", "lib", "resolve-ecc-root.js")],
} as const

/**
 * Walk upwards from `startDir` looking for an ancestor that contains every
 * relative path in `probes`. The plugin ships in three layouts -
 * `<root>/plugins` (installed), `<root>/dist/plugins` (compiled) and
 * `<repo>/.opencode/plugins` (repo checkout) - so the walk is bounded to
 * 5 levels. Returns null when no ancestor qualifies.
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

/** Read the ECC version from package.json, trying the plausible root layouts. */
function getECCVersion(eccRootDir?: string | null): string {
  const candidates = [eccRootDir, path.resolve(PLUGIN_DIR, ".."), path.resolve(PLUGIN_DIR, "..", "..")]
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

/** Run a command, resolving with its output regardless of exit code. */
function run(
  command: string,
  args: string[],
  options: { cwd?: string; detached?: boolean } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // npx/npm are .cmd shims on Windows: resolve them through the shell.
    const useShell = process.platform === "win32" && /^(npx|npm|pnpm|yarn|bun)(\.cmd)?$/i.test(command)
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: useShell,
      detached: options.detached === true,
      stdio: options.detached === true ? "ignore" : ["ignore", "pipe", "pipe"],
    })
    if (options.detached === true) {
      child.unref()
      resolve({ code: 0, stdout: "", stderr: "" })
      return
    }
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)))
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)))
    child.on("error", reject)
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
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
// distinct-id stub, but we keep a per-directory guard so the hook set is
// registered only once per process *and* per project directory even if a
// future layout double-instantiates this module.
const GUARD_KEY = Symbol.for("ecc.hooks.registered-directories")
const registeredDirectories: Set<string> =
  ((globalThis as any)[GUARD_KEY] as Set<string> | undefined) ??
  ((globalThis as any)[GUARD_KEY] = new Set<string>())

type HookProfile = "minimal" | "standard" | "strict"

export const ECCHooksPluginDefinition = {
  id: "ecc-hooks",
  async setup(ctx: any): Promise<() => void> {
    const directory: string = ctx?.location?.directory ?? process.cwd()
    const worktreePath: string = directory

    if (registeredDirectories.has(worktreePath)) {
      return () => {}
    }
    registeredDirectories.add(worktreePath)

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
      const p = args.filePath ?? args.file_path ?? args.path
      return typeof p === "string" && p.trim() ? p : null
    }

    // V2 plugins have no client.app.log; console output is captured into the
    // server log, which is where the old ECC messages ended up anyway.
    const log = (level: "debug" | "info" | "warn" | "error", message: string) => {
      try {
        const line = `[ecc] ${message}`
        if (level === "error") console.error(line)
        else if (level === "warn") console.warn(line)
        else if (level === "debug") console.debug(line)
        else console.log(line)
      } catch {
        // Logging must never break a hook.
      }
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

    const hookEnabled = (hookId: string, requiredProfile: HookProfile | HookProfile[] = "standard"): boolean => {
      if (disabledHooks.has(hookId)) return false
      return profileAllowed(requiredProfile)
    }

    // ECC root detection (see ECC_ROOT_PROBES rationale above).
    const trackerRoot = findEccRootDir(PLUGIN_DIR, ECC_ROOT_PROBES.skillTracker)
    const eccRoot = findEccRootDir(PLUGIN_DIR, ECC_ROOT_PROBES.resolver) ?? findEccRootDir(PLUGIN_DIR, ECC_ROOT_PROBES.root)
    const eccVersion = getECCVersion(eccRoot)

    // Lazy imports so a partial install disables one capability instead of
    // crashing the plugin (and previously the session) at load time (#2530).
    let changedFilesStore:
      | {
          initStore?: (dir: string) => void
          recordChange?: (p: string, t: string) => void
          clearChanges?: () => void
          buildTree?: (f?: string) => unknown[]
          getChangedPaths?: (f?: string) => { path: string; changeType: string }[]
          hasChanges?: () => boolean
        }
      | undefined
    try {
      const store = (await import(pathToFileURL(path.join(PLUGIN_DIR, "lib", "changed-files-store.ts")).href)) as any
      store.initStore?.(worktreePath)
      changedFilesStore = store
    } catch {
      log(
        "warn",
        "[ECC] changed-files tracking disabled: could not load the changed-files store. " +
          "Run `ecc repair --target opencode` to restore the missing files. Other ECC hooks are unaffected.",
      )
    }

    let recordSkillRun: ((payload: unknown) => void) | undefined
    try {
      const trackerPath = trackerRoot ? path.join(trackerRoot, "scripts", "hooks", "skill-run-tracker.js") : null
      if (!trackerPath || !fs.existsSync(trackerPath)) {
        throw new Error("skill-run-tracker.js not found")
      }
      // CJS module loaded from ESM: run() is on the namespace in Node/Bun, but
      // a transpiled default export must stay supported.
      const loaded = (await import(pathToFileURL(trackerPath).href)) as { run?: (p: unknown) => void; default?: { run?: (p: unknown) => void } }
      const entry = typeof loaded.run === "function" ? loaded : loaded.default
      if (!entry || typeof entry.run !== "function") {
        throw new Error("skill-run-tracker.js exposes no run()")
      }
      recordSkillRun = entry.run
    } catch {
      log(
        "warn",
        "[ECC] skill-run telemetry disabled: could not load scripts/hooks/skill-run-tracker.js. " +
          "Run `ecc repair --target opencode` to restore the missing files. Other ECC hooks are unaffected.",
      )
    }

    // ------------------------------------------------------------------
    // Hook implementations (bodies preserved from the V1 plugin)
    // ------------------------------------------------------------------

    /** Prettier auto-format + console.log warning + change tracking. */
    const onFileEdited = async (filePath: string) => {
      try {
        editedFiles.add(filePath)
        changedFilesStore?.recordChange?.(filePath, "modified")

        if (hookEnabled("post:edit:format", ["strict"]) && /\.(ts|tsx|js|jsx)$/.test(filePath)) {
          try {
            await run("npx", ["prettier", "--write", filePath], { cwd: worktreePath })
            log("info", `[ECC] Formatted: ${filePath}`)
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            log("debug", `[ECC] Prettier formatting failed for ${filePath}: ${errorMessage}`)
          }
        }

        if (hookEnabled("post:edit:console-warn", ["standard", "strict"]) && /\.(ts|tsx|js|jsx)$/.test(filePath)) {
          const count = await countConsoleLogs(filePath).catch(() => 0)
          if (count > 0) {
            log("warn", `[ECC] console.log found in ${filePath} (${count} occurrence${count > 1 ? "s" : ""})`)
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log("debug", `[ECC] file.edited hook failed: ${errorMessage}`)
      }
    }

    /** Pre-tool: change bookkeeping, git-push/tmux reminders, doc-file warning. */
    const onToolBefore = async (event: LooseRecord) => {
      try {
        const toolName: string = event.tool ?? event.name ?? ""
        const args = (event.input ?? event.args) as ToolArgs | undefined
        const callId: string | undefined = event.callID ?? event.id

        if (toolName === "write") {
          const filePath = getFilePath(args)
          if (filePath) {
            const absPath = resolvePath(filePath)
            let type: "added" | "modified" = "modified"
            try {
              type = fs.existsSync(absPath) ? "modified" : "added"
            } catch {
              type = "modified"
            }
            const key = callId ?? `write-${++writeCounter}-${filePath}`
            pendingToolChanges.set(key, { path: filePath, type })
          }
        }

        // Git push review reminder
        if (hookEnabled("pre:bash:git-push-reminder", "strict") && toolName === "bash") {
          const cmd = String(args?.command ?? args ?? "")
          if (cmd.includes("git push")) {
            log("info", "[ECC] Remember to review changes before pushing: git diff origin/main...HEAD")
          }
        }

        // Block creation of unnecessary documentation files
        if (hookEnabled("pre:write:doc-file-warning", ["standard", "strict"]) && toolName === "write") {
          const filePath = getFilePath(args)
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
        if (hookEnabled("pre:bash:tmux-reminder", "strict") && toolName === "bash") {
          const cmd = String(args?.command ?? args ?? "")
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

    /** Post-tool: change recording, typecheck, PR log, skill telemetry. */
    const onToolAfter = async (event: LooseRecord) => {
      try {
        const toolName: string = event.tool ?? event.name ?? ""
        const args = (event.input ?? event.args) as ToolArgs | undefined
        const callId: string | undefined = event.callID ?? event.id

        const filePath = getFilePath(args)
        if (toolName === "edit" && filePath) {
          changedFilesStore?.recordChange?.(filePath, "modified")
        }
        if (toolName === "write" && filePath) {
          const key = callId ?? `write-${++writeCounter}-${filePath}`
          const pending = pendingToolChanges.get(key)
          if (pending) {
            changedFilesStore?.recordChange?.(pending.path, pending.type)
            pendingToolChanges.delete(key)
          } else {
            changedFilesStore?.recordChange?.(filePath, "modified")
          }
        }

        // TypeScript check (strict profile only - it shells out to tsc).
        if (
          hookEnabled("post:edit:typecheck", ["strict"]) &&
          toolName === "edit" &&
          typeof args?.filePath === "string" &&
          /\.tsx?$/.test(args.filePath)
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
          toolName === "bash" &&
          String(args?.command ?? args ?? "").includes("gh pr create")
        ) {
          log("info", "[ECC] PR created - check GitHub Actions status")
        }

        // Skill telemetry (#2463): OpenCode's tool is named `skill`.
        if (
          hookEnabled("post:skill:track", ["standard", "strict"]) &&
          typeof toolName === "string" &&
          toolName.trim().toLowerCase() === "skill"
        ) {
          try {
            recordSkillRun?.({
              tool_name: "Skill",
              tool_input: args ?? {},
              tool_response: event.result ?? event.output,
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

    /** Session idle: console.log audit on edited files + desktop notification. */
    const onSessionIdle = async () => {
      if (!hookEnabled("stop:check-console-log", ["minimal", "standard", "strict"])) return
      if (editedFiles.size === 0) return

      log("info", "[ECC] Session idle - running console.log audit")

      let totalConsoleLogCount = 0
      const filesWithConsoleLogs: string[] = []

      for (const file of editedFiles) {
        if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue
        const count = await countConsoleLogs(file).catch(() => 0)
        if (count > 0) {
          totalConsoleLogCount += count
          filesWithConsoleLogs.push(file)
        }
      }

      if (totalConsoleLogCount > 0) {
        log("warn", `[ECC] Audit: ${totalConsoleLogCount} console.log statement(s) in ${filesWithConsoleLogs.length} file(s)`)
        filesWithConsoleLogs.forEach((f) => log("warn", `  - ${f}`))
        log("warn", "[ECC] Remove console.log statements before committing")
      } else {
        log("info", "[ECC] Audit passed: No console.log statements found")
      }

      // Desktop notification, best effort and never blocking: the V1 Windows
      // path opened a modal MessageBox on the server; that was replaced with
      // a fire-and-forget balloon tip.
      try {
        if (process.platform === "darwin") {
          await run("osascript", ["-e", 'display notification "Task completed!" with title "OpenCode ECC"'], { detached: true }).catch(() => {})
        } else if (process.platform === "win32") {
          const ps =
            "$ni = New-Object System.Windows.Forms.NotifyIcon; $ni.Icon = [System.Drawing.SystemIcons]::Information; " +
            "$ni.Visible = $true; $ni.ShowBalloonTip('OpenCode ECC', 'Task completed!', 'Info'); " +
            "Start-Sleep -Seconds 5; $ni.Dispose()"
          await run("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", `Add-Type -AssemblyName System.Windows.Forms; ${ps}`], {
            detached: true,
          }).catch(() => {})
        } else if (process.platform === "linux") {
          await run("notify-send", ["OpenCode ECC", "Task completed!"], { detached: true }).catch(() => {})
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log("debug", `[ECC] Desktop notification failed: ${errorMessage}`)
      }

      editedFiles.clear()
    }

    /** Inject ECC environment variables into shell commands. */
    let cachedEnv: Record<string, string> | undefined
    function computeEccEnv(): Record<string, string> {
      if (cachedEnv) return cachedEnv
      const env: Record<string, string> = {
        ECC_VERSION: eccVersion,
        ECC_PLUGIN: "true",
        ECC_HOOK_PROFILE: currentProfile,
        ECC_DISABLED_HOOKS: process.env.ECC_DISABLED_HOOKS || "",
        PROJECT_ROOT: worktreePath,
      }

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

      const langDetectors: Record<string, string> = {
        "tsconfig.json": "typescript",
        "go.mod": "go",
        "pyproject.toml": "python",
        "Cargo.toml": "rust",
        "Package.swift": "swift",
      }
      const detected: string[] = []
      for (const [file, lang] of Object.entries(langDetectors)) {
        if (hasProjectFile(file)) detected.push(lang)
      }
      if (detected.length > 0) {
        env.DETECTED_LANGUAGES = detected.join(",")
        env.PRIMARY_LANGUAGE = detected[0]
      }

      // Commands embed resolve-ecc-root.js, which reads CLAUDE_PLUGIN_ROOT
      // first; exporting the root here fixes them without editing command files.
      // Never replace a root someone else already chose.
      if (eccRoot && !(process.env.CLAUDE_PLUGIN_ROOT || "").trim()) {
        env.CLAUDE_PLUGIN_ROOT = eccRoot
      }

      cachedEnv = env
      return env
    }

    /** ECC context block preserved through compaction. */
    function buildCompactionContext(): string {
      const contextBlock = [
        "# ECC Context (preserve across compaction)",
        "",
        `## Active Plugin: ECC v${eccVersion}`,
        "- Hooks: file.edited, tool.execute.before/after, session.created/idle/deleted, shell env, compaction, permission",
        "- Tools: changed-files, dependency-analyzer",
        "",
        "## Key Principles",
        "- TDD: write tests first, 80%+ coverage",
        "- Immutability: never mutate, always return new copies",
        "- Security: validate inputs, no hardcoded secrets",
        "",
      ]

      if (editedFiles.size > 0) {
        contextBlock.push("## Recently Edited Files")
        for (const f of editedFiles) contextBlock.push(`- ${f}`)
        contextBlock.push("")
      }

      contextBlock.push(
        "Focus on preserving: 1) Current task status and progress, 2) Key decisions made, 3) Files created/modified, 4) Remaining work items, 5) Any security concerns flagged. Discard: verbose tool outputs, intermediate exploration, redundant file listings.",
      )
      return contextBlock.join("\n")
    }

    /** Auto-approve safe operations on top of the configured rules. */
    const READ_ONLY_ACTIONS = ["read", "glob", "grep", "search", "list"]
    const FORMATTER_RE = /^(npx )?(@biomejs\/biome|prettier|black|gofmt|rustfmt|swift-format)/
    const TEST_RE = /^(npm test|npx vitest|npx jest|pytest|go test|cargo test)/

    const onPermissionEvaluate = async (event: LooseRecord) => {
      try {
        const action: string = String(event.action ?? "")
        const resource: string = String(event.resources?.[0] ?? "")
        log("debug", `[ECC] Permission evaluated: ${action} ${resource}`)

        if (READ_ONLY_ACTIONS.includes(action)) {
          event.effect = "allow"
          event.message = "ECC: read-only operation"
          return
        }
        if ((action === "bash" || action === "shell" || action === "execute") && (FORMATTER_RE.test(resource) || TEST_RE.test(resource))) {
          event.effect = "allow"
          event.message = "ECC: formatter/test execution"
          return
        }
        // Everything else: leave the configured decision in place.
      } catch (error: unknown) {
        // On error, keep the configured behavior rather than denying outright.
        const errorMessage = error instanceof Error ? error.message : String(error)
        log("error", `[ECC] Permission handling error: ${errorMessage}`)
      }
    }

    // ------------------------------------------------------------------
    // Registration on the V2 domains (each guarded so a missing domain in an
    // older 2.x runtime downgrades to "capability off", not "plugin crash").
    // ------------------------------------------------------------------

    const registrations: { dispose?: () => Promise<void> | void }[] = []

    if (typeof ctx?.tool?.hook === "function") {
      registrations.push(await ctx.tool.hook("execute.before", onToolBefore))
      registrations.push(await ctx.tool.hook("execute.after", onToolAfter))
    }

    if (typeof ctx?.shell?.hook === "function") {
      registrations.push(
        await ctx.shell.hook("create.before", (event: LooseRecord) => {
          try {
            const eccEnv = computeEccEnv()
            event.env = { ...(event.env ?? {}) }
            for (const [key, value] of Object.entries(eccEnv)) {
              // Never replace values set by the user or an earlier plugin.
              if (event.env[key] === undefined || event.env[key] === "") event.env[key] = value
            }
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            log("debug", `[ECC] shell env hook failed: ${errorMessage}`)
          }
        }),
      )
    }

    if (typeof ctx?.session?.hook === "function") {
      registrations.push(
        await ctx.session.hook("compaction", (event: LooseRecord) => {
          try {
            event.system = event.system ?? []
            event.system.push({ type: "text", text: buildCompactionContext() })
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            log("debug", `[ECC] compaction hook failed: ${errorMessage}`)
          }
        }),
      )
    }

    if (typeof ctx?.permission?.hook === "function") {
      registrations.push(await ctx.permission.hook("evaluate", onPermissionEvaluate))
    }

    // Custom tools: registered through a transform, resolving the V1 tool
    // modules lazily inside execute so a broken tools/ install only affects
    // these two tools when actually invoked.
    const toolModuleCache = new Map<string, Promise<any>>()
    async function loadV1Tool(name: string): Promise<{ execute: (args: any, context: any) => Promise<string> }> {
      let p = toolModuleCache.get(name)
      if (!p) {
        p = import(pathToFileURL(path.resolve(PLUGIN_DIR, "..", "tools", `${name}.ts`)).href)
          .then((mod: any) => (typeof mod?.default === "function" ? { execute: mod.default } : mod.default))
          .catch((error: unknown) => {
            toolModuleCache.delete(name)
            throw new Error(
              `${name} tool: could not load ECC tool module. Run \`ecc repair --target opencode\` to restore the missing files. (${
                error instanceof Error ? error.message : String(error)
              })`,
            )
          })
        toolModuleCache.set(name, p)
      }
      return p
    }

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
              const mod = await loadV1Tool("changed-files")
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
              const mod = await loadV1Tool("dependency-analyzer")
              const result = await mod.execute(input ?? {}, context ?? { directory: worktreePath, worktree: worktreePath })
              return { content: String(result) }
            },
          })
        }),
      )
    }

    // Event-driven hooks: V1 returned keyed handlers; V2 delivers these as
    // public server events on a subscription stream.
    const controller = new AbortController()
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
                  if (typeof p === "string") await onFileEdited(p)
                  break
                }
                case "file.watcher.updated": {
                  const p = props.file ?? props.path
                  if (typeof p !== "string") break
                  const changeType = props.type
                  let mapped: "added" | "modified" | "deleted" = "modified"
                  if (changeType === "create" || changeType === "add") mapped = "added"
                  else if (changeType === "delete" || changeType === "remove") mapped = "deleted"
                  changedFilesStore?.recordChange?.(p, mapped)
                  if (changeType === "change" && /\.(ts|tsx|js|jsx)$/.test(p)) editedFiles.add(p)
                  break
                }
                case "session.created": {
                  if (!hookEnabled("session:start", ["minimal", "standard", "strict"])) break
                  log("info", `[ECC] Session started - profile=${currentProfile}`)
                  if (hasProjectFile("CLAUDE.md")) log("info", "[ECC] Found CLAUDE.md - loading project context")
                  break
                }
                case "session.idle": {
                  await onSessionIdle()
                  break
                }
                case "session.deleted": {
                  if (!hookEnabled("session:end-marker", ["minimal", "standard", "strict"])) break
                  log("info", "[ECC] Session ended - cleaning up")
                  editedFiles.clear()
                  changedFilesStore?.clearChanges?.()
                  pendingToolChanges.clear()
                  break
                }
                case "todo.updated": {
                  const todos: { done: boolean }[] = Array.isArray(props.todos) ? props.todos : []
                  if (todos.length > 0) {
                    const completed = todos.filter((t) => t.done).length
                    log("info", `[ECC] Progress: ${completed}/${todos.length} tasks completed`)
                  }
                  break
                }
                default:
                  break
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error)
              log("debug", `[ECC] event ${type} handler failed: ${errorMessage}`)
            }
          }
        } catch {
          // Subscription aborted during unload - expected.
        }
      })()
    }

    log("info", `[ECC] hooks plugin v${eccVersion} loaded (profile=${currentProfile}, directory=${worktreePath})`)

    return () => {
      controller.abort()
      registeredDirectories.delete(worktreePath)
      for (const registration of registrations) {
        try {
          void registration?.dispose?.()
        } catch {
          // Best-effort dispose.
        }
      }
    }
  },
}

export default ECCHooksPluginDefinition
