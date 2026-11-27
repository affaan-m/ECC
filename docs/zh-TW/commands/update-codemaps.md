# 更新程式碼地圖

分析程式碼庫結構並更新架構文件：

1. 掃描所有原始檔案的 imports、exports 和相依性
2. 以下列格式產生精簡的程式碼地圖：
   - codemaps/architecture.md - 整體架構
   - codemaps/backend.md - 後端結構
   - codemaps/frontend.md - 前端結構
   - codemaps/data.md - 資料模型和結構描述

3. 計算與前一版本的差異百分比
4. 如果變更 > 30%，在更新前請求使用者批准
5. 為每個程式碼地圖新增新鮮度時間戳
6. 將報告儲存到 .reports/codemap-diff.txt

使用 TypeScript/Node.js 進行分析。專注於高階結構，而非實作細節。
