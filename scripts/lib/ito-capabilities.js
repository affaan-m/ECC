"use strict";

const CONTRACT_VERSION = "ito.cli.capabilities.v1";
const MAX_COMMANDS = 64;
const COMMAND_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const MCP_TOOLS = Object.freeze(["ito_auth", "ito_find", "ito_status"]);
const ENUMS = Object.freeze({
  availability: new Set(["supported", "unsupported"]),
  auth: new Set(["none", "required", "device_bootstrap"]),
  network: new Set(["none", "ito_api", "explicit_nodes"]),
  side_effect: new Set([
    "none",
    "credential_write",
    "credential_revoke",
    "rfq_submit",
    "workload_start",
    "workload_cancel",
    "workload_cleanup",
    "provisioning_reconcile",
    "node_qualification",
  ]),
  authority: new Set([
    "none",
    "device_owner",
    "buyer_rfq",
    "entitled_workload",
    "named_node_operator",
  ]),
});
const EXPLICIT_EFFECT_POLICY = Object.freeze({
  login: Object.freeze({
    auth: "device_bootstrap",
    network: "ito_api",
    side_effect: "credential_write",
    authority: "device_owner",
  }),
  logout: Object.freeze({
    auth: "none",
    network: "ito_api",
    side_effect: "credential_revoke",
    authority: "device_owner",
  }),
  find: Object.freeze({
    auth: "required",
    network: "ito_api",
    side_effect: "rfq_submit",
    authority: "buyer_rfq",
  }),
  status: Object.freeze({
    auth: "required",
    network: "ito_api",
    side_effect: "provisioning_reconcile",
    authority: "buyer_rfq",
  }),
  evals: Object.freeze({
    auth: "none",
    network: "explicit_nodes",
    side_effect: "node_qualification",
    authority: "named_node_operator",
  }),
});

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid Itô capability contract: ${label} must be an object.`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Invalid Itô capability contract: ${label} has unknown or missing fields.`);
  }
}

function assertEnum(value, field) {
  if (!ENUMS[field].has(value)) {
    throw new Error(`Invalid Itô capability contract: unsupported ${field}.`);
  }
}

function parseItoCapabilities(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error("Invalid Itô capability contract: canonical CLI did not emit JSON.");
  }
  assertPlainObject(envelope, "envelope");
  assertExactKeys(envelope, ["ok", "live_api_contacted", "notice", "data"], "envelope");
  if (
    envelope.ok !== true
    || envelope.live_api_contacted !== false
    || typeof envelope.notice !== "string"
    || envelope.notice.length === 0
  ) {
    throw new Error("Invalid Itô capability contract: discovery must be local-only success.");
  }

  const data = assertPlainObject(envelope.data, "data");
  assertExactKeys(
    data,
    ["contract_version", "cli", "commands", "mcp_tools", "output_contract"],
    "data",
  );
  if (data.contract_version !== CONTRACT_VERSION) {
    throw new Error(`Unsupported Itô capability contract ${JSON.stringify(data.contract_version)}.`);
  }

  const cli = assertPlainObject(data.cli, "cli");
  assertExactKeys(cli, ["name", "version", "private"], "cli");
  if (
    cli.name !== "ito-compute-cli"
    || typeof cli.version !== "string"
    || !cli.version
    || cli.private !== true
  ) {
    throw new Error("Invalid Itô capability contract: unexpected private CLI identity.");
  }

  const outputContract = assertPlainObject(data.output_contract, "output_contract");
  assertExactKeys(
    outputContract,
    ["json_success_envelope", "errors_on_stderr", "unsupported_commands_contact_nothing"],
    "output_contract",
  );
  if (
    outputContract.json_success_envelope !== true
    || outputContract.errors_on_stderr !== true
    || outputContract.unsupported_commands_contact_nothing !== true
  ) {
    throw new Error("Invalid Itô capability contract: required output guarantees are absent.");
  }

  if (
    !Array.isArray(data.mcp_tools)
    || data.mcp_tools.length !== MCP_TOOLS.length
    || data.mcp_tools.some((tool, index) => tool !== MCP_TOOLS[index])
  ) {
    throw new Error("Invalid Itô capability contract: MCP tool surface changed.");
  }
  if (!Array.isArray(data.commands) || data.commands.length < 1 || data.commands.length > MAX_COMMANDS) {
    throw new Error("Invalid Itô capability contract: commands must be a bounded non-empty array.");
  }

  const seen = new Set();
  const commands = data.commands.map((entry, index) => {
    const command = assertPlainObject(entry, `commands[${index}]`);
    assertExactKeys(
      command,
      ["name", "availability", "auth", "network", "side_effect", "authority"],
      `commands[${index}]`,
    );
    if (typeof command.name !== "string" || !COMMAND_PATTERN.test(command.name)) {
      throw new Error("Invalid Itô capability contract: malformed command name.");
    }
    if (seen.has(command.name)) {
      throw new Error(`Invalid Itô capability contract: duplicate command ${command.name}.`);
    }
    seen.add(command.name);
    for (const field of ["availability", "auth", "network", "side_effect", "authority"]) {
      assertEnum(command[field], field);
    }
    return Object.freeze({ ...command });
  });

  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    cli: Object.freeze({ ...cli }),
    commands: Object.freeze(commands),
    mcp_tools: Object.freeze([...data.mcp_tools]),
    output_contract: Object.freeze({ ...outputContract }),
  });
}

function commandCapability(manifest, requestedCommand) {
  const capability = manifest.commands.find(({ name }) => name === requestedCommand);
  if (!capability || capability.availability !== "supported") {
    throw new Error(
      `The installed canonical Itô CLI does not advertise ${JSON.stringify(requestedCommand)} as supported.`,
    );
  }
  return capability;
}

function authorizeEccCapability(manifest, requestedCommand) {
  const capability = commandCapability(manifest, requestedCommand);
  const policy = EXPLICIT_EFFECT_POLICY[requestedCommand];
  if (policy) {
    if (Object.entries(policy).every(([field, expected]) => capability[field] === expected)) {
      return capability;
    }
    throw new Error(
      `Itô command ${JSON.stringify(requestedCommand)} is outside ECC's safe policy: ${capability.side_effect}.`,
    );
  }
  if (
    capability.side_effect === "none"
    && capability.authority === "none"
    && capability.network !== "explicit_nodes"
  ) {
    return capability;
  }
  throw new Error(
    `Itô command ${JSON.stringify(requestedCommand)} is outside ECC's safe policy: ${capability.side_effect}.`,
  );
}

module.exports = Object.freeze({
  CONTRACT_VERSION,
  authorizeEccCapability,
  parseItoCapabilities,
});
