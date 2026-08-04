---
name: nodejs-keccak256
description: 防止 JavaScript 和 TypeScript 中的以太坊哈希错误。Node 的 sha3-256 是 NIST SHA3，而非以太坊 Keccak-256，会静默破坏选择器、签名、存储槽和地址推导。
origin: ECC direct-port adaptation
version: "1.0.0"
---

# Node.js Keccak-256

以太坊使用 Keccak-256，而非 Node 的 `crypto.createHash('sha3-256')` 所暴露的 NIST 标准化 SHA3 变体。

## 何时使用

* 计算以太坊函数选择器或事件主题
* 在 JS/TS 中构建 EIP-712、签名、Merkle 或存储槽辅助函数
* 审查任何直接使用 Node crypto 对以太坊数据进行哈希的代码

## 工作原理

两种算法对相同输入会产生不同输出，且 Node 不会发出警告。

```javascript
import crypto from 'crypto';
import { keccak256, toUtf8Bytes } from 'ethers';

const data = 'hello';
const nistSha3 = crypto.createHash('sha3-256').update(data).digest('hex');
const keccak = keccak256(toUtf8Bytes(data)).slice(2);

console.log(nistSha3 === keccak); // false
```

## 示例

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

### 常见模式

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

### 从公钥生成地址

```typescript
import { keccak256 } from 'ethers';

function pubkeyToAddress(pubkeyBytes: Uint8Array): string {
  const hash = keccak256(pubkeyBytes.slice(1));
  return '0x' + hash.slice(-40);
}
```

### 审计你的代码库

```bash
grep -rn "createHash.*sha3" --include="*.ts" --include="*.js" --exclude-dir=node_modules .
grep -rn "keccak256" --include="*.ts" --include="*.js" . | grep -v node_modules
```

## 规则

在以太坊上下文中，切勿使用 `crypto.createHash('sha3-256')`。应使用来自 `ethers`、`viem`、`web3` 或其他明确 Keccak 实现的 Keccak 感知辅助函数。
