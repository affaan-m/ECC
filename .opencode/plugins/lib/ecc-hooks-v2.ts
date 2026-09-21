/**
 * ECC Plugin Hooks for OpenCode V2
 *
 * Port of the OpenCode V1 hook surface (`plugins/ecc-hooks.ts`) to the OpenCode 2
 * plugin API. OpenCode 2 intentionally replaced the V1 returned-hook-map
 * entrypoint with `setup(ctx)` plus per-domain hooks, and removed the Bun `$`
 * shell helper from the plugin context. This module registers the same ECC
 * behavior through the V2 context instead.
 *
 * It is loaded lazily from the dual entrypoint in `plugins/ecc-hooks.ts`, so an
 * OpenCode 1 runtime never evaluates this file.
 *
 * Hook mapping (V1 -> V2):
 *   file.edited                      -> ctx.event.subscribe("filesystem.changed")
 *   file.watcher.updated             -> ctx.event.subscribe("filesystem.changed")
 *   tool.execute.before              -> ctx.tool.hook("execute.before")
 *   tool.execute.after               -> ctx.tool.hook("execute.after")
 *   session.created                  -> ctx.event.subscribe("session.created")
 *   session.idle                     -> ctx.event.subscribe("session.idle")
 *   session.deleted                  -> ctx.event.subscribe("session.deleted")
 *   shell.env                        -> ctx.shell.hook("create.before")
 *   experimental.session.compacting  -> ctx.session.hook("compaction")
 *   permission.ask                   -> ctx.permission.hook("evaluate")
 *
 * `todo.updated` has no V2 equivalent in the current OpenCode 2 event surface.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { exec } from "node:child_process"
import type { Plugin } from "@opencode/plugin"
import { initStore, recordChange, clearChanges } from "./changed-files-store.ts"
import { registerV2Tools } from "./v2-tools.ts"

type Context = Plugin.Context

const ECC_VERSION = "2.2.2"

type HookProfile = "minimal" | "standard" | "strict"

interface ShellResult {
  stdout: string
  stderr: string
  failed: boolean
}

interface AnyEvent {
  type: string
  data?: Record<string, unknown>
}

interface ToolHookEvent {
  tool: string
  input: unknown
}

function runShell(command: string, cwd: string): Promise<ShellResult> {
  return new Promise((resolve) => {
    exec(command, { cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", failed: Boolean(error) })
    })
  })
}

/** POSIX-safe single quoting so model/file-supplied paths cannot break out. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function getFilePath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  const record = input as Record<string, unknown>
  const candidate = record.filePath ?? record.file_path ?? record.path
  return typeof candidate === "string" && candidate.trim() ? candidate : null
}

function stringifyArgs(input: unknown): string {
  if (typeof input === "string") return input
  if (input && typeof input === "object") {
    const command = (input as Record<string, unknown>).command
    if (typeof command === "string") return command
    try {
      return JSON.stringify(input)
    } catch {
      return ""
    }
  }
  return String(input ?? "")
}

/**
 * Wire the ECC hook + tool surface into an OpenCode 2 plugin context.
 * Returns a cleanup function that stops the event subscription.
 */
export async function setupV2(ctx: Context): Promise<() => void> {
  const worktreePath = ctx.location.directory || process.cwd()

  const editedFiles = new Set<string>()
  const pendingToolChanges = new Map<string, { path: string; type: "added" | "modified" }>()
  let writeCounter = 0

  const log = (message: string): void => {
    // V2 plugin context exposes no logging API; server logs capture stderr.
    console.error(`[ECC] ${message}`)
  }

  try {
    initStore(worktreePath)
  } catch {
    log("changed-files tracking disabled: could not initialise the changed-files store.")
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

  const profileOrder: Record<HookProfile, number> = { minimal: 0, standard: 1, strict: 2 }

  const hookEnabled = (hookId: string, required: HookProfile | HookProfile[] = "standard"): boolean => {
    if (disabledHooks.has(hookId)) return false
    if (Array.isArray(required)) {
      return required.some((entry) => profileOrder[currentProfile] >= profileOrder[entry])
    }
    return profileOrder[currentProfile] >= profileOrder[required]
  }

  const resolvePath = (p: string): string => (path.isAbsolute(p) ? p : path.join(worktreePath, p))

  /**
   * Post-edit handling for a touched file. OpenCode 2 does not emit
   * `filesystem.changed` for agent-initiated writes, so this is called from the
   * tool hook as well as from the filesystem event, matching the V1
   * `file.edited` behavior.
   */
  const onFileTouched = (file: string): void => {
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) return
    editedFiles.add(file)

    if (hookEnabled("post:edit:format", ["strict"])) {
      void runShell(`prettier --write ${shellQuote(resolvePath(file))} 2>/dev/null`, worktreePath)
    }

    if (hookEnabled("post:edit:console-warn", ["standard", "strict"])) {
      void runShell(`grep -n "console\\.log" ${shellQuote(resolvePath(file))} 2>/dev/null`, worktreePath).then((result) => {
        const lines = result.stdout.trim()
        if (lines) {
          const count = lines.split("\n").length
          log(`console.log found in ${file} (${count} occurrence${count > 1 ? "s" : ""})`)
        }
      })
    }
  }

  const hasProjectFile = (relativePath: string): boolean => {
    try {
      return fs.statSync(resolvePath(relativePath)).isFile()
    } catch {
      return false
    }
  }

  // ── tool.execute.before ──────────────────────────────────────────────────
  await ctx.tool.hook("execute.before", (event) => {
    const { tool, input } = event as unknown as ToolHookEvent

    if (tool === "write") {
      const filePath = getFilePath(input)
      if (filePath) {
        let type: "added" | "modified" = "modified"
        try {
          type = fs.existsSync(resolvePath(filePath)) ? "modified" : "added"
        } catch {
          type = "modified"
        }
        pendingToolChanges.set(`${tool}:${++writeCounter}:${filePath}`, { path: filePath, type })
      }
    }

    if (hookEnabled("pre:bash:git-push-reminder", "strict") && tool === "bash") {
      if (stringifyArgs(input).includes("git push")) {
        log("Remember to review changes before pushing: git diff origin/main...HEAD")
      }
    }

    if (hookEnabled("pre:write:doc-file-warning", ["standard", "strict"]) && tool === "write") {
      const filePath = getFilePath(input)
      if (
        filePath &&
        /\.(md|txt)$/i.test(filePath) &&
        !filePath.includes("README") &&
        !filePath.includes("CHANGELOG") &&
        !filePath.includes("LICENSE") &&
        !filePath.includes("CONTRIBUTING")
      ) {
        log(`Creating ${filePath} - consider if this documentation is necessary`)
      }
    }

    if (hookEnabled("pre:bash:tmux-reminder", "strict") && tool === "bash") {
      const cmd = stringifyArgs(input)
      if (
        /^(npm|pnpm|yarn|bun)\s+(install|build|test|run)/.test(cmd) ||
        /^cargo\s+(build|test|run)/.test(cmd) ||
        /^go\s+(build|test|run)/.test(cmd)
      ) {
        log("Long-running command detected - consider using background execution")
      }
    }
  })

  // ── tool.execute.after ───────────────────────────────────────────────────
  await ctx.tool.hook("execute.after", async (event) => {
    const { tool, input } = event as unknown as ToolHookEvent

    if (tool === "edit" || tool === "write") {
      const filePath = getFilePath(input)
      if (filePath) {
        // V2 does not emit `filesystem.changed` for agent-initiated writes, so
        // track and post-process JS/TS files here as the V1 `file.edited` hook did.
        if (/\.(ts|tsx|js|jsx)$/.test(filePath)) onFileTouched(filePath)

        const pending = [...pendingToolChanges.entries()].find(([, value]) => value.path === filePath)
        if (pending) {
          recordChange(pending[1].path, pending[1].type)
          pendingToolChanges.delete(pending[0])
        } else {
          recordChange(filePath, "modified")
        }
      }
    }

    if (
      hookEnabled("post:edit:typecheck", ["strict"]) &&
      tool === "edit" &&
      getFilePath(input)?.match(/\.tsx?$/)
    ) {
      const result = await runShell("npx tsc --noEmit 2>&1", worktreePath)
      if (result.failed || result.stdout.trim()) {
        log("TypeScript errors detected:")
        result.stdout
          .split("\n")
          .filter(Boolean)
          .slice(0, 5)
          .forEach((line) => log(`  ${line}`))
      } else {
        log("TypeScript check passed")
      }
    }

    if (hookEnabled("post:bash:pr-created", ["standard", "strict"]) && tool === "bash") {
      if (stringifyArgs(input).includes("gh pr create")) {
        log("PR created - check GitHub Actions status")
      }
    }
  })

  // ── shell.env ────────────────────────────────────────────────────────────
  await ctx.shell.hook("create.before", (event) => {
    const env: Record<string, string> = {
      ECC_VERSION,
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
    for (const [lockfile, manager] of Object.entries(lockfiles)) {
      if (hasProjectFile(lockfile)) {
        env.PACKAGE_MANAGER = manager
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

    event.env = { ...event.env, ...env }
  })

  // ── session compaction ───────────────────────────────────────────────────
  await ctx.session.hook("compaction", (event) => {
    const block = [
      `# ECC Context (preserve across compaction)`,
      "",
      `## Active Plugin: ECC v${ECC_VERSION}`,
      "- Hooks: filesystem.changed, tool.execute.before/after, session.created/idle/deleted, shell.env, compaction, permission.evaluate",
      "- Tools: run-tests, check-coverage, security-audit, format-code, lint-check, git-summary, changed-files, dependency-analyzer",
      "",
      "## Key Principles",
      "- TDD: write tests first, 80%+ coverage",
      "- Immutability: never mutate, always return new copies",
      "- Security: validate inputs, no hardcoded secrets",
      "",
      "Focus on preserving: 1) Current task status and progress, 2) Key decisions made, 3) Files created/modified, 4) Remaining work items, 5) Any security concerns flagged. Discard: verbose tool outputs, intermediate exploration, redundant file listings.",
    ]

    if (editedFiles.size > 0) {
      block.push("", "## Recently Edited Files")
      for (const file of editedFiles) block.push(`- ${file}`)
    }

    event.system.push({ type: "text", text: block.join("\n") } as never)
  })

  // ── permission evaluation ────────────────────────────────────────────────
  await ctx.permission.hook("evaluate", (event) => {
    const action = event.action
    const command = event.resources.join(" ")

    if (["read", "glob", "grep", "search", "list"].includes(action)) {
      event.effect = "allow"
      event.message = "ECC: read-only operation"
      return
    }
    if (action === "shell" && /^(npx )?(@biomejs\/biome|prettier|black|gofmt|rustfmt|swift-format)/.test(command)) {
      event.effect = "allow"
      event.message = "ECC: formatter execution"
      return
    }
    if (action === "shell" && /^(npm test|npx vitest|npx jest|pytest|go test|cargo test)/.test(command)) {
      event.effect = "allow"
      event.message = "ECC: test execution"
    }
  })

  // ── custom tools ─────────────────────────────────────────────────────────
  const registeredTools = await registerV2Tools(ctx, worktreePath)
  log(`Session started - profile=${currentProfile} (OpenCode 2, ${registeredTools.length} tools)`)

  if (hasProjectFile("CLAUDE.md")) {
    log("Found CLAUDE.md - loading project context")
  }

  // ── events (filesystem + session lifecycle) ──────────────────────────────
  const controller = new AbortController()

  const handleFilesystemChanged = (data: Record<string, unknown>): void => {
    const file = typeof data.file === "string" ? data.file : null
    if (!file) return

    const rawEvent = typeof data.event === "string" ? data.event : "change"
    const changeType = rawEvent === "add" ? "added" : rawEvent === "unlink" ? "deleted" : "modified"
    recordChange(file, changeType)

    if (changeType !== "deleted") {
      onFileTouched(file)
    }
  }

  const handleSessionIdle = async (): Promise<void> => {
    if (!hookEnabled("stop:check-console-log", ["minimal", "standard", "strict"])) return
    if (editedFiles.size === 0) return

    let total = 0
    const filesWithLogs: string[] = []
    for (const file of editedFiles) {
      if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue
      const result = await runShell(`grep -c "console\\.log" ${shellQuote(resolvePath(file))} 2>/dev/null`, worktreePath)
      const count = parseInt(result.stdout.trim(), 10)
      if (Number.isFinite(count) && count > 0) {
        total += count
        filesWithLogs.push(file)
      }
    }

    if (total > 0) {
      log(`Audit: ${total} console.log statement(s) in ${filesWithLogs.length} file(s)`)
      filesWithLogs.forEach((file) => log(`  - ${file}`))
      log("Remove console.log statements before committing")
    } else {
      log("Audit passed: No console.log statements found")
    }

    try {
      if (process.platform === "darwin") {
        await runShell(`osascript -e 'display notification "Task completed!" with title "OpenCode ECC"' 2>/dev/null`, worktreePath)
      } else if (process.platform === "win32") {
        await runShell(
          `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Task completed!', 'OpenCode ECC', 'OK', 'Information')"`,
          worktreePath
        )
      } else if (process.platform === "linux") {
        await runShell(`notify-send "OpenCode ECC" "Task completed!" 2>/dev/null`, worktreePath)
      }
    } catch {
      // Notification support is best-effort.
    }

    editedFiles.clear()
  }

  void (async () => {
    try {
      for await (const raw of ctx.event.subscribe({ signal: controller.signal })) {
        const event = raw as unknown as AnyEvent
        const data = (event.data ?? {}) as Record<string, unknown>

        if (event.type === "filesystem.changed") {
          handleFilesystemChanged(data)
        } else if (event.type === "session.created") {
          if (hookEnabled("session:start", ["minimal", "standard", "strict"])) {
            log(`Session started - profile=${currentProfile}`)
          }
        } else if (event.type === "session.idle") {
          void handleSessionIdle()
        } else if (event.type === "session.deleted") {
          if (hookEnabled("session:end-marker", ["minimal", "standard", "strict"])) {
            log("Session ended - cleaning up")
          }
          editedFiles.clear()
          clearChanges()
          pendingToolChanges.clear()
        }
      }
    } catch {
      // The subscription aborts during plugin unload; no action needed.
    }
  })()

  return () => controller.abort()
}
