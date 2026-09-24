---
name: nodejs-keccak256
description: JavaScriptとTypeScriptにおけるEthereumハッシュバグを防ぐ。NodeのSHA3-256はNIST SHA3であり、Ethereum Keccak-256ではなく、セレクター、署名、ストレージスロット、アドレス導出を静かに破壊する。
origin: ECC direct-port adaptation
version: "1.0.0"
---

# Node.js Keccak-256

EthereumはKeccak-256を使用し、Nodeの`crypto.createHash('sha3-256')`が公開するNIST標準化SHA3バリアントではない。

## 使用するタイミング

- Ethereum関数セレクターやイベントトピックの計算
- JS/TSでEIP-712、署名、Merkle、またはストレージスロットヘルパーの構築
- Nodeのcryptoを直接使用してEthereumデータをハッシュするコードのレビュー

## 仕組み

2つのアルゴリズムは同じ入力に対して異なる出力を生成し、Nodeは警告しない。

```javascript
import crypto from 'crypto';
import { keccak256, toUtf8Bytes } from 'ethers';

const data = 'hello';
const nistSha3 = crypto.createHash('sha3-256').update(data).digest('hex');
const keccak = keccak256(toUtf8Bytes(data)).slice(2);

console.log(nistSha3 === keccak); // false
```

## 例

### ethers v6

```typescript
import { keccak256, toUtf8Bytes, solidityPackedKeccak256, id } from 'ethers';

const hash = keccak256(new Uint8Array([0x01, 0x02]));
const hash2 = keccak256(toUtf8Bytes('hello'));
const topic = id('Transfer(address,address,uint256)');
const packed = solidityPackedKeccak256(
  ['address', 'uint256'],
  ['0x742d35Cc6634C0532925a3b8D4C9B569890FaC1c', 100n],
);
```

### viem

```typescript
import { keccak256, toBytes } from 'viem';

const hash = keccak256(toBytes('hello'));
```

### web3.js

```javascript
const hash = web3.utils.keccak256('hello');
const packed = web3.utils.soliditySha3(
  { type: 'address', value: '0x742d35Cc6634C0532925a3b8D4C9B569890FaC1c' },
  { type: 'uint256', value: '100' },
);
```

### 一般的なパターン

```typescript
import { id, keccak256, AbiCoder } from 'ethers';

const selector = id('transfer(address,uint256)').slice(0, 10);
const typeHash = keccak256(toUtf8Bytes('Transfer(address from,address to,uint256 value)'));

function getMappingSlot(key: string, mappingSlot: number): string {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [key, mappingSlot]),
  );
}
```

### 公開鍵からアドレス

```typescript
import { keccak256 } from 'ethers';

function pubkeyToAddress(pubkeyBytes: Uint8Array): string {
  const hash = keccak256(pubkeyBytes.slice(1));
  return '0x' + hash.slice(-40);
}
```

### コードベースの監査

```bash
grep -rn "createHash.*sha3" --include="*.ts" --include="*.js" --exclude-dir=node_modules .
grep -rn "keccak256" --include="*.ts" --include="*.js" . | grep -v node_modules
```

## ルール

Ethereumコンテキストでは、`crypto.createHash('sha3-256')`を絶対に使用しない。`ethers`、`viem`、`web3`、または別の明示的なKeccak実装のKeccak対応ヘルパーを使用すること。
