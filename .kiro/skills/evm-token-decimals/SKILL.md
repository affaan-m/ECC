---
name: evm-token-decimals
description: Prevent silent decimal mismatch bugs across EVM chains. Covers runtime decimal lookup, chain-aware caching, bridged-token precision drift, and safe normalization for bots, dashboards, and DeFi tools.
origin: ECC direct-port adaptation
version: "1.0.0"
---

# EVM Token Decimals

Silent decimal mismatches are one of the easiest ways to ship balances or USD values that are off by orders of magnitude without throwing an error.

## When to Use

- Reading ERC-20 balances in Python, TypeScript, or Solidity
- Calculating fiat values from on-chain balances
- Comparing token amounts across multiple EVM chains
- Handling bridged assets
- Building portfolio trackers, bots, or aggregators

## How It Works

Never assume stablecoins use the same decimals everywhere. Query `decimals()` at runtime, cache by `(chain_id, token_address)`, and use decimal-safe math for value calculations.

## Examples

### Query decimals at runtime

```python
from decimal import Decimal
from web3 import Web3

ERC20_ABI = [
    {"name": "decimals", "type": "function", "inputs": [],
     "outputs": [{"type": "uint8"}], "stateMutability": "view"},
    {"name": "balanceOf", "type": "function",
     "inputs": [{"name": "account", "type": "address"}],
     "outputs": [{"type": "uint256"}], "stateMutability": "view"},
]

def get_token_balance(w3: Web3, token_address: str, wallet: str) -> Decimal:
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(token_address),
        abi=ERC20_ABI,
    )
    decimals = contract.functions.decimals().call()
    raw = contract.functions.balanceOf(Web3.to_checksum_address(wallet)).call()
    return Decimal(raw) / Decimal(10 ** decimals)
```

Do not hardcode `1_000_000` because a symbol usually has 6 decimals somewhere else.

### Cache by chain and token

```python
from functools import lru_cache

@lru_cache(maxsize=512)
def get_decimals(chain_id: int, token_address: str) -> int:
    w3 = get_web3_for_chain(chain_id)
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(token_address),
        abi=ERC20_ABI,
    )
    return contract.functions.decimals().call()
```

### Handle odd tokens defensively

```python
try:
    decimals = contract.functions.decimals().call()
except Exception:
    logging.warning(
        "decimals() reverted on %s (chain %s), defaulting to 18",
        token_address,
        chain_id,
    )
    decimals = 18
```

Log the fallback and keep it visible. Old or non-standard tokens still exist.

### Normalize to 18-decimal WAD in Solidity

```solidity
interface IERC20Metadata {
    function decimals() external view returns (uint8);
}

function normalizeToWad(address token, uint256 amount) internal view returns (uint256) {
    uint8 d = IERC20Metadata(token).decimals();
    if (d == 18) return amount;
    if (d < 18) return amount * 10 ** (18 - d);
    return amount / 10 ** (d - 18);
}
```

### TypeScript with ethers

```typescript
import { Contract, formatUnits } from 'ethers';

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
];

async function getBalance(provider: any, tokenAddress: string, wallet: string): Promise<string> {
  const token = new Contract(tokenAddress, ERC20_ABI, provider);
  const [decimals, raw] = await Promise.all([
    token.decimals(),
    token.balanceOf(wallet),
  ]);
  return formatUnits(raw, decimals);
}
```

### Quick on-chain check

```bash
cast call <token_address> "decimals()(uint8)" --rpc-url <rpc>
```

## Rules

- Always query `decimals()` at runtime
- Cache by chain plus token address, not symbol
- Use `Decimal`, `BigInt`, or equivalent exact math, not float
- Re-query decimals after bridging or wrapper changes
- Normalize internal accounting consistently before comparison or pricing
