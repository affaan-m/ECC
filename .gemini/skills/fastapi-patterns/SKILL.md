---
name: fastapi-patterns
description: FastAPI patterns for async APIs, dependency injection, Pydantic request and response models, OpenAPI docs, tests, security, and production readiness.
origin: community
---

# FastAPI Patterns

Production-oriented patterns for FastAPI services.

## When to Use

- Building or reviewing a FastAPI app.
- Splitting routers, schemas, dependencies, and database access.
- Writing async endpoints that call a database or external service.
- Adding authentication, authorization, OpenAPI docs, tests, or deployment settings.
- Checking a FastAPI PR for copy-pasteable examples and production risks.

## How It Works

Treat the FastAPI app as a thin HTTP layer over explicit dependencies and service code:

- `main.py` owns app construction, middleware, exception handlers, and router registration.
- `schemas/` owns Pydantic request and response models.
- `dependencies.py` owns database, auth, pagination, and request-scoped dependencies.
- `services/` or `crud/` owns business and persistence operations.
- `tests/` overrides dependencies instead of opening production resources.

Prefer small routers and explicit `response_model` declarations. Keep raw ORM objects, secrets, and framework globals out of response schemas.

## Project Layout

```text
app/
|-- main.py
|-- config.py
|-- dependencies.py
|-- exceptions.py
|-- api/
|   `-- routes/
|       |-- users.py
|       `-- health.py
|-- core/
|   |-- security.py
|   `-- middleware.py
|-- db/
|   |-- session.py
|   `-- crud.py
|-- models/
|-- schemas/
`-- tests/
```

## Application Factory

Use a factory so tests and workers can build the app with controlled settings.

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import health, users
from app.config import settings
from app.db.session import close_db, init_db
from app.exceptions import register_exception_handlers


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await close_db()


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.api_title,
        version=settings.api_version,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=bool(settings.cors_origins),
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    register_exception_handlers(app)
    app.include_router(health.router, prefix="/health", tags=["health"])
    app.include_router(users.router, prefix="/api/v1/users", tags=["users"])
    return app


app = create_app()
```

Do not use `allow_origins=["*"]` with `allow_credentials=True`; browsers reject that combination and Starlette disallows it for credentialed requests.

## Pydantic Schemas

Keep request, update, and response models separate.

```python
from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserBase(BaseModel):
    email: EmailStr
    full_name: Annotated[str, Field(min_length=1, max_length=100)]


class UserCreate(UserBase):
    password: Annotated[str, Field(min_length=12, max_length=128)]


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: Annotated[str | None, Field(min_length=1, max_length=100)] = None


class UserResponse(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
```

Response models must never include password hashes, access tokens, refresh tokens, or internal authorization state.

## Dependencies

Use dependency injection for request-scoped resources.

```python
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import session_factory
from app.models.user import User


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_db() -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_token(token)
    user_id = UUID(payload["sub"])
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return user
```

Avoid creating sessions, clients, or credentials inline inside route handlers.

## Async Endpoints

Keep route handlers async when they perform I/O, and use async libraries inside them.

```python
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.user import UserResponse


router = APIRouter()


@router.get("/", response_model=list[UserResponse])
async def list_users(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
    )
    return result.scalars().all()
```

Use `httpx.AsyncClient` for external HTTP calls from async handlers. Do not call `requests` in an async route.

## Error Handling

Centralize domain exceptions and keep response shapes stable.

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message}},
        )
```

## OpenAPI Customization

Assign the custom OpenAPI callable to `app.openapi`; do not just call the function once.

```python
from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi


def install_openapi(app: FastAPI) -> None:
    def custom_openapi():
        if app.openapi_schema:
            return app.openapi_schema
        app.openapi_schema = get_openapi(
            title="Service API",
            version="1.0.0",
            routes=app.routes,
        )
        return app.openapi_schema

    app.openapi = custom_openapi
```

## Testing

Override the dependency used by `Depends`, not an internal helper that route handlers never reference.

```python
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.main import create_app


@pytest.fixture
async def client(test_session: AsyncSession):
    app = create_app()

    async def override_get_db():
        yield test_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as test_client:
        yield test_client
    app.dependency_overrides.clear()
```

## Security Checklist

- Hash passwords with `argon2-cffi`, `bcrypt`, or a current passlib-compatible hasher.
- Validate JWT issuer, audience, expiry, and signing algorithm.
- Keep CORS origins environment-specific.
- Put rate limits on auth and write-heavy endpoints.
- Use Pydantic models for all request bodies.
- Use ORM parameter binding or SQLAlchemy Core expressions; never build SQL with f-strings.
- Redact tokens, authorization headers, cookies, and passwords from logs.
- Run dependency audit tooling in CI.

## Performance Checklist

- Configure database connection pooling explicitly.
- Add pagination to list endpoints.
- Watch for N+1 queries and use eager loading intentionally.
- Use async HTTP/database clients in async paths.
- Add compression only after checking payload size and CPU tradeoffs.
- Cache stable expensive reads behind explicit invalidation.

## Examples

Use these examples as patterns, not as project-wide templates:

- Application factory: configure middleware and routers once in `create_app`.
- Schema split: `UserCreate`, `UserUpdate`, and `UserResponse` have different responsibilities.
- Dependency override: tests override `get_db` directly.
- OpenAPI customization: assign `app.openapi = custom_openapi`.

## See Also

- Agent: `fastapi-reviewer`
- Command: `/fastapi-review`
- Skill: `python-patterns`
- Skill: `python-testing`
- Skill: `api-design`
