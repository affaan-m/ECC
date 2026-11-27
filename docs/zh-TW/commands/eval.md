# Eval 指令

管理評估驅動開發工作流程。

## 使用方式

`/eval [define|check|report|list] [feature-name]`

## 定義 Evals

`/eval define feature-name`

建立新的 eval 定義：

1. 使用範本建立 `.claude/evals/feature-name.md`：

```markdown
## EVAL: feature-name
建立日期：$(date)

### 能力 Evals
- [ ] [能力 1 的描述]
- [ ] [能力 2 的描述]

### 回歸 Evals
- [ ] [現有行為 1 仍然有效]
- [ ] [現有行為 2 仍然有效]

### 成功標準
- 能力 evals 的 pass@3 > 90%
- 回歸 evals 的 pass^3 = 100%
```

2. 提示使用者填入具體標準

## 檢查 Evals

`/eval check feature-name`

執行功能的 evals：

1. 從 `.claude/evals/feature-name.md` 讀取 eval 定義
2. 對每個能力 eval：
   - 嘗試驗證標準
   - 記錄通過/失敗
   - 記錄嘗試到 `.claude/evals/feature-name.log`
3. 對每個回歸 eval：
   - 執行相關測試
   - 與基準比較
   - 記錄通過/失敗
4. 報告目前狀態：

```
EVAL 檢查：feature-name
========================
能力：X/Y 通過
回歸：X/Y 通過
狀態：進行中 / 就緒
```

## 報告 Evals

`/eval report feature-name`

產生全面的 eval 報告：

```
EVAL 報告：feature-name
=========================
產生日期：$(date)

能力 EVALS
----------------
[eval-1]：通過（pass@1）
[eval-2]：通過（pass@2）- 需要重試
[eval-3]：失敗 - 參見備註

回歸 EVALS
----------------
[test-1]：通過
[test-2]：通過
[test-3]：通過

指標
-------
能力 pass@1：67%
能力 pass@3：100%
回歸 pass^3：100%

備註
-----
[任何問題、邊界情況或觀察]

建議
--------------
[發布 / 需要改進 / 阻擋]
```

## 列出 Evals

`/eval list`

顯示所有 eval 定義：

```
EVAL 定義
================
feature-auth      [3/5 通過] 進行中
feature-search    [5/5 通過] 就緒
feature-export    [0/4 通過] 未開始
```

## 參數

$ARGUMENTS:
- `define <name>` - 建立新的 eval 定義
- `check <name>` - 執行並檢查 evals
- `report <name>` - 產生完整報告
- `list` - 顯示所有 evals
- `clean` - 移除舊的 eval 日誌（保留最後 10 次執行）
