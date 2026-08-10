---
name: ito-training
description: Run an ML training job on a completed Itô compute booking through the canonical Itô backend. Use after ito-compute has booked GPU nodes and the user wants pre-training, fine-tuning, or RL on that metal. Chains off a booking record; ECC implements no training stack of its own.
metadata:
  origin: ECC
---

# Itô Training

Run training work on rented Itô metal by delegating to the canonical Itô compute
backend (Layer 0.3). ECC does not implement a parallel training stack, trainer,
or scheduler, and does no browser automation. This skill chains off a
**completed booking** from `ito-compute`; it never books, reserves, or spends.

## Prerequisite

A completed booking from the `ito-compute` skill (booking id, node IPs, SSH,
GPU SKU, node count, fabric) in harness memory. Without one, stop.

## Delegation

ECC calls the canonical backend through the `ecc ito` bridge; it never
re-implements training. Authenticate once with `ecc ito login`, as
`ito-compute` documents. Never put a key or token in arguments, files, logs, or
chat.

```sh
ecc ito train \
  --booking <booking-id> \
  --model-size <e.g. 8B> \
  --data <data-ref> \
  --target <capability> \
  --budget-usd <ceiling> \
  [--post-training sft|dpo|rlvr]
```

## What the backend does (Layer 0.3)

The desk backend runs a staged, eval-gated pipeline; this skill reports stage
gates and never overrides one:

1. Data prep — manifest, dedup, decontamination against the eval suite;
   150M-ladder decision job as the cheap pre-check for custom data.
2. Parallelism and precision — selected from model size, node count, fabric;
   wasteful combinations refused.
3. Checkpointing and fault tolerance — async DCP, torchft; detect < 10 min,
   resume < 15 min. Loss-spike restart is a proposed, human-gated action.
4. Curriculum and eval gates — staged pretrain / mid-train / long-context /
   post-training, each with a fixed eval battery; a failed gate stops the run.
5. Post-training — SFT → DPO → RLVR (GRPO with DAPO stability fixes),
   trainer/rollout separation with bounded staleness.

Emits desk telemetry (goodput, interruption rate, checkpoint bandwidth) so the
desk prices training blocks honestly.

## Unavailable today

Not yet wired: the canonical CLI's `run` verb and the desk `training-run`
backend are scaffolds. Until they land, this skill reports the missing
capability and stops. Never substitute a local trainer or a purchase endpoint.
