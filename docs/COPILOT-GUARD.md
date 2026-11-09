# Copilot shell and file guard

`scripts/hooks/copilot-guard.js` is a stateless pre-tool policy. Its input is
the normalized ECC hook payload, not a shell command to execute. It returns an
empty JSON object on stdout and exit 2 with a bounded policy reason on denial.
Invalid input fails closed. The adapter must translate exit 2 into Copilot's
native deny output and must distribute the runtime dependency closure.

## Implemented subset of P02

- Bash and PowerShell destructive classification uses the existing GateGuard
  `classifyDestructiveCommand` algorithm. The latter already includes a distinct
  PowerShell parser for aliases, pipeline deletion, script blocks, nested shell
  execution, .NET deletion and dynamic execution.
- Bash git hook bypass checks reuse `block-no-verify.js`.
- Literal PowerShell git invocations use a separate lexer for PowerShell quotes,
  backtick escapes, comments, statement boundaries and interpolated
  subexpressions. The resulting literal argument list is quoted and passed as
  data to the canonical git policy. No shell is launched. Known static shell
  wrappers are also inspected. PowerShell git environment overrides, git alias
  definitions and `Start-Process git` require operator review.
- Every normalized Edit/Write target, including patch move destinations supplied
  by the adapter, is checked through canonical sensitive-target and hardlink
  classification. Existing symlink targets are resolved by that classifier.
- Literal shell redirections and common file writers also use canonical target
  classification: Bash `cp`, `mv`, `tee`, `touch`, `install`, `rm`, `mkdir`, `ln`,
  and PowerShell content/item/copy/move/remove/rename writers and listed aliases.
  Bash command prefixes, substitutions and static nested `sh -c`/`eval` payloads
  are inspected. Dynamic or computed recognized-writer targets, PowerShell
  target lists, and writes after a directory change require operator review.
- Direct `git commit` requests inspect staged source through bounded read-only
  git invocations and the existing canonical content heuristics. Potential
  secrets and debugger statements block; console/TODO and commit-subject issues
  produce count-only advice. Git errors, timeouts and quota failures cannot be
  reported as passing. `--amend` does not skip staged inspection. Maximums are
  32 staged source files, 256 KiB per git output, 1 MiB total source and a
  2500 ms total subprocess budget. No linter is started by this preflight;
  end-of-response quality checks report toolchain status separately.
- Push requests reuse the canonical advisory reminder. Recognized dev-server
  requests produce a host-neutral log/background-execution reminder; no server
  is started, command rewritten or tmux window launched by the hook.

Denial is persistent across retries. This adapter deliberately does not invoke
the canonical GateGuard session-state machine: its destructive-retry allowance
and Claude transcript evidence do not establish permission in Copilot. Disabling
this policy is an operator action through the existing ECC hook controls; hook
output never grants an approval or creates evidence.

## Remaining work and limits

Native Windows delivery and feedback have not been tested. Optional complete
Read-before-edit evidence is now implemented in
[COPILOT-READ-EVIDENCE.md](COPILOT-READ-EVIDENCE.md): it checks successful pre/post
correlation, complete visible source, unchanged file identity/content, lifecycle
boundaries, available turn IDs and expiry. Search text and unknown/truncated
view output cannot create a proof. A proof never grants operator permission.
Native delivery of commit/push/dev-server feedback still needs verification.
Sensitive paths can include ordinary
`auth`, `billing`, `migrations`, and GitHub workflow source files because the
canonical algorithm classifies them as sensitive. Such edits are denied until
the operator reviews or disables this particular policy.

The policy is not a shell sandbox. A command can invoke an external script or
executable whose contents are not visible in the tool event; existing shell
aliases, functions, environment, script files and remote execution cannot be
fully inferred from literal command text. Sensitive writes made through arbitrary
Bash/PowerShell programs are not covered by the recognized-writer checks. Git
preflight requires a direct `git commit` in the attested workspace; `git -C`,
other global options before `commit`, or preceding directory changes require
operator review. Static nested commit invocations in PowerShell are not certified
by direct-command inspection. Further native evidence and policy are required
before claiming full shell or GateGuard coverage. The policy does not start tmux
or dev servers on any platform.

## Verification

Run `node tests/hooks/copilot-guard.test.js`. Stable denial/allowance cases are
identified by tool and corpus index in the test output. Tests inspect requests
without executing destructive commands. They cover repeated denials, safe git
commands, quoted inert text, nested invocation, sensitive batches, symlinks,
hardlinks, malformed/oversized input, and the stdin entry point. Linux fixture
success does not certify native PowerShell or Copilot behavior.
