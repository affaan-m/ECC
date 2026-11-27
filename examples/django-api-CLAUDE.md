# Django REST API — Project CLAUDE.md

> Real-world example for a Django REST Framework API with PostgreSQL and Celery.
> Copy this to your project root and customize for your service.

## Project Overview

**Stack:** Python 3.12+, Django 5.x, Django REST Framework, PostgreSQL, Celery + Redis, pytest, Docker Compose

**Architecture:** Domain-driven design with apps per business domain. DRF for API layer, Celery for async tasks, pytest for testing. All endpoints return JSON — no template rendering.

## Critical Rules

### Python Conventions

- Type hints on all function signatures — use `from __future__ import annotations`
- No `print()` statements — use `logging.getLogger(__name__)`
- f-strings for string formatting, never `%` or `.format()`
- Use `pathlib.Path` not `os.path` for file operations
- Imports sorted with isort: stdlib, third-party, local (enforced by ruff)

### Database

- All queries use Django ORM — raw SQL only with `.raw()` and parameterized queries
- Migrations committed to git — never use `--fake` in production
- Use `select_related()` and `prefetch_related()` to prevent N+1 queries
- All models must have `created_at` and `updated_at` auto-fields
- Indexes on any field used in `filter()`, `order_by()`, or `WHERE` clauses

```python
# BAD: N+1 query
orders = Order.objects.all()
for order in orders:
    print(order.customer.name)  # hits DB for each order

# GOOD: Single query with join
orders = Order.objects.select_related("customer").all()
```

### Authentication

- JWT via `djangorestframework-simplejwt` — access token (15 min) + refresh token (7 days)
- Permission classes on every view — never rely on default
- Use `IsAuthenticated` as base, add custom permissions for object-level access
- Token blacklisting enabled for logout

### Serializers

- Use `ModelSerializer` for simple CRUD, `Serializer` for complex validation
- Separate read and write serializers when input/output shapes differ
- Validate at serializer level, not in views — views should be thin

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

### Error Handling

- Use DRF exception handler for consistent error responses
- Custom exceptions for business logic in `core/exceptions.py`
- Never expose internal error details to clients

```python
# core/exceptions.py
from rest_framework.exceptions import APIException

class InsufficientStockError(APIException):
    status_code = 409
    default_detail = "Insufficient stock for this order"
    default_code = "insufficient_stock"
```

### Code Style

- No emojis in code or comments
- Max line length: 120 characters (enforced by ruff)
- Classes: PascalCase, functions/variables: snake_case, constants: UPPER_SNAKE_CASE
- Views are thin — business logic lives in service functions or model methods

## File Structure

```
config/
  settings/
    base.py              # Shared settings
    local.py             # Dev overrides (DEBUG=True)
    production.py        # Production settings
  urls.py                # Root URL config
  celery.py              # Celery app configuration
apps/
  accounts/              # User auth, registration, profile
    models.py
    serializers.py
    views.py
    services.py          # Business logic
    tests/
      test_views.py
      test_services.py
      factories.py       # Factory Boy factories
  orders/                # Order management
    models.py
    serializers.py
    views.py
    services.py
    tasks.py             # Celery tasks
    tests/
  products/              # Product catalog
    models.py
    serializers.py
    views.py
    tests/
core/
  exceptions.py          # Custom API exceptions
  permissions.py         # Shared permission classes
  pagination.py          # Custom pagination
  middleware.py          # Request logging, timing
  tests/
```

## Key Patterns

### Service Layer

```python
# apps/orders/services.py
from django.db import transaction

def create_order(*, customer, product_id: uuid.UUID, quantity: int) -> Order:
    """Create an order with stock validation and payment hold."""
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

    # Async: send confirmation email
    send_order_confirmation.delay(order.id)
    return order
```

### View Pattern

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

### Test Pattern (pytest + Factory Boy)

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

## Environment Variables

```bash
# Django
SECRET_KEY=
DEBUG=False
ALLOWED_HOSTS=api.example.com

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/myapp

# Redis (Celery broker + cache)
REDIS_URL=redis://localhost:6379/0

# JWT
JWT_ACCESS_TOKEN_LIFETIME=15       # minutes
JWT_REFRESH_TOKEN_LIFETIME=10080   # minutes (7 days)

# Email
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.example.com
```

## Testing Strategy

```bash
# Run all tests
pytest --cov=apps --cov-report=term-missing

# Run specific app tests
pytest apps/orders/tests/ -v

# Run with parallel execution
pytest -n auto

# Only failing tests from last run
pytest --lf
```

## ECC Workflow

```bash
# Planning
/plan "Add order refund system with Stripe integration"

# Development with TDD
/tdd                    # pytest-based TDD workflow

# Review
/python-review          # Python-specific code review
/security-scan          # Django security audit
/code-review            # General quality check

# Verification
/verify                 # Build, lint, test, security scan
```

## Git Workflow

- `feat:` new features, `fix:` bug fixes, `refactor:` code changes
- Feature branches from `main`, PRs required
- CI: ruff (lint + format), mypy (types), pytest (tests), safety (dep check)
- Deploy: Docker image, managed via Kubernetes or Railway
