---
name: ito-inference
description: Serve a model on a completed Itô compute booking through the canonical Itô backend. Use after ito-compute has booked GPU nodes and the user wants an OpenAI-compatible endpoint on that metal. Chains off a booking record; ECC implements no serving stack of its own.
metadata:
  origin: ECC
---

# Itô Inference

Serve a model on rented Itô metal by delegating to the canonical Itô compute
backend (Layer 0.2). ECC does not implement a parallel serving stack, launch
adapter, or inference server, and does no browser automation. This skill chains
off a **completed booking** produced by `ito-compute`; it never books, reserves,
or spends.

## Prerequisite

A completed booking from the `ito-compute` skill: booking id, node IPs, SSH
access, GPU SKU, node count, and fabric, already recorded in harness memory.
Without a booking record, stop — this skill does not provision.

## Delegation

ECC calls the canonical backend through the `ecc ito` bridge; it never
re-implements serving. Authenticate once with `ecc ito login` (device
authorization; no key in arguments, files, logs, or chat), exactly as
`ito-compute` documents.

```sh
ecc ito serve \
  --booking <booking-id> \
  --model <hf-model-id> \
  [--quantization <scheme>] \
  [--ttft-ms <target>] [--tpot-ms <target>]
```

The `--ttft-ms` / `--tpot-ms` SLO is optional; supplying it turns on
disaggregated prefill/decode, which is off by default.

## What the backend does (Layer 0.2)

The desk backend, not ECC, runs the stages, and this skill only reports them:

1. Fabric gate — never launch on unverified metal. Blocks below 80% of
   fabric-expected bus bandwidth; advisory between 80% and 92%; fails loud on
   silent NCCL socket fallback.
2. Weights download and shard to the serving layout (desk-side sharded cache
   keyed by model, quantization, TP degree).
3. Topology plan (AIConfigurator): TP inside the NVLink domain, PP across nodes;
   engine flags emitted as a reviewable file before launch.
4. Launch (vLLM, Dynamo when disaggregating) under systemd, warmup, SLO canary,
   and registration of the endpoint URL and config to Graphiti memory.

## Unavailable today

The serving operation is not yet wired: the canonical CLI's `inference` verb and
the desk `serve-on-booking` backend are scaffolds. Until they land, this skill
reports the missing capability and stops. Never substitute a local runner or a
purchase endpoint.
