---
description: テスト駆動開発ワークフローを強制します。インターフェースをスキャフォールドし、最初にテストを生成し、次にテストに合格するための最小限のコードを実装します。80%以上のカバレッジを保証します。
---

# TDDコマンド

このコマンドは**tdd-guide**エージェントを呼び出し、テスト駆動開発の手法を強制します。

## このコマンドの機能

1. **インターフェースのスキャフォールド** - まず型/インターフェースを定義
2. **最初にテストを生成** - 失敗するテストを書く(RED)
3. **最小限のコードを実装** - テストに合格するだけのコードを書く(GREEN)
4. **リファクタリング** - テストを緑色に保ちながらコードを改善(REFACTOR)
5. **カバレッジの検証** - 80%以上のテストカバレッジを保証

## 使用するタイミング

以下の場合に`/tdd`を使用します:
- 新機能の実装時
- 新しい関数/コンポーネントの追加時
- バグ修正時(最初にバグを再現するテストを書く)
- 既存コードのリファクタリング時
- 重要なビジネスロジックの構築時

## 動作方法

tdd-guideエージェントは以下を実行します:

1. **インターフェースを定義**入力/出力の型を決定
2. **失敗するテストを書く**(コードがまだ存在しないため)
3. **テストを実行**し、正しい理由で失敗することを確認
4. **最小限の実装を書く**テストに合格させる
5. **テストを実行**し、合格することを確認
6. **リファクタリング**テストを緑色に保ちながらコードを改善
7. **カバレッジを確認**80%未満の場合はテストを追加

## TDDサイクル

```
RED → GREEN → REFACTOR → REPEAT

RED:      失敗するテストを書く
GREEN:    合格するための最小限のコードを書く
REFACTOR: コードを改善し、テストを合格状態に保つ
REPEAT:   次の機能/シナリオへ
```

## 使用例

```
User: /tdd マーケット流動性スコアを計算する関数が必要です

Agent (tdd-guide):
# TDDセッション: マーケット流動性スコア計算機

## ステップ1: インターフェースの定義(SCAFFOLD)

```typescript
// lib/liquidity.ts
export interface MarketData {
  totalVolume: number
  bidAskSpread: number
  activeTraders: number
  lastTradeTime: Date
}

export function calculateLiquidityScore(market: MarketData): number {
  // TODO: Implementation
  throw new Error('Not implemented')
}
```

## ステップ2: 失敗するテストを書く(RED)

```typescript
// lib/liquidity.test.ts
import { calculateLiquidityScore } from './liquidity'

describe('calculateLiquidityScore', () => {
  it('should return high score for liquid market', () => {
    const market = {
      totalVolume: 100000,
      bidAskSpread: 0.01,
      activeTraders: 500,
      lastTradeTime: new Date()
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBeGreaterThan(80)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('should return low score for illiquid market', () => {
    const market = {
      totalVolume: 100,
      bidAskSpread: 0.5,
      activeTraders: 2,
      lastTradeTime: new Date(Date.now() - 86400000) // 1 day ago
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBeLessThan(30)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('should handle edge case: zero volume', () => {
    const market = {
      totalVolume: 0,
      bidAskSpread: 0,
      activeTraders: 0,
      lastTradeTime: new Date()
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBe(0)
  })
})
```

## ステップ3: テストを実行 - 失敗を確認

```bash
npm test lib/liquidity.test.ts

FAIL lib/liquidity.test.ts
  ✕ should return high score for liquid market (2 ms)
    Error: Not implemented

1 test failed, 0 passed
```

PASS: テストは期待通りに失敗しました。実装の準備ができました。

## ステップ4: 最小限のコードを実装(GREEN)

```typescript
// lib/liquidity.ts
export function calculateLiquidityScore(market: MarketData): number {
  // Handle zero volume edge case
  if (market.totalVolume === 0) {
    return 0
  }

  // Calculate component scores (0-100 scale)
  const volumeScore = Math.min(market.totalVolume / 1000, 100)
  const spreadScore = Math.max(100 - (market.bidAskSpread * 1000), 0)
  const traderScore = Math.min(market.activeTraders / 10, 100)

  // Recent activity bonus
  const hoursSinceLastTrade = (Date.now() - market.lastTradeTime.getTime()) / (1000 * 60 * 60)
  const recencyScore = Math.max(100 - (hoursSinceLastTrade * 10), 0)

  // Weighted average
  const score = (
    volumeScore * 0.4 +
    spreadScore * 0.3 +
    traderScore * 0.2 +
    recencyScore * 0.1
  )

  return Math.min(Math.max(score, 0), 100) // Clamp to 0-100
}
```

## ステップ5: テストを実行 - 合格を確認

```bash
npm test lib/liquidity.test.ts

PASS lib/liquidity.test.ts
  ✓ should return high score for liquid market (3 ms)
  ✓ should return low score for illiquid market (2 ms)
  ✓ should handle edge case: zero volume (1 ms)

3 tests passed
```

PASS: すべてのテストが合格しました!

## ステップ6: リファクタリング(IMPROVE)

```typescript
// lib/liquidity.ts - 定数と可読性を向上させてリファクタリング
const WEIGHTS = {
  VOLUME: 0.4,
  SPREAD: 0.3,
  TRADERS: 0.2,
  RECENCY: 0.1,
} as const

const SCALE_FACTORS = {
  VOLUME: 1000,
  SPREAD: 1000,
  TRADERS: 10,
  RECENCY_PENALTY: 10,
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function calculateLiquidityScore(market: MarketData): number {
  if (market.totalVolume === 0) return 0

  const volumeScore = Math.min(market.totalVolume / SCALE_FACTORS.VOLUME, 100)
  const spreadScore = clamp(100 - (market.bidAskSpread * SCALE_FACTORS.SPREAD), 0, 100)
  const traderScore = Math.min(market.activeTraders / SCALE_FACTORS.TRADERS, 100)

  const hoursSinceLastTrade = (Date.now() - market.lastTradeTime.getTime()) / (1000 * 60 * 60)
  const recencyScore = clamp(100 - (hoursSinceLastTrade * SCALE_FACTORS.RECENCY_PENALTY), 0, 100)

  const weightedScore =
    volumeScore * WEIGHTS.VOLUME +
    spreadScore * WEIGHTS.SPREAD +
    traderScore * WEIGHTS.TRADERS +
    recencyScore * WEIGHTS.RECENCY

  return clamp(weightedScore, 0, 100)
}
```

## ステップ7: テストがまだ合格することを確認

```bash
npm test lib/liquidity.test.ts

PASS lib/liquidity.test.ts
  ✓ should return high score for liquid market (3 ms)
  ✓ should return low score for illiquid market (2 ms)
  ✓ should handle edge case: zero volume (1 ms)

3 tests passed
```

PASS: リファクタリング完了、テストはまだ合格しています!

## ステップ8: カバレッジの確認

```bash
npm test -- --coverage lib/liquidity.test.ts

File           | % Stmts | % Branch | % Funcs | % Lines
---------------|---------|----------|---------|--------
liquidity.ts   |   100   |   100    |   100   |   100

Coverage: 100% PASS: (Target: 80%)
```

PASS: TDDセッション完了!
```

## TDDベストプラクティス

**すべきこと:**
- PASS: 実装の前にまずテストを書く
- PASS: テストを実行し、実装前に失敗することを確認
- PASS: テストに合格するための最小限のコードを書く
- PASS: テストが緑色になってからのみリファクタリング
- PASS: エッジケースとエラーシナリオを追加
- PASS: 80%以上のカバレッジを目指す(重要なコードは100%)

**してはいけないこと:**
- FAIL: テストの前に実装を書く
- FAIL: 各変更後のテスト実行をスキップ
- FAIL: 一度に多くのコードを書く
- FAIL: 失敗するテストを無視
- FAIL: 実装の詳細をテスト(動作をテスト)
- FAIL: すべてをモック化(統合テストを優先)

## 含めるべきテストタイプ

**単体テスト**(関数レベル):
- ハッピーパスシナリオ
- エッジケース(空、null、最大値)
- エラー条件
- 境界値

**統合テスト**(コンポーネントレベル):
- APIエンドポイント
- データベース操作
- 外部サービス呼び出し
- hooksを使用したReactコンポーネント

**E2Eテスト**(`/e2e`コマンドを使用):
- 重要なユーザーフロー
- 複数ステップのプロセス
- フルスタック統合

## カバレッジ要件

- **すべてのコードに80%以上**
- **以下には100%必須**:
  - 財務計算
  - 認証ロジック
  - セキュリティクリティカルなコード
  - コアビジネスロジック

## 重要事項

**必須**: テストは実装の前に書く必要があります。TDDサイクルは:

1. **RED** - 失敗するテストを書く
2. **GREEN** - 合格する実装を書く
3. **REFACTOR** - コードを改善

REDフェーズをスキップしてはいけません。テストの前にコードを書いてはいけません。

## 他のコマンドとの統合

- まず`/plan`を使用して何を構築するかを理解
- `/tdd`を使用してテスト付きで実装
- `/build-and-fix`をビルドエラー発生時に使用
- `/code-review`で実装をレビュー
- `/test-coverage`でカバレッジを検証

## 関連エージェント

このコマンドは以下の場所にある`tdd-guide`エージェントを呼び出します:
`~/.claude/agents/tdd-guide.md`

また、以下の場所にある`tdd-workflow`スキルを参照できます:
`~/.claude/skills/tdd-workflow/`
