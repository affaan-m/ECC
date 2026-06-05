---
name: defi-amm-security
description: Security checklist for Solidity AMM contracts, liquidity pools, and swap flows. Covers reentrancy, CEI ordering, donation or inflation attacks, oracle manipulation, slippage, admin controls, and integer math.
origin: ECC direct-port adaptation
version: "1.0.0"
---

# DeFi AMM Security

Critical vulnerability patterns and hardened implementations for Solidity AMM contracts, LP vaults, and swap functions.

## When to Use

- Writing or auditing a Solidity AMM or liquidity-pool contract
- Implementing swap, deposit, withdraw, mint, or burn flows that hold token balances
- Reviewing any contract that uses `token.balanceOf(address(this))` in share or reserve math
- Adding fee setters, pausers, oracle updates, or other admin functions to a DeFi protocol

## How It Works

Use this as a checklist-plus-pattern library. Review every user entrypoint against the categories below and prefer the hardened examples over hand-rolled variants.

## Execution Safety

The shell commands in this skill are local audit examples. Run them only in a trusted checkout or disposable sandbox, and do not splice untrusted contract names, paths, RPC URLs, private keys, or user-supplied flags into shell commands. Ask before installing tools or running long fuzzing/static-analysis jobs that may consume significant local or paid resources.

Never include secrets, private keys, seed phrases, API tokens, or mainnet signing credentials in command examples, logs, or reports.

## Examples

### Reentrancy: enforce CEI order

Vulnerable:

```solidity
function withdraw(uint256 amount) external {
    require(balances[msg.sender] >= amount);
    token.transfer(msg.sender, amount);
    balances[msg.sender] -= amount;
}
```

Safe:

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

Do not write your own guard when a hardened library exists.

### Donation or inflation attacks

Using `token.balanceOf(address(this))` directly for share math lets attackers manipulate the denominator by sending tokens to the contract outside the intended path.

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

Track internal accounting and measure actual tokens received.

### Oracle manipulation

Spot prices are flash-loan manipulable. Prefer TWAP.

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

### Slippage protection

Every swap path needs caller-provided slippage and a deadline.

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

### Safe reserve math

```solidity
import {FullMath} from "@uniswap/v3-core/contracts/libraries/FullMath.sol";

uint256 result = FullMath.mulDiv(a, b, c);
```

For large reserve math, avoid naive `a * b / c` when overflow risk exists.

### Admin controls

```solidity
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract MyAMM is Ownable2Step {
    function setFee(uint256 fee) external onlyOwner { ... }
    function pause() external onlyOwner { ... }
}
```

Prefer explicit acceptance for ownership transfer and gate every privileged path.

## Security Checklist

- Reentrancy-exposed entrypoints use `nonReentrant`
- CEI ordering is respected
- Share math does not depend on raw `balanceOf(address(this))`
- ERC-20 transfers use `SafeERC20`
- Deposits measure actual tokens received
- Oracle reads use TWAP or another manipulation-resistant source
- Swaps require `amountOutMin` and `deadline`
- Overflow-sensitive reserve math uses safe primitives like `mulDiv`
- Admin functions are access-controlled
- Emergency pause exists and is tested
- Static analysis and fuzzing are run before production

## Audit Tools

```bash
pip install slither-analyzer
slither . --exclude-dependencies

echidna-test . --contract YourAMM --config echidna.yaml

forge test --fuzz-runs 10000
```
