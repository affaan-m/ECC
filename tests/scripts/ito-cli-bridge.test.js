/**
 * End-to-end contract tests for ECC's real local Itô CLI bridge.
 *
 * The executable used here is a process-boundary probe. It never contacts an
 * Itô API, submits an RFQ, opens a browser, or reaches a GPU node.
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");
const ECC_SCRIPT = path.join(REPO_ROOT, "scripts", "ecc.js");
const ITO_SCRIPT = path.join(REPO_ROOT, "scripts", "ito.js");
const CANONICAL_PACKAGE = "Ito-Markets/ito-cloud-runtime/cli/ito-compute-cli";
const {
  NODE_QUALIFICATION_TIMEOUT_MS,
} = require("../../scripts/ito");
const {
  createSafeItoInvocationEnvironment,
  getInvocationCommand,
  ITO_RUNTIME_ENVIRONMENT_KEYS,
} = require("../../scripts/lib/ito-environment");
const {
  authorizeEccCapability,
  parseItoCapabilities,
} = require("../../scripts/lib/ito-capabilities");

function runCli(args, environment = {}) {
  return spawnSync(process.execPath, [ECC_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      ...environment,
    },
  });
}

function runCliAndObserveFirstOutput(args, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ECC_SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_ENV: "test", ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let firstOutputAt;
    const startedAt = Date.now();
    child.stdout.on("data", (chunk) => {
      if (firstOutputAt === undefined) firstOutputAt = Date.now();
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => resolve({
      status,
      stdout,
      stderr,
      startedAt,
      firstOutputAt,
      closedAt: Date.now(),
    }));
  });
}

function capabilityEnvelope(commands) {
  return {
    ok: true,
    live_api_contacted: false,
    notice: "Static CLI capability contract; no credential or network access occurred.",
    data: {
      contract_version: "ito.cli.capabilities.v1",
      cli: { name: "ito-compute-cli", version: "0.1.1", private: true },
      commands,
      mcp_tools: ["ito_auth", "ito_find", "ito_status"],
      output_contract: {
        json_success_envelope: true,
        errors_on_stderr: true,
        unsupported_commands_contact_nothing: true,
      },
    },
  };
}

const DEFAULT_CAPABILITY_COMMANDS = Object.freeze([
  { name: "capabilities", availability: "supported", auth: "none", network: "none", side_effect: "none", authority: "none" },
  { name: "login", availability: "supported", auth: "device_bootstrap", network: "ito_api", side_effect: "credential_write", authority: "device_owner" },
  { name: "logout", availability: "supported", auth: "none", network: "ito_api", side_effect: "credential_revoke", authority: "device_owner" },
  { name: "auth", availability: "supported", auth: "required", network: "ito_api", side_effect: "none", authority: "none" },
  { name: "find", availability: "supported", auth: "required", network: "ito_api", side_effect: "rfq_submit", authority: "buyer_rfq" },
  { name: "status", availability: "supported", auth: "required", network: "ito_api", side_effect: "provisioning_reconcile", authority: "buyer_rfq" },
  { name: "serve", availability: "supported", auth: "required", network: "ito_api", side_effect: "workload_start", authority: "entitled_workload" },
  { name: "train", availability: "supported", auth: "required", network: "ito_api", side_effect: "workload_start", authority: "entitled_workload" },
  { name: "workload-status", availability: "supported", auth: "required", network: "ito_api", side_effect: "none", authority: "none" },
  { name: "workload-cancel", availability: "supported", auth: "required", network: "ito_api", side_effect: "workload_cancel", authority: "entitled_workload" },
  { name: "workload-cleanup", availability: "supported", auth: "required", network: "ito_api", side_effect: "workload_cleanup", authority: "entitled_workload" },
  { name: "evals", availability: "supported", auth: "none", network: "explicit_nodes", side_effect: "node_qualification", authority: "named_node_operator" },
]);

function makeItoProbe(exitCode = 0, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-ito-cli-"));
  const log = path.join(directory, "invocation.json");
  const capabilityLog = path.join(directory, "capability-invocation.json");
  const script = path.join(
    directory,
    "ito-cloud-runtime",
    "cli",
    "ito-compute-cli",
    "dist",
    "bin",
    "ito.js"
  );
  const executable = script;
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(
    script,
    [
      `#!${process.execPath}`,
      '"use strict";',
      'const fs = require("fs");',
      'const argv = process.argv.slice(2);',
      'const command = argv.filter((value) => value !== "--json")[0];',
      'if (command === "capabilities") {',
      `  fs.writeFileSync(${JSON.stringify(capabilityLog)}, JSON.stringify({ argv, env: process.env }));`,
      `  process.stdout.write(${JSON.stringify(`${JSON.stringify(options.capabilityEnvelope ?? capabilityEnvelope(DEFAULT_CAPABILITY_COMMANDS))}\n`)});`,
      '  process.exit(0);',
      '}',
      `fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env }));`,
      'process.stdout.write(`ito-probe:${process.argv.slice(2).join("|")}\\n`);',
      'process.stderr.write("ito-probe-stderr\\n");',
      `process.exit(${exitCode});`,
      "",
    ].join("\n")
  );
  if (process.platform !== "win32") {
    fs.chmodSync(script, 0o755);
  }
  return Object.freeze({ capabilityLog, directory, executable, log });
}

function readInvocation(probe) {
  return JSON.parse(fs.readFileSync(probe.log, "utf8"));
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

async function main() {
  console.log("\n=== Testing ECC × Itô real CLI bridge ===\n");

  const tests = [
    ["forwards only the reviewed RFQ CLI surface to an explicit local executable", () => {
      for (const command of ["login", "logout", "auth", "find", "status"]) {
        const probe = makeItoProbe();
        try {
          const result = runCli(["ito", command], {
            ECC_ITO_CLI_EXECUTABLE: probe.executable,
          });
          assert.strictEqual(result.status, 0, result.stderr);
          assert.deepStrictEqual(readInvocation(probe).argv, [command]);
          assert.match(result.stdout, new RegExp(`ito-probe:${command}`));
        } finally {
          fs.rmSync(probe.directory, { recursive: true, force: true });
        }
      }
    }],
    ["derives a newly supported read-only command from a credential-free capability probe", () => {
      const probe = makeItoProbe();
      try {
        const result = runCli(["ito", "workload-status", "run_123", "--json"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
          ITO_API_KEY: "ito_test_key",
          ITO_API_URL: "https://compute.example.test",
          AWS_SECRET_ACCESS_KEY: "must-not-cross",
        });
        assert.strictEqual(result.status, 0, result.stderr);
        const capabilityInvocation = JSON.parse(fs.readFileSync(probe.capabilityLog, "utf8"));
        assert.deepStrictEqual(capabilityInvocation.argv, ["capabilities", "--json"]);
        assert.strictEqual(capabilityInvocation.env.ITO_API_KEY, undefined);
        assert.strictEqual(capabilityInvocation.env.ITO_API_URL, undefined);
        assert.strictEqual(capabilityInvocation.env.AWS_SECRET_ACCESS_KEY, undefined);
        assert.strictEqual(capabilityInvocation.env.ECC_ITO_CLI_EXECUTABLE, undefined);
        const targetInvocation = readInvocation(probe);
        assert.deepStrictEqual(targetInvocation.argv, ["--json", "workload-status", "run_123"]);
        assert.strictEqual(targetInvocation.env.ITO_API_KEY, "ito_test_key");
        assert.strictEqual(targetInvocation.env.ITO_API_URL, "https://compute.example.test");
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["blocks advertised workload mutations after capability discovery", () => {
      const probe = makeItoProbe();
      try {
        const result = runCli([
          "ito", "serve", "--model", "org/model", "--entitlement", "ent_123", "--confirm",
        ], { ECC_ITO_CLI_EXECUTABLE: probe.executable });
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /workload_start|safe policy/i);
        assert.ok(fs.existsSync(probe.capabilityLog), "capability discovery did not run");
        assert.ok(!fs.existsSync(probe.log), "blocked workload command reached the target invocation");
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["requires exact tuples for every explicitly reviewed effectful command", () => {
      for (const commandName of ["login", "logout", "find", "evals"]) {
        const commands = DEFAULT_CAPABILITY_COMMANDS.map((command) => (
          command.name === commandName
            ? { ...command, auth: "none", network: "none", side_effect: "none", authority: "none" }
            : command
        ));
        const manifest = parseItoCapabilities(JSON.stringify(capabilityEnvelope(commands)));
        assert.throws(
          () => authorizeEccCapability(manifest, commandName),
          /outside ECC's safe policy/i,
          commandName,
        );
      }
    }],
    ["allows status only under the exact provisioning-reconcile tuple", () => {
      const manifest = parseItoCapabilities(JSON.stringify(capabilityEnvelope(DEFAULT_CAPABILITY_COMMANDS)));
      assert.strictEqual(authorizeEccCapability(manifest, "status").side_effect, "provisioning_reconcile");
      const mislabeled = DEFAULT_CAPABILITY_COMMANDS.map((command) => (
        command.name === "status"
          ? { ...command, side_effect: "none", authority: "none" }
          : command
      ));
      assert.throws(
        () => authorizeEccCapability(
          parseItoCapabilities(JSON.stringify(capabilityEnvelope(mislabeled))),
          "status",
        ),
        /outside ECC's safe policy/i,
      );
    }],
    ["fails closed on duplicate command records in the installed manifest", () => {
      const duplicateAuth = DEFAULT_CAPABILITY_COMMANDS.find(({ name }) => name === "auth");
      const probe = makeItoProbe(0, {
        capabilityEnvelope: capabilityEnvelope([duplicateAuth, duplicateAuth]),
      });
      try {
        const result = runCli(["ito", "auth"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
          ITO_API_KEY: "must-not-cross-after-invalid-contract",
        });
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /duplicate command/i);
        assert.ok(!fs.existsSync(probe.log), "invalid capability contract reached target invocation");
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["rejects embedded-newline aliases in the exact MCP tool surface", () => {
      const envelope = capabilityEnvelope(DEFAULT_CAPABILITY_COMMANDS);
      envelope.data.mcp_tools = ["ito_auth\nito_find", "ito_status"];
      assert.throws(
        () => parseItoCapabilities(JSON.stringify(envelope)),
        /MCP tool surface changed/i,
      );
    }],
    ["never auto-authorizes read-only commands that contact explicit nodes", () => {
      const explicitNodeRead = {
        name: "topology",
        availability: "supported",
        auth: "none",
        network: "explicit_nodes",
        side_effect: "none",
        authority: "none",
      };
      const probe = makeItoProbe(0, {
        capabilityEnvelope: capabilityEnvelope([...DEFAULT_CAPABILITY_COMMANDS, explicitNodeRead]),
      });
      try {
        const result = runCli(["ito", "topology"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
          SIXTYTWO_API_TOKEN: "must-not-cross-outside-evals",
          SSH_AUTH_SOCK: "/tmp/must-not-cross-outside-evals.sock",
        });
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /outside ECC's safe policy/i);
        assert.ok(fs.existsSync(probe.capabilityLog), "capability discovery did not run");
        assert.ok(!fs.existsSync(probe.log), "explicit-node command reached target invocation");
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["forwards logout with device-token settings but never an API key", () => {
      const probe = makeItoProbe();
      try {
        const result = runCli(["ito", "logout", "--json"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
          ITO_API_KEY: "must-not-cross-into-device-revocation",
          ITO_ALLOW_FILE_TOKEN: "1",
          ITO_TOKEN_FILE: "/tmp/ito-device-token",
          ITO_API_URL: "https://compute.example.test",
        });
        assert.strictEqual(result.status, 0, result.stderr);
        const invocation = readInvocation(probe);
        assert.deepStrictEqual(invocation.argv, ["--json", "logout"]);
        assert.strictEqual(invocation.env.ITO_API_KEY, undefined);
        assert.strictEqual(invocation.env.ITO_ALLOW_FILE_TOKEN, "1");
        assert.strictEqual(invocation.env.ITO_TOKEN_FILE, "/tmp/ito-device-token");
        assert.strictEqual(invocation.env.ITO_API_URL, "https://compute.example.test");
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["forwards the canonical login browser opt-out without performing browser automation", () => {
      const probe = makeItoProbe();
      try {
        const result = runCli(["ito", "login", "--no-browser"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
        });
        assert.strictEqual(result.status, 0, result.stderr);
        assert.deepStrictEqual(readInvocation(probe).argv, ["login", "--no-browser"]);
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["rejects --no-browser on validation-only auth before spawning", () => {
      const probe = makeItoProbe();
      try {
        const result = runCli(["ito", "auth", "--no-browser"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
        });
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /--no-browser.*only.*login/i);
        assert.ok(!fs.existsSync(probe.log));
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["normalizes JSON and forwards every RFQ constraint without interpretation", () => {
      const probe = makeItoProbe();
      try {
        const args = [
          "ito",
          "find",
          "--gpu", "h200",
          "--count", "8",
          "--nodes", "1",
          "--gpus-per-node", "8",
          "--days", "30",
          "--storage-tb", "1",
          "--start-window", "2099-08-15",
          "--max-rate", "3.00",
          "--form-factor", "bare_metal",
          "--contract-type", "reservation",
          "--fabric", "infiniband",
          "--region", "us-east-1",
          "--json",
        ];
        const result = runCli(args, {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
        });
        assert.strictEqual(result.status, 0, result.stderr);
        assert.deepStrictEqual(readInvocation(probe).argv, [
          "--json",
          ...args.slice(1, -1),
        ]);
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["login never inherits ITO_API_KEY but preserves secure token settings", () => {
      const probe = makeItoProbe();
      try {
        const result = runCli(["ito", "login"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
          ITO_API_KEY: "must-not-cross-without-legacy-mode",
          ITO_AUTH_MODE: "device",
          ITO_ALLOW_FILE_TOKEN: "1",
          ITO_TOKEN_FILE: "/tmp/ito-device-token",
          ITO_API_URL: "https://compute.example.test",
          ITO_INVENTORY_URL: "https://edge.example.test",
          AWS_SECRET_ACCESS_KEY: "must-not-cross",
          OPENAI_API_KEY: "must-not-cross",
          TEST_PASSWORD: "must-not-cross",
        });
        assert.strictEqual(result.status, 0, result.stderr);
        const childEnvironment = readInvocation(probe).env;
        assert.strictEqual(childEnvironment.ITO_API_KEY, undefined);
        assert.strictEqual(childEnvironment.ITO_AUTH_MODE, "device");
        assert.strictEqual(childEnvironment.ITO_ALLOW_FILE_TOKEN, "1");
        assert.strictEqual(childEnvironment.ITO_TOKEN_FILE, "/tmp/ito-device-token");
        assert.strictEqual(childEnvironment.ITO_API_URL, "https://compute.example.test");
        assert.strictEqual(childEnvironment.ITO_INVENTORY_URL, "https://edge.example.test");
        assert.strictEqual(childEnvironment.AWS_SECRET_ACCESS_KEY, undefined);
        assert.strictEqual(childEnvironment.OPENAI_API_KEY, undefined);
        assert.strictEqual(childEnvironment.TEST_PASSWORD, undefined);
        assert.strictEqual(childEnvironment.ECC_ITO_CLI_EXECUTABLE, undefined);
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["forwards ITO_API_KEY directly to auth, find, and status without legacy mode", () => {
      for (const command of ["auth", "find", "status"]) {
        const probe = makeItoProbe();
        try {
          const result = runCli(["ito", command], {
            ECC_ITO_CLI_EXECUTABLE: probe.executable,
            ITO_API_KEY: "ito_test_key",
          });
          assert.strictEqual(result.status, 0, result.stderr);
          assert.strictEqual(readInvocation(probe).env.ITO_API_KEY, "ito_test_key");
        } finally {
          fs.rmSync(probe.directory, { recursive: true, force: true });
        }
      }
    }],
    ["streams device login output before completion and propagates its exit status", async () => {
      const probe = makeItoProbe(7);
      try {
        fs.writeFileSync(
          probe.executable,
          [
            '"use strict";',
            'const argv = process.argv.slice(2);',
            'if (argv.filter((value) => value !== "--json")[0] === "capabilities") {',
            `  process.stdout.write(${JSON.stringify(`${JSON.stringify(capabilityEnvelope(DEFAULT_CAPABILITY_COMMANDS))}\n`)});`,
            '  process.exit(0);',
            '}',
            'process.stdout.write("device-code-now\\n");',
            'setTimeout(() => process.exit(7), 500);',
            "",
          ].join("\n")
        );
        const result = await runCliAndObserveFirstOutput(["ito", "login"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
        });
        assert.strictEqual(result.status, 7, result.stderr);
        assert.match(result.stdout, /device-code-now/);
        assert.ok(
          result.closedAt - result.firstOutputAt >= 350,
          "login output was buffered until process completion",
        );
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["isolates live node qualification from Itô and unrelated credentials", () => {
      const probe = makeItoProbe();
      try {
        const configDirectory = path.join(probe.directory, "qualification");
        fs.mkdirSync(configDirectory);
        fs.writeFileSync(path.join(configDirectory, "sixtytwo.yaml"), "suite: full\n");
        const result = runCli([
          "ito",
          "evals",
          "--cluster", "clu_prod_example",
          "--live-sixtytwo",
          "--nodes", "gpu-01,gpu-02",
          "--config-dir", configDirectory,
        ], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
          ITO_API_KEY: "must-not-cross-into-node-qualification",
          ITO_AUTH_MODE: "legacy",
          ITO_ALLOW_FILE_TOKEN: "1",
          ITO_TOKEN_FILE: "/tmp/must-not-cross-token-file",
          ITO_API_URL: "https://compute.example.test",
          ITO_INVENTORY_URL: "https://edge.example.test",
          ITO_ENABLE_SIXTYTWO_LIVE: "1",
          SIXTYTWO_API_TOKEN: "sixtytwo-test-token",
          SIXTYTWO_TOKEN: "sixtytwo-legacy-test-token",
          SSH_AUTH_SOCK: "/tmp/ecc-test-agent.sock",
          ITO_CLI_DEMO: "1",
          ITO_CLI_STATE_DIR: "/tmp/forbidden-paper-state",
          AWS_SECRET_ACCESS_KEY: "must-not-cross",
          OPENAI_API_KEY: "must-not-cross",
        });
        assert.strictEqual(result.status, 0, result.stderr);
        const invocation = readInvocation(probe);
        assert.deepStrictEqual(invocation.argv, [
          "evals",
          "--cluster", "clu_prod_example",
          "--live-sixtytwo",
          "--nodes", "gpu-01,gpu-02",
          "--config-dir", configDirectory,
        ]);
        assert.strictEqual(invocation.env.ITO_ENABLE_SIXTYTWO_LIVE, "1");
        assert.strictEqual(invocation.env.SIXTYTWO_API_TOKEN, "sixtytwo-test-token");
        assert.strictEqual(invocation.env.SIXTYTWO_TOKEN, "sixtytwo-legacy-test-token");
        assert.strictEqual(invocation.env.SSH_AUTH_SOCK, "/tmp/ecc-test-agent.sock");
        assert.strictEqual(invocation.env.ITO_API_KEY, undefined);
        assert.strictEqual(invocation.env.ITO_AUTH_MODE, undefined);
        assert.strictEqual(invocation.env.ITO_ALLOW_FILE_TOKEN, undefined);
        assert.strictEqual(invocation.env.ITO_TOKEN_FILE, undefined);
        assert.strictEqual(invocation.env.ITO_API_URL, undefined);
        assert.strictEqual(invocation.env.ITO_INVENTORY_URL, undefined);
        assert.strictEqual(invocation.env.ITO_CLI_DEMO, undefined);
        assert.strictEqual(invocation.env.ITO_CLI_STATE_DIR, undefined);
        assert.strictEqual(invocation.env.AWS_SECRET_ACCESS_KEY, undefined);
        assert.strictEqual(invocation.env.OPENAI_API_KEY, undefined);
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["rejects every incomplete live qualification before spawning", () => {
      const validArgs = [
        "ito",
        "evals",
        "--cluster", "clu_prod_example",
        "--live-sixtytwo",
        "--nodes", "gpu-01,gpu-02",
      ];
      const cases = [
        {
          label: "missing environment opt-in",
          args: [...validArgs, "--config-dir", "__CONFIG__"],
          env: {},
          error: /ITO_ENABLE_SIXTYTWO_LIVE=1/,
        },
        {
          label: "missing live flag",
          args: validArgs.filter((value) => value !== "--live-sixtytwo")
            .concat("--config-dir", "__CONFIG__"),
          env: { ITO_ENABLE_SIXTYTWO_LIVE: "1" },
          error: /--live-sixtytwo/,
        },
        {
          label: "missing nodes",
          args: [
            "ito", "evals",
            "--cluster", "clu_prod_example",
            "--live-sixtytwo",
            "--config-dir", "__CONFIG__",
          ],
          env: { ITO_ENABLE_SIXTYTWO_LIVE: "1" },
          error: /--nodes/,
        },
        {
          label: "empty node list",
          args: [
            "ito", "evals",
            "--cluster", "clu_prod_example",
            "--live-sixtytwo",
            "--nodes", ",",
            "--config-dir", "__CONFIG__",
          ],
          env: { ITO_ENABLE_SIXTYTWO_LIVE: "1" },
          error: /--nodes/,
        },
        {
          label: "missing cluster",
          args: [
            "ito", "evals",
            "--live-sixtytwo",
            "--nodes", "gpu-01",
            "--config-dir", "__CONFIG__",
          ],
          env: { ITO_ENABLE_SIXTYTWO_LIVE: "1" },
          error: /--cluster/,
        },
        {
          label: "relative config directory",
          args: [...validArgs, "--config-dir", "relative/config"],
          env: { ITO_ENABLE_SIXTYTWO_LIVE: "1" },
          error: /absolute/,
        },
        {
          label: "missing config directory",
          args: [...validArgs, "--config-dir", "__MISSING_CONFIG__"],
          env: { ITO_ENABLE_SIXTYTWO_LIVE: "1" },
          error: /sixtytwo\.yaml/,
        },
      ];

      for (const testCase of cases) {
        const probe = makeItoProbe();
        try {
          const configDirectory = path.join(probe.directory, "qualification");
          fs.mkdirSync(configDirectory);
          fs.writeFileSync(path.join(configDirectory, "sixtytwo.yaml"), "suite: full\n");
          const args = testCase.args.map((value) => (
            value === "__CONFIG__"
              ? configDirectory
              : value === "__MISSING_CONFIG__"
                ? path.join(probe.directory, "missing")
                : value
          ));
          const result = runCli(args, {
            ECC_ITO_CLI_EXECUTABLE: probe.executable,
            ...testCase.env,
          });
          assert.notStrictEqual(result.status, 0, testCase.label);
          assert.match(result.stderr, testCase.error, testCase.label);
          assert.ok(
            !fs.existsSync(probe.log),
            `${testCase.label} must not spawn the canonical Itô CLI`,
          );
        } finally {
          fs.rmSync(probe.directory, { recursive: true, force: true });
        }
      }
    }],
    ["classifies Itō child environments once and fails closed on unknown prefixes", () => {
      assert.deepStrictEqual(ITO_RUNTIME_ENVIRONMENT_KEYS, [
        "ITO_API_KEY",
        "ITO_API_URL",
        "ITO_INVENTORY_URL",
        "ITO_AUTH_MODE",
        "ITO_ALLOW_FILE_TOKEN",
        "ITO_TOKEN_FILE",
      ]);
      const safe = createSafeItoInvocationEnvironment(
        {
          PATH: process.env.PATH,
          ECC_ITO_CLI_EXECUTABLE: "/operator/canonical/ito.js",
          ITO_API_KEY: "must-not-cross",
          SIXTYTWO_TOKEN: "must-not-cross",
        },
        ["--future-ecc-flag", "evals"],
        { includeControls: true },
      );
      assert.strictEqual(safe.ECC_ITO_CLI_EXECUTABLE, "/operator/canonical/ito.js");
      assert.strictEqual(safe.ITO_API_KEY, undefined);
      assert.strictEqual(safe.SIXTYTWO_TOKEN, undefined);
    }],
    ["detects the Itō command consistently with or without the global JSON flag", () => {
      assert.strictEqual(getInvocationCommand(["auth"]), "auth");
      assert.strictEqual(getInvocationCommand(["--json", "evals"]), "evals");
      assert.strictEqual(getInvocationCommand([]), undefined);
    }],
    ["bounds the outer node-qualification process beyond the canonical timeout", () => {
      assert.strictEqual(NODE_QUALIFICATION_TIMEOUT_MS, 31 * 60 * 1000);
      const source = fs.readFileSync(ITO_SCRIPT, "utf8");
      assert.match(
        source,
        /timeout: isNodeQualification \? NODE_QUALIFICATION_TIMEOUT_MS : undefined/,
      );
    }],
    ["rejects unsupported browser, paper, and execution operations after safe discovery", () => {
      for (const command of ["rent", "lock", "purchase", "run", "inference", "mcp"]) {
        const probe = makeItoProbe();
        try {
          const result = runCli(["ito", command], {
            ECC_ITO_CLI_EXECUTABLE: probe.executable,
          });
          assert.notStrictEqual(result.status, 0, command);
          assert.match(result.stderr, /does not advertise|safe policy/i);
          assert.ok(fs.existsSync(probe.capabilityLog), `${command} must inspect capabilities`);
          assert.ok(!fs.existsSync(probe.log), `${command} must not reach target execution`);
        } finally {
          fs.rmSync(probe.directory, { recursive: true, force: true });
        }
      }
    }],
    ["fails closed rather than simulating a dry-run RFQ", () => {
      const probe = makeItoProbe();
      try {
        const result = runCli(["--dry-run", "ito", "find"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
        });
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /no paper or dry-run success mode/i);
        assert.ok(!fs.existsSync(probe.log));
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["fails closed with exact local install guidance when the explicit CLI is absent", () => {
      const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-empty-path-"));
      try {
        const result = runCli(["ito", "status"], {
          ECC_ITO_CLI_EXECUTABLE: "",
          PATH: emptyPath,
        });
        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /canonical ito-compute-cli is unpublished/i);
        assert.match(result.stderr, new RegExp(CANONICAL_PACKAGE.replaceAll("/", "\\/")));
        assert.match(result.stderr, /npm run check/);
        assert.match(result.stderr, /ECC_ITO_CLI_EXECUTABLE/);
        assert.match(result.stderr, /explicit absolute/i);
        assert.match(result.stderr, /unpublished/i);
        assert.doesNotMatch(result.stderr, /npx|npm exec|npm link|install -g/i);
      } finally {
        fs.rmSync(emptyPath, { recursive: true, force: true });
      }
    }],
    ["never forwards Itô credentials to an unverified PATH collision", () => {
      const collisionDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "ecc-hostile-ito-path-")
      );
      const stolenEnvironment = path.join(collisionDirectory, "stolen.json");
      const executable = path.join(
        collisionDirectory,
        process.platform === "win32" ? "ito.exe" : "ito"
      );
      try {
        fs.writeFileSync(
          executable,
          [
            `#!${process.execPath}`,
            '"use strict";',
            'const fs = require("fs");',
            `fs.writeFileSync(${JSON.stringify(stolenEnvironment)}, JSON.stringify(process.env));`,
            "",
          ].join("\n")
        );
        if (process.platform !== "win32") {
          fs.chmodSync(executable, 0o755);
        }

        const result = runCli(["ito", "auth"], {
          ECC_ITO_CLI_EXECUTABLE: "",
          ITO_API_KEY: "must-never-reach-path-collision",
          PATH: collisionDirectory,
        });

        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /explicit absolute|ECC_ITO_CLI_EXECUTABLE/i);
        assert.ok(
          !fs.existsSync(stolenEnvironment),
          "an unverified PATH executable must never receive the Itô credential"
        );
      } finally {
        fs.rmSync(collisionDirectory, { recursive: true, force: true });
      }
    }],
    ["rejects an absolute POSIX shim before it can resolve an interpreter through PATH", () => {
      if (process.platform === "win32") return;
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-hostile-ito-shim-"));
      const shim = path.join(directory, "ito");
      const hostileNode = path.join(directory, "node");
      const stolenEnvironment = path.join(directory, "stolen.json");
      try {
        fs.writeFileSync(shim, "#!/usr/bin/env node\n");
        fs.writeFileSync(
          hostileNode,
          [
            "#!/bin/sh",
            `env > ${JSON.stringify(stolenEnvironment)}`,
            "",
          ].join("\n")
        );
        fs.chmodSync(shim, 0o755);
        fs.chmodSync(hostileNode, 0o755);

        const result = runCli(["ito", "auth"], {
          ECC_ITO_CLI_EXECUTABLE: shim,
          ITO_API_KEY: "must-never-reach-shim-interpreter",
          PATH: directory,
        });

        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /canonical dist\/bin\/ito\.js/i);
        assert.ok(
          !fs.existsSync(stolenEnvironment),
          "a shim-resolved interpreter must never receive the Itô credential"
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }],
    ["rejects a readable JavaScript decoy outside the canonical package entry", () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-hostile-ito-js-"));
      const decoy = path.join(directory, "ito.js");
      const stolenEnvironment = path.join(directory, "stolen.json");
      try {
        fs.writeFileSync(
          decoy,
          [
            '"use strict";',
            'const fs = require("fs");',
            `fs.writeFileSync(${JSON.stringify(stolenEnvironment)}, JSON.stringify(process.env));`,
            "",
          ].join("\n")
        );

        const result = runCli(["ito", "auth"], {
          ECC_ITO_CLI_EXECUTABLE: decoy,
          ITO_API_KEY: "must-never-reach-js-decoy",
        });

        assert.notStrictEqual(result.status, 0);
        assert.match(result.stderr, /canonical dist\/bin\/ito\.js/i);
        assert.ok(
          !fs.existsSync(stolenEnvironment),
          "an arbitrary JavaScript file must never receive the Itô credential"
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }],
    ["rejects a relative executable override instead of searching or guessing", () => {
      const result = runCli(["ito", "status"], {
        ECC_ITO_CLI_EXECUTABLE: "ito",
      });
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stderr, /must be an absolute path/i);
    }],
    ["preserves the real CLI exit code and output without a success wrapper", () => {
      const probe = makeItoProbe(7);
      try {
        const result = runCli(["ito", "status"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
        });
        assert.strictEqual(result.status, 7);
        assert.match(result.stdout, /ito-probe:status/);
        assert.match(result.stderr, /ito-probe-stderr/);
        assert.doesNotMatch(result.stdout, /manual_handoff|simulated|paper/i);
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
    ["help separates device login from auth validation", () => {
      const probe = makeItoProbe();
      try {
        const result = runCli(["ito", "--help"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
        });
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /ecc ito login \[--no-browser\]/);
        assert.match(result.stdout, /ecc ito logout/);
        assert.match(result.stdout, /ecc ito auth/);
        assert.match(result.stdout, /ecc ito find/);
        assert.match(result.stdout, /ecc ito status/);
        assert.match(result.stdout, /ecc ito evals/);
        assert.match(result.stdout, /sixtytwo/i);
        assert.match(result.stdout, /ito_auth/);
        assert.match(result.stdout, /ito_find/);
        assert.match(result.stdout, /ito_status/);
        assert.match(result.stdout, new RegExp(CANONICAL_PACKAGE.replaceAll("/", "\\/")));
        assert.match(result.stdout, /unpublished/i);
        assert.match(result.stdout, /never discovers[^\n]*through PATH/i);
        assert.match(result.stdout, /device authorization/i);
        assert.match(result.stdout, /opens the Itô verification page by default/i);
        assert.match(result.stdout, /macOS Keychain/i);
        assert.match(result.stdout, /ECC itself performs no browser automation/i);
        assert.match(result.stdout, /auth.*validat/i);
        assert.match(result.stdout, /ITO_AUTH_MODE=legacy is not\s+required/i);
        assert.doesNotMatch(
          result.stdout,
          /manual copy|ito_lock|ito_run|npm link|paper|simulat/i
        );
        assert.ok(!fs.existsSync(probe.log));
      } finally {
        fs.rmSync(probe.directory, { recursive: true, force: true });
      }
    }],
  ];

  let passed = 0;
  let failed = 0;
  for (const [name, fn] of tests) {
    if (await runTest(name, fn)) passed += 1;
    else failed += 1;
  }

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
