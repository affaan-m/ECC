/**
 * Contract tests for the installable Itô compute skill and MCP documentation.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
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
  console.log("\n=== Testing Itô compute skill surface ===\n");

  const tests = [
    ["documents only the real CLI commands and MCP tools", () => {
      const skill = read("skills/ito-compute/SKILL.md");
      for (const command of ["ecc ito auth", "ecc ito find", "ecc ito status"]) {
        assert.match(skill, new RegExp(command.replace(" ", "\\s+")));
      }
      assert.doesNotMatch(skill, /^\s*ito (?:auth|find|status)\b/m);
      for (const tool of ["ito_auth", "ito_find", "ito_status"]) {
        assert.match(skill, new RegExp(`\\b${tool}\\b`));
      }
      assert.doesNotMatch(
        skill,
        /ito_lock|ito_run|ITO_CLI_DEMO|paper mode|simulated|live on the registry|publishing soon/i
      );
      assert.match(skill, /unpublished/i);
      assert.match(skill, /Ito-Markets\/ito-cloud-runtime/);
      assert.match(skill, /cli\/ito-compute-cli/);
      assert.match(skill, /npm run check/);
      assert.match(skill, /ECC_ITO_CLI_EXECUTABLE/);
      assert.match(skill, /explicit absolute built entry/);
      assert.match(skill, /never discovers[^\n]*through `PATH`/);
      assert.doesNotMatch(skill, /npm link/);
    }],
    ["registers one opt-in install module and capability", () => {
      const modules = readJson("manifests/install-modules.json").modules;
      const module = modules.find((candidate) => candidate.id === "ito-compute");
      assert.ok(module, "ito-compute install module is missing");
      assert.deepStrictEqual(module.paths, ["skills/ito-compute"]);
      assert.deepStrictEqual(module.dependencies, ["platform-configs"]);
      assert.strictEqual(module.defaultInstall, false);
      assert.strictEqual(module.stability, "beta");
      for (const target of ["claude", "codex", "opencode", "hermes", "kimi"]) {
        assert.ok(module.targets.includes(target), `${target} target is missing`);
      }

      const components = readJson("manifests/install-components.json").components;
      assert.deepStrictEqual(
        components.find((candidate) => candidate.id === "capability:ito-compute"),
        {
          id: "capability:ito-compute",
          family: "capability",
          description: "Authenticated Itô GPU inventory, RFQ, and status workflows through the separately installed canonical CLI.",
          modules: ["ito-compute"],
        }
      );
      const profiles = readJson("manifests/install-profiles.json").profiles;
      assert.ok(profiles.full.modules.includes("ito-compute"));
    }],
    ["publishes the skill but never bundles the Itô CLI", () => {
      const packageJson = readJson("package.json");
      assert.ok(packageJson.files.includes("skills/ito-compute/"));
      assert.ok(!packageJson.dependencies?.["ito-compute-cli"]);
      assert.ok(!packageJson.optionalDependencies?.["ito-compute-cli"]);
      assert.ok(!packageJson.bin?.ito);
    }],
    ["offers an opt-in local MCP template with the exact real tool boundary", () => {
      const mcpConfig = readJson("mcp-configs/mcp-servers.json");
      const server = mcpConfig.mcpServers["ito-compute"];
      assert.ok(server, "ito-compute MCP template is missing");
      assert.strictEqual(server.command, "node");
      assert.deepStrictEqual(server.args, [
        "/absolute/path/to/ito-cloud-runtime/cli/ito-compute-cli/dist/bin/ito-mcp.js",
      ]);
      assert.doesNotMatch(JSON.stringify(server), /npx|ito_lock|ito_run|paper|simulat/i);
      assert.match(server.description, /ito_auth, ito_find, and ito_status/);
      assert.match(server.description, /unpublished/i);
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
