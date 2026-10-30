# Skill contribution workflow

1. Resolve the active ECC checkout, non-default branch, base/head, package lock,
   manifests, catalog script, placement policy, and checkpoint.
2. Use `changeKind: "skill"` and name the canonical source under `skills/`
   before editing a mirror. This version supports skill contributions only.
3. Observe RED with named failing behaviors.
4. Implement GREEN in the canonical surface, then REFACTOR.
5. Update only required install manifests, documentation, and harness adapters.
6. Normalize content identity across Claude, Codex, and Cursor; record every
   intentional frontmatter or metadata adaptation.
7. Reconcile agent, skill, command, manifest, catalog, registry, and intentionally
   unshipped counts.
8. Run the eight exact validation gates and record argv, exit status, and
   evidence.
9. Check secrets, personal paths, permissions, hooks, prompt-injection boundary,
   supply chain, coverage, breaking-change status, and budgets.
10. Compile the review packet. The compiler checks supplied claims for shape and
    internal consistency but does not verify referenced evidence or approve a
    contribution. Exit code 0 means a packet was emitted without reported
    faults or contradictions; review is still required. Exit code 2 means
    validation faults, contradictions, or an input/output error. A diagnostic
    packet may still be emitted with exit code 2. Inspect the packet and stderr;
    the exit code alone does not establish whether output exists. Resolve
    every contradiction and semantic page fault before preparing a commit.
11. The compiler runs no proposed runners. Obtain separate authorization
    before implementation-file, test, catalog, commit, push, PR, Control Store,
    canonical-memory, or Semantic Commit effects.
12. Supersede the packet on HEAD, policy, manifest, catalog, adapter, test,
    coverage, security, or review drift.
