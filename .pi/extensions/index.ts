/**
 * ECC adapter for the Pi coding agent.
 *
 * This is the ONLY adapter logic ECC ships for Pi. ECC's canonical assets stay
 * the single source of truth: `skills/` and `commands/` are mounted directly by
 * the `pi` manifest in the repo's root `package.json`. Nothing is copied or
 * generated under `.pi/`.
 *
 * What this file adapts:
 *   - Pi lifecycle events -> ECC's existing hook runner (`run-with-flags.js`),
 *     so ECC hook profiles and disable flags keep working under Pi.
 *   - ECC's SessionStart `additionalContext` payload -> Pi's system prompt.
 *   - A `/ecc-doctor` command for install diagnostics.
 *
 * Design constraints (see .pi/README.md):
 *   - Hooks resolve relative to THIS file, never `process.cwd()`, so a global
 *     `pi install` works from any project directory.
 *   - Hooks execute via `execFile(process.execPath, [...])` with no shell, so
 *     paths containing spaces or shell metacharacters are safe.
 *   - Hook failures are isolated: a broken, missing, or slow hook degrades to a
 *     warning and never terminates the Pi session.
 */

import { execFile } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

/**
 * Minimal structural types mirroring `@earendil-works/pi-coding-agent`.
 *
 * Declared locally on purpose: Pi loads extensions through jiti, which strips
 * types without type-checking, so importing the package would add a dependency
 * and a lockfile entry that buy nothing at runtime. Field names and signatures
 * match the upstream `ExtensionAPI` / `ExtensionContext` declarations; install
 * the package as a devDependency if you want editor-level checking.
 */
interface PiUiContext {
  notify(message: string, type?: "info" | "warning" | "error"): void
}

interface PiSessionManager {
  getSessionId(): string
  getSessionFile(): string | undefined
}

interface ExtensionContext {
  ui: PiUiContext
  cwd: string
  sessionManager: PiSessionManager
}

interface SessionStartEvent {
  reason: "startup" | "reload" | "new" | "resume" | "fork"
}

interface SessionShutdownEvent {
  reason: "quit" | "reload" | "new" | "resume" | "fork"
}

interface BeforeAgentStartEvent {
  systemPrompt: string
}

interface BeforeAgentStartResult {
  systemPrompt?: string
}

interface ExtensionAPI {
  on(
    event: "session_start",
    handler: (event: SessionStartEvent, ctx: ExtensionContext) => Promise<void> | void
  ): void
  on(
    event: "session_shutdown",
    handler: (event: SessionShutdownEvent, ctx: ExtensionContext) => Promise<void> | void
  ): void
  on(
    event: "before_agent_start",
    handler: (
      event: BeforeAgentStartEvent,
      ctx: ExtensionContext
    ) => Promise<BeforeAgentStartResult | void> | BeforeAgentStartResult | void
  ): void
  registerCommand(
    name: string,
    options: {
      description?: string
      handler: (args: string, ctx: ExtensionContext) => Promise<void>
    }
  ): void
  sendMessage(
    message: { customType: string; content: string; display: boolean; details?: unknown },
    options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
  ): void
}

/**
 * ECC package root. This file lives at `<root>/.pi/extensions/index.ts`, so the
 * root is two levels up. Pi loads extensions via jiti in CommonJS mode, which
 * is why `__dirname` is the correct primitive here rather than
 * `import.meta.url` (verified against Pi 0.84.1).
 */
const ECC_ROOT = path.resolve(__dirname, "..", "..")

/** ECC's universal hook runner. It applies hook-profile and disable flags. */
const HOOK_RUNNER = path.join(ECC_ROOT, "scripts", "hooks", "run-with-flags.js")

const HOOK_TIMEOUT_MS = 30_000
const MAX_HOOK_OUTPUT_BYTES = 1024 * 1024

/**
 * Optional Pi companion packages. ECC works without every one of these; they
 * are reported by `/ecc-doctor` so users can see which extras are available.
 */
const COMPANION_PACKAGES = [
  "pi-subagents",
  "@juicesharp/rpiv-ask-user-question",
  "@juicesharp/rpiv-todo",
] as const

interface HookSpec {
  /** ECC hook id, used for profile gating and disable flags. */
  id: string
  /** Hook script path relative to the ECC package root. */
  script: string
  /** Hook profiles the hook participates in. */
  profiles: string
}

/** Mirrors the SessionStart wiring in `hooks/hooks.json`. */
const SESSION_START_HOOK: HookSpec = {
  id: "session:start",
  script: "scripts/hooks/session-start.js",
  profiles: "minimal,standard,strict",
}

/** Mirrors the SessionEnd wiring in `hooks/hooks.json`. */
const SESSION_END_HOOK: HookSpec = {
  id: "session:end:marker",
  script: "scripts/hooks/session-end-marker.js",
  profiles: "minimal,standard,strict",
}

interface HookResult {
  stdout: string
  failure?: string
}

/**
 * Run an ECC hook through ECC's own runner.
 *
 * Never rejects: a missing runner, a non-zero exit, a timeout, or a spawn error
 * all resolve to a `failure` string that the caller surfaces as a warning.
 */
function runEccHook(
  spec: HookSpec,
  payload: unknown,
  env: NodeJS.ProcessEnv,
  cwd: string
): Promise<HookResult> {
  return new Promise(resolve => {
    if (!fs.existsSync(HOOK_RUNNER)) {
      resolve({ stdout: "", failure: `hook runner not found at ${HOOK_RUNNER}` })
      return
    }

    const child = execFile(
      process.execPath,
      [HOOK_RUNNER, spec.id, spec.script, spec.profiles],
      {
        // Hooks inspect the user's project, so they run there. Only the script
        // path is package-relative, and the runner resolves that from
        // CLAUDE_PLUGIN_ROOT rather than from the working directory.
        cwd,
        env,
        timeout: HOOK_TIMEOUT_MS,
        maxBuffer: MAX_HOOK_OUTPUT_BYTES,
        encoding: "utf8",
      },
      (error, stdout) => {
        const text = typeof stdout === "string" ? stdout : ""
        if (error) {
          resolve({ stdout: text, failure: `${spec.id}: ${error.message}` })
          return
        }
        resolve({ stdout: text })
      }
    )

    child.on("error", error => {
      resolve({ stdout: "", failure: `${spec.id}: ${error.message}` })
    })

    // stdin.end() writes asynchronously. A hook that exits, short-circuits, or
    // is killed by the timeout before reading the payload makes the write fail
    // with EPIPE, which Node reports as an `error` event rather than a throw.
    // Without this listener that event is unhandled and would take the Pi
    // session down, breaking the isolation guarantee documented above.
    child.stdin?.on("error", error => {
      resolve({ stdout: "", failure: `${spec.id}: could not write hook payload (${error.message})` })
    })

    try {
      child.stdin?.end(JSON.stringify(payload))
    } catch (error) {
      resolve({
        stdout: "",
        failure: `${spec.id}: could not write hook payload (${(error as Error).message})`,
      })
    }
  })
}

/**
 * Working directory for hook execution: the user's project. Falls back to the
 * ECC package root if Pi reports a directory that no longer exists, so a stale
 * cwd degrades to a working hook rather than a spawn failure.
 */
function resolveHookCwd(ctx: ExtensionContext): string {
  try {
    if (ctx.cwd && fs.existsSync(ctx.cwd)) {
      return ctx.cwd
    }
  } catch {
    // Fall through to the package root.
  }
  return ECC_ROOT
}

function readSessionId(ctx: ExtensionContext): string | undefined {
  try {
    return ctx.sessionManager.getSessionId() || undefined
  } catch {
    return undefined
  }
}

/**
 * Build the environment ECC hooks expect.
 *
 * `CLAUDE_PLUGIN_ROOT` / `ECC_PLUGIN_ROOT` are how every ECC hook locates the
 * package; setting them from `ECC_ROOT` is what makes a global install resolve
 * correctly instead of probing the user's project. The `CLAUDE_*` session vars
 * are the names ECC's shared hook scripts already read across harnesses.
 */
function buildHookEnv(ctx: ExtensionContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: ECC_ROOT,
    ECC_PLUGIN_ROOT: ECC_ROOT,
    CLAUDE_PROJECT_DIR: ctx.cwd,
  }

  const sessionId = readSessionId(ctx)
  if (sessionId) {
    env.CLAUDE_SESSION_ID = sessionId
  }

  return env
}

/**
 * Map Pi's session reason onto the `source` values ECC's SessionStart hook
 * understands. Pi's `new` and `reload` have no Claude Code equivalent, so they
 * report as a fresh startup.
 */
function mapSessionSource(reason: SessionStartEvent["reason"]): string {
  switch (reason) {
    case "resume":
    case "fork":
      return "resume"
    default:
      return "startup"
  }
}

/**
 * Extract `hookSpecificOutput.additionalContext` from a hook's stdout.
 *
 * ECC hooks emit a JSON envelope, but the runner passes stdin straight through
 * when a hook is disabled by profile, so non-JSON stdout is expected and must
 * not be treated as an error.
 */
function extractAdditionalContext(stdout: string): string | undefined {
  const trimmed = stdout.trim()
  if (!trimmed.startsWith("{")) {
    return undefined
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      hookSpecificOutput?: { additionalContext?: unknown }
    }
    const context = parsed.hookSpecificOutput?.additionalContext
    return typeof context === "string" && context.trim() ? context : undefined
  } catch {
    return undefined
  }
}

/**
 * Pi's config directory, honoring the documented `PI_CODING_AGENT_DIR` override.
 */
function resolvePiConfigDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR
  if (override && override.trim()) {
    return override.trim()
  }
  return path.join(os.homedir(), ".pi", "agent")
}

/**
 * Package names Pi currently has installed, read from the same `packages`
 * lists Pi itself uses: the user config directory plus the project-local
 * `.pi/settings.json`.
 *
 * `require.resolve` cannot answer this. Pi installs packages under its own
 * config directory (`<config>/npm`, `<config>/git`), which is not on Node's
 * module resolution path from this file, so resolving would report every
 * companion as missing no matter what the user has installed.
 */
function listInstalledPiPackages(projectDir: string): Set<string> {
  const names = new Set<string>()

  const settingsFiles = [
    path.join(resolvePiConfigDir(), "settings.json"),
    path.join(projectDir, ".pi", "settings.json"),
  ]

  for (const file of settingsFiles) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { packages?: unknown }
      if (!Array.isArray(parsed.packages)) {
        continue
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
  }

  return names
}

/**
 * Reduce a `packages` entry to a bare package name.
 *
 * Entries look like `npm:pi-subagents`, `npm:@scope/name@1.2.3`, a git source,
 * or a filesystem path. Only npm sources carry a comparable package name.
 */
function normalizePiPackageName(entry: unknown): string | undefined {
  if (typeof entry !== "string" || !entry.startsWith("npm:")) {
    return undefined
  }

  const spec = entry.slice("npm:".length)
  // Strip a trailing @version without breaking the leading @ of a scoped name.
  const versionAt = spec.lastIndexOf("@")
  return versionAt > 0 ? spec.slice(0, versionAt) : spec
}

function countDirectories(dir: string): number {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).length
  } catch {
    return 0
  }
}

function countMarkdownFiles(dir: string): number {
  try {
    return fs.readdirSync(dir).filter(name => name.endsWith(".md")).length
  } catch {
    return 0
  }
}

function readEccVersion(): string {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(ECC_ROOT, "package.json"), "utf8")) as {
      version?: string
    }
    return manifest.version || "unknown"
  } catch {
    return "unknown"
  }
}

function buildDoctorReport(ctx: ExtensionContext): string {
  const skillsDir = path.join(ECC_ROOT, "skills")
  const commandsDir = path.join(ECC_ROOT, "commands")
  const skillCount = countDirectories(skillsDir)
  const commandCount = countMarkdownFiles(commandsDir)

  const lines = [
    "ECC adapter for Pi",
    "",
    `  ECC version:   ${readEccVersion()}`,
    `  Package root:  ${ECC_ROOT}`,
    `  Project cwd:   ${ctx.cwd}`,
    "",
    "Canonical resources",
    `  skills/        ${skillCount > 0 ? `${skillCount} skill(s)` : "NOT FOUND"} (${skillsDir})`,
    `  commands/      ${commandCount > 0 ? `${commandCount} command(s)` : "NOT FOUND"} (${commandsDir})`,
    "",
    "Hook runner",
    `  ${fs.existsSync(HOOK_RUNNER) ? "found" : "NOT FOUND"} (${HOOK_RUNNER})`,
    `  profile:       ${process.env.ECC_HOOK_PROFILE || "standard (default)"}`,
    `  disabled:      ${process.env.ECC_DISABLED_HOOKS || "none"}`,
    "",
    "Optional companion packages (from Pi's installed package list)",
  ]

  const installed = listInstalledPiPackages(ctx.cwd)
  for (const name of COMPANION_PACKAGES) {
    const present = installed.has(name)
    lines.push(`  ${present ? "installed    " : "not installed"}  ${name}`)
    if (!present) {
      lines.push(`      install with: pi install npm:${name}`)
    }
  }

  lines.push(
    "",
    "Companion packages are optional; ECC skills, commands, and session hooks",
    "work without them. See .pi/README.md for what each one unlocks.",
    "Detection reads Pi's `packages` list, so a companion vendored some other",
    "way may work while reporting as not installed."
  )

  return lines.join("\n")
}

export default function (pi: ExtensionAPI): void {
  /**
   * ECC's SessionStart hook returns context for the model, but Pi has no
   * equivalent of Claude Code's `additionalContext` field. It is held here and
   * folded into the system prompt on the next agent start, which is the
   * documented Pi injection point that does not fabricate a user turn.
   */
  let pendingContext: string | undefined

  pi.on("session_start", async (event, ctx) => {
    const payload = {
      hook_event_name: "SessionStart",
      source: mapSessionSource(event.reason),
      cwd: ctx.cwd,
      session_id: readSessionId(ctx),
    }

    // Drop any context captured by an earlier session start that has not been
    // injected yet. Pi can start a new session (/new, /resume, /fork) before
    // `before_agent_start` consumes the previous value, and replaying context
    // built for a different session would describe the wrong project state.
    pendingContext = undefined

    const result = await runEccHook(
      SESSION_START_HOOK,
      payload,
      buildHookEnv(ctx),
      resolveHookCwd(ctx)
    )

    if (result.failure) {
      ctx.ui.notify(`ECC session-start hook skipped (${result.failure})`, "warning")
      return
    }

    pendingContext = extractAdditionalContext(result.stdout)
  })

  pi.on("before_agent_start", event => {
    if (!pendingContext) {
      return
    }

    const context = pendingContext
    pendingContext = undefined

    return {
      systemPrompt: `${event.systemPrompt}\n\n<ecc-session-context>\n${context}\n</ecc-session-context>`,
    }
  })

  pi.on("session_shutdown", async (event, ctx) => {
    const payload = {
      hook_event_name: "SessionEnd",
      reason: event.reason,
      cwd: ctx.cwd,
      session_id: readSessionId(ctx),
    }

    const result = await runEccHook(
      SESSION_END_HOOK,
      payload,
      buildHookEnv(ctx),
      resolveHookCwd(ctx)
    )

    if (result.failure) {
      ctx.ui.notify(`ECC session-end hook skipped (${result.failure})`, "warning")
    }
  })

  pi.registerCommand("ecc-doctor", {
    description: "Report ECC adapter status: package root, canonical resources, hooks, companions",
    handler: async (_args, ctx) => {
      pi.sendMessage(
        {
          customType: "ecc-doctor",
          content: buildDoctorReport(ctx),
          display: true,
        },
        { deliverAs: "nextTurn" }
      )
    },
  })
}
