---
name: fastapi-patterns
description: 非同期API、依存性注入、Pydanticのリクエスト・レスポンスモデル、OpenAPIドキュメント、テスト、セキュリティ、本番対応のためのFastAPIパターン。
origin: community
---

# FastAPIパターン

本番指向のFastAPIサービスのためのパターン。

## 使用するタイミング

- FastAPIアプリを構築またはレビューする場合。
- ルーター、スキーマ、依存関係、データベースアクセスを分割する場合。
- データベースや外部サービスを呼び出す非同期エンドポイントを記述する場合。
- 認証、認可、OpenAPIドキュメント、テスト、またはデプロイ設定を追加する場合。
- FastAPI PRをコピー可能な例とリスクについて確認する場合。

## 仕組み

FastAPIアプリを明示的な依存関係とサービスコードの上の薄いHTTPレイヤーとして扱います:

- `main.py` はアプリ構築、ミドルウェア、例外ハンドラー、ルーター登録を担当する。
- `schemas/` はPydanticのリクエストとレスポンスモデルを担当する。
- `dependencies.py` はデータベース、認証、ページネーション、リクエストスコープの依存関係を担当する。
- `services/` または `crud/` はビジネスと永続化操作を担当する。
- `tests/` は本番リソースを開かずに依存関係をオーバーライドする。

小さなルーターと明示的な`response_model`宣言を優先します。レスポンススキーマには生のORMオブジェクト、シークレット、フレームワークのグローバル変数を含めないでください。

## プロジェクトレイアウト

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

## アプリケーションファクトリー

テストとワーカーが制御された設定でアプリをビルドできるように、ファクトリーを使用します。

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

`allow_credentials=True`と一緒に`allow_origins=["*"]`を使用しないでください; ブラウザはその組み合わせを拒否し、Starletteは認証情報付きリクエストに対してそれを禁止します。

## Pydanticスキーマ

リクエスト、更新、レスポンスのモデルを分離します。

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

レスポンスモデルにはパスワードハッシュ、アクセストークン、リフレッシュトークン、内部認可状態を含めてはなりません。

## 依存関係

リクエストスコープのリソースには依存性注入を使用します。

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

ルートハンドラー内でインラインにセッション、クライアント、または認証情報を作成しないでください。

## 非同期エンドポイント

I/Oを実行する場合はルートハンドラーを非同期にし、その内部で非同期ライブラリを使用します。

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

非同期ハンドラーからの外部HTTP呼び出しには`httpx.AsyncClient`を使用してください。非同期ルートで`requests`を呼び出さないでください。

## エラー処理

ドメイン例外を一元化し、レスポンスの形状を安定させます。

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

## OpenAPIカスタマイズ

カスタムOpenAPI呼び出し可能オブジェクトを`app.openapi`に割り当ててください; 関数を一度だけ呼び出さないでください。

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

## テスト

ルートハンドラーが決して参照しない内部ヘルパーではなく、`Depends`で使用される依存関係をオーバーライドします。

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

## セキュリティチェックリスト

- `argon2-cffi`、`bcrypt`、または現在のpasslib互換ハッシャーでパスワードをハッシュする。
- JWTの発行者、オーディエンス、有効期限、署名アルゴリズムを検証する。
- CORSオリジンを環境固有に保つ。
- 認証と書き込み負荷の高いエンドポイントにレート制限を設ける。
- すべてのリクエストボディにPydanticモデルを使用する。
- ORMパラメーターバインディングまたはSQLAlchemy Coreの式を使用する; f文字列でSQLを構築しない。
- ログからトークン、認可ヘッダー、クッキー、パスワードを削除する。
- CIで依存関係の監査ツールを実行する。

## パフォーマンスチェックリスト

- データベース接続プールを明示的に設定する。
- リストエンドポイントにページネーションを追加する。
- N+1クエリに注意し、イーガーローディングを意図的に使用する。
- 非同期パスでは非同期HTTP/データベースクライアントを使用する。
- ペイロードサイズとCPUのトレードオフを確認してから圧縮を追加する。
- 明示的な無効化の後ろで安定した高コストの読み取りをキャッシュする。

## 使用例

これらの例はプロジェクト全体のテンプレートではなく、パターンとして使用してください:

- アプリケーションファクトリー: `create_app`でミドルウェアとルーターを一度設定する。
- スキーマの分割: `UserCreate`、`UserUpdate`、`UserResponse`はそれぞれ異なる責務を持つ。
- 依存関係のオーバーライド: テストは`get_db`を直接オーバーライドする。
- OpenAPIのカスタマイズ: `app.openapi = custom_openapi`を割り当てる。

## 関連情報

- エージェント: `fastapi-reviewer`
- コマンド: `/fastapi-review`
- スキル: `python-patterns`
- スキル: `python-testing`
- スキル: `api-design`
