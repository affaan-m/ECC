---
name: ito-compute
description: Query live GPU inventory, submit an authenticated Itô fixed-rate RFQ, inspect RFQ or procurement status, and run explicitly gated node qualification through the separately installed canonical CLI. Use when a user asks to find H100/H200 capacity, request a fixed compute rate, check Itô compute status, or validate GPU nodes.
metadata:
  origin: ECC
---

# Itô Compute

Use the canonical Itô compute CLI or MCP server. ECC does not implement a
parallel client, browser handoff, local simulation, reservation, workload
runner, or inference server.

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
Inject `ITO_API_KEY` through 1Password or the launching process environment.
Never put it in arguments, tracked files, MCP results, logs, or chat.

## CLI workflow

1. Run `ecc ito auth` before the first operation.
2. Before `ecc ito find`, obtain explicit buyer authority to submit an RFQ.
   - Require `gpu`, `count`, whole `days`, `max-rate`, `nodes`,
     `gpus-per-node`, `storage-tb`, `start-window`, `form-factor`,
     `contract-type`, `fabric`, `region`, and the split-fill decision.
   - Require `count == nodes * gpus-per-node`; never derive topology.
   - Use `any` only when the buyer explicitly accepts any fabric or region.
   - Omitted `--allow-split` means false.
3. Run the live RFQ command:

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

4. Run `ecc ito status` to inspect RFQs and procurement orders.
   After an ambiguous transport failure, check status before repeating `find`.

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

Use `ito_auth`, gather explicit buyer authority and every hard constraint, call
`ito_find`, then poll with `ito_status` when needed.

## Unsupported operations

The supported client surface cannot lock quotes, reserve capacity, execute
workloads, or serve inference. The MCP server does not expose qualification;
use the explicit CLI command above. Do not invent additional tools or a
purchase path. Do not substitute a browser or fixture when the local CLI is
missing or a live operation fails. Report the missing capability and stop.
