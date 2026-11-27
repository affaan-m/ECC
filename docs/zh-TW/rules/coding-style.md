# 程式碼風格

## 不可變性（關鍵）

總是建立新物件，絕不變異：

```javascript
// 錯誤：變異
function updateUser(user, name) {
  user.name = name  // 變異！
  return user
}

// 正確：不可變性
function updateUser(user, name) {
  return {
    ...user,
    name
  }
}
```

## 檔案組織

多小檔案 > 少大檔案：
- 高內聚、低耦合
- 通常 200-400 行，最多 800 行
- 從大型元件中抽取工具
- 依功能/領域組織，而非依類型

## 錯誤處理

總是全面處理錯誤：

```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  console.error('Operation failed:', error)
  throw new Error('Detailed user-friendly message')
}
```

## 輸入驗證

總是驗證使用者輸入：

```typescript
import { z } from 'zod'

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150)
})

const validated = schema.parse(input)
```

## 程式碼品質檢查清單

在標記工作完成前：
- [ ] 程式碼可讀且命名良好
- [ ] 函式小（<50 行）
- [ ] 檔案專注（<800 行）
- [ ] 沒有深層巢狀（>4 層）
- [ ] 適當的錯誤處理
- [ ] 沒有 console.log 陳述式
- [ ] 沒有寫死的值
- [ ] 沒有變異（使用不可變模式）
