---
name: evm-token-decimals
description: EVMチェーン全体でサイレントな小数点不一致バグを防ぐ。ランタイムでの小数点照会、チェーン対応キャッシング、ブリッジドトークンの精度ドリフト、ボット・ダッシュボード・DeFiツール向けの安全な正規化をカバーします。
origin: ECC direct-port adaptation
version: "1.0.0"
---

# EVMトークン小数点

サイレントな小数点不一致は、エラーを発生させることなく残高やUSD値が桁違いになる最も簡単な方法のひとつです。

## 使用するタイミング

- Python、TypeScript、またはSolidityでERC-20残高を読み取る場合
- オンチェーン残高から法定通貨の値を計算する場合
- 複数のEVMチェーン間でトークン量を比較する場合
- ブリッジされた資産を扱う場合
- ポートフォリオトラッカー、ボット、またはアグリゲーターを構築する場合

## 仕組み

ステーブルコインが同じ小数点を使用していると仮定しないでください。ランタイムで`decimals()`を照会し、`(chain_id, token_address)`でキャッシュし、値の計算には小数点安全な数学を使用します。

## 使用例

### ランタイムで小数点を照会する

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

シンボルが他の場所で通常6小数点を持つからといって`1_000_000`をハードコードしないでください。

### チェーンとトークンでキャッシュする

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

### 特殊なトークンを防御的に処理する

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

フォールバックをログに記録して可視化しておく。古いまたは非標準トークンはまだ存在します。

### SolidityでWAD（18小数点）に正規化する

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

### ethersを使ったTypeScript

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

### クイックなオンチェーン確認

```bash
cast call <token_address> "decimals()(uint8)" --rpc-url <rpc>
```

## ルール

- 常にランタイムで`decimals()`を照会する
- シンボルではなく、チェーンとトークンアドレスでキャッシュする
- floatではなく`Decimal`、`BigInt`、または同等の正確な数学を使用する
- ブリッジングやラッパーの変更後は小数点を再照会する
- 比較や価格計算の前に内部会計を一貫して正規化する
