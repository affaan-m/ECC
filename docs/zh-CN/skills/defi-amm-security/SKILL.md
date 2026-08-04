---
name: defi-amm-security
description: Solidity AMM 合约、流动性池和交换流程的安全检查清单。涵盖重入、CEI 排序、捐赠或通胀攻击、预言机操纵、滑点、管理员控制和整数数学。
origin: ECC direct-port adaptation
version: "1.0.0"
---

# DeFi AMM 安全

Solidity AMM 合约、LP 金库和交换函数的关键漏洞模式及强化实现。

## 适用场景

* 编写或审计 Solidity AMM 或流动性池合约
* 实现持有代币余额的交换、存款、提款、铸造或销毁流程
* 审查任何在份额或储备金计算中使用 `token.balanceOf(address(this))` 的合约
* 向 DeFi 协议添加费用设置器、暂停器、预言机更新或其他管理功能

## 工作原理

将其作为检查清单加模式库使用。对照以下类别审查每个用户入口点，并优先使用强化示例而非自行编写的变体。

## 执行安全

本技能中的 shell 命令是本地审计示例。仅在受信任的代码检出或一次性沙箱中运行，不要将不受信任的合约名称、路径、RPC URL、私钥或用户提供的标志拼接到 shell 命令中。在安装工具或运行可能消耗大量本地或付费资源的长时间模糊测试/静态分析任务前，请先询问。

切勿在命令示例、日志或报告中包含机密信息、私钥、助记词、API 令牌或主网签名凭证。

## 示例

### 重入攻击：强制遵循 CEI 顺序

存在漏洞：

```solidity
function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount);
    token.transfer(msg.sender, amount);
    balances[msg.sender] -= amount;
}
```

安全：

```solidity
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

using SafeERC20 for IERC20;

function withdraw(uint256 amount) external nonReentrant {
    require(balances[msg.sender] >= amount, "Insufficient");
    balances[msg.sender] -= amount;
    token.safeTransfer(msg.sender, amount);
}
```

当存在经过验证的库时，不要自行编写防护措施。

### 捐赠或通胀攻击

直接使用 `token.balanceOf(address(this))` 进行份额计算，会让攻击者通过向合约发送代币（绕过预期路径）来操纵分母。

```solidity
// Vulnerable
function deposit(uint256 assets) external returns (uint256 shares) {
    shares = (assets * totalShares) / token.balanceOf(address(this));
}
```

```solidity
// Safe
uint256 private _totalAssets;

function deposit(uint256 assets) external nonReentrant returns (uint256 shares) {
    uint256 balBefore = token.balanceOf(address(this));
    token.safeTransferFrom(msg.sender, address(this), assets);
    uint256 received = token.balanceOf(address(this)) - balBefore;

    shares = totalShares == 0 ? received : (received * totalShares) / _totalAssets;
    _totalAssets += received;
    totalShares += shares;
}
```

跟踪内部会计并衡量实际收到的代币。

### 预言机操纵

现货价格可通过闪电贷操纵。优先使用 TWAP。

```solidity
uint32[] memory secondsAgos = new uint32[](2);
secondsAgos[0] = 1800;
secondsAgos[1] = 0;
(int56[] memory tickCumulatives,) = IUniswapV3Pool(pool).observe(secondsAgos);
int24 twapTick = int24(
    (tickCumulatives[1] - tickCumulatives[0]) / int56(uint56(30 minutes))
);
uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(twapTick);
```

### 滑点保护

每个交换路径都需要调用者提供的滑点和截止时间。

```solidity
function swap(
    uint256 amountIn,
    uint256 amountOutMin,
    uint256 deadline
) external returns (uint256 amountOut) {
    require(block.timestamp <= deadline, "Expired");
    amountOut = _calculateOut(amountIn);
    require(amountOut >= amountOutMin, "Slippage exceeded");
    _executeSwap(amountIn, amountOut);
}
```

### 安全的储备金计算

```solidity
import {FullMath} from "@uniswap/v3-core/contracts/libraries/FullMath.sol";

uint256 result = FullMath.mulDiv(a, b, c);
```

对于大型储备金计算，当存在溢出风险时，避免使用简单的 `a * b / c`。

### 管理控制

```solidity
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract MyAMM is Ownable2Step {
    function setFee(uint256 fee) external onlyOwner { ... }
    function pause() external onlyOwner { ... }
}
```

所有权转移应优先使用显式接受，并对每个特权路径设置门控。

## 安全检查清单

* 暴露于重入攻击的入口点使用 `nonReentrant`
* 遵循 CEI 顺序
* 份额计算不依赖原始的 `balanceOf(address(this))`
* ERC-20 转账使用 `SafeERC20`
* 存款衡量实际收到的代币
* 预言机读取使用 TWAP 或其他抗操纵源
* 交换需要 `amountOutMin` 和 `deadline`
* 对溢出敏感的储备金计算使用安全原语，如 `mulDiv`
* 管理函数受访问控制
* 存在紧急暂停功能并经过测试
* 在生产前运行静态分析和模糊测试

## 审计工具

```bash
pip install slither-analyzer
slither . --exclude-dependencies

echidna-test . --contract YourAMM --config echidna.yaml

forge test --fuzz-runs 10000
```
