---
name: node-project-guidelines-example
description: Example template for writing a project-specific skill. Use when creating or structuring per-project guidelines (architecture, conventions, common tasks, warnings) for a codebase — copy this file and adapt it to your project.
---

# Project Guidelines Skill (Example)

This is an example of a project-specific skill. Use this as a template for your own projects.

Based on a real production application: [Zenith](https://zenith.chat) - AI-powered customer discovery platform.

---

## When to Use

Reference this skill when working on the specific project it's designed for. Project skills contain:

- Architecture overview
- File structure
- Code patterns
- Testing requirements
- Deployment workflow

---

## Architecture Overview

**Tech Stack:**

- **Frontend**: SvelteKit 5, Svelte 5 (runes), TypeScript, Tailwind CSS 4 + shadcn-svelte
- **Backend**: FastAPI (Python), Pydantic models
- **Database**: Supabase (PostgreSQL)
- **AI**: Claude API with tool calling and structured output
- **Deployment**: Google Cloud Run
- **Testing**: Chrome DevTools MCP (E2E), pytest (backend), Svelte Testing Library

**Services:**

```text
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                            │
│  SvelteKit 5 + Svelte 5 + TypeScript + shadcn-svelte        │
│  Deployed: Vercel / Cloud Run                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         Backend                             │
│  FastAPI + Python 3.11 + Pydantic                          │
│  Deployed: Cloud Run                                       │
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

## File Structure

```text
project/
├── frontend/
│   └── src/
│       ├── routes/           # SvelteKit file-based routing
│       │   ├── api/          # API routes (+server.ts)
│       │   ├── (auth)/       # Auth-protected route group
│       │   └── workspace/    # Main app workspace
│       ├── lib/
│       │   ├── components/   # Svelte components
│       │   │   ├── ui/       # shadcn-svelte components
│       │   │   ├── forms/    # Form components
│       │   │   └── layouts/  # Layout components
│       │   ├── stores/       # Shared state (.svelte.ts)
│       │   ├── utils/        # Utilities
│       │   └── types/        # TypeScript definitions
│       └── app.css           # Tailwind CSS 4 + shadcn theme
│
├── backend/
│   ├── routers/              # FastAPI route handlers
│   ├── models.py             # Pydantic models
│   ├── main.py               # FastAPI app entry
│   ├── auth_system.py        # Authentication
│   ├── database.py           # Database operations
│   ├── services/             # Business logic
│   └── tests/                # pytest tests
│
├── deploy/                   # Deployment configs
├── docs/                     # Documentation
└── scripts/                  # Utility scripts
```

---

## Code Patterns

### API Response Format (FastAPI)

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

### Frontend API Calls (TypeScript)

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

### Claude AI Integration (Structured Output)

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

    # Extract tool use result
    tool_use = next(
        block for block in response.content
        if block.type == "tool_use"
    )

    return AnalysisResult(**tool_use.input)
```

### Reactive API Store (Svelte 5)

```typescript
// stores/api.svelte.ts
export function createApiStore<T>(fetchFn: () => Promise<ApiResponse<T>>) {
  let data = $state<T | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)

  async function execute() {
    loading = true
    error = null

    const result = await fetchFn()

    if (result.success) {
      data = result.data!
    } else {
      error = result.error!
    }

    loading = false
  }

  return {
    get data() { return data },
    get loading() { return loading },
    get error() { return error },
    execute
  }
}
```

---

## Testing Requirements

### Backend (pytest)

```bash
# Run all tests
poetry run pytest tests/

# Run with coverage
poetry run pytest tests/ --cov=. --cov-report=html

# Run specific test file
poetry run pytest tests/test_auth.py -v
```

**Test structure:**

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

### Frontend (Svelte Testing Library)

```bash
# Run tests
bun run test

# Run with coverage
bun run test -- --coverage

# Run E2E tests
bun run test:e2e
```

**Test structure:**

```typescript
import { render, screen, fireEvent } from '@testing-library/svelte'
import WorkspacePanel from './WorkspacePanel.svelte'

describe('WorkspacePanel', () => {
  it('renders workspace correctly', () => {
    render(WorkspacePanel)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })

  it('handles session creation', async () => {
    render(WorkspacePanel)
    await fireEvent.click(screen.getByText('New Session'))
    expect(await screen.findByText('Session created')).toBeInTheDocument()
  })
})
```

---

## Deployment Workflow

### Pre-Deployment Checklist

- [ ] All tests passing locally
- [ ] `bun run build` succeeds (frontend)
- [ ] `poetry run pytest` passes (backend)
- [ ] No hardcoded secrets
- [ ] Environment variables documented
- [ ] Database migrations ready

### Deployment Commands

```bash
# Build and deploy frontend
cd frontend && bun run build
gcloud run deploy frontend --source .

# Build and deploy backend
cd backend
gcloud run deploy backend --source .
```

### Environment Variables

```bash
# Frontend (.env)
PUBLIC_API_URL=https://api.example.com
PUBLIC_SUPABASE_URL=https://xxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Backend (.env)
DATABASE_URL=postgresql://...
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...
```

---

## Critical Rules

1. **No emojis** in code, comments, or documentation
2. **Immutability** - never mutate objects or arrays
3. **TDD** - write tests before implementation
4. **80% coverage** minimum
5. **Many small files** - 200-400 lines typical, 800 max
6. **No console.log** in production code
7. **Proper error handling** with try/catch
8. **Input validation** with Pydantic/Zod

---

## Related Skills

- `coding-standards.md` - General coding best practices
- `backend-patterns.md` - API and database patterns
- `frontend-patterns.md` - Svelte 5 and SvelteKit patterns
- `tdd-workflow/` - Test-driven development methodology
