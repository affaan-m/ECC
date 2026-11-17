# abi-selectors

Contract ABI tooling: compute Ethereum function selectors.

## Contract

`src/selector.js` is CommonJS and exports `functionSelector(signature)`:

- `signature` is the canonical function signature string, e.g.
  `"transfer(address,uint256)"` — no spaces, no argument names.
- Returns `"0x"` plus the first 4 bytes of the Keccak-256 hash of the UTF-8
  signature, as 8 lowercase hex characters.
- Throws `TypeError` for a non-string argument.
- Node.js standard library only; no external dependencies. Whatever hashing
  you need, implement it in this repo.
- Run the tests with `npm test`.

## Note

Ethereum uses **Keccak-256**, the original Keccak submission, which predates
the finalized NIST SHA3-256 standard. Mind that distinction.
