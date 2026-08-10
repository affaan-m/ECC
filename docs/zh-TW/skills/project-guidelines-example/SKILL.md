---
name: project-guidelines-example
description: Project-specific skill template covering architecture, patterns, testing, and deployment guidance.
metadata:
  origin: ECC
---

# 專案指南技能（範例）

這是專案特定技能的範例。使用此作為你自己專案的範本。

基於真實生產應用程式：[Zenith](https://zenith.chat) - AI 驅動的客戶探索平台。

---

## 何時使用

在處理專案特定設計時參考此技能。專案技能包含：
- 架構概覽
- 檔案結構
- 程式碼模式
- 測試要求
- 部署工作流程

---

## 架構概覽

**技術堆疊：**
- **前端**：Next.js 15（App Router）、TypeScript、React
- **後端**：FastAPI（Python）、Pydantic 模型
- **資料庫**：Supabase（PostgreSQL）
- **AI**：Claude API 帶工具呼叫和結構化輸出
- **部署**：Google Cloud Run
- **測試**：Playwright（E2E）、pytest（後端）、React Testing Library

**服務：**
```
┌─────────────────────────────────────────────────────────────┐
│                         前端                                 │
│  Next.js 15 + TypeScript + TailwindCSS                     │
│  部署：Vercel / Cloud Run                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         後端                                 │
│  FastAPI + Python 3.11 + Pydantic                          │
│  部署：Cloud Run                                            │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Supabase │   │  Claude  │   │  Redis   │
        │ Database │   │   API    │   │  Cache   │
        └──────────┘   └──────────┘   └──────────┘
```

---

## 檔案結構

```
project/
├── frontend/
│   └── src/
│       ├── app/              # Next.js app router 頁面
│       │   ├── api/          # API 路由
│       │   ├── (auth)/       # 需認證路由
│       │   └── workspace/    # 主應用程式工作區
│       ├── components/       # React 元件
│       │   ├── ui/           # 基礎 UI 元件
│       │   ├── forms/        # 表單元件
│       │   └── layouts/      # 版面配置元件
│       ├── hooks/            # 自訂 React hooks
│       ├── lib/              # 工具
│       ├── types/            # TypeScript 定義
│       └── config/           # 設定
│
├── backend/
│   ├── routers/              # FastAPI 路由處理器
│   ├── models.py             # Pydantic 模型
│   ├── main.py               # FastAPI app 進入點
│   ├── auth_system.py        # 認證
│   ├── database.py           # 資料庫操作
│   ├── services/             # 業務邏輯
│   └── tests/                # pytest 測試
│
├── deploy/                   # 部署設定
├── docs/                     # 文件
└── scripts/                  # 工具腳本
```

---

## 程式碼模式

### API 回應格式（FastAPI）

```python
from pydantic import BaseModel
from typing import Generic, TypeVar, Optional

T = TypeVar('T')

class ApiResponse(BaseModel, Generic[T]):
    success: bool
    data: Optional[T] = None
    error: Optional[str] = None

    @classmethod
    def ok(cls, data: T) -> "ApiResponse[T]":
        return cls(success=True, data=data)

    @classmethod
    def fail(cls, error: str) -> "ApiResponse[T]":
        return cls(success=False, error=error)
```

### 前端 API 呼叫（TypeScript）

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`/api${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` }
    }

    return await response.json()
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
```

### Claude AI 整合（結構化輸出）

```python
from anthropic import Anthropic
from pydantic import BaseModel

class AnalysisResult(BaseModel):
    summary: str
    key_points: list[str]
    confidence: float

async def analyze_with_claude(content: str) -> AnalysisResult:
    client = Anthropic()

    response = client.messages.create(
        model="claude-sonnet-4-5-20250514",
        max_tokens=1024,
        messages=[{"role": "user", "content": content}],
        tools=[{
            "name": "provide_analysis",
            "description": "Provide structured analysis",
            "input_schema": AnalysisResult.model_json_schema()
        }],
        tool_choice={"type": "tool", "name": "provide_analysis"}
    )

    # 提取工具使用結果
    tool_use = next(
        block for block in response.content
        if block.type == "tool_use"
    )

    return AnalysisResult(**tool_use.input)
```

### 自訂 Hooks（React）

```typescript
import { useState, useCallback } from 'react'

interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export function useApi<T>(
  fetchFn: () => Promise<ApiResponse<T>>
) {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: false,
    error: null,
  })

  const execute = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }))

    const result = await fetchFn()

    if (result.success) {
      setState({ data: result.data!, loading: false, error: null })
    } else {
      setState({ data: null, loading: false, error: result.error! })
    }
  }, [fetchFn])

  return { ...state, execute }
}
```

---

## 測試要求

### 後端（pytest）

```bash
# 執行所有測試
poetry run pytest tests/

# 執行帶覆蓋率的測試
poetry run pytest tests/ --cov=. --cov-report=html

# 執行特定測試檔案
poetry run pytest tests/test_auth.py -v
```

**測試結構：**
```python
import pytest
from httpx import AsyncClient
from main import app

@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac

@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"
```

### 前端（React Testing Library）

```bash
# 執行測試
npm run test

# 執行帶覆蓋率的測試
npm run test -- --coverage

# 執行 E2E 測試
npm run test:e2e
```

**測試結構：**
```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { WorkspacePanel } from './WorkspacePanel'

describe('WorkspacePanel', () => {
  it('renders workspace correctly', () => {
    render(<WorkspacePanel />)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('handles session creation', async () => {
    render(<WorkspacePanel />)
    fireEvent.click(screen.getByText('New Session'))
    expect(await screen.findByText('Session created')).toBeInTheDocument()
  })
})
```

---

## 部署工作流程

### 部署前檢查清單

- [ ] 本機所有測試通過
- [ ] `npm run build` 成功（前端）
- [ ] `poetry run pytest` 通過（後端）
- [ ] 無寫死密鑰
- [ ] 環境變數已記錄
- [ ] 資料庫 migrations 準備就緒

### 部署指令

```bash
# 建置和部署前端
cd frontend && npm run build
gcloud run deploy frontend --source .

# 建置和部署後端
cd backend
gcloud run deploy backend --source .
```

### 環境變數

```bash
# 前端（.env.local）
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# 後端（.env）
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...
```

---

## 關鍵規則

1. **無表情符號** 在程式碼、註解或文件中
2. **不可變性** - 永遠不要突變物件或陣列
3. **TDD** - 實作前先寫測試
4. **80% 覆蓋率** 最低
5. **多個小檔案** - 200-400 行典型，最多 800 行
6. **無 console.log** 在生產程式碼中
7. **適當錯誤處理** 使用 try/catch
8. **輸入驗證** 使用 Pydantic/Zod

---

## 相關技能

- `coding-standards.md` - 一般程式碼最佳實務
- `backend-patterns.md` - API 和資料庫模式
- `frontend-patterns.md` - React 和 Next.js 模式
- `tdd-workflow/` - 測試驅動開發方法論
