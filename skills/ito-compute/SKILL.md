---
name: ito-compute
description: Use the canonical Itô CLI for authenticated compute reads, RFQs, status, and gated node qualification.
---

# Itô Compute

Use the canonical Itô compute CLI or MCP server. ECC does not implement a
parallel client, local simulation, reservation, workload runner, or inference
server. ECC itself does no browser automation.

## When to Use

Use this skill to validate Itô device authorization, inspect capabilities,
submit an explicitly authorized fixed-rate RFQ, read RFQ/procurement/workload
status, revoke a device credential, or qualify named GPU nodes. Do not use it
to reserve or purchase capacity, move funds, or start, cancel, or clean up a
workload.

## How It Works

ECC resolves only the explicitly configured canonical CLI entry. Before each
target operation, it runs credential-free capability discovery, validates the
closed provider contract, applies ECC's stricter effect policy, and forwards a
least-privilege child environment. Unknown effects and direct-node commands
outside the exact `evals` policy fail closed.

## Install the canonical local package

`ito-compute-cli` is currently unpublished. Build it from its canonical
repository instead of using `npx`, `npm exec`, or an unverified package:

```sh
git clone https://github.com/Ito-Markets/ito-cloud-runtime.git
cd ito-cloud-runtime/cli/ito-compute-cli
npm ci
npm run check
```

Set `ECC_ITO_CLI_EXECUTABLE` to the explicit absolute built entry:

```text
/absolute/path/to/ito-cloud-runtime/cli/ito-compute-cli/dist/bin/ito.js
```

ECC never discovers this credential-bearing client through `PATH`.
`ecc ito login` performs device authorization and never inherits `ITO_API_KEY`.
The validation-only `auth`, plus `find`, `status`, and `workload-status`, forward
`ITO_API_KEY` directly when configured; `ITO_AUTH_MODE=legacy` is not required. Never put a
key or token in arguments, tracked files, MCP results, logs, or chat.

Before every forwarded operation, ECC invokes `capabilities --json` with a
credential-free environment and validates the closed `ito.cli.capabilities.v1`
contract. Run `ecc ito capabilities --json` to inspect that installed contract
directly. ECC automatically accepts supported commands only when they declare
no side effect, no authority, and no `explicit_nodes` network access. It keeps
explicit policy for login, logout, RFQ submission, status reconciliation, and
node qualification.
Workload start, cancel, and cleanup effects remain blocked.

## Examples

### CLI workflow

1. Run `ecc ito login` before the first operation. ECC delegates this to the
   canonical CLI's device authorization, which opens the Itô verification page
   by default and persists a device token in macOS Keychain. Use
   `ecc ito login --no-browser` to suppress the page handoff. ECC itself does no
   browser automation. If the originating agent cannot complete the signed-in
   browser step, hand the exact command to the user; after approval finishes,
   return to the originating task and continue with `ecc ito auth`.
   Device tokens use macOS Keychain by default. File-token fallback is explicit
   and its directory and token file must remain owner-only (0700 and 0600).
2. Run `ecc ito auth` to validate existing credentials; it never starts login
   and rejects `--no-browser`.
3. Before `ecc ito find`, obtain explicit buyer authority to submit an RFQ.
   - Require `gpu`, `count`, whole `days`, `max-rate`, `nodes`,
     `gpus-per-node`, `storage-tb`, `start-window`, `form-factor`,
     `contract-type`, `fabric`, `region`, and the split-fill decision.
   - Require `count == nodes * gpus-per-node`; never derive topology.
   - Use `any` only when the buyer explicitly accepts any fabric or region.
   - Omitted `--allow-split` means false.
4. Run the live RFQ command:

   ```sh
   ecc ito find \
     --gpu h200 \
     --count 8 \
     --nodes 1 \
     --gpus-per-node 8 \
     --days 30 \
     --storage-tb 1 \
     --start-window 2099-08-15 \
     --max-rate 3.00 \
     --form-factor bare_metal \
     --contract-type reservation \
     --fabric infiniband \
     --region us-east-1
   ```

5. Run `ecc ito status` to inspect RFQs and procurement orders.
   After an ambiguous transport failure, check status before repeating `find`.
6. Run `ecc ito workload-status <run-id>` to inspect an already existing
   entitled workload without starting, stopping, or cleaning it up.
7. Run `ecc ito logout` when the user explicitly asks to revoke this device.
   The canonical CLI keeps the local credential when remote revocation fails so
   the operator can retry; never delete the token manually as a substitute.

Inventory prices are indicative. An RFQ is not reserved capacity. Treat a rate
as fixed only when the canonical result contains a non-null firm quote.

## Live node qualification

`ecc ito evals` exposes the canonical CLI's narrow live adapter to a separately
installed `sixtytwo-cli==0.3.33`. It does not expose local fixture execution
through ECC.
Require all of the following before invoking it:

- operator authorization to contact the named nodes;
- `ITO_ENABLE_SIXTYTWO_LIVE=1`;
- `--live-sixtytwo`;
- an explicit node list; and
- an existing absolute config directory containing `sixtytwo.yaml`.

```sh
ecc ito evals \
  --cluster clu_prod_example \
  --live-sixtytwo \
  --nodes gpu-01,gpu-02 \
  --config-dir /absolute/path/to/qualification-config
```

The canonical adapter can run only the pinned version check and
`sixtytwo test --full` against the explicit nodes. It cannot rent, launch,
recover, repair, reset, purchase, or order resources. ECC does not forward
`ITO_API_KEY` or model/cloud credentials into node qualification.

## MCP workflow

Build the canonical package, then configure the stdio server with an absolute
path:

```json
{
  "mcpServers": {
    "ito-compute": {
      "command": "node",
      "args": [
        "/absolute/path/to/ito-cloud-runtime/cli/ito-compute-cli/dist/bin/ito-mcp.js"
      ]
    }
  }
}
```

The server exposes only:

- `ito_auth`
- `ito_find`
- `ito_status`

`ito_auth` validates existing credentials; it does not start device login. Use
`ito_auth`, gather explicit buyer authority and every hard constraint, call
`ito_find`, then poll with `ito_status` when needed.

## Rent or purchase semantics

`find` submits an RFQ and may return a firm quote, but it does not rent,
purchase, reserve, provision, or move funds. `status` is read-oriented, though
the provider endpoint may reconcile an existing procurement order. The passive
dashboard link in ECC help is a separate user-operated web route; do not open or
operate it as a substitute for a missing CLI capability.

## Unsupported operations

The ECC bridge cannot lock quotes, reserve capacity, start, cancel, or clean up
workloads, or serve inference. It may inspect an already existing workload when
the installed v1 capability contract advertises that no-side-effect command.
The MCP server does not expose qualification;
use the explicit CLI command above. Do not invent additional tools or a
purchase path. Do not substitute a browser or fixture when the local CLI is
missing or a live operation fails. Report the missing capability and stop.
