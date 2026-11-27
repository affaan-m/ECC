# Django REST API — 프로젝트 CLAUDE.md

> PostgreSQL과 Celery를 사용하는 Django REST Framework API의 실전 예시입니다.
> 프로젝트 루트에 복사하여 서비스에 맞게 커스터마이즈하세요.

## 프로젝트 개요

**기술 스택:** Python 3.12+, Django 5.x, Django REST Framework, PostgreSQL, Celery + Redis, pytest, Docker Compose

**아키텍처:** 비즈니스 도메인별 앱으로 구성된 도메인 주도 설계. API 레이어에 DRF, 비동기 작업에 Celery, 테스트에 pytest 사용. 모든 엔드포인트는 JSON을 반환하며 템플릿 렌더링은 없음.

## 필수 규칙

### Python 규칙

- 모든 함수 시그니처에 type hints 사용 — `from __future__ import annotations` 사용
- `print()` 문 사용 금지 — `logging.getLogger(__name__)` 사용
- 문자열 포매팅은 f-strings 사용, `%`나 `.format()`은 사용 금지
- 파일 작업에 `os.path` 대신 `pathlib.Path` 사용
- isort로 import 정렬: stdlib, third-party, local 순서 (ruff에 의해 강제)

### 데이터베이스

- 모든 쿼리는 Django ORM 사용 — raw SQL은 `.raw()`와 parameterized 쿼리로만 사용
- 마이그레이션은 git에 커밋 — 프로덕션에서 `--fake` 사용 금지
- N+1 쿼리 방지를 위해 `select_related()`와 `prefetch_related()` 사용
- 모든 모델에 `created_at`과 `updated_at` 자동 필드 필수
- `filter()`, `order_by()`, 또는 `WHERE` 절에 사용되는 모든 필드에 인덱스 추가

```python
# 나쁜 예: N+1 쿼리
orders = Order.objects.all()
for order in orders:
    print(order.customer.name)  # 각 주문마다 DB를 조회함

# 좋은 예: join을 사용한 단일 쿼리
orders = Order.objects.select_related("customer").all()
```

### 인증

- `djangorestframework-simplejwt`를 통한 JWT — access token (15분) + refresh token (7일)
- 모든 뷰에 permission 클래스 지정 — 기본값에 의존하지 않기
- `IsAuthenticated`를 기본으로, 객체 수준 접근에는 커스텀 permission 추가
- 로그아웃을 위한 token blacklisting 활성화

### Serializers

- 간단한 CRUD에는 `ModelSerializer`, 복잡한 유효성 검증에는 `Serializer` 사용
- 입력/출력 형태가 다를 때는 읽기와 쓰기 serializer를 분리
- 유효성 검증은 serializer 레벨에서 — 뷰는 얇게 유지

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

### 오류 처리

- 일관된 오류 응답을 위해 DRF exception handler 사용
- 비즈니스 로직용 커스텀 예외는 `core/exceptions.py`에 정의
- 클라이언트에 내부 오류 세부 정보를 노출하지 않기

```python
# core/exceptions.py
from rest_framework.exceptions import APIException

class InsufficientStockError(APIException):
    status_code = 409
    default_detail = "Insufficient stock for this order"
    default_code = "insufficient_stock"
```

### 코드 스타일

- 코드나 주석에 이모지 사용 금지
- 최대 줄 길이: 120자 (ruff에 의해 강제)
- 클래스: PascalCase, 함수/변수: snake_case, 상수: UPPER_SNAKE_CASE
- 뷰는 얇게 유지 — 비즈니스 로직은 서비스 함수나 모델 메서드에 배치

## 파일 구조

```
config/
  settings/
    base.py              # 공유 설정
    local.py             # 개발 환경 오버라이드 (DEBUG=True)
    production.py        # 프로덕션 설정
  urls.py                # 루트 URL 설정
  celery.py              # Celery 앱 설정
apps/
  accounts/              # 사용자 인증, 회원가입, 프로필
    models.py
    serializers.py
    views.py
    services.py          # 비즈니스 로직
    tests/
      test_views.py
      test_services.py
      factories.py       # Factory Boy 팩토리
  orders/                # 주문 관리
    models.py
    serializers.py
    views.py
    services.py
    tasks.py             # Celery 작업
    tests/
  products/              # 상품 카탈로그
    models.py
    serializers.py
    views.py
    tests/
core/
  exceptions.py          # 커스텀 API 예외
  permissions.py         # 공유 permission 클래스
  pagination.py          # 커스텀 페이지네이션
  middleware.py          # 요청 로깅, 타이밍
  tests/
```

## 주요 패턴

### Service 레이어

```python
# apps/orders/services.py
from django.db import transaction

def create_order(*, customer, product_id: uuid.UUID, quantity: int) -> Order:
    """재고 검증과 결제 보류를 포함한 주문 생성."""
    with transaction.atomic():
        product = Product.objects.select_for_update().get(id=product_id)

        if product.stock < quantity:
            raise InsufficientStockError()

        order = Order.objects.create(
            customer=customer,
            product=product,
            quantity=quantity,
            total=product.price * quantity,
        )
        product.stock -= quantity
        product.save(update_fields=["stock", "updated_at"])

    # 비동기: 주문 확인 이메일 발송
    send_order_confirmation.delay(order.id)
    return order
```

### View 패턴

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

### 테스트 패턴 (pytest + Factory Boy)

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

## 환경 변수

```bash
# Django
SECRET_KEY=
DEBUG=False
ALLOWED_HOSTS=api.example.com

# 데이터베이스
DATABASE_URL=postgres://user:pass@localhost:5432/myapp

# Redis (Celery broker + 캐시)
REDIS_URL=redis://localhost:6379/0

# JWT
JWT_ACCESS_TOKEN_LIFETIME=15       # 분
JWT_REFRESH_TOKEN_LIFETIME=10080   # 분 (7일)

# 이메일
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.example.com
```

## 테스트 전략

```bash
# 전체 테스트 실행
pytest --cov=apps --cov-report=term-missing

# 특정 앱 테스트 실행
pytest apps/orders/tests/ -v

# 병렬 실행
pytest -n auto

# 마지막 실행에서 실패한 테스트만 실행
pytest --lf
```

## ECC 워크플로우

```bash
# 계획 수립
/plan "Add order refund system with Stripe integration"

# TDD로 개발
/tdd                    # pytest 기반 TDD 워크플로우

# 리뷰
/python-review          # Python 전용 코드 리뷰
/security-scan          # Django 보안 감사
/code-review            # 일반 품질 검사

# 검증
/verify                 # 빌드, 린트, 테스트, 보안 스캔
```

## Git 워크플로우

- `feat:` 새 기능, `fix:` 버그 수정, `refactor:` 코드 변경
- `main`에서 feature 브랜치 생성, PR 필수
- CI: ruff (린트 + 포맷), mypy (타입), pytest (테스트), safety (의존성 검사)
- 배포: Docker 이미지, Kubernetes 또는 Railway로 관리
