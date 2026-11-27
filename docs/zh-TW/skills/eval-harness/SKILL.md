---
name: eval-harness
description: Formal evaluation framework for Claude Code sessions implementing eval-driven development (EDD) principles
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Eval Harness 技能

Claude Code 工作階段的正式評估框架，實作 eval 驅動開發（EDD）原則。

## 理念

Eval 驅動開發將 evals 視為「AI 開發的單元測試」：
- 在實作前定義預期行為
- 開發期間持續執行 evals
- 每次變更追蹤回歸
- 使用 pass@k 指標進行可靠性測量

## Eval 類型

### 能力 Evals
測試 Claude 是否能做到以前做不到的事：
```markdown
[CAPABILITY EVAL: feature-name]
任務：Claude 應完成什麼的描述
成功標準：
  - [ ] 標準 1
  - [ ] 標準 2
  - [ ] 標準 3
預期輸出：預期結果描述
```

### 回歸 Evals
確保變更不會破壞現有功能：
```markdown
[REGRESSION EVAL: feature-name]
基準：SHA 或檢查點名稱
測試：
  - existing-test-1: PASS/FAIL
  - existing-test-2: PASS/FAIL
  - existing-test-3: PASS/FAIL
結果：X/Y 通過（先前為 Y/Y）
```

## 評分器類型

### 1. 基於程式碼的評分器
使用程式碼的確定性檢查：
```bash
# 檢查檔案是否包含預期模式
grep -q "export function handleAuth" src/auth.ts && echo "PASS" || echo "FAIL"

# 檢查測試是否通過
npm test -- --testPathPattern="auth" && echo "PASS" || echo "FAIL"

# 檢查建置是否成功
npm run build && echo "PASS" || echo "FAIL"
```

### 2. 基於模型的評分器
使用 Claude 評估開放式輸出：
```markdown
[MODEL GRADER PROMPT]
評估以下程式碼變更：
1. 它是否解決了陳述的問題？
2. 結構是否良好？
3. 邊界案例是否被處理？
4. 錯誤處理是否適當？

分數：1-5（1=差，5=優秀）
理由：[解釋]
```

### 3. 人工評分器
標記為手動審查：
```markdown
[HUMAN REVIEW REQUIRED]
變更：變更內容的描述
理由：為何需要人工審查
風險等級：LOW/MEDIUM/HIGH
```

## 指標

### pass@k
「k 次嘗試中至少一次成功」
- pass@1：第一次嘗試成功率
- pass@3：3 次嘗試內成功
- 典型目標：pass@3 > 90%

### pass^k
「所有 k 次試驗都成功」
- 更高的可靠性標準
- pass^3：連續 3 次成功
- 用於關鍵路徑

## Eval 工作流程

### 1. 定義（編碼前）
```markdown
## EVAL 定義：feature-xyz

### 能力 Evals
1. 可以建立新使用者帳戶
2. 可以驗證電子郵件格式
3. 可以安全地雜湊密碼

### 回歸 Evals
1. 現有登入仍可運作
2. 工作階段管理未變更
3. 登出流程完整

### 成功指標
- 能力 evals 的 pass@3 > 90%
- 回歸 evals 的 pass^3 = 100%
```

### 2. 實作
撰寫程式碼以通過定義的 evals。

### 3. 評估
```bash
# 執行能力 evals
[執行每個能力 eval，記錄 PASS/FAIL]

# 執行回歸 evals
npm test -- --testPathPattern="existing"

# 產生報告
```

### 4. 報告
```markdown
EVAL 報告：feature-xyz
========================

能力 Evals：
  create-user:     PASS (pass@1)
  validate-email:  PASS (pass@2)
  hash-password:   PASS (pass@1)
  整體：           3/3 通過

回歸 Evals：
  login-flow:      PASS
  session-mgmt:    PASS
  logout-flow:     PASS
  整體：           3/3 通過

指標：
  pass@1: 67% (2/3)
  pass@3: 100% (3/3)

狀態：準備審查
```

## 整合模式

### 實作前
```
/eval define feature-name
```
在 `.claude/evals/feature-name.md` 建立 eval 定義檔案

### 實作期間
```
/eval check feature-name
```
執行當前 evals 並報告狀態

### 實作後
```
/eval report feature-name
```
產生完整 eval 報告

## Eval 儲存

在專案中儲存 evals：
```
.claude/
  evals/
    feature-xyz.md      # Eval 定義
    feature-xyz.log     # Eval 執行歷史
    baseline.json       # 回歸基準
```

## 最佳實務

1. **編碼前定義 evals** - 強制清楚思考成功標準
2. **頻繁執行 evals** - 及早捕捉回歸
3. **隨時間追蹤 pass@k** - 監控可靠性趨勢
4. **可能時使用程式碼評分器** - 確定性 > 機率性
5. **安全性需人工審查** - 永遠不要完全自動化安全檢查
6. **保持 evals 快速** - 慢 evals 不會被執行
7. **與程式碼一起版本化 evals** - Evals 是一等工件

## 範例：新增認證

```markdown
## EVAL：add-authentication

### 階段 1：定義（10 分鐘）
能力 Evals：
- [ ] 使用者可以用電子郵件/密碼註冊
- [ ] 使用者可以用有效憑證登入
- [ ] 無效憑證被拒絕並顯示適當錯誤
- [ ] 工作階段在頁面重新載入後持續
- [ ] 登出清除工作階段

回歸 Evals：
- [ ] 公開路由仍可存取
- [ ] API 回應未變更
- [ ] 資料庫 schema 相容

### 階段 2：實作（視情況而定）
[撰寫程式碼]

### 階段 3：評估
執行：/eval check add-authentication

### 階段 4：報告
EVAL 報告：add-authentication
==============================
能力：5/5 通過（pass@3：100%）
回歸：3/3 通過（pass^3：100%）
狀態：準備發佈
```
