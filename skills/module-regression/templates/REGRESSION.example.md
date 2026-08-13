# REGRESSION.md — Module Regression Ledger

> After each relevant change, locate the changed module, run its acceptance command plus every required downstream command, and deliver only when all exit codes are green.
> Refresh downstream relationships from reproducible repository evidence. Acceptance commands are the core asset; prefer reconciliation against external facts over weak mocks or assertions.
> If a module has no acceptance command, mark it `MISSING`. Never manufacture a green result.
>
> Downstream evidence last refreshed: 2026-06-09 using `<repository dependency graph or scan command>`

## Module 01 — Data Ingestion

- Downstream consumers: `02-cleaning`, `03-shop-mapping`
- Dependency evidence: `<repository dependency graph or reproducible scan command>`
- Regression acceptance command: `pytest tests/test_01.py`
- Propagation rule: output column/format changes require 02 and 03; internal logging-only changes may exempt downstream when this module is green
- Last green commit: `<commit>`

## Module 02 — Cleaning

- Downstream consumers: `05-aggregation`
- Dependency evidence: `<repository dependency graph or reproducible scan command>`
- Regression acceptance command: `pytest tests/test_02.py && python scripts/reconcile.py --module 02`
- Propagation rule: external behavior changes require 05
- Related test points: `TEST-ORDER-001`, `TEST-AMOUNT-002`
- Last green commit: `<commit>`

## Module 04 — Temporary Utility

- Downstream consumers: none
- Dependency evidence: `<repository dependency graph or reproducible scan command>`
- Regression acceptance command: `MISSING` — add the minimum executable check
- Propagation rule: none
- Related test points: `MISSING` — inventory in the test registry
