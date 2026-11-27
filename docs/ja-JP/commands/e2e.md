---
description: Playwright を使用してエンドツーエンドテストを生成して実行します。テストジャーニーを作成し、テストを実行し、スクリーンショット/ビデオ/トレースをキャプチャし、アーティファクトをアップロードします。
---

# E2E コマンド

このコマンドは **e2e-runner** エージェントを呼び出して、Playwright を使用してエンドツーエンドテストを生成、保守、実行します。

## このコマンドの機能

1. **テストジャーニー生成** - ユーザーフローの Playwright テストを作成
2. **E2E テスト実行** - 複数ブラウザ間でテストを実行
3. **アーティファクトキャプチャ** - 失敗時のスクリーンショット、ビデオ、トレース
4. **結果アップロード** - HTML レポートと JUnit XML
5. **不安定なテスト識別** - 不安定なテストを分離

## いつ使用しますするか

以下の場合に `/e2e` を使用します：

* 重要なユーザージャーニーをテスト（ログイン、取引、支払い）
* マルチステップフローがエンドツーエンドで機能することを検証
* UI インタラクションとナビゲーションをテスト
* フロントエンドとバックエンド間の統合を検証
* 本番環境デプロイメント向けの準備

## 動作方法

e2e-runner エージェントは：

1. **ユーザーフローを分析**してテストシナリオを特定
2. **ページオブジェクトモデルパターンを使用して Playwright テストを生成**
3. **複数ブラウザ間（Chrome、Firefox、Safari）でテストを実行**
4. **失敗をキャプチャ**（スクリーンショット、ビデオ、トレース含む）
5. **結果とアーティファクトを含むレポートを生成**
6. **不安定なテストを特定**して修正を推奨

## 使用します示例

````
User: /e2e マーケット検索と表示フローをテスト

Agent (e2e-runner):
# E2Eテスト生成: マーケット検索と表示フロー

## 特定されたテストシナリオ

**ユーザージャーニー:** マーケット検索 → 結果表示 → マーケットクリック → 詳細表示

**テストカバレッジ:**
1. マーケットページに遷移
2. セマンティック検索を実行
3. 検索結果を検証
4. 最初の結果をクリック
5. マーケット詳細ページの読み込みを検証
6. チャートの描画を検証

## 生成されたテストコード

```typescript
// tests/e2e/markets/search-and-view.spec.ts
import { test, expect } from '@playwright/test'
import { MarketsPage } from '../../pages/MarketsPage'
import { MarketDetailsPage } from '../../pages/MarketDetailsPage'

test.describe('Market Search and View Flow', () => {
  test('user can search markets and view details', async ({ page }) => {
    // 1. Navigate to markets page
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Verify page loaded
    await expect(page).toHaveTitle(/Markets/)
    await expect(page.locator('h1')).toContainText('Markets')

    // 2. Perform semantic search
    await marketsPage.searchMarkets('election')

    // Wait for API response
    await page.waitForResponse(resp =>
      resp.url().includes('/api/markets/search') && resp.status() === 200
    )

    // 3. Verify search results
    const marketCards = marketsPage.marketCards
    await expect(marketCards.first()).toBeVisible()
    const resultCount = await marketCards.count()
    expect(resultCount).toBeGreaterThan(0)

    // Take screenshot of search results
    await page.screenshot({ path: 'artifacts/search-results.png' })

    // 4. Click on first result
    const firstMarketTitle = await marketCards.first().textContent()
    await marketCards.first().click()

    // 5. Verify market details page loads
    await expect(page).toHaveURL(/\/markets\/[a-z0-9-]+/)

    const detailsPage = new MarketDetailsPage(page)
    await expect(detailsPage.marketName).toBeVisible()
    await expect(detailsPage.marketDescription).toBeVisible()

    // 6. Verify chart renders
    await expect(detailsPage.priceChart).toBeVisible()

    // Verify market name matches
    const detailsTitle = await detailsPage.marketName.textContent()
    expect(detailsTitle?.toLowerCase()).toContain(
      firstMarketTitle?.toLowerCase().substring(0, 20) || ''
    )

    // Take screenshot of market details
    await page.screenshot({ path: 'artifacts/market-details.png' })
  })

  test('search with no results shows empty state', async ({ page }) => {
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Search for non-existent market
    await marketsPage.searchMarkets('xyznonexistentmarket123456')

    // Verify empty state
    await expect(page.locator('[data-testid="no-results"]')).toBeVisible()
    await expect(page.locator('[data-testid="no-results"]')).toContainText(
      /no.*results|no.*markets/i
    )

    const marketCount = await marketsPage.marketCards.count()
    expect(marketCount).toBe(0)
  })

  test('can clear search and see all markets again', async ({ page }) => {
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Initial market count
    const initialCount = await marketsPage.marketCards.count()

    // Perform search
    await marketsPage.searchMarkets('trump')
    await page.waitForLoadState('networkidle')

    // Verify filtered results
    const filteredCount = await marketsPage.marketCards.count()
    expect(filteredCount).toBeLessThan(initialCount)

    // Clear search
    await marketsPage.searchInput.clear()
    await page.waitForLoadState('networkidle')

    // Verify all markets shown again
    const finalCount = await marketsPage.marketCards.count()
    expect(finalCount).toBe(initialCount)
  })
})
````

## テスト実行

```bash
# 生成されたテストを実行
npx playwright test tests/e2e/markets/search-and-view.spec.ts

Running 3 tests using 3 workers

  ✓  [chromium] › search-and-view.spec.ts:5:3 › user can search markets and view details (4.2s)
  ✓  [chromium] › search-and-view.spec.ts:52:3 › search with no results shows empty state (1.8s)
  ✓  [chromium] › search-and-view.spec.ts:67:3 › can clear search and see all markets again (2.9s)

  3 passed (9.1s)

Artifacts generated:
- artifacts/search-results.png
- artifacts/market-details.png
- playwright-report/index.html
```

## テストレポート

```
╔══════════════════════════════════════════════════════════════╗
║                    E2Eテスト結果                          ║
╠══════════════════════════════════════════════════════════════╣
║ ステータス: PASS: 全テスト合格                              ║
║ 合計:       3テスト                                          ║
║ 合格:       3 (100%)                                         ║
║ 失敗:       0                                                ║
║ 不安定:     0                                                ║
║ 所要時間:   9.1s                                             ║
╚══════════════════════════════════════════════════════════════╝

アーティファクト:
 スクリーンショット: 2ファイル
 ビデオ: 0ファイル (失敗時のみ)
 トレース: 0ファイル (失敗時のみ)
 HTMLレポート: playwright-report/index.html

レポート表示: npx playwright show-report
```

PASS: E2E テストスイートは CI/CD 統合の準備ができました！

````

## テストアーティファクト

テスト実行時、以下のアーティファクトがキャプチャされます:

**全テスト共通:**
- タイムラインと結果を含むHTMLレポート
- CI統合用のJUnit XML

**失敗時のみ:**
- 失敗状態のスクリーンショット
- テストのビデオ録画
- デバッグ用トレースファイル (ステップバイステップ再生)
- ネットワークログ
- コンソールログ

## アーティファクトの確認

```bash
# ブラウザでHTMLレポートを表示
npx playwright show-report

# 特定のトレースファイルを表示
npx playwright show-trace artifacts/trace-abc123.zip

# スクリーンショットはartifacts/ディレクトリに保存
open artifacts/search-results.png
````

## 不安定なテスト検出

テストが断続的に失敗する場合：

```
WARNING:  FLAKY TEST DETECTED: tests/e2e/markets/trade.spec.ts

テストは10回中7回合格 (合格率70%)

よくある失敗:
"Timeout waiting for element '[data-testid="confirm-btn"]'"

推奨修正:
1. 明示的な待機を追加: await page.waitForSelector('[data-testid="confirm-btn"]')
2. タイムアウトを増加: { timeout: 10000 }
3. コンポーネントの競合状態を確認
4. 要素がアニメーションで隠れていないか確認

隔離推奨: 修正されるまでtest.fixme()としてマーク
```

## ブラウザ設定

デフォルトでは、テストは複数のブラウザで実行されます：

* PASS: Chromium（デスクトップ Chrome）
* PASS: Firefox（デスクトップ）
* PASS: WebKit（デスクトップ Safari）
* PASS: Mobile Chrome（オプション）

`playwright.config.ts` で設定してブラウザを調整します。

## CI/CD 統合

CI パイプラインに追加：

```yaml
# .github/workflows/e2e.yml
- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npx playwright test

- name: Upload artifacts
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## PMX 固有の重要フロー

PMX の場合、以下の E2E テストを優先：

**重大（常に成功する必要）：**

1. ユーザーがウォレットを接続できる
2. ユーザーが市場をブラウズできる
3. ユーザーが市場を検索できる（セマンティック検索）
4. ユーザーが市場の詳細を表示できる
5. ユーザーが取引注文を配置できる（テスト資金使用します）
6. 市場が正しく決済される
7. ユーザーが資金を引き出せる

**重要：**

1. 市場作成フロー
2. ユーザープロフィール更新
3. リアルタイム価格更新
4. チャートレンダリング
5. 市場のフィルタリングとソート
6. モバイルレスポンシブレイアウト

## ベストプラクティス

**すべき事：**

* PASS: 保守性を高めるためページオブジェクトモデルを使用します
* PASS: セレクタとして data-testid 属性を使用します
* PASS: 任意のタイムアウトではなく API レスポンスを待機
* PASS: 重要なユーザージャーニーのエンドツーエンドテスト
* PASS: main にマージする前にテストを実行
* PASS: テスト失敗時にアーティファクトをレビュー

**すべきでない事：**

* FAIL: 不安定なセレクタを使用します（CSS クラスは変わる可能性）
* FAIL: 実装の詳細をテスト
* FAIL: 本番環境に対してテストを実行
* FAIL: 不安定なテストを無視
* FAIL: 失敗時にアーティファクトレビューをスキップ
* FAIL: E2E テストですべてのエッジケースをテスト（単体テストを使用します）

## 重要な注意事項

**PMX にとって重大：**

* 実際の資金に関わる E2E テストは**テストネット/ステージング環境でのみ実行**する必要があります
* 本番環境に対して取引テストを実行しないでください
* 金融テストに `test.skip(process.env.NODE_ENV === 'production')` を設定
* 少量のテスト資金を持つテストウォレットのみを使用します

## 他のコマンドとの統合

* `/plan` を使用してテストする重要なジャーニーを特定
* `/tdd` を単体テストに使用します（より速く、より細粒度）
* `/e2e` を統合とユーザージャーニーテストに使用します
* `/code-review` を使用してテスト品質を検証

## 関連エージェント

このコマンドは `~/.claude/agents/e2e-runner.md` の `e2e-runner` エージェントを呼び出します。

## 快速命令

```bash
# 全E2Eテストを実行
npx playwright test

# 特定のテストファイルを実行
npx playwright test tests/e2e/markets/search.spec.ts

# ヘッドモードで実行 (ブラウザ表示)
npx playwright test --headed

# テストをデバッグ
npx playwright test --debug

# テストコードを生成
npx playwright codegen http://localhost:3000

# レポートを表示
npx playwright show-report
```
