---
name: ecc-go
description: Implement, review, and test Go packages, concurrency, error handling, table tests, fuzz tests, and benchmarks.
---

# Go development

Read `go.mod`, any `toolchain` directive, CI, and local project instructions before
choosing APIs. Preserve package boundaries and the existing dependency policy.

- Make cancellation and goroutine ownership explicit. Bound worker counts and
  queues; ensure every goroutine can finish and channels have clear owners.
- Pass context through request paths; propagate wrapped errors without hiding
  `errors.Is`/`errors.As` behavior. Distinguish EOF, cancellation, and failures.
- Keep interfaces at consumers and avoid abstractions without a second use.
- Validate with the repository's commands. Typical checks are `gofmt`, `go vet`,
  and `go test ./...`; race checks require a supported toolchain and target.

For package design, interfaces, errors, or concurrency, read [patterns](references/patterns.md).
For table tests, fuzzing, benchmarks, or race diagnosis, read [testing](references/testing.md).
Use meaningful behavior and failure-path tests; follow the project's coverage policy.
