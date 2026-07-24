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
const { spawnSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..", "..");
const ECC_SCRIPT = path.join(REPO_ROOT, "scripts", "ecc.js");
const CANONICAL_PACKAGE = "Ito-Markets/ito-cloud-runtime/cli/ito-compute-cli";

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

function makeItoProbe(exitCode = 0) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ecc-ito-cli-"));
  const log = path.join(directory, "invocation.json");
  const script = path.join(directory, "ito-probe.js");
  const executable = script;
  fs.writeFileSync(
    script,
    [
      `#!${process.execPath}`,
      '"use strict";',
      'const fs = require("fs");',
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
  return Object.freeze({ directory, executable, log });
}

function readInvocation(probe) {
  return JSON.parse(fs.readFileSync(probe.log, "utf8"));
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

function main() {
  console.log("\n=== Testing ECC × Itô real CLI bridge ===\n");

  const tests = [
    ["forwards only auth, find, and status to an explicit local executable", () => {
      for (const command of ["auth", "find", "status"]) {
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
    ["passes only the required Itô runtime settings across the process boundary", () => {
      const probe = makeItoProbe();
      try {
        const result = runCli(["ito", "auth"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
          ITO_API_KEY: "ito_test_key",
          ITO_API_URL: "https://compute.example.test",
          ITO_INVENTORY_URL: "https://edge.example.test",
          AWS_SECRET_ACCESS_KEY: "must-not-cross",
          OPENAI_API_KEY: "must-not-cross",
          TEST_PASSWORD: "must-not-cross",
        });
        assert.strictEqual(result.status, 0, result.stderr);
        const childEnvironment = readInvocation(probe).env;
        assert.strictEqual(childEnvironment.ITO_API_KEY, "ito_test_key");
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
    ["rejects unsupported, browser, simulated, and node operations before spawning", () => {
      for (const command of ["rent", "lock", "run", "inference", "evals", "mcp"]) {
        const probe = makeItoProbe();
        try {
          const result = runCli(["ito", command], {
            ECC_ITO_CLI_EXECUTABLE: probe.executable,
          });
          assert.notStrictEqual(result.status, 0, command);
          assert.match(result.stderr, /only auth, find, and status/i);
          assert.ok(!fs.existsSync(probe.log), `${command} must not spawn the Itô CLI`);
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
    ["help exposes the truthful CLI and MCP surface without a browser path", () => {
      const probe = makeItoProbe();
      try {
        const result = runCli(["ito", "--help"], {
          ECC_ITO_CLI_EXECUTABLE: probe.executable,
        });
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /ecc ito auth/);
        assert.match(result.stdout, /ecc ito find/);
        assert.match(result.stdout, /ecc ito status/);
        assert.match(result.stdout, /ito_auth/);
        assert.match(result.stdout, /ito_find/);
        assert.match(result.stdout, /ito_status/);
        assert.match(result.stdout, new RegExp(CANONICAL_PACKAGE.replaceAll("/", "\\/")));
        assert.match(result.stdout, /unpublished/i);
        assert.match(result.stdout, /never discovers[^\n]*through PATH/i);
        assert.doesNotMatch(
          result.stdout,
          /manual copy|open(?:s)? (?:a )?browser|ito_lock|ito_run|npm link|paper|simulat/i
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
    if (runTest(name, fn)) passed += 1;
    else failed += 1;
  }

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
