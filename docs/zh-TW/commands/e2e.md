---
description: Generate and run end-to-end tests with Playwright. Creates test journeys, runs tests, captures screenshots/videos/traces, and uploads artifacts.
---

# E2E 指令

此指令呼叫 **e2e-runner** Agent 來產生、維護和執行使用 Playwright 的端對端測試。

## 此指令的功能

1. **產生測試旅程** - 為使用者流程建立 Playwright 測試
2. **執行 E2E 測試** - 跨瀏覽器執行測試
3. **擷取產出物** - 失敗時的截圖、影片、追蹤
4. **上傳結果** - HTML 報告和 JUnit XML
5. **識別不穩定測試** - 隔離不穩定的測試

## 何時使用

在以下情況使用 `/e2e`：
- 測試關鍵使用者旅程（登入、交易、支付）
- 驗證多步驟流程端對端運作
- 測試 UI 互動和導航
- 驗證前端和後端的整合
- 為生產環境部署做準備

## 運作方式

e2e-runner Agent 會：

1. **分析使用者流程**並識別測試情境
2. **產生 Playwright 測試**使用 Page Object Model 模式
3. **跨多個瀏覽器執行測試**（Chrome、Firefox、Safari）
4. **擷取失敗**的截圖、影片和追蹤
5. **產生報告**包含結果和產出物
6. **識別不穩定測試**並建議修復

## 測試產出物

測試執行時，會擷取以下產出物：

**所有測試：**
- HTML 報告包含時間線和結果
- JUnit XML 用於 CI 整合

**僅在失敗時：**
- 失敗狀態的截圖
- 測試的影片錄製
- 追蹤檔案用於除錯（逐步重播）
- 網路日誌
- Console 日誌

## 檢視產出物

```bash
# 在瀏覽器檢視 HTML 報告
npx playwright show-report

# 檢視特定追蹤檔案
npx playwright show-trace artifacts/trace-abc123.zip

# 截圖儲存在 artifacts/ 目錄
open artifacts/search-results.png
```

## 最佳實務

**應該做：**
- PASS: 使用 Page Object Model 以利維護
- PASS: 使用 data-testid 屬性作為選擇器
- PASS: 等待 API 回應，不要用任意逾時
- PASS: 測試關鍵使用者旅程端對端
- PASS: 合併到主分支前執行測試
- PASS: 測試失敗時審查產出物

**不應該做：**
- FAIL: 使用脆弱的選擇器（CSS class 可能改變）
- FAIL: 測試實作細節
- FAIL: 對生產環境執行測試
- FAIL: 忽略不穩定的測試
- FAIL: 失敗時跳過產出物審查
- FAIL: 用 E2E 測試每個邊界情況（使用單元測試）

## 快速指令

```bash
# 執行所有 E2E 測試
npx playwright test

# 執行特定測試檔案
npx playwright test tests/e2e/markets/search.spec.ts

# 以可視模式執行（看到瀏覽器）
npx playwright test --headed

# 除錯測試
npx playwright test --debug

# 產生測試程式碼
npx playwright codegen http://localhost:3000

# 檢視報告
npx playwright show-report
```

## 與其他指令的整合

- 使用 `/plan` 識別要測試的關鍵旅程
- 使用 `/tdd` 進行單元測試（更快、更細粒度）
- 使用 `/e2e` 進行整合和使用者旅程測試
- 使用 `/code-review` 驗證測試品質

## 相關 Agent

此指令呼叫位於以下位置的 `e2e-runner` Agent：
`~/.claude/agents/e2e-runner.md`
