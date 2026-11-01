const fs = require("node:fs")
const path = require("node:path")

/** Same placeholder set Pi's prompt-template substitution understands. */
const ARG_PLACEHOLDER = /\$ARGUMENTS|\$@|\$\d|\$\{@/

/** Values ECC treats as "off" across its existing environment switches. */
const DISABLED_VALUES = new Set(["0", "false", "off", "none", "disabled"])

function isDisabledByEnv(value) {
  return typeof value === "string" && DISABLED_VALUES.has(value.trim().toLowerCase())
}

/**
 * Body of an ECC command that has NO argument placeholder, or null.
 *
 * Claude Code appends `ARGUMENTS: <args>` when a command lacks `$ARGUMENTS`;
 * Pi's template expansion silently drops the arguments instead. Most ECC
 * commands rely on the Claude behaviour, so the adapter restores it.
 */
function loadPlaceholderlessCommand(name, eccRoot, cache) {
  if (cache.has(name)) {
    return cache.get(name) ?? null
  }
  let body = null
  if (/^[A-Za-z0-9._-]+$/.test(name)) {
    try {
      const raw = fs.readFileSync(path.join(eccRoot, "commands", `${name}.md`), "utf8")
      const stripped = raw.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
      body = ARG_PLACEHOLDER.test(stripped) ? null : stripped
    } catch {
      body = null
    }
  }
  cache.set(name, body)
  return body
}

/**
 * Pi input-handler transform shared by the TypeScript extension and tests.
 *
 * Keep this in a CommonJS module so the real registered handler can be loaded
 * and exercised by the plain Node test suite; the extension itself delegates
 * directly to this function.
 */
function handlePiInput({ text, eccRoot, env, cache }) {
  if (isDisabledByEnv(env.ECC_PI_COMMAND_ARGS)) {
    return { action: "continue" }
  }
  const match = text.match(/^\/([^\s:]+)\s+([\s\S]*\S[\s\S]*)$/)
  if (!match) {
    return { action: "continue" }
  }
  const body = loadPlaceholderlessCommand(match[1], eccRoot, cache)
  if (!body) {
    return { action: "continue" }
  }
  return { action: "transform", text: `${body}\n\nARGUMENTS: ${match[2].trim()}` }
}

module.exports = {
  ARG_PLACEHOLDER,
  DISABLED_VALUES,
  isDisabledByEnv,
  loadPlaceholderlessCommand,
  handlePiInput,
}
