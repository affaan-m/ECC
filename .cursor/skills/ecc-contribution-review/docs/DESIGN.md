# ECC cross-harness skill contribution review

This compiler converts supplied skill observations into a structured contribution
review packet. It supports only `changeKind: "skill"`, with canonical source
under `skills/` and the required skill artifacts and harness mirrors. It checks
the declared source ownership, generated-root exclusion, install coverage, cross-harness identity, catalog reconciliation,
TDD claims, security claims, validation gates, and commit proposal for internal
consistency. It does not inspect the repository or independently verify any
claim or referenced evidence, so it cannot establish contribution readiness.

PCCA ownership:

- observation-and-data: repository, diff, artifact, gate, count, and coverage
  observations;
- epistemic-and-lineage: base/head, hashes, canonical source, mirrors, and test
  evidence;
- state-and-relationship: artifact graph, harness parity, manifests, catalogs,
  and checkpoint;
- cognitive-control: TDD, gate selection, coverage, and commit formulation;
- meta-control: contradiction detection, page faults, hostile probes, and typed
  runners;
- viability-and-policy: security, provenance, breaking-change, budget, and
  external-effect boundaries.

The semantic checksum uses sorted compact UTF-8 JSON and excludes
`artifactId`, `semanticChecksum`, and `returnReceipt`. The compiler writes a
capsule file only when the caller supplies `--output`; the receipt distinguishes
that generated artifact from implementation-file changes.
