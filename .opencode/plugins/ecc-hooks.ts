/**
 * ECC Plugin Hooks for OpenCode
 *
 * This plugin translates Claude Code hooks to OpenCode's plugin system.
 * OpenCode's plugin system is MORE sophisticated than Claude Code with 20+ events
 * compared to Claude Code's 3 phases (PreToolUse, PostToolUse, Stop).
 *
 * Hook Event Mapping:
 * - PreToolUse → tool.execute.before
 * - PostToolUse → tool.execute.after
 * - Stop → session.idle / session.status
 * - SessionStart → session.created
 * - SessionEnd → session.deleted
 */

import type { PluginInput } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import changedFilesTool from "../tools/changed-files.ts"
import dependencyAnalyzerTool from "../tools/dependency-analyzer.ts"

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
  if (typeof __dirname === "string" && __dirname) return __dirname
  return path.dirname(fileURLToPath(import.meta.url))
}

const PLUGIN_DIR = resolvePluginDir()

/**
 * Type definitions for better type safety
 */
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

interface FileEvent {
  path: string
  type?: string
}

interface TodoEvent {
  todos: Array<{ text: string; done: boolean }>
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

type ECCHooksPluginFn = (input: PluginInput) => Promise<Record<string, unknown>>

export const ECCHooksPlugin: ECCHooksPluginFn = async ({
  client,
  $,
  directory,
  worktree,
}: PluginInput) => {
  type HookProfile = "minimal" | "standard" | "strict"

  const worktreePath = worktree || directory

  const editedFiles = new Set<string>()

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

  const pendingToolChanges = new Map<string, { path: string; type: "added" | "modified" }>()
  let writeCounter = 0

  function getFilePath(args: ToolArgs | undefined): string | null {
    if (!args) return null
    const p = (args.filePath ?? args.file_path ?? args.path) as string | undefined
    return typeof p === "string" && p.trim() ? p : null
  }

  // Helper to call the SDK's log API with correct signature
  const log = (level: "debug" | "info" | "warn" | "error", message: string) =>
    client.app.log({ body: { service: "ecc", level, message } })

  // Loaded lazily (instead of via a top-level import) so that a missing or
  // partially-installed `~/.opencode/plugins/lib` directory (e.g. an
  // interrupted or partial ECC install on Termux/Android) only disables
  // changed-files tracking, rather than throwing during module evaluation.
  // This plugin is OpenCode's startup entry point, so a static import
  // failure here previously crashed the whole plugin -- and with it, the
  // entire OpenCode session -- before any hooks could load (see #2530).
  let changedFilesStore: typeof import("./lib/changed-files-store.ts") | undefined
  try {
    const store = await import("./lib/changed-files-store.ts")
    store.initStore(worktreePath)
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
            "Run `ecc repair --target opencode` to restore the missing files. Other ECC hooks are unaffected."
        )
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
  // Loaded lazily, for the same reason as the store above: this file is
  // OpenCode's startup entry point, and a static import of a missing module
  // crashes the plugin -- and with it the whole session -- before any hook can
  // run (#2530). A runtime file URL also keeps tsc from resolving a relative
  // specifier that exists in no compiled layout.
  type SkillRunTrackerModule = { run?: (payload: unknown) => void }
  let recordSkillRun: ((payload: unknown) => void) | undefined
  // Detection is scoped to the tracker itself, so a modular install that omits
  // optional content still gets telemetry.
  const trackerRoot = findEccRootDir(PLUGIN_DIR, ECC_ROOT_PROBES.skillTracker)
  // The root advertised to commands is a different question: those commands
  // require the resolver, so a root without it would break them again.
  const eccRoot =
    findEccRootDir(PLUGIN_DIR, ECC_ROOT_PROBES.resolver) ?? findEccRootDir(PLUGIN_DIR, ECC_ROOT_PROBES.root)
  try {
    const trackerPath = trackerRoot
      ? path.join(trackerRoot, "scripts", "hooks", "skill-run-tracker.js")
      : null
    if (!trackerPath || !fs.existsSync(trackerPath)) {
      throw new Error("skill-run-tracker.js not found")
    }
    // CJS module loaded from ESM: run() is on the namespace in Node/Bun, but a
    // transpiled default export must stay supported.
    const loaded = (await import(pathToFileURL(trackerPath).href)) as SkillRunTrackerModule & {
      default?: SkillRunTrackerModule
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
            "Run `ecc repair --target opencode` to restore the missing files. Other ECC hooks are unaffected."
        )
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
      .filter(Boolean)
  )

  const profileOrder: Record<HookProfile, number> = {
    minimal: 0,
    standard: 1,
    strict: 2,
  }

  const profileAllowed = (required: HookProfile | HookProfile[]): boolean => {
    if (Array.isArray(required)) {
      return required.some((entry) => profileOrder[currentProfile] >= profileOrder[entry])
    }
    return profileOrder[currentProfile] >= profileOrder[required]
  }

  const hookEnabled = (
    hookId: string,
    requiredProfile: HookProfile | HookProfile[] = "standard"
  ): boolean => {
    if (disabledHooks.has(hookId)) return false
    return profileAllowed(requiredProfile)
  }

  return {
    /**
     * Prettier Auto-Format Hook
     * Equivalent to Claude Code PostToolUse hook for prettier
     *
     * Triggers: After any JS/TS/JSX/TSX file is edited
     * Action: Runs prettier --write on the file
     */
    "file.edited": async (event: { path: string }) => {
      editedFiles.add(event.path)
      changedFilesStore?.recordChange(event.path, "modified")

      // Auto-format JS/TS files
      if (hookEnabled("post:edit:format", ["strict"]) && event.path.match(/\.(ts|tsx|js|jsx)$/)) {
        try {
          await $`prettier --write ${event.path} 2>/dev/null`
          log("info", `[ECC] Formatted: ${event.path}`)
        } catch (error: unknown) {
          // Prettier not installed or failed - log but continue
          const errorMessage = error instanceof Error ? error.message : String(error)
          log("debug", `[ECC] Prettier formatting failed for ${event.path}: ${errorMessage}`)
        }
      }

      // Console.log warning check
      if (hookEnabled("post:edit:console-warn", ["standard", "strict"]) && event.path.match(/\.(ts|tsx|js|jsx)$/)) {
        try {
          const result = await $`grep -n "console\\.log" ${event.path} 2>/dev/null`.text()
          if (result.trim()) {
            const lines = result.trim().split("\n").length
            log(
              "warn",
              `[ECC] console.log found in ${event.path} (${lines} occurrence${lines > 1 ? "s" : ""})`
            )
          }
        } catch {
          // No console.log found (grep returns non-zero) - this is good
        }
      }
    },

    /**
     * TypeScript Check Hook
     * Equivalent to Claude Code PostToolUse hook for tsc
     *
     * Triggers: After edit tool completes on .ts/.tsx files
     * Action: Runs tsc --noEmit to check for type errors
     */
    "tool.execute.after": async (
      input: ToolInput,
      output: unknown
    ) => {
      const filePath = getFilePath(input.args)
      if (input.tool === "edit" && filePath) {
        changedFilesStore?.recordChange(filePath, "modified")
      }
      if (input.tool === "write" && filePath) {
        const key = input.callID ?? `write-${++writeCounter}-${filePath}`
        const pending = pendingToolChanges.get(key)
        if (pending) {
          changedFilesStore?.recordChange(pending.path, pending.type)
          pendingToolChanges.delete(key)
        } else {
          changedFilesStore?.recordChange(filePath, "modified")
        }
      }

      // Check if a TypeScript file was edited
      if (
        hookEnabled("post:edit:typecheck", ["strict"]) &&
        input.tool === "edit" &&
        input.args?.filePath?.match(/\.tsx?$/)
      ) {
        try {
          await $`npx tsc --noEmit 2>&1`
          log("info", "[ECC] TypeScript check passed")
        } catch (error: unknown) {
          const err = error as { stdout?: string }
          log("warn", "[ECC] TypeScript errors detected:")
          if (err.stdout) {
            // Log first few errors
            const errors = err.stdout.split("\n").slice(0, 5)
            errors.forEach((line: string) => log("warn", `  ${line}`))
          }
        }
      }

      // PR creation logging
      if (
        hookEnabled("post:bash:pr-created", ["standard", "strict"]) &&
        input.tool === "bash" &&
        input.args?.toString().includes("gh pr create")
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
    },

    /**
     * Pre-Tool Security Check
     * Equivalent to Claude Code PreToolUse hook
     *
     * Triggers: Before tool execution
     * Action: Warns about potential security issues
     */
    "tool.execute.before": async (
      input: ToolInput
    ) => {
      if (input.tool === "write") {
        const filePath = getFilePath(input.args)
        if (filePath) {
          const absPath = resolvePath(filePath)
          let type: "added" | "modified" = "modified"
          try {
            if (typeof fs.existsSync === "function") {
              type = fs.existsSync(absPath) ? "modified" : "added"
            }
          } catch {
            type = "modified"
          }
          const key = input.callID ?? `write-${++writeCounter}-${filePath}`
          pendingToolChanges.set(key, { path: filePath, type })
        }
      }

      // Git push review reminder
      if (
        hookEnabled("pre:bash:git-push-reminder", "strict") &&
        input.tool === "bash" &&
        input.args?.toString().includes("git push")
      ) {
        log(
          "info",
          "[ECC] Remember to review changes before pushing: git diff origin/main...HEAD"
        )
      }

      // Block creation of unnecessary documentation files
      if (
        hookEnabled("pre:write:doc-file-warning", ["standard", "strict"]) &&
        input.tool === "write" &&
        input.args?.filePath &&
        typeof input.args.filePath === "string"
      ) {
        const filePath = input.args.filePath
        if (
          filePath.match(/\.(md|txt)$/i) &&
          !filePath.includes("README") &&
          !filePath.includes("CHANGELOG") &&
          !filePath.includes("LICENSE") &&
          !filePath.includes("CONTRIBUTING")
        ) {
          log(
            "warn",
            `[ECC] Creating ${filePath} - consider if this documentation is necessary`
          )
        }
      }

      // Long-running command reminder
      if (hookEnabled("pre:bash:tmux-reminder", "strict") && input.tool === "bash") {
        const cmd = String(input.args?.command || input.args || "")
        if (
          cmd.match(/^(npm|pnpm|yarn|bun)\s+(install|build|test|run)/) ||
          cmd.match(/^cargo\s+(build|test|run)/) ||
          cmd.match(/^go\s+(build|test|run)/)
        ) {
          log(
            "info",
            "[ECC] Long-running command detected - consider using background execution"
          )
        }
      }
    },

    /**
     * Session Created Hook
     * Equivalent to Claude Code SessionStart hook
     *
     * Triggers: When a new session starts
     * Action: Loads context and displays welcome message
     */
    "session.created": async () => {
      if (!hookEnabled("session:start", ["minimal", "standard", "strict"])) return

      log("info", `[ECC] Session started - profile=${currentProfile}`)

      // Check for project-specific context files
      if (hasProjectFile("CLAUDE.md")) {
        log("info", "[ECC] Found CLAUDE.md - loading project context")
      }
    },

    /**
     * Session Idle Hook
     * Equivalent to Claude Code Stop hook
     *
     * Triggers: When session becomes idle (task completed)
     * Action: Runs console.log audit on all edited files
     */
    "session.idle": async () => {
      if (!hookEnabled("stop:check-console-log", ["minimal", "standard", "strict"])) return
      if (editedFiles.size === 0) return

      log("info", "[ECC] Session idle - running console.log audit")

      let totalConsoleLogCount = 0
      const filesWithConsoleLogs: string[] = []

      for (const file of editedFiles) {
        if (!file.match(/\.(ts|tsx|js|jsx)$/)) continue

        try {
          const result = await $`grep -c "console\\.log" ${file} 2>/dev/null`.text()
          const count = parseInt(result.trim(), 10)
          if (count > 0) {
            totalConsoleLogCount += count
            filesWithConsoleLogs.push(file)
          }
        } catch {
          // No console.log found
        }
      }

      if (totalConsoleLogCount > 0) {
        log(
          "warn",
          `[ECC] Audit: ${totalConsoleLogCount} console.log statement(s) in ${filesWithConsoleLogs.length} file(s)`
        )
        filesWithConsoleLogs.forEach((f) =>
          log("warn", `  - ${f}`)
        )
        log("warn", "[ECC] Remove console.log statements before committing")
      } else {
        log("info", "[ECC] Audit passed: No console.log statements found")
      }

      // Desktop notification (cross-platform)
      try {
        if (process.platform === "darwin") {
          // macOS
          await $`osascript -e 'display notification "Task completed!" with title "OpenCode ECC"' 2>/dev/null`
        } else if (process.platform === "win32") {
          // Windows - PowerShell notification
          await $`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Task completed!', 'OpenCode ECC', 'OK', 'Information')" 2>/dev/null`
        } else if (process.platform === "linux") {
          // Linux - notify-send (requires libnotify)
          await $`notify-send "OpenCode ECC" "Task completed!" 2>/dev/null`
        }
      } catch (error: unknown) {
        // Notification not supported or failed - log but continue
        const errorMessage = error instanceof Error ? error.message : String(error)
        log("debug", `[ECC] Desktop notification failed: ${errorMessage}`)
      }

      // Clear tracked files for next task
      editedFiles.clear()
    },

    /**
     * Session Deleted Hook
     * Equivalent to Claude Code SessionEnd hook
     *
     * Triggers: When session ends
     * Action: Final cleanup and state saving
     */
    "session.deleted": async () => {
      if (!hookEnabled("session:end-marker", ["minimal", "standard", "strict"])) return
      log("info", "[ECC] Session ended - cleaning up")
      editedFiles.clear()
      changedFilesStore?.clearChanges()
      pendingToolChanges.clear()
    },

    /**
     * File Watcher Hook
     * OpenCode-only feature
     *
     * Triggers: When file system changes are detected
     * Action: Updates tracking
     */
    "file.watcher.updated": async (event: { path: string; type: string }) => {
      let changeType: "added" | "modified" | "deleted" = "modified"
      if (event.type === "create" || event.type === "add") changeType = "added"
      else if (event.type === "delete" || event.type === "remove") changeType = "deleted"
      changedFilesStore?.recordChange(event.path, changeType)
      if (event.type === "change" && event.path.match(/\.(ts|tsx|js|jsx)$/)) {
        editedFiles.add(event.path)
      }
    },

    /**
     * Todo Updated Hook
     * OpenCode-only feature
     *
     * Triggers: When todo list is updated
     * Action: Logs progress
     */
    "todo.updated": async (event: { todos: Array<{ text: string; done: boolean }> }) => {
      const completed = event.todos.filter((t) => t.done).length
      const total = event.todos.length
      if (total > 0) {
        log("info", `[ECC] Progress: ${completed}/${total} tasks completed`)
      }
    },

    /**
     * Shell Environment Hook
     * OpenCode-specific: Inject environment variables into shell commands
     *
     * Triggers: Before shell command execution
     * Action: Sets PROJECT_ROOT, PACKAGE_MANAGER, DETECTED_LANGUAGES, ECC_VERSION
     */
    "shell.env": async (_input: { cwd: string }, output: { env: Record<string, string> }) => {
      const env: Record<string, string> = {
        ECC_VERSION: getECCVersion(eccRoot),
        ECC_PLUGIN: "true",
        ECC_HOOK_PROFILE: currentProfile,
        ECC_DISABLED_HOOKS: process.env.ECC_DISABLED_HOOKS || "",
        PROJECT_ROOT: worktreePath,
      }

      // Detect package manager
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
        (process.env.CLAUDE_PLUGIN_ROOT || "").trim() ||
          (output.env?.CLAUDE_PLUGIN_ROOT || "").trim()
      )
      if (eccRoot && !rootAlreadySet) {
        env.CLAUDE_PLUGIN_ROOT = eccRoot
      }

      // OpenCode reads the supplied output object and ignores callback return values.
      output.env = { ...output.env, ...env }
    },

    /**
     * Session Compacting Hook
     * OpenCode-specific: Control context compaction behavior
     *
     * Triggers: Before context compaction
     * Action: Push ECC context block and compaction guidance
     */
    "experimental.session.compacting": async (
      _input: { sessionID: string },
      output: { context: string[]; prompt?: string }
    ) => {
      const contextBlock = [
        "# ECC Context (preserve across compaction)",
        "",
        "## Active Plugin: ECC v2.2.3",
        "- Hooks: file.edited, tool.execute.before/after, session.created/idle/deleted, shell.env, compacting, permission.ask",
        "- Tools: run-tests, check-coverage, security-audit, format-code, lint-check, git-summary, changed-files",
        "- Agents: 13 specialized (planner, architect, tdd-guide, code-reviewer, security-reviewer, build-error-resolver, e2e-runner, refactor-cleaner, doc-updater, go-reviewer, go-build-resolver, database-reviewer, python-reviewer)",
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

      const eccContext = [
        contextBlock.join("\n"),
        "Focus on preserving: 1) Current task status and progress, 2) Key decisions made, 3) Files created/modified, 4) Remaining work items, 5) Any security concerns flagged. Discard: verbose tool outputs, intermediate exploration, redundant file listings.",
      ]

      // OpenCode requires output assignment and skips context when a prompt is set.
      if (output.prompt !== undefined) {
        output.prompt = [output.prompt, ...eccContext].join("\n\n")
      } else {
        output.context = [...output.context, ...eccContext]
      }
    },

    /**
     * Permission Auto-Approve Hook
     * OpenCode-specific: Auto-approve safe operations
     *
     * Triggers: When permission is requested
     * Action: Auto-approve reads, formatters, and test commands; log all for audit
     */
    "permission.ask": async (event: PermissionEvent) => {
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

        // Auto-approve: read/search tools
        if (["read", "glob", "grep", "search", "list"].includes(event.tool)) {
          log("debug", `[ECC] Auto-approved read-only tool: ${event.tool}`)
          return { approved: true, reason: "Read-only operation" }
        }

        // Auto-approve: formatters
        if (event.tool === "bash" && /^(npx )?(@biomejs\/biome|prettier|black|gofmt|rustfmt|swift-format)/.test(cmd)) {
          log("debug", `[ECC] Auto-approved formatter: ${cmd}`)
          return { approved: true, reason: "Formatter execution" }
        }

        // Auto-approve: test execution
        if (event.tool === "bash" && /^(npm test|npx vitest|npx jest|pytest|go test|cargo test)/.test(cmd)) {
          log("debug", `[ECC] Auto-approved test execution: ${cmd}`)
          return { approved: true, reason: "Test execution" }
        }

        // Everything else: let user decide
        log("debug", `[ECC] Permission requires user approval: ${event.tool}`)
        return { approved: undefined }
      } catch (error: unknown) {
        // Error in permission handling - log and deny for safety
        const errorMessage = error instanceof Error ? error.message : String(error)
        log("error", `[ECC] Permission handling error for ${event.tool}: ${errorMessage}`)
        return { approved: false, reason: `Error: ${errorMessage}` }
      }
    },

    tool: {
      "changed-files": changedFilesTool,
      "dependency-analyzer": dependencyAnalyzerTool,
    },
  }
}

export default ECCHooksPlugin
