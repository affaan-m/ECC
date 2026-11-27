# 安全性指南

## 強制安全性檢查

任何提交前：
- [ ] 沒有寫死的密鑰（API 金鑰、密碼、Token）
- [ ] 所有使用者輸入已驗證
- [ ] SQL 注入防護（參數化查詢）
- [ ] XSS 防護（清理過的 HTML）
- [ ] 已啟用 CSRF 保護
- [ ] 已驗證驗證/授權
- [ ] 所有端點都有速率限制
- [ ] 錯誤訊息不會洩漏敏感資料

## 密鑰管理

```typescript
// 絕不：寫死的密鑰
const apiKey = "sk-proj-xxxxx"

// 總是：環境變數
const apiKey = process.env.OPENAI_API_KEY

if (!apiKey) {
  throw new Error('OPENAI_API_KEY not configured')
}
```

## 安全性回應協定

如果發現安全性問題：
1. 立即停止
2. 使用 **security-reviewer** Agent
3. 在繼續前修復關鍵問題
4. 輪換任何暴露的密鑰
5. 審查整個程式碼庫是否有類似問題
