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
 *   (V2 tool id `shell` is matched as V1 `bash`)
 * - file.edited                -> completed write/edit in execute.after
 *                                 (V2 publishes no file.edited event)
 * - file.watcher / session.* / todo.updated
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

import * as path from "path"
import { fileURLToPath } from "url"

import { createEccRuntime } from "./lib/ecc-runtime.ts"
import { ECC_ROOT_PROBES, findEccRootDir, getECCVersion, loadToolModule } from "./lib/ecc-runtime-support.ts"
import type { LooseRecord, ToolArgs, ToolInput } from "./lib/ecc-runtime-support.ts"

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
  const runtime = await createEccRuntime(input, PLUGIN_DIR)
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

    const runtime = await createEccRuntime({ directory, worktree: directory }, PLUGIN_DIR)
    const { hooks, worktreePath } = runtime

    // Normalize a V2 tool-hook event into the V1 ToolInput shape so both
    // surfaces share one implementation. OpenCode 2 renamed the V1 `bash`
    // tool to `shell` and passes `{ path }` to `write`/`edit`, so map both
    // back to the V1 names the shared runtime matches on.
    const toToolInput = (event: LooseRecord): ToolInput => {
      const rawTool = String(event.tool ?? event.name ?? "")
      const tool = rawTool === "shell" ? "bash" : rawTool
      let args = (event.input ?? event.args) as ToolArgs | undefined
      if (
        (tool === "write" || tool === "edit") &&
        args && typeof args === "object" &&
        typeof args.filePath !== "string" && typeof args.path === "string"
      ) {
        args = { ...args, filePath: args.path }
      }
      return { tool, callID: event.callID ?? event.id, args }
    }

    // OpenCode 2's public event stream has no `file.edited`, so V1's
    // post-edit hook (formatter, console.log warning, idle audit input) is
    // driven from the completed write/edit tool call instead.
    const editedPath = (input: ToolInput): string | null => {
      if (input.tool !== "write" && input.tool !== "edit") return null
      const p = input.args?.filePath ?? input.args?.path
      return typeof p === "string" && p.trim() ? p : null
    }

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
        await ctx.tool.hook("execute.after", safe("execute.after", async (event: LooseRecord) => {
          const input = toToolInput(event)
          // R2-1: hand the shared handler the tool output object directly. The
          // skill tracker reads error fields (isError/is_error/status/error) off
          // `tool_response` itself; a `{ result: … }` wrapper made failed skill
          // runs look like successes.
          await hooks["tool.execute.after"](input, event.status === "error"
            ? { is_error: true }
            : event.result ?? event.output)
          const edited = event.status === "error" ? null : editedPath(input)
          if (edited) await hooks["file.edited"]({ path: edited })
        })),
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
              const mod = await loadToolModule("changed-files", PLUGIN_DIR)
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
              const mod = await loadToolModule("dependency-analyzer", PLUGIN_DIR)
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
  console.info(`[ecc] hooks plugin v${getECCVersion(findEccRootDir(PLUGIN_DIR, ECC_ROOT_PROBES.root), PLUGIN_DIR)} loaded (directory=${directory})`)
}

export default ECCHooksPluginDefinition
