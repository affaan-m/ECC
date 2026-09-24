---
name: api-design
description: Patrones de diseño REST API incluyendo nomenclatura de recursos, códigos de estado, paginación, filtrado, respuestas de error, versionado y rate limiting para APIs de producción.
origin: ECC
---

# Patrones de Diseño de API

Convenciones y buenas prácticas para diseñar APIs REST consistentes y amigables para desarrolladores.

## Cuándo Activar

- Diseñar nuevos endpoints de API
- Revisar contratos de API existentes
- Agregar paginación, filtrado u ordenamiento
- Implementar manejo de errores para APIs
- Planificar la estrategia de versionado de API
- Construir APIs públicas o para partners

## Diseño de Recursos

### Estructura de URL

```
# Los recursos son sustantivos, plural, minúsculas, kebab-case
GET    /api/v1/users
GET    /api/v1/users/:id
POST   /api/v1/users
PUT    /api/v1/users/:id
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id

# Sub-recursos para relaciones
GET    /api/v1/users/:id/orders
POST   /api/v1/users/:id/orders

# Acciones que no mapean a CRUD (usar verbos con moderación)
POST   /api/v1/orders/:id/cancel
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
```

### Reglas de Nomenclatura

```
# BIEN
/api/v1/team-members          # kebab-case para recursos de varias palabras
/api/v1/orders?status=active  # query params para filtrado
/api/v1/users/123/orders      # recursos anidados para pertenencia

# MAL
/api/v1/getUsers              # verbo en la URL
/api/v1/user                  # singular (usar plural)
/api/v1/team_members          # snake_case en URLs
/api/v1/users/123/getOrders   # verbo en recurso anidado
```

## Métodos HTTP y Códigos de Estado

### Semántica de Métodos

| Método | Idempotente | Seguro | Usar Para |
|--------|-----------|------|---------|
| GET | Sí | Sí | Recuperar recursos |
| POST | No | No | Crear recursos, disparar acciones |
| PUT | Sí | No | Reemplazo completo de un recurso |
| PATCH | No* | No | Actualización parcial de un recurso |
| DELETE | Sí | No | Eliminar un recurso |

*PATCH puede hacerse idempotente con la implementación adecuada

### Referencia de Códigos de Estado

```
# Éxito
200 OK                    — GET, PUT, PATCH (con cuerpo de respuesta)
201 Created               — POST (incluir header Location)
204 No Content            — DELETE, PUT (sin cuerpo de respuesta)

# Errores de Cliente
400 Bad Request           — Fallo de validación, JSON malformado
401 Unauthorized          — Autenticación ausente o inválida
403 Forbidden             — Autenticado pero no autorizado
404 Not Found             — El recurso no existe
409 Conflict              — Entrada duplicada, conflicto de estado
422 Unprocessable Entity  — Semánticamente inválido (JSON válido, datos incorrectos)
429 Too Many Requests     — Límite de rate excedido

# Errores de Servidor
500 Internal Server Error — Fallo inesperado (nunca exponer detalles)
502 Bad Gateway           — Falló el servicio upstream
503 Service Unavailable   — Sobrecarga temporal, incluir Retry-After
```

### Errores Comunes

```
# MAL: 200 para todo
{ "status": 200, "success": false, "error": "Not found" }

# BIEN: Usar códigos de estado HTTP semánticamente
HTTP/1.1 404 Not Found
{ "error": { "code": "not_found", "message": "User not found" } }

# MAL: 500 para errores de validación
# BIEN: 400 o 422 con detalles por campo

# MAL: 200 para recursos creados
# BIEN: 201 con header Location
HTTP/1.1 201 Created
Location: /api/v1/users/abc-123
```

## Formato de Respuesta

### Respuesta Exitosa

```json
{
  "data": {
    "id": "abc-123",
    "email": "alice@example.com",
    "name": "Alice",
    "created_at": "2025-01-15T10:30:00Z"
  }
}
```

### Respuesta de Colección (con Paginación)

```json
{
  "data": [
    { "id": "abc-123", "name": "Alice" },
    { "id": "def-456", "name": "Bob" }
  ],
  "meta": {
    "total": 142,
    "page": 1,
    "per_page": 20,
    "total_pages": 8
  },
  "links": {
    "self": "/api/v1/users?page=1&per_page=20",
    "next": "/api/v1/users?page=2&per_page=20",
    "last": "/api/v1/users?page=8&per_page=20"
  }
}
```

### Respuesta de Error

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      {
        "field": "email",
        "message": "Must be a valid email address",
        "code": "invalid_format"
      },
      {
        "field": "age",
        "message": "Must be between 0 and 150",
        "code": "out_of_range"
      }
    ]
  }
}
```

### Variantes de Envelope de Respuesta

```typescript
// Opción A: Envelope con wrapper data (recomendado para APIs públicas)
interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
  links?: PaginationLinks;
}

interface ApiError {
  error: {
    code: string;
    message: string;
    details?: FieldError[];
  };
}

// Opción B: Respuesta plana (más simple, común para APIs internas)
// Éxito: retornar el recurso directamente
// Error: retornar objeto de error
// Distinguir por código de estado HTTP
```

## Paginación

### Basada en Offset (Simple)

```
GET /api/v1/users?page=2&per_page=20

# Implementación
SELECT * FROM users
ORDER BY created_at DESC
LIMIT 20 OFFSET 20;
```

**Pros:** Fácil de implementar, soporta "saltar a página N"
**Contras:** Lento en offsets grandes (OFFSET 100000), inconsistente con inserciones concurrentes

### Basada en Cursor (Escalable)

```
GET /api/v1/users?cursor=eyJpZCI6MTIzfQ&limit=20

# Implementación
SELECT * FROM users
WHERE id > :cursor_id
ORDER BY id ASC
LIMIT 21;  -- obtener uno extra para determinar has_next
```

```json
{
  "data": [...],
  "meta": {
    "has_next": true,
    "next_cursor": "eyJpZCI6MTQzfQ"
  }
}
```

**Pros:** Rendimiento consistente independientemente de la posición, estable con inserciones concurrentes
**Contras:** No se puede saltar a una página arbitraria, el cursor es opaco

### Cuándo Usar Cuál

| Caso de Uso | Tipo de Paginación |
|----------|----------------|
| Dashboards administrativos, datasets pequeños (<10K) | Offset |
| Scroll infinito, feeds, datasets grandes | Cursor |
| APIs públicas | Cursor (por defecto) con offset (opcional) |
| Resultados de búsqueda | Offset (los usuarios esperan números de página) |

## Filtrado, Ordenamiento y Búsqueda

### Filtrado

```
# Igualdad simple
GET /api/v1/orders?status=active&customer_id=abc-123

# Operadores de comparación (usar notación de corchetes)
GET /api/v1/products?price[gte]=10&price[lte]=100
GET /api/v1/orders?created_at[after]=2025-01-01

# Múltiples valores (separados por coma)
GET /api/v1/products?category=electronics,clothing

# Campos anidados (notación de punto)
GET /api/v1/orders?customer.country=US
```

### Ordenamiento

```
# Campo único (prefijo - para descendente)
GET /api/v1/products?sort=-created_at

# Múltiples campos (separados por coma)
GET /api/v1/products?sort=-featured,price,-created_at
```

### Búsqueda de Texto Completo

```
# Parámetro de consulta de búsqueda
GET /api/v1/products?q=wireless+headphones

# Búsqueda específica de campo
GET /api/v1/users?email=alice
```

### Conjuntos de Campos Reducidos (Sparse Fieldsets)

```
# Retornar solo los campos especificados (reduce el payload)
GET /api/v1/users?fields=id,name,email
GET /api/v1/orders?fields=id,total,status&include=customer.name
```

## Autenticación y Autorización

### Autenticación Basada en Token

```
# Bearer token en el header Authorization
GET /api/v1/users
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...

# API key (para servidor a servidor)
GET /api/v1/data
X-API-Key: sk_live_abc123
```

### Patrones de Autorización

```typescript
// A nivel de recurso: verificar propiedad
app.get("/api/v1/orders/:id", async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: { code: "not_found" } });
  if (order.userId !== req.user.id) return res.status(403).json({ error: { code: "forbidden" } });
  return res.json({ data: order });
});

// Basada en roles: verificar permisos
app.delete("/api/v1/users/:id", requireRole("admin"), async (req, res) => {
  await User.delete(req.params.id);
  return res.status(204).send();
});
```

## Rate Limiting

### Headers

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000

# Cuando se excede
HTTP/1.1 429 Too Many Requests
Retry-After: 60
{
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Rate limit exceeded. Try again in 60 seconds."
  }
}
```

### Niveles de Rate Limit

| Nivel | Límite | Ventana | Caso de Uso |
|------|-------|--------|----------|
| Anónimo | 30/min | Por IP | Endpoints públicos |
| Autenticado | 100/min | Por usuario | Acceso API estándar |
| Premium | 1000/min | Por API key | Planes de API de pago |
| Interno | 10000/min | Por servicio | Servicio a servicio |

## Versionado

### Versionado en Ruta de URL (Recomendado)

```
/api/v1/users
/api/v2/users
```

**Pros:** Explícito, fácil de enrutar, cacheable
**Contras:** La URL cambia entre versiones

### Versionado por Header

```
GET /api/users
Accept: application/vnd.myapp.v2+json
```

**Pros:** URLs limpias
**Contras:** Más difícil de probar, fácil de olvidar

### Estrategia de Versionado

```
1. Empezar con /api/v1/ — no versionar hasta que sea necesario
2. Mantener como máximo 2 versiones activas (actual + anterior)
3. Línea de tiempo de deprecación:
   - Anunciar la deprecación (6 meses de aviso para APIs públicas)
   - Agregar header Sunset: Sunset: Sat, 01 Jan 2026 00:00:00 GMT
   - Retornar 410 Gone después de la fecha de sunset
4. Los cambios no disruptivos no necesitan una nueva versión:
   - Agregar nuevos campos a las respuestas
   - Agregar nuevos parámetros de consulta opcionales
   - Agregar nuevos endpoints
5. Los cambios disruptivos requieren una nueva versión:
   - Eliminar o renombrar campos
   - Cambiar tipos de campo
   - Cambiar la estructura de URL
   - Cambiar el método de autenticación
```

## Patrones de Implementación

### TypeScript (Next.js API Route)

```typescript
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({
      error: {
        code: "validation_error",
        message: "Request validation failed",
        details: parsed.error.issues.map(i => ({
          field: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
      },
    }, { status: 422 });
  }

  const user = await createUser(parsed.data);

  return NextResponse.json(
    { data: user },
    {
      status: 201,
      headers: { Location: `/api/v1/users/${user.id}` },
    },
  );
}
```

### Python (Django REST Framework)

```python
from rest_framework import serializers, viewsets, status
from rest_framework.response import Response

class CreateUserSerializer(serializers.Serializer):
    email = serializers.EmailField()
    name = serializers.CharField(max_length=100)

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "name", "created_at"]

class UserViewSet(viewsets.ModelViewSet):
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action == "create":
            return CreateUserSerializer
        return UserSerializer

    def create(self, request):
        serializer = CreateUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = UserService.create(**serializer.validated_data)
        return Response(
            {"data": UserSerializer(user).data},
            status=status.HTTP_201_CREATED,
            headers={"Location": f"/api/v1/users/{user.id}"},
        )
```

### Go (net/http)

```go
func (h *UserHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeError(w, http.StatusBadRequest, "invalid_json", "Invalid request body")
        return
    }

    if err := req.Validate(); err != nil {
        writeError(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
        return
    }

    user, err := h.service.Create(r.Context(), req)
    if err != nil {
        switch {
        case errors.Is(err, domain.ErrEmailTaken):
            writeError(w, http.StatusConflict, "email_taken", "Email already registered")
        default:
            writeError(w, http.StatusInternalServerError, "internal_error", "Internal error")
        }
        return
    }

    w.Header().Set("Location", fmt.Sprintf("/api/v1/users/%s", user.ID))
    writeJSON(w, http.StatusCreated, map[string]any{"data": user})
}
```

## Lista de Verificación de Diseño de API

Antes de publicar un nuevo endpoint:

- [ ] La URL del recurso sigue las convenciones de nomenclatura (plural, kebab-case, sin verbos)
- [ ] Se usa el método HTTP correcto (GET para lecturas, POST para creaciones, etc.)
- [ ] Se retornan códigos de estado apropiados (no 200 para todo)
- [ ] La entrada se valida con esquema (Zod, Pydantic, Bean Validation)
- [ ] Las respuestas de error siguen el formato estándar con códigos y mensajes
- [ ] Se implementa paginación para endpoints de lista (cursor u offset)
- [ ] Autenticación requerida (o marcado explícitamente como público)
- [ ] Autorización verificada (el usuario solo puede acceder a sus propios recursos)
- [ ] Rate limiting configurado
- [ ] La respuesta no filtra detalles internos (stack traces, errores SQL)
- [ ] Nomenclatura consistente con los endpoints existentes (camelCase vs snake_case)
- [ ] Documentado (especificación OpenAPI/Swagger actualizada)
