# Grok remote marketplace evidence

This run verified marketplace retrieval from a temporary public GitHub
repository using Grok Build 1.0.62 on Linux x64. The disposable catalog
repository's `main` contained `.grok-plugin/marketplace.json` pinned to the
full ECC source in the author's fork at PR head
`1ad6fbc88e9ff67a36c2f21fee87e5c1cffa39e1`.

Grok fetched the remote catalog, listed `ecc` as available, installed
`ecc@ecc-grok-marketplace-smoke-20261021-a1d6fbc8`, and reported the exact
source URL and SHA in its Git registry. The installed tree was a snapshot, not
a symlink; `grok inspect` discovered the ECC plugin and skills with hooks and
MCP disabled. Removing the marketplace removed the plugin, registry entry, and
native discovery state.

The machine-readable [receipt](grok-remote-marketplace.json) records the
temporary catalog commit, runtime and executable identity, source SHA,
installation readbacks, and cleanup. The test repository and isolated Grok home
were deleted after the run. No GitHub credentials were passed to Grok; network
access used the configured proxy.

This verifies public GitHub marketplace fetching and immutable plugin-source
installation. It does not exercise an authenticated model turn, hooks/MCP
execution, or a Grok-hosted marketplace publication workflow.
