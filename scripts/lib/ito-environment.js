"use strict";

const SYSTEM_ENVIRONMENT_KEYS = Object.freeze([
  "CI",
  "ComSpec",
  "DISPLAY",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WAYLAND_DISPLAY",
  "WINDIR",
  "XDG_RUNTIME_DIR",
]);

const ITO_RUNTIME_ENVIRONMENT_KEYS = Object.freeze([
  "ITO_API_KEY",
  "ITO_API_URL",
  "ITO_INVENTORY_URL",
]);

const ITO_EVAL_ENVIRONMENT_KEYS = Object.freeze([
  "ITO_ENABLE_SIXTYTWO_LIVE",
  "SIXTYTWO_API_TOKEN",
  "SIXTYTWO_TOKEN",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
]);

const ECC_ITO_CONTROL_KEYS = Object.freeze([
  "ECC_DRY_RUN",
  "ECC_ITO_CLI_EXECUTABLE",
  "NODE_ENV",
]);
const ITO_RUNTIME_COMMANDS = new Set(["auth", "find", "status"]);

function copyDefined(source, target, key) {
  if (typeof source[key] === "string") {
    target[key] = source[key];
  }
}

function createSafeItoEnvironment(source = process.env, options = {}) {
  const safe = {};
  for (const key of SYSTEM_ENVIRONMENT_KEYS) {
    copyDefined(source, safe, key);
  }
  for (const [key] of Object.entries(source)) {
    if (key.startsWith("LC_")) copyDefined(source, safe, key);
  }

  if (options.includeItoRuntime) {
    for (const key of ITO_RUNTIME_ENVIRONMENT_KEYS) {
      copyDefined(source, safe, key);
    }
  }

  if (options.includeItoEvals) {
    for (const key of ITO_EVAL_ENVIRONMENT_KEYS) {
      copyDefined(source, safe, key);
    }
  }

  if (options.includeControls) {
    for (const key of ECC_ITO_CONTROL_KEYS) {
      copyDefined(source, safe, key);
    }
  }

  return Object.freeze(safe);
}

function getInvocationCommand(args = []) {
  return args.filter((value) => value !== "--json")[0];
}

function createSafeItoInvocationEnvironment(
  source = process.env,
  args = [],
  options = {},
) {
  const command = getInvocationCommand(args);
  return createSafeItoEnvironment(source, {
    includeControls: options.includeControls === true,
    includeItoRuntime: ITO_RUNTIME_COMMANDS.has(command),
    includeItoEvals: command === "evals",
  });
}

module.exports = Object.freeze({
  ECC_ITO_CONTROL_KEYS,
  ITO_EVAL_ENVIRONMENT_KEYS,
  ITO_RUNTIME_ENVIRONMENT_KEYS,
  SYSTEM_ENVIRONMENT_KEYS,
  createSafeItoEnvironment,
  createSafeItoInvocationEnvironment,
  getInvocationCommand,
});
