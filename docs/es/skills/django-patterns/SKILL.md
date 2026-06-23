---
name: django-patterns
description: Patrones de arquitectura Django, diseño de API REST con DRF, buenas prácticas de ORM, caché, señales, middleware y aplicaciones Django de nivel producción.
origin: ECC
---

# Patrones de Desarrollo Django

Patrones de arquitectura Django de nivel producción para aplicaciones escalables y mantenibles.

## Cuándo Activar

- Construir aplicaciones web Django
- Diseñar APIs con Django REST Framework
- Trabajar con el ORM de Django y modelos
- Configurar la estructura del proyecto Django
- Implementar caché, señales, middleware

## Estructura del Proyecto

### Layout Recomendado

```
myproject/
├── config/
│   ├── __init__.py
│   ├── settings/
│   │   ├── __init__.py
│   │   ├── base.py          # Configuración base
│   │   ├── development.py   # Configuración de desarrollo
│   │   ├── production.py    # Configuración de producción
│   │   └── test.py          # Configuración de pruebas
│   ├── urls.py
│   ├── wsgi.py
│   └── asgi.py
├── manage.py
└── apps/
    ├── __init__.py
    ├── users/
    │   ├── __init__.py
    │   ├── models.py
    │   ├── views.py
    │   ├── serializers.py
    │   ├── urls.py
    │   ├── permissions.py
    │   ├── filters.py
    │   ├── services.py
    │   └── tests/
    └── products/
        └── ...
```

### Patrón de Configuración Dividida

```python
# config/settings/base.py
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

SECRET_KEY = env('DJANGO_SECRET_KEY')
DEBUG = False
ALLOWED_HOSTS = []

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    # Apps locales
    'apps.users',
    'apps.products',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': env('DB_NAME'),
        'USER': env('DB_USER'),
        'PASSWORD': env('DB_PASSWORD'),
        'HOST': env('DB_HOST'),
        'PORT': env('DB_PORT', default='5432'),
    }
}

# config/settings/development.py
from .base import *

DEBUG = True
ALLOWED_HOSTS = ['localhost', '127.0.0.1']

DATABASES['default']['NAME'] = 'myproject_dev'

INSTALLED_APPS += ['debug_toolbar']

MIDDLEWARE += ['debug_toolbar.middleware.DebugToolbarMiddleware']

EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'

# config/settings/production.py
from .base import *

DEBUG = False
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS')
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# Logging
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'file': {
            'level': 'WARNING',
            'class': 'logging.FileHandler',
            'filename': '/var/log/django/django.log',
        },
    },
    'loggers': {
        'django': {
            'handlers': ['file'],
            'level': 'WARNING',
            'propagate': True,
        },
    },
}
```

## Patrones de Diseño de Modelos

### Buenas Prácticas de Modelos

```python
from django.db import models
from django.contrib.auth.models import AbstractUser
from django.core.validators import MinValueValidator, MaxValueValidator

class User(AbstractUser):
    """Modelo de usuario personalizado que extiende AbstractUser."""
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=20, blank=True)
    birth_date = models.DateField(null=True, blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    class Meta:
        db_table = 'users'
        verbose_name = 'user'
        verbose_name_plural = 'users'
        ordering = ['-date_joined']

    def __str__(self):
        return self.email

    def get_full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

class Product(models.Model):
    """Modelo de producto con configuración de campos apropiada."""
    name = models.CharField(max_length=200)
    slug = models.SlugField(unique=True, max_length=250)
    description = models.TextField(blank=True)
    price = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(0)]
    )
    stock = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    category = models.ForeignKey(
        'Category',
        on_delete=models.CASCADE,
        related_name='products'
    )
    tags = models.ManyToManyField('Tag', blank=True, related_name='products')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'products'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['slug']),
            models.Index(fields=['-created_at']),
            models.Index(fields=['category', 'is_active']),
        ]
        constraints = [
            models.CheckConstraint(
                check=models.Q(price__gte=0),
                name='price_non_negative'
            )
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)
```

### Buenas Prácticas de QuerySet

```python
from django.db import models

class ProductQuerySet(models.QuerySet):
    """QuerySet personalizado para el modelo Product."""

    def active(self):
        """Retornar solo productos activos."""
        return self.filter(is_active=True)

    def with_category(self):
        """Seleccionar categoría relacionada para evitar consultas N+1."""
        return self.select_related('category')

    def with_tags(self):
        """Prefetch tags para relación muchos-a-muchos."""
        return self.prefetch_related('tags')

    def in_stock(self):
        """Retornar productos con stock > 0."""
        return self.filter(stock__gt=0)

    def search(self, query):
        """Buscar productos por nombre o descripción."""
        return self.filter(
            models.Q(name__icontains=query) |
            models.Q(description__icontains=query)
        )

class Product(models.Model):
    # ... campos ...

    objects = ProductQuerySet.as_manager()  # Usar QuerySet personalizado

# Uso
Product.objects.active().with_category().in_stock()
```

### Métodos de Manager

```python
class ProductManager(models.Manager):
    """Manager personalizado para consultas complejas."""

    def get_or_none(self, **kwargs):
        """Retornar objeto o None en lugar de DoesNotExist."""
        try:
            return self.get(**kwargs)
        except self.model.DoesNotExist:
            return None

    def create_with_tags(self, name, price, tag_names):
        """Crear producto con tags asociados."""
        product = self.create(name=name, price=price)
        tags = [Tag.objects.get_or_create(name=name)[0] for name in tag_names]
        product.tags.set(tags)
        return product

    def bulk_update_stock(self, product_ids, quantity):
        """Actualización masiva de stock para múltiples productos."""
        return self.filter(id__in=product_ids).update(stock=quantity)

# En el modelo
class Product(models.Model):
    # ... campos ...
    custom = ProductManager()
```

## Patrones de Django REST Framework

### Patrones de Serializer

```python
from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from .models import Product, User

class ProductSerializer(serializers.ModelSerializer):
    """Serializer para el modelo Product."""

    category_name = serializers.CharField(source='category.name', read_only=True)
    average_rating = serializers.FloatField(read_only=True)
    discount_price = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            'id', 'name', 'slug', 'description', 'price',
            'discount_price', 'stock', 'category_name',
            'average_rating', 'created_at'
        ]
        read_only_fields = ['id', 'slug', 'created_at']

    def get_discount_price(self, obj):
        """Calcular precio con descuento si aplica."""
        if hasattr(obj, 'discount') and obj.discount:
            return obj.price * (1 - obj.discount.percent / 100)
        return obj.price

    def validate_price(self, value):
        """Asegurar que el precio no sea negativo."""
        if value < 0:
            raise serializers.ValidationError("Price cannot be negative.")
        return value

class ProductCreateSerializer(serializers.ModelSerializer):
    """Serializer para crear productos."""

    class Meta:
        model = Product
        fields = ['name', 'description', 'price', 'stock', 'category']

    def validate(self, data):
        """Validación personalizada para múltiples campos."""
        if data['price'] > 10000 and data['stock'] > 100:
            raise serializers.ValidationError(
                "Cannot have high-value products with large stock."
            )
        return data

class UserRegistrationSerializer(serializers.ModelSerializer):
    """Serializer para registro de usuario."""

    password = serializers.CharField(
        write_only=True,
        required=True,
        validators=[validate_password],
        style={'input_type': 'password'}
    )
    password_confirm = serializers.CharField(write_only=True, style={'input_type': 'password'})

    class Meta:
        model = User
        fields = ['email', 'username', 'password', 'password_confirm']

    def validate(self, data):
        """Validar que las contraseñas coincidan."""
        if data['password'] != data['password_confirm']:
            raise serializers.ValidationError({
                "password_confirm": "Password fields didn't match."
            })
        return data

    def create(self, validated_data):
        """Crear usuario con contraseña hasheada."""
        validated_data.pop('password_confirm')
        password = validated_data.pop('password')
        user = User.objects.create(**validated_data)
        user.set_password(password)
        user.save()
        return user
```

### Patrones de ViewSet

```python
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from django_filters.rest_framework import DjangoFilterBackend
from .models import Product
from .serializers import ProductSerializer, ProductCreateSerializer
from .permissions import IsOwnerOrReadOnly
from .filters import ProductFilter
from .services import ProductService

class ProductViewSet(viewsets.ModelViewSet):
    """ViewSet para el modelo Product."""

    queryset = Product.objects.select_related('category').prefetch_related('tags')
    permission_classes = [IsAuthenticated, IsOwnerOrReadOnly]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ProductFilter
    search_fields = ['name', 'description']
    ordering_fields = ['price', 'created_at', 'name']
    ordering = ['-created_at']

    def get_serializer_class(self):
        """Retornar serializer apropiado según la acción."""
        if self.action == 'create':
            return ProductCreateSerializer
        return ProductSerializer

    def perform_create(self, serializer):
        """Guardar con contexto de usuario."""
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=['get'])
    def featured(self, request):
        """Retornar productos destacados."""
        featured = self.queryset.filter(is_featured=True)[:10]
        serializer = self.get_serializer(featured, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def purchase(self, request, pk=None):
        """Comprar un producto."""
        product = self.get_object()
        service = ProductService()
        result = service.purchase(product, request.user)
        return Response(result, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def my_products(self, request):
        """Retornar productos creados por el usuario actual."""
        products = self.queryset.filter(created_by=request.user)
        page = self.paginate_queryset(products)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)
```

### Acciones Personalizadas

```python
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def add_to_cart(request):
    """Agregar producto al carrito del usuario."""
    product_id = request.data.get('product_id')
    quantity = request.data.get('quantity', 1)

    try:
        product = Product.objects.get(id=product_id)
    except Product.DoesNotExist:
        return Response(
            {'error': 'Product not found'},
            status=status.HTTP_404_NOT_FOUND
        )

    cart, _ = Cart.objects.get_or_create(user=request.user)
    CartItem.objects.create(
        cart=cart,
        product=product,
        quantity=quantity
    )

    return Response({'message': 'Added to cart'}, status=status.HTTP_201_CREATED)
```

## Patrón de Capa de Servicio

```python
# apps/orders/services.py
from typing import Optional
from django.db import transaction
from .models import Order, OrderItem

class OrderService:
    """Capa de servicio para la lógica de negocio relacionada con pedidos."""

    @staticmethod
    @transaction.atomic
    def create_order(user, cart: Cart) -> Order:
        """Crear pedido a partir del carrito."""
        order = Order.objects.create(
            user=user,
            total_price=cart.total_price
        )

        for item in cart.items.all():
            OrderItem.objects.create(
                order=order,
                product=item.product,
                quantity=item.quantity,
                price=item.product.price
            )

        # Vaciar carrito
        cart.items.all().delete()

        return order

    @staticmethod
    def process_payment(order: Order, payment_data: dict) -> bool:
        """Procesar el pago del pedido."""
        # Integración con pasarela de pago
        payment = PaymentGateway.charge(
            amount=order.total_price,
            token=payment_data['token']
        )

        if payment.success:
            order.status = Order.Status.PAID
            order.save()
            # Enviar email de confirmación
            OrderService.send_confirmation_email(order)
            return True

        return False

    @staticmethod
    def send_confirmation_email(order: Order):
        """Enviar email de confirmación del pedido."""
        # Lógica de envío de email
        pass
```

## Estrategias de Caché

### Caché a Nivel de Vista

```python
from django.views.decorators.cache import cache_page
from django.utils.decorators import method_decorator

@method_decorator(cache_page(60 * 15), name='dispatch')  # 15 minutos
class ProductListView(generic.ListView):
    model = Product
    template_name = 'products/list.html'
    context_object_name = 'products'
```

### Caché de Fragmentos de Plantilla

```django
{% load cache %}
{% cache 500 sidebar %}
    ... contenido costoso del sidebar ...
{% endcache %}
```

### Caché de Bajo Nivel

```python
from django.core.cache import cache

def get_featured_products():
    """Obtener productos destacados con caché."""
    cache_key = 'featured_products'
    products = cache.get(cache_key)

    if products is None:
        products = list(Product.objects.filter(is_featured=True))
        cache.set(cache_key, products, timeout=60 * 15)  # 15 minutos

    return products
```

### Caché de QuerySet

```python
from django.core.cache import cache

def get_popular_categories():
    cache_key = 'popular_categories'
    categories = cache.get(cache_key)

    if categories is None:
        categories = list(Category.objects.annotate(
            product_count=Count('products')
        ).filter(product_count__gt=10).order_by('-product_count')[:20])
        cache.set(cache_key, categories, timeout=60 * 60)  # 1 hora

    return categories
```

## Señales

### Patrones de Señal

```python
# apps/users/signals.py
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.contrib.auth import get_user_model
from .models import Profile

User = get_user_model()

@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """Crear perfil cuando se crea el usuario."""
    if created:
        Profile.objects.create(user=instance)

@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    """Guardar perfil cuando se guarda el usuario."""
    instance.profile.save()

# apps/users/apps.py
from django.apps import AppConfig

class UsersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.users'

    def ready(self):
        """Importar señales cuando la app esté lista."""
        import apps.users.signals
```

## Middleware

### Middleware Personalizado

```python
# middleware/active_user_middleware.py
import time
from django.utils.deprecation import MiddlewareMixin

class ActiveUserMiddleware(MiddlewareMixin):
    """Middleware para rastrear usuarios activos."""

    def process_request(self, request):
        """Procesar request entrante."""
        if request.user.is_authenticated:
            # Actualizar última hora activa
            request.user.last_active = timezone.now()
            request.user.save(update_fields=['last_active'])

class RequestLoggingMiddleware(MiddlewareMixin):
    """Middleware para logging de requests."""

    def process_request(self, request):
        """Registrar hora de inicio del request."""
        request.start_time = time.time()

    def process_response(self, request, response):
        """Registrar duración del request."""
        if hasattr(request, 'start_time'):
            duration = time.time() - request.start_time
            logger.info(f'{request.method} {request.path} - {response.status_code} - {duration:.3f}s')
        return response
```

## Optimización de Rendimiento

### Prevención de Consultas N+1

```python
# Mal - consultas N+1
products = Product.objects.all()
for product in products:
    print(product.category.name)  # Consulta separada para cada producto

# Bien - consulta única con select_related
products = Product.objects.select_related('category').all()
for product in products:
    print(product.category.name)

# Bien - Prefetch para muchos-a-muchos
products = Product.objects.prefetch_related('tags').all()
for product in products:
    for tag in product.tags.all():
        print(tag.name)
```

### Indexación de Base de Datos

```python
class Product(models.Model):
    name = models.CharField(max_length=200, db_index=True)
    slug = models.SlugField(unique=True)
    category = models.ForeignKey('Category', on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['name']),
            models.Index(fields=['-created_at']),
            models.Index(fields=['category', 'created_at']),
        ]
```

### Operaciones Masivas

```python
# Creación masiva
Product.objects.bulk_create([
    Product(name=f'Product {i}', price=10.00)
    for i in range(1000)
])

# Actualización masiva
products = Product.objects.all()[:100]
for product in products:
    product.is_active = True
Product.objects.bulk_update(products, ['is_active'])

# Eliminación masiva
Product.objects.filter(stock=0).delete()
```

## Referencia Rápida

| Patrón | Descripción |
|---------|-------------|
| Configuración dividida | Separar configuración de dev/prod/test |
| QuerySet personalizado | Métodos de consulta reutilizables |
| Capa de Servicio | Separación de lógica de negocio |
| ViewSet | Endpoints de API REST |
| Validación de Serializer | Transformación de request/response |
| select_related | Optimización de clave foránea |
| prefetch_related | Optimización de muchos-a-muchos |
| Cache first | Cachear operaciones costosas |
| Señales | Acciones basadas en eventos |
| Middleware | Procesamiento de request/response |

Recuerda: Django proporciona muchos atajos, pero para aplicaciones de producción, la estructura y organización importan más que el código conciso. Construir para la mantenibilidad.
