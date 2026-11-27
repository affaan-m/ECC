# Django REST API — プロジェクト CLAUDE.md

> PostgreSQL と Celery を使用した Django REST Framework API の実世界サンプル。
> これをプロジェクトのルートにコピーしてサービスに合わせてカスタマイズしてください。

## プロジェクト概要

**スタック:** Python 3.12+, Django 5.x, Django REST Framework, PostgreSQL, Celery + Redis, pytest, Docker Compose

**アーキテクチャ:** ビジネスドメインごとにアプリを持つドメイン駆動設計。APIレイヤーにDRF、非同期タスクにCelery、テストにpytestを使用。すべてのエンドポイントはJSONを返す — テンプレートレンダリングなし。

## 重要なルール

### Python の規約

- すべての関数シグネチャに型ヒントを付ける — `from __future__ import annotations` を使用
- `print()` 文は使用しない — `logging.getLogger(__name__)` を使用
- 文字列フォーマットにはf-stringを使用し、`%` や `.format()` は使用しない
- ファイル操作には `os.path` ではなく `pathlib.Path` を使用
- isortでインポートをソートする: stdlib、サードパーティ、ローカル（ruffにより強制）

### データベース

- すべてのクエリはDjango ORMを使用 — 生SQLは `.raw()` とパラメータ化クエリのみ
- マイグレーションはgitにコミットする — 本番環境では `--fake` を絶対に使用しない
- N+1クエリを防ぐために `select_related()` と `prefetch_related()` を使用する
- すべてのモデルには `created_at` と `updated_at` の自動フィールドが必要
- `filter()`, `order_by()`, または `WHERE` 句で使用されるフィールドにはインデックスを付ける

```python
# 悪い例: N+1クエリ
orders = Order.objects.all()
for order in orders:
    print(order.customer.name)  # 各注文ごとにDBをヒット

# 良い例: JOINによる単一クエリ
orders = Order.objects.select_related("customer").all()
```

### 認証

- `djangorestframework-simplejwt` によるJWT — アクセストークン（15分）+ リフレッシュトークン（7日）
- すべてのビューにパーミッションクラスを設定 — デフォルトに依存しない
- `IsAuthenticated` をベースとして使用し、オブジェクトレベルのアクセスにはカスタムパーミッションを追加
- ログアウト用のトークンブラックリストを有効にする

### シリアライザー

- シンプルなCRUDには `ModelSerializer` を、複雑なバリデーションには `Serializer` を使用
- 入出力の形状が異なる場合は読み取りと書き込みのシリアライザーを分ける
- バリデーションはシリアライザーレベルで行い、ビューでは行わない — ビューは薄くするべき

```python
class CreateOrderSerializer(serializers.Serializer):
    product_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1, max_value=100)

    def validate_product_id(self, value):
        if not Product.objects.filter(id=value, active=True).exists():
            raise serializers.ValidationError("Product not found or inactive")
        return value

class OrderDetailSerializer(serializers.ModelSerializer):
    customer = CustomerSerializer(read_only=True)
    product = ProductSerializer(read_only=True)

    class Meta:
        model = Order
        fields = ["id", "customer", "product", "quantity", "total", "status", "created_at"]
```

### エラーハンドリング

- 一貫したエラーレスポンスのためにDRF例外ハンドラーを使用する
- `core/exceptions.py` にビジネスロジック用のカスタム例外を定義する
- 内部エラーの詳細をクライアントに公開しない

```python
# core/exceptions.py
from rest_framework.exceptions import APIException

class InsufficientStockError(APIException):
    status_code = 409
    default_detail = "Insufficient stock for this order"
    default_code = "insufficient_stock"
```

### コードスタイル

- コードやコメントに絵文字を使用しない
- 最大行長: 120文字（ruffにより強制）
- クラス: PascalCase、関数/変数: snake_case、定数: UPPER_SNAKE_CASE
- ビューは薄く — ビジネスロジックはサービス関数またはモデルメソッドに置く

## ファイル構成

```
config/
  settings/
    base.py              # 共通設定
    local.py             # 開発用オーバーライド（DEBUG=True）
    production.py        # 本番設定
  urls.py                # ルートURL設定
  celery.py              # Celeryアプリ設定
apps/
  accounts/              # ユーザー認証、登録、プロフィール
    models.py
    serializers.py
    views.py
    services.py          # ビジネスロジック
    tests/
      test_views.py
      test_services.py
      factories.py       # Factory Boy ファクトリー
  orders/                # 注文管理
    models.py
    serializers.py
    views.py
    services.py
    tasks.py             # Celeryタスク
    tests/
  products/              # 商品カタログ
    models.py
    serializers.py
    views.py
    tests/
core/
  exceptions.py          # カスタムAPI例外
  permissions.py         # 共有パーミッションクラス
  pagination.py          # カスタムページネーション
  middleware.py          # リクエストロギング、タイミング
  tests/
```

## 主要なパターン

### サービスレイヤー

```python
# apps/orders/services.py
from django.db import transaction

def create_order(*, customer, product_id: uuid.UUID, quantity: int) -> Order:
    """在庫バリデーションと支払い保留付きで注文を作成する。"""
    product = Product.objects.select_for_update().get(id=product_id)

    if product.stock < quantity:
        raise InsufficientStockError()

    with transaction.atomic():
        order = Order.objects.create(
            customer=customer,
            product=product,
            quantity=quantity,
            total=product.price * quantity,
        )
        product.stock -= quantity
        product.save(update_fields=["stock", "updated_at"])

    # 非同期: 確認メールを送信
    send_order_confirmation.delay(order.id)
    return order
```

### ビューパターン

```python
# apps/orders/views.py
class OrderViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_serializer_class(self):
        if self.action == "create":
            return CreateOrderSerializer
        return OrderDetailSerializer

    def get_queryset(self):
        return (
            Order.objects
            .filter(customer=self.request.user)
            .select_related("product", "customer")
            .order_by("-created_at")
        )

    def perform_create(self, serializer):
        order = create_order(
            customer=self.request.user,
            product_id=serializer.validated_data["product_id"],
            quantity=serializer.validated_data["quantity"],
        )
        serializer.instance = order
```

### テストパターン（pytest + Factory Boy）

```python
# apps/orders/tests/factories.py
import factory
from apps.accounts.tests.factories import UserFactory
from apps.products.tests.factories import ProductFactory

class OrderFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = "orders.Order"

    customer = factory.SubFactory(UserFactory)
    product = factory.SubFactory(ProductFactory, stock=100)
    quantity = 1
    total = factory.LazyAttribute(lambda o: o.product.price * o.quantity)

# apps/orders/tests/test_views.py
import pytest
from rest_framework.test import APIClient

@pytest.mark.django_db
class TestCreateOrder:
    def setup_method(self):
        self.client = APIClient()
        self.user = UserFactory()
        self.client.force_authenticate(self.user)

    def test_create_order_success(self):
        product = ProductFactory(price=29_99, stock=10)
        response = self.client.post("/api/orders/", {
            "product_id": str(product.id),
            "quantity": 2,
        })
        assert response.status_code == 201
        assert response.data["total"] == 59_98

    def test_create_order_insufficient_stock(self):
        product = ProductFactory(stock=0)
        response = self.client.post("/api/orders/", {
            "product_id": str(product.id),
            "quantity": 1,
        })
        assert response.status_code == 409

    def test_create_order_unauthenticated(self):
        self.client.force_authenticate(None)
        response = self.client.post("/api/orders/", {})
        assert response.status_code == 401
```

## 環境変数

```bash
# Django
SECRET_KEY=
DEBUG=False
ALLOWED_HOSTS=api.example.com

# データベース
DATABASE_URL=postgres://user:pass@localhost:5432/myapp

# Redis（Celeryブローカー + キャッシュ）
REDIS_URL=redis://localhost:6379/0

# JWT
JWT_ACCESS_TOKEN_LIFETIME=15       # 分
JWT_REFRESH_TOKEN_LIFETIME=10080   # 分（7日）

# メール
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.example.com
```

## テスト戦略

```bash
# すべてのテストを実行
pytest --cov=apps --cov-report=term-missing

# 特定のアプリのテストを実行
pytest apps/orders/tests/ -v

# 並列実行で実行
pytest -n auto

# 前回の失敗したテストのみ
pytest --lf
```

## ECCワークフロー

```bash
# 計画
/plan "Add order refund system with Stripe integration"

# TDDによる開発
/tdd                    # pytest ベースのTDDワークフロー

# レビュー
/python-review          # Python固有のコードレビュー
/security-scan          # Djangoセキュリティ監査
/code-review            # 全般的な品質チェック

# 検証
/verify                 # ビルド、リント、テスト、セキュリティスキャン
```

## Git ワークフロー

- `feat:` 新機能、`fix:` バグ修正、`refactor:` コード変更
- `main` からフィーチャーブランチを切り、PRが必要
- CI: ruff（リント + フォーマット）、mypy（型）、pytest（テスト）、safety（依存関係チェック）
- デプロイ: DockerイメージをKubernetesまたはRailway経由で管理
