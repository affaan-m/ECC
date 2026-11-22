# MCP Catalog `@latest` Pins — AgentShield Evidence

Generated on 2026-11-22 with `ecc-agentshield@1.6.0` (npm integrity
`sha512-lpeHG96DtEn7ofq7Iiyvq29piQOwParaiZOdDB206i4ZeCL4yjwT6xN5BSGI4yhCEAN0eO0f9F9hxHLBuRqf/g==`),
installed with `--ignore-scripts`. Only static analysis was run: no prompt
injection testing, sandbox execution, taint or LLM analysis, and no auto-fix.
No MCP server from the catalog was started.

## Scope

The change replaces the three `@latest` selectors in
`mcp-configs/mcp-servers.json` with exact versions:
`@supabase/mcp-server-supabase@0.17.0`, `@upstash/context7-mcp@4.7.0` and
`@magicuidesign/mcp@2.1.0`. The scan root is `mcp-configs/` from the tree under
review, extracted into an empty directory so that no other part of the
repository is scanned:

```bash
git archive HEAD mcp-configs | tar -x -C <scan-root>
npx --yes ecc-agentshield@1.6.0 scan --path <scan-root> \
  --format json --evidence-pack <temporary-directory>
```

The same root was built from `main` at `6aacada6`, saved with
`--save-baseline`, and compared with `--baseline <file> --gate`.

`mcp-catalog-pin-latest-agentshield.sarif` is the redacted
`agentshield-results.sarif` from the evidence pack of this branch (commit
`82cf1f0f`). AgentShield replaced the scan root with the placeholder
`<target-path>`, which is not a valid SARIF URI, so the optional
`invocations[].workingDirectory` object was removed; the findings and their
repository-relative locations are unchanged. The file contains no local path,
username, credential or token.

## Result

| | this branch (`82cf1f0f`) | `main` (`6aacada6`) |
| --- | ---: | ---: |
| Exit code | 0 | 0 |
| Files scanned | 1 | 1 |
| Score / grade | 98 / A | 98 / A |
| Critical / high | 0 / 0 | 0 / 0 |
| Medium / low / info | 15 / 46 / 0 | 15 / 49 / 0 |
| Total findings | 61 | 64 |

## Baseline comparison

`--gate` against `main` exits 0: no new findings. Three low findings are
removed, one for each pinned entry:

| Removed finding | Severity |
| --- | --- |
| `mcp-no-version-supabase`: `@supabase/mcp-server-supabase@latest` | low |
| `mcp-no-version-context7`: `@upstash/context7-mcp@latest` | low |
| `mcp-no-version-magic`: `@magicuidesign/mcp@latest` | low |

## Boundaries

- A static configuration scan; it does not assess the pinned packages' code,
  their transitive dependencies, npm provenance, or runtime behavior.
- The pinned versions were selected by the maintainer from npm registry
  metadata, not from a registry "latest" lookup.
- Other unpinned (bare package name) entries in the catalog are out of scope.
