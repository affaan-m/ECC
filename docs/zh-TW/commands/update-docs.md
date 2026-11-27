# 更新文件

從單一真相來源同步文件：

1. 讀取 package.json scripts 區段
   - 產生 scripts 參考表
   - 包含註解中的描述

2. 讀取 .env.example
   - 擷取所有環境變數
   - 記錄用途和格式

3. 產生 docs/CONTRIB.md，包含：
   - 開發工作流程
   - 可用的 scripts
   - 環境設定
   - 測試程序

4. 產生 docs/RUNBOOK.md，包含：
   - 部署程序
   - 監控和警報
   - 常見問題和修復
   - 回滾程序

5. 識別過時的文件：
   - 找出 90 天以上未修改的文件
   - 列出供手動審查

6. 顯示差異摘要

單一真相來源：package.json 和 .env.example
