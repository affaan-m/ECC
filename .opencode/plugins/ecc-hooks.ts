/**
 * ECC OpenCode hooks — v2 adapter.
 *
 * ## Active Plugin: ECC v2.2.3
 *
 * (The banner above is the version marker scripts/release.sh rewrites; it must
 * stay in this file, which is the plugin entry point the installer ships.)
 *
 * ECC 2.2.3 ships its hook runtime against the OpenCode v1 plugin contract:
 *   ctx = { client, $, directory, worktree, project }
 *   the default-exported function RETURNS a hooks object keyed by names such as
 *   "tool.execute.before", "file.edited", "session.idle", "permission.ask".
 *
 * OpenCode 2.0.32 requires a default-exported definition { id, setup(ctx) } and
 * exposes hooks through registration functions on the ctx namespaces instead.
 * (`effect` also satisfies the schema but is the internal Effect-TS path — a
 * plain async function there never settles and wedges location activation. Do
 * not move this file back to `effect`.)
 *
 * This adapter keeps ECC's audited hook logic untouched (it lives at
 * ../ecc-v1/plugins/ecc-hooks.ts, outside the auto-discovered plugins dir) and
 * translates the two contracts:
 *
 *   v1 ctx            -> built here from ctx.location / a Bun shell / a file log
 *   v1 hook return    -> registered on the matching v2 hook point
 *
 * Verified firing on 2.0.32 (probe log, /tmp/opencode/port-lab):
 *   ctx.tool.hook("execute.before", h)   h({tool, sessionID, agent, id, input})
 *   ctx.tool.hook("execute.after",  h)   h({...that, status, result})
 *   ctx.session.hook("context",     h)   h({sessionID, model, system[]})
 *
 * MAPPED (behaviour preserved):
 *   tool.execute.before  -> tool.hook("execute.before")
 *   tool.execute.after   -> tool.hook("execute.after")
 *   file.edited          -> derived from execute.after on write/edit/patch
 *   session.created      -> session.hook("context")
 *
 * NOT MAPPED (no verified v2 hook point on 2.0.32; the notice below says so):
 *   session.idle, session.deleted, file.watcher.updated, todo.updated,
 *   shell.env, permission.ask, experimental.session.compacting
 *
 * Also not mapped: ECC's custom tools (changed-files, dependency-analyzer).
 * ctx.tool.transform((t) => t.add(...)) does register them (they appear in
 * t.list()), but the model cannot call them: every call returns
 * "No tool named ... is currently available". Registration without exposure is
 * worse than none, so nothing is registered.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const LOG_PATH = path.join(os.homedir(), ".cache", "opencode", "ecc-hooks.log")
const NOTICE_PATH = path.join(os.homedir(), ".cache", "opencode", "ecc-plugin-v1-on-opencode-v2.txt")

type Level = "debug" | "info" | "warn" | "error"

function writeLine(level: Level, message: string): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${level} ${message}\n`)
  } catch {
    // Logging must never break a hook.
  }
}

function noticeOnce(text: string): void {
  try {
    fs.mkdirSync(path.dirname(NOTICE_PATH), { recursive: true })
    fs.writeFileSync(NOTICE_PATH, `${text} ${new Date().toISOString()}\n`)
  } catch {
    // Never let a notice break plugin loading.
  }
}

/**
 * Minimal stand-in for Bun's `$` tagged template, which the v1 hooks use for
 * prettier/grep/tsc/notify calls. Prefers the real Bun shell when present.
 * Mirrors the two behaviours the hooks depend on: `.text()` returns stdout, and
 * a non-zero exit throws with `stdout` attached.
 */
function makeShell(cwd: string) {
  const bun = (globalThis as { Bun?: { $?: unknown } }).Bun
  if (bun && typeof bun.$ === "function") return bun.$ as (strings: TemplateStringsArray, ...values: unknown[]) => any

  return (strings: TemplateStringsArray, ...values: unknown[]) => {
    const command = strings.reduce(
      (acc, chunk, i) => acc + chunk + (i < values.length ? String(values[i]) : ""),
      ""
    )
    const run = () => {
      const { spawnSync } = require("node:child_process") as typeof import("node:child_process")
      const result = spawnSync("/bin/sh", ["-c", command], { cwd, encoding: "utf8" })
      const stdout = result.stdout ?? ""
      if (result.status !== 0) {
        const error = new Error(`Command failed (exit ${result.status}): ${command}`) as Error & {
          stdout?: string
        }
        error.stdout = stdout
        throw error
      }
      return stdout
    }
    const stdout = run()
    return {
      text: async () => stdout,
      then: (onFulfilled?: (value: string) => unknown) =>
        Promise.resolve(stdout).then(onFulfilled) as Promise<unknown>,
      catch: (onRejected?: (reason: unknown) => unknown) => Promise.resolve(stdout).catch(onRejected),
    }
  }
}

/** v2 tool names -> the v1 names ECC's hooks switch on. */
const TOOL_ALIASES: Record<string, string> = {
  shell: "bash",
  patch: "edit",
}

/** Tools whose completion implies a file was edited, mapped to the v2 arg field. */
function editedPathFrom(tool: string, args: Record<string, unknown> | undefined): string | null {
  if (tool !== "write" && tool !== "edit" && tool !== "patch") return null
  const candidate = args?.path ?? args?.filePath ?? args?.file_path
  return typeof candidate === "string" && candidate.trim() ? candidate : null
}

export default {
  id: "ecc-hooks",
  setup: async (ctx: any) => {
    const directory: string = ctx?.location?.directory ?? process.cwd()

    // The v1 hooks read `args.filePath` directly in a couple of places while v2
    // passes `path`, so both keys are provided.
    const toV1Input = (arg: any) => {
      const args = { ...(arg?.input ?? {}) }
      const filePath = args.path ?? args.filePath ?? args.file_path
      if (typeof filePath === "string") args.filePath = filePath
      return {
        tool: TOOL_ALIASES[arg?.tool] ?? arg?.tool,
        args,
        callID: arg?.id,
        sessionID: arg?.sessionID,
      }
    }

    let hooks: Record<string, (...a: any[]) => any> = {}
    try {
      const mod = await import("../plugins-v1/ecc-hooks.ts")
      hooks = await mod.ECCHooksPlugin({
        client: { app: { log: ({ body }: any) => writeLine(body?.level ?? "info", String(body?.message ?? "")) } },
        $: makeShell(directory),
        directory,
        worktree: directory,
        project: ctx?.location?.project,
      })
    } catch (error) {
      writeLine("error", `[ECC] v1 hook runtime failed to initialise: ${String(error)}`)
      noticeOnce("ECC hooks are NOT running: the v1 runtime failed to initialise on this OpenCode build.")
      return
    }

    const mapped: string[] = []
    const skipped: string[] = []

    if (typeof hooks["tool.execute.before"] === "function") {
      const handler = hooks["tool.execute.before"]
      ctx.tool.hook("execute.before", async (arg: any) => {
        try {
          await handler(toV1Input(arg))
        } catch (error) {
          writeLine("error", `[ECC] tool.execute.before failed: ${String(error)}`)
        }
      })
      mapped.push("tool.execute.before")
    }

    if (typeof hooks["tool.execute.after"] === "function") {
      const handler = hooks["tool.execute.after"]
      ctx.tool.hook("execute.after", async (arg: any) => {
        try {
          await handler(toV1Input(arg), arg?.result)
        } catch (error) {
          writeLine("error", `[ECC] tool.execute.after failed: ${String(error)}`)
        }
        // v2 has no file.edited hook, so ECC's edit-side behaviour (prettier,
        // console.log warning, changed-files tracking) is derived from the
        // completion of the tools that edit files.
        const editedPath = editedPathFrom(arg?.tool, arg?.input)
        if (editedPath && typeof hooks["file.edited"] === "function") {
          try {
            await hooks["file.edited"]({ path: editedPath })
          } catch (error) {
            writeLine("error", `[ECC] file.edited failed: ${String(error)}`)
          }
        }
      })
      mapped.push("tool.execute.after", "file.edited (derived)")
    }

    if (typeof hooks["session.created"] === "function") {
      const handler = hooks["session.created"]
      ctx.session.hook("context", async () => {
        try {
          await handler()
        } catch (error) {
          writeLine("error", `[ECC] session.created failed: ${String(error)}`)
        }
      })
      mapped.push("session.created")
    }

    // The event channel. ctx.event.subscribe() is an async iterable, not a
    // callback registration (passing a callback registers nothing and delivers
    // nothing). Two v1 hooks have a verified event equivalent; the payload is
    // `{ sessionID }` for both. The loop runs detached so setup() returns and
    // location activation completes.
    const EVENT_HOOKS: Record<string, string> = {
      "session.execution.succeeded": "session.idle",
      "session.deleted": "session.deleted",
    }
    // Every activated location gets its own adapter instance, and each one
    // receives the whole process-wide event stream, so one event would be
    // handled once per location. A process-global set of event ids keeps each
    // event single-handled.
    const seenEvents: Set<string> = ((globalThis as any).__eccSeenEvents ??= new Set<string>())
    try {
      const stream = ctx.event.subscribe()
      ;(async () => {
        for await (const event of stream) {
          const hookName = EVENT_HOOKS[String(event?.type)]
          if (!hookName || typeof hooks[hookName] !== "function") continue
          const eventId = String(event?.id ?? "")
          if (eventId) {
            if (seenEvents.has(eventId)) continue
            if (seenEvents.size > 5000) seenEvents.clear()
            seenEvents.add(eventId)
          }
          try {
            await hooks[hookName]({ sessionID: event?.data?.sessionID })
          } catch (error) {
            writeLine("error", `[ECC] ${hookName} failed: ${String(error)}`)
          }
        }
      })().catch((error) => writeLine("error", `[ECC] event loop stopped: ${String(error)}`))
      for (const eventName of Object.keys(EVENT_HOOKS)) {
        if (typeof hooks[EVENT_HOOKS[eventName]] === "function") {
          mapped.push(`${EVENT_HOOKS[eventName]} (event ${eventName})`)
        }
      }
    } catch (error) {
      writeLine("error", `[ECC] event subscription failed: ${String(error)}`)
    }

    // shell.env -> ctx.shell.hook("create.before", ...). Verified firing on
    // 2.0.32: the event is { command, cwd, timeout, shell, env } and env is a
    // mutable object, which is exactly what ECC's shell.env hook writes to.
    if (typeof hooks["shell.env"] === "function") {
      const handler = hooks["shell.env"]
      ctx.shell.hook("create.before", async (event: any) => {
        try {
          // ECC's hook replaces `output.env` with a merged object rather than
          // mutating it, so the merge has to be copied back onto the event's
          // own env object for the shell to see it.
          const output: { env: Record<string, string> } = { env: event?.env ?? {} }
          await handler({ cwd: event?.cwd }, output)
          if (event && typeof event.env === "object" && output.env !== event.env) {
            Object.assign(event.env, output.env)
          }
        } catch (error) {
          writeLine("error", `[ECC] shell.env failed: ${String(error)}`)
        }
      })
      mapped.push("shell.env")
    }

    // permission.ask -> ctx.permission.hook("evaluate", ...). Verified firing:
    // the event is { sessionID, agent, action, resources, metadata, source,
    // effect } and effect carries the resolved decision. ECC's hook returns
    // { approved, reason }; an explicit denial is written back as effect:"deny".
    // Anything else is left alone, so this can only tighten, never loosen.
    if (typeof hooks["permission.ask"] === "function") {
      const handler = hooks["permission.ask"]
      ctx.permission.hook("evaluate", async (event: any) => {
        try {
          const decision = await handler({
            tool: event?.action,
            sessionID: event?.sessionID,
            args: { resources: event?.resources },
          })
          if (decision && decision.approved === false && typeof event === "object") {
            event.effect = "deny"
            writeLine("warn", `[ECC] permission denied: ${String(decision.reason ?? "no reason given")}`)
          }
        } catch (error) {
          writeLine("error", `[ECC] permission.ask failed: ${String(error)}`)
        }
      })
      mapped.push("permission.ask")
    }

    // ECC's two custom tools, in the v2 shape: { name, description, input as
    // JSON Schema, execute -> { content } }. The v1 implementations are reused
    // rather than reimplemented.
    try {
      const toolDefs: Array<{
        name: string
        description: string
        input: Record<string, unknown>
        load: () => Promise<any>
      }> = [
        {
          name: "changed-files",
          description:
            "List files changed by agents in this session as a navigable tree. Shows added (+), modified (~), and deleted (-) indicators. Use filter to show only specific change types. Returns paths for git diff.",
          input: {
            type: "object",
            properties: {
              filter: { type: "string", enum: ["all", "added", "modified", "deleted"], description: "Filter by change type (default: all)" },
            },
            additionalProperties: false,
          },
          load: () => import("../tools/changed-files.ts"),
        },
        {
          name: "dependency-analyzer",
          description:
            "Analyze project dependencies for outdated, vulnerable, and unused packages.",
          input: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["all", "outdated", "security", "unused"], description: "Type of analysis to run (default: all)" },
              fix: { type: "boolean", description: "Attempt to fix issues automatically (default: false)" },
            },
            additionalProperties: false,
          },
          load: () => import("../tools/dependency-analyzer.ts"),
        },
      ]

      // Loaded before the synchronous transform callback, per the v2 docs.
      const loaded: Array<{ name: string; description: string; input: Record<string, unknown>; def: any }> = []
      for (const spec of toolDefs) {
        try {
          const mod = await spec.load()
          const def = mod?.default ?? mod
          if (def && typeof def.execute === "function") {
            loaded.push({ name: spec.name, description: spec.description, input: spec.input, def })
          }
        } catch (error) {
          writeLine("warn", `[ECC] tool ${spec.name} unavailable: ${String(error)}`)
        }
      }

      if (loaded.length > 0) {
        await ctx.tool.transform((editor: any) => {
          for (const tool of loaded) {
            editor.add({
              name: tool.name,
              description: tool.description,
              input: tool.input,
              options: { codemode: true },
              execute: async (input: unknown) => {
                const out = await tool.def.execute(input ?? {}, {
                  directory,
                  worktree: directory,
                  sessionID: undefined,
                })
                return { content: typeof out === "string" ? out : JSON.stringify(out) }
              },
            })
          }
        })
        const registered = await ctx.tool.list()
        const ids = registered.map((t: any) => String(t.id))
        for (const tool of loaded) {
          if (ids.some((id) => id.endsWith(tool.name))) mapped.push(`tool:${tool.name}`)
        }
      }
    } catch (error) {
      writeLine("error", `[ECC] custom tools failed to register: ${String(error)}`)
    }

    for (const key of [
      "file.watcher.updated",
      "todo.updated",
      "experimental.session.compacting",
    ]) {
      if (typeof hooks[key] === "function") skipped.push(key)
    }

    writeLine("info", `[ECC] v2 adapter active. mapped=${mapped.join(",")} unmapped=${skipped.join(",")}`)
    noticeOnce(
      `ECC hooks partially active on OpenCode v2 via the setup(ctx) adapter. Mapped: ${mapped.join(", ")}. ` +
        `Not mapped (no verified v2 hook point): ${skipped.join(", ")}.`
    )
  },
}
