# MCP Installation Safety Policy (#2959)

All ECC setup guides and MCP configuration examples must meet these baseline requirements:

1. **Official Vendor / Source Link**: Link only to the official publisher repository or package page.
2. **Publisher Identity Verification**: Confirm namespace, package ownership, and verified dates rather than citing unverified claims.
3. **Version & Integrity Pinning**: Pin exact versions (`package@x.y.z`) or commit SHAs/hashes whenever supported by the runtime.
4. **Explicit Tool Allowlisting**: Review exposed MCP tools before enabling and prefer minimal tool subsets over wildcard grants.
5. **Least Privilege & Secret Isolation**: Scope environment credentials strictly to the server that requires them and never commit plaintext keys.
