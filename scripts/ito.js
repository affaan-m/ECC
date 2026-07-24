#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { createSafeItoEnvironment } = require("./lib/ito-environment");

const SUPPORTED_COMMANDS = Object.freeze(["auth", "find", "status"]);
const CANONICAL_REPOSITORY = "https://github.com/Ito-Markets/ito-cloud-runtime.git";
const CANONICAL_PACKAGE_PATH = "cli/ito-compute-cli";
const EXECUTABLE_OVERRIDE = "ECC_ITO_CLI_EXECUTABLE";
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

function showHelp() {
  console.log(`
ECC × Itô local CLI bridge

Usage:
  ecc ito auth
  ecc ito find <all required RFQ options>
  ecc ito status
  ecc ito <auth|find|status> --json

The bridge invokes the separately installed canonical Itô CLI and returns its
real stdout, stderr, and exit code unchanged. It performs no browser navigation
and adds no lock, workload, inference, evaluation, or purchase path.

Important:
  - "find" reads live inventory and submits an authenticated RFQ.
  - Obtain explicit buyer authority and every hard constraint before invoking it.
  - "status" reads live RFQ and procurement status.
  - Inventory and RFQs are not reservations; only a returned firm quote is firm.

The canonical package is currently unpublished. Install it locally:
  Canonical source: Ito-Markets/ito-cloud-runtime/${CANONICAL_PACKAGE_PATH}
  git clone ${CANONICAL_REPOSITORY}
  cd ito-cloud-runtime/${CANONICAL_PACKAGE_PATH}
  npm ci
  npm run check

Then set ${EXECUTABLE_OVERRIDE} to the explicit absolute built entry:
  /absolute/path/to/ito-cloud-runtime/${CANONICAL_PACKAGE_PATH}/dist/bin/ito.js

For safety, ECC never discovers this credential-bearing client through PATH.

The same package's MCP server exposes only:
  ito_auth
  ito_find
  ito_status

Configure the MCP command as "node" with this absolute argument:
  /absolute/path/to/ito-cloud-runtime/${CANONICAL_PACKAGE_PATH}/dist/bin/ito-mcp.js

Inject ITO_API_KEY into the child process from 1Password or the launching
environment. Never put the key in arguments, tracked files, or chat.
`);
}

function parseArgs(argv, environment = process.env) {
  const args = [...argv];
  if (
    args.length === 0
    || args.includes("--help")
    || args.includes("-h")
  ) {
    return Object.freeze({ help: true, invocationArgs: [] });
  }

  if (environment.ECC_DRY_RUN === "1" || args.includes("--dry-run")) {
    throw new Error(
      "Itô compute has no paper or dry-run success mode. No CLI operation was invoked."
    );
  }

  const jsonIndexes = args
    .map((value, index) => (value === "--json" ? index : -1))
    .filter((index) => index >= 0);
  if (jsonIndexes.length > 1) {
    throw new Error("--json may only be provided once");
  }
  const withoutJson = args.filter((value) => value !== "--json");
  const command = withoutJson.shift();
  if (!SUPPORTED_COMMANDS.includes(command)) {
    throw new Error(
      `Unsupported Itô command "${command || "(missing)"}"; ECC permits only auth, find, and status.`
    );
  }

  return Object.freeze({
    help: false,
    invocationArgs: Object.freeze([
      ...(jsonIndexes.length === 1 ? ["--json"] : []),
      command,
      ...withoutJson,
    ]),
  });
}

function resolveItoExecutable(environment = process.env) {
  const configured = environment[EXECUTABLE_OVERRIDE]?.trim();
  if (!configured) {
    throw new Error([
      "The canonical ito-compute-cli is unpublished and ECC will not resolve",
      `a credential-bearing "ito" executable from PATH. Build it from`,
      `${CANONICAL_REPOSITORY.replace(/\.git$/, "")}/${CANONICAL_PACKAGE_PATH},`,
      "run npm ci and npm run check, then set",
      `${EXECUTABLE_OVERRIDE} to the explicit absolute dist/bin/ito.js path.`,
    ].join(" "));
  }

  if (!path.isAbsolute(configured)) {
    throw new Error(
      `${EXECUTABLE_OVERRIDE} must be an absolute path explicitly configured by the operator.`
    );
  }
  return assertUsableExecutable(configured);
}

function assertUsableExecutable(candidate) {
  let canonicalCandidate;
  try {
    canonicalCandidate = fs.realpathSync.native(candidate);
  } catch {
    throw new Error(
      `${EXECUTABLE_OVERRIDE} does not point to a readable local Itô CLI file.`
    );
  }
  if (!isUsableExecutable(canonicalCandidate)) {
    throw new Error(
      `${EXECUTABLE_OVERRIDE} does not point to a readable local Itô CLI file.`
    );
  }
  return canonicalCandidate;
}

function isUsableExecutable(candidate) {
  try {
    const info = fs.statSync(candidate);
    if (!info.isFile()) return false;
    if (process.platform !== "win32" && path.extname(candidate) !== ".js") {
      fs.accessSync(candidate, fs.constants.X_OK);
    } else {
      fs.accessSync(candidate, fs.constants.R_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function buildInvocation(executable, args) {
  if (path.extname(executable).toLowerCase() === ".js") {
    return Object.freeze({
      executable: process.execPath,
      args: Object.freeze([executable, ...args]),
    });
  }
  if (
    process.platform === "win32"
    && /\.(?:bat|cmd|ps1)$/i.test(executable)
  ) {
    throw new Error(
      `Refusing to invoke the Itô CLI through a shell shim. Set ${EXECUTABLE_OVERRIDE} to the absolute dist/bin/ito.js path.`
    );
  }
  return Object.freeze({ executable, args: Object.freeze([...args]) });
}

function invokeIto(executable, args, environment = process.env) {
  const invocation = buildInvocation(executable, args);
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...createSafeItoEnvironment(environment, { includeItoRuntime: true }),
    },
    maxBuffer: MAX_OUTPUT_BYTES,
    shell: false,
    windowsHide: true,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    throw new Error(`The local Itô CLI could not be started: ${result.error.message}`);
  }
  if (typeof result.status === "number") return result.status;
  if (result.signal) {
    throw new Error(`The local Itô CLI terminated by signal ${result.signal}.`);
  }
  return 1;
}

function main(argv = process.argv.slice(2), environment = process.env) {
  try {
    const parsed = parseArgs(argv, environment);
    if (parsed.help) {
      showHelp();
      return 0;
    }
    const executable = resolveItoExecutable(environment);
    return invokeIto(executable, parsed.invocationArgs, environment);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = Object.freeze({
  CANONICAL_PACKAGE_PATH,
  CANONICAL_REPOSITORY,
  EXECUTABLE_OVERRIDE,
  SUPPORTED_COMMANDS,
  buildInvocation,
  invokeIto,
  main,
  parseArgs,
  resolveItoExecutable,
});
