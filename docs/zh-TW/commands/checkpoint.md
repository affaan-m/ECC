# Checkpoint 指令

在您的工作流程中建立或驗證檢查點。

## 使用方式

`/checkpoint [create|verify|list] [name]`

## 建立檢查點

建立檢查點時：

1. 執行 `/verify quick` 確保目前狀態是乾淨的
2. 使用檢查點名稱建立 git stash 或 commit
3. 將檢查點記錄到 `.claude/checkpoints.log`：

```bash
echo "$(date +%Y-%m-%d-%H:%M) | $CHECKPOINT_NAME | $(git rev-parse --short HEAD)" >> .claude/checkpoints.log
```

4. 報告檢查點已建立

## 驗證檢查點

針對檢查點進行驗證時：

1. 從日誌讀取檢查點
2. 比較目前狀態與檢查點：
   - 檢查點後新增的檔案
   - 檢查點後修改的檔案
   - 現在 vs 當時的測試通過率
   - 現在 vs 當時的覆蓋率

3. 報告：
```
檢查點比較：$NAME
============================
變更檔案：X
測試：+Y 通過 / -Z 失敗
覆蓋率：+X% / -Y%
建置：[通過/失敗]
```

## 列出檢查點

顯示所有檢查點，包含：
- 名稱
- 時間戳
- Git SHA
- 狀態（目前、落後、領先）

## 工作流程

典型的檢查點流程：

```
[開始] --> /checkpoint create "feature-start"
   |
[實作] --> /checkpoint create "core-done"
   |
[測試] --> /checkpoint verify "core-done"
   |
[重構] --> /checkpoint create "refactor-done"
   |
[PR] --> /checkpoint verify "feature-start"
```

## 參數

$ARGUMENTS:
- `create <name>` - 建立命名檢查點
- `verify <name>` - 針對命名檢查點驗證
- `list` - 顯示所有檢查點
- `clear` - 移除舊檢查點（保留最後 5 個）
