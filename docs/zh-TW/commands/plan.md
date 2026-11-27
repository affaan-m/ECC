---
description: Restate requirements, assess risks, and create step-by-step implementation plan. WAIT for user CONFIRM before touching any code.
---

# Plan 指令

此指令呼叫 **planner** Agent，在撰寫任何程式碼前建立全面的實作計畫。

## 此指令的功能

1. **重述需求** - 釐清需要建構什麼
2. **識別風險** - 揭示潛在問題和阻礙
3. **建立步驟計畫** - 將實作拆解為階段
4. **等待確認** - 必須在繼續前收到使用者批准

## 何時使用

在以下情況使用 `/plan`：
- 開始新功能
- 進行重大架構變更
- 進行複雜重構
- 多個檔案/元件會受影響
- 需求不清楚或模糊

## 運作方式

planner Agent 會：

1. **分析請求**並以清晰的語言重述需求
2. **拆解為階段**，包含具體、可執行的步驟
3. **識別相依性**元件之間的關係
4. **評估風險**和潛在阻礙
5. **估計複雜度**（高/中/低）
6. **呈現計畫**並等待您明確確認

## 使用範例

```
使用者：/plan 我需要在市場解決時新增即時通知

Agent（planner）：
# 實作計畫：即時市場解決通知

## 需求重述
- 當使用者關注的市場解決時發送通知
- 支援多個通知管道（應用內、Email、Webhook）
- 確保通知可靠送達
- 包含市場結果和使用者持倉結果

## 實作階段

### 階段 1：資料庫結構描述
- 新增 notifications 表格，欄位：id、user_id、market_id、type、status、created_at
- 新增 user_notification_preferences 表格用於管道偏好
- 在 user_id 和 market_id 上建立索引以優化效能

### 階段 2：通知服務
- 在 lib/notifications.ts 建立通知服務
- 使用 BullMQ/Redis 實作通知佇列
- 為失敗的送達新增重試邏輯
- 建立通知範本

### 階段 3：整合點
- 連接到市場解決邏輯（當狀態變更為 "resolved"）
- 查詢所有在該市場有持倉的使用者
- 為每個使用者加入通知佇列

### 階段 4：前端元件
- 在標題建立 NotificationBell 元件
- 新增 NotificationList 彈窗
- 透過 Supabase 訂閱實作即時更新
- 新增通知偏好設定頁面

## 相依性
- Redis（用於佇列）
- Email 服務（SendGrid/Resend）
- Supabase 即時訂閱

## 風險
- 高：Email 送達率（需要 SPF/DKIM）
- 中：每個市場 1000+ 使用者時的效能
- 中：如果市場頻繁解決可能造成通知垃圾訊息
- 低：即時訂閱的開銷

## 估計複雜度：中
- 後端：4-6 小時
- 前端：3-4 小時
- 測試：2-3 小時
- 總計：9-13 小時

**等待確認**：繼續此計畫？（是/否/修改）
```

## 重要提醒

**關鍵**：planner Agent **不會**撰寫任何程式碼，直到您明確以「是」、「繼續」或類似肯定回應確認計畫。

如果您想要修改，回應：
- "修改：[您的變更]"
- "不同的方法：[替代方案]"
- "跳過階段 2，先做階段 3"

## 與其他指令的整合

計畫後：
- 使用 `/tdd` 以測試驅動開發實作
- 如果發生建置錯誤，使用 `/build-fix`
- 使用 `/code-review` 審查完成的實作

## 相關 Agent

此指令呼叫位於以下位置的 `planner` Agent：
`~/.claude/agents/planner.md`
