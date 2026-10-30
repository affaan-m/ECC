# ECC skill contribution review contract

The compiler prepares packets for skill contributions only
(`changeKind: "skill"`). It validates the shape and internal consistency of
supplied observations; it does not independently
inspect repository files, Git state, CI, tests, coverage, or evidence refs.
Every structurally valid packet returns `require_review`. Contradictions
return `reject`. Neither result approves or qualifies a contribution.

The envelope requires `schemaVersion: "1.0.0"`, an ISO 8601 `observedAt`
timestamp with a timezone, and a nonempty string `subjectRef`. Unsupported
versions and malformed identifiers produce validation faults.

The local observation contract checks for:

- exact active repository, non-default branch, base/head, package lock, install
  manifests, catalog script, placement policy, and checkpoint identity;
- a bounded, non-breaking skill change under `skills/` with no unnecessary
  command shim;
- one canonical curated source, explicit non-generated artifacts, manifest
  coverage, tests, and required harness metadata;
- normalized content parity across Claude, Codex, and Cursor with zero drift;
- filesystem/documented counts, manifest coverage, intentional unshipped
  exceptions, catalog check, and command registry reconciled, with nonnegative
  curated and intentionally unshipped skill counts;
- observed RED/GREEN/REFACTOR, named failing tests, passing behavior tests, and
  line/function/branch/statement coverage between 80% and 100% inclusive;
- eight green validators, security and supply-chain review, bounded change/test
  budgets, twelve hostile probes, and seven typed runners;
- a concise conventional commit proposal, while commit/push/PR effects remain
  false;
- no source-file, test, catalog, git, PR, Control Store, canonical-memory, or
  Semantic Commit claim or requested effect;
- every generated `may*` authority false.

Contradictions reject. Missing or malformed observations require review.
