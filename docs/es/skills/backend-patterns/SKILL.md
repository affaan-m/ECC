---
name: backend-patterns
description: Patrones de arquitectura backend, diseño de API, optimización de base de datos y buenas prácticas del lado del servidor para Node.js, Express y rutas API de Next.js.
origin: ECC
---

# Patrones de Desarrollo Backend

Patrones de arquitectura backend y buenas prácticas para aplicaciones del lado del servidor escalables.

## Cuándo Activar

- Diseñar endpoints de API REST o GraphQL
- Implementar capas de repositorio, servicio o controlador
- Optimizar consultas de base de datos (N+1, indexación, connection pooling)
- Agregar caché (Redis, en memoria, headers de caché HTTP)
- Configurar trabajos en segundo plano o procesamiento asíncrono
- Estructurar manejo de errores y validación para APIs
- Construir middleware (auth, logging, rate limiting)

## Patrones de Diseño de API

### Estructura de API RESTful

```typescript
// PASS: URLs basadas en recursos
GET    /api/markets                 # Listar recursos
GET    /api/markets/:id             # Obtener recurso individual
POST   /api/markets                 # Crear recurso
PUT    /api/markets/:id             # Reemplazar recurso
PATCH  /api/markets/:id             # Actualizar recurso
DELETE /api/markets/:id             # Eliminar recurso

// PASS: Parámetros de consulta para filtrado, ordenamiento, paginación
GET /api/markets?status=active&sort=volume&limit=20&offset=0
```

### Patrón Repository

```typescript
// Abstraer la lógica de acceso a datos
interface MarketRepository {
  findAll(filters?: MarketFilters): Promise<Market[]>
  findById(id: string): Promise<Market | null>
  create(data: CreateMarketDto): Promise<Market>
  update(id: string, data: UpdateMarketDto): Promise<Market>
  delete(id: string): Promise<void>
}

class SupabaseMarketRepository implements MarketRepository {
  async findAll(filters?: MarketFilters): Promise<Market[]> {
    let query = supabase.from('markets').select('*')

    if (filters?.status) {
      query = query.eq('status', filters.status)
    }

    if (filters?.limit) {
      query = query.limit(filters.limit)
    }

    const { data, error } = await query

    if (error) throw new Error(error.message)
    return data
  }

  // Otros métodos...
}
```

### Patrón de Capa de Servicio

```typescript
// Lógica de negocio separada del acceso a datos
class MarketService {
  constructor(private marketRepo: MarketRepository) {}

  async searchMarkets(query: string, limit: number = 10): Promise<Market[]> {
    // Lógica de negocio
    const embedding = await generateEmbedding(query)
    const results = await this.vectorSearch(embedding, limit)

    // Obtener datos completos
    const markets = await this.marketRepo.findByIds(results.map(r => r.id))

    // Ordenar por similitud
    return markets.sort((a, b) => {
      const scoreA = results.find(r => r.id === a.id)?.score || 0
      const scoreB = results.find(r => r.id === b.id)?.score || 0
      return scoreA - scoreB
    })
  }

  private async vectorSearch(embedding: number[], limit: number) {
    // Implementación de búsqueda vectorial
  }
}
```

### Patrón Middleware

```typescript
// Pipeline de procesamiento de request/response
export function withAuth(handler: NextApiHandler): NextApiHandler {
  return async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
      const user = await verifyToken(token)
      req.user = user
      return handler(req, res)
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' })
    }
  }
}

// Uso
export default withAuth(async (req, res) => {
  // El handler tiene acceso a req.user
})
```

## Patrones de Base de Datos

### Optimización de Consultas

```typescript
// PASS: BIEN: Seleccionar solo las columnas necesarias
const { data } = await supabase
  .from('markets')
  .select('id, name, status, volume')
  .eq('status', 'active')
  .order('volume', { ascending: false })
  .limit(10)

// FAIL: MAL: Seleccionar todo
const { data } = await supabase
  .from('markets')
  .select('*')
```

### Prevención de Problema N+1

```typescript
// FAIL: MAL: Problema de consulta N+1
const markets = await getMarkets()
for (const market of markets) {
  market.creator = await getUser(market.creator_id)  // N consultas
}

// PASS: BIEN: Obtención en lote
const markets = await getMarkets()
const creatorIds = markets.map(m => m.creator_id)
const creators = await getUsers(creatorIds)  // 1 consulta
const creatorMap = new Map(creators.map(c => [c.id, c]))

markets.forEach(market => {
  market.creator = creatorMap.get(market.creator_id)
})
```

### Patrón de Transacción

```typescript
async function createMarketWithPosition(
  marketData: CreateMarketDto,
  positionData: CreatePositionDto
) {
  // Usar transacción de Supabase
  const { data, error } = await supabase.rpc('create_market_with_position', {
    market_data: marketData,
    position_data: positionData
  })

  if (error) throw new Error('Transaction failed')
  return data
}

// Función SQL en Supabase
CREATE OR REPLACE FUNCTION create_market_with_position(
  market_data jsonb,
  position_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  -- La transacción comienza automáticamente
  INSERT INTO markets VALUES (market_data);
  INSERT INTO positions VALUES (position_data);
  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    -- El rollback ocurre automáticamente
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
```

## Estrategias de Caché

### Capa de Caché con Redis

```typescript
class CachedMarketRepository implements MarketRepository {
  constructor(
    private baseRepo: MarketRepository,
    private redis: RedisClient
  ) {}

  async findById(id: string): Promise<Market | null> {
    // Verificar caché primero
    const cached = await this.redis.get(`market:${id}`)

    if (cached) {
      return JSON.parse(cached)
    }

    // Cache miss - obtener de base de datos
    const market = await this.baseRepo.findById(id)

    if (market) {
      // Cachear por 5 minutos
      await this.redis.setex(`market:${id}`, 300, JSON.stringify(market))
    }

    return market
  }

  async invalidateCache(id: string): Promise<void> {
    await this.redis.del(`market:${id}`)
  }
}
```

### Patrón Cache-Aside

```typescript
async function getMarketWithCache(id: string): Promise<Market> {
  const cacheKey = `market:${id}`

  // Intentar caché
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  // Cache miss - obtener de DB
  const market = await db.markets.findUnique({ where: { id } })

  if (!market) throw new Error('Market not found')

  // Actualizar caché
  await redis.setex(cacheKey, 300, JSON.stringify(market))

  return market
}
```

## Patrones de Manejo de Errores

### Manejador de Errores Centralizado

```typescript
class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message)
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}

export function errorHandler(error: unknown, req: Request): Response {
  if (error instanceof ApiError) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: error.statusCode })
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json({
      success: false,
      error: 'Validation failed',
      details: error.errors
    }, { status: 400 })
  }

  // Registrar errores inesperados
  console.error('Unexpected error:', error)

  return NextResponse.json({
    success: false,
    error: 'Internal server error'
  }, { status: 500 })
}

// Uso
export async function GET(request: Request) {
  try {
    const data = await fetchData()
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return errorHandler(error, request)
  }
}
```

### Reintentos con Backoff Exponencial

```typescript
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      if (i < maxRetries - 1) {
        // Backoff exponencial: 1s, 2s, 4s
        const delay = Math.pow(2, i) * 1000
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError!
}

// Uso
const data = await fetchWithRetry(() => fetchFromAPI())
```

## Autenticación y Autorización

### Validación de Token JWT

```typescript
import jwt from 'jsonwebtoken'

interface JWTPayload {
  userId: string
  email: string
  role: 'admin' | 'user'
}

export function verifyToken(token: string): JWTPayload {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload
    return payload
  } catch (error) {
    throw new ApiError(401, 'Invalid token')
  }
}

export async function requireAuth(request: Request) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')

  if (!token) {
    throw new ApiError(401, 'Missing authorization token')
  }

  return verifyToken(token)
}

// Uso en ruta API
export async function GET(request: Request) {
  const user = await requireAuth(request)

  const data = await getDataForUser(user.userId)

  return NextResponse.json({ success: true, data })
}
```

### Control de Acceso Basado en Roles

```typescript
type Permission = 'read' | 'write' | 'delete' | 'admin'

interface User {
  id: string
  role: 'admin' | 'moderator' | 'user'
}

const rolePermissions: Record<User['role'], Permission[]> = {
  admin: ['read', 'write', 'delete', 'admin'],
  moderator: ['read', 'write', 'delete'],
  user: ['read', 'write']
}

export function hasPermission(user: User, permission: Permission): boolean {
  return rolePermissions[user.role].includes(permission)
}

export function requirePermission(permission: Permission) {
  return (handler: (request: Request, user: User) => Promise<Response>) => {
    return async (request: Request) => {
      const user = await requireAuth(request)

      if (!hasPermission(user, permission)) {
        throw new ApiError(403, 'Insufficient permissions')
      }

      return handler(request, user)
    }
  }
}

// Uso - HOF envuelve el handler
export const DELETE = requirePermission('delete')(
  async (request: Request, user: User) => {
    // El handler recibe el usuario autenticado con permiso verificado
    return new Response('Deleted', { status: 200 })
  }
)
```

## Rate Limiting

El rate limiting debe usar un almacén compartido como Redis, un gateway, o el limitador nativo de la plataforma. No usar contadores en memoria por proceso para APIs de producción: se reinician al desplegarse, se dividen entre réplicas y fallan abiertamente en entornos serverless o multi-instancia.

Mantener la capa backend responsable de elegir el punto de integración y la forma del error; usar `api-design` para el contrato HTTP y `security-review` para la revisión de casos de abuso.

## Trabajos en Segundo Plano y Colas

### Patrón de Cola Simple

```typescript
class JobQueue<T> {
  private queue: T[] = []
  private processing = false

  async add(job: T): Promise<void> {
    this.queue.push(job)

    if (!this.processing) {
      this.process()
    }
  }

  private async process(): Promise<void> {
    this.processing = true

    while (this.queue.length > 0) {
      const job = this.queue.shift()!

      try {
        await this.execute(job)
      } catch (error) {
        console.error('Job failed:', error)
      }
    }

    this.processing = false
  }

  private async execute(job: T): Promise<void> {
    // Lógica de ejecución del trabajo
  }
}

// Uso para indexar markets
interface IndexJob {
  marketId: string
}

const indexQueue = new JobQueue<IndexJob>()

export async function POST(request: Request) {
  const { marketId } = await request.json()

  // Agregar a la cola en lugar de bloquear
  await indexQueue.add({ marketId })

  return NextResponse.json({ success: true, message: 'Job queued' })
}
```

## Logging y Monitoreo

### Logging Estructurado

```typescript
interface LogContext {
  userId?: string
  requestId?: string
  method?: string
  path?: string
  [key: string]: unknown
}

class Logger {
  log(level: 'info' | 'warn' | 'error', message: string, context?: LogContext) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context
    }

    console.log(JSON.stringify(entry))
  }

  info(message: string, context?: LogContext) {
    this.log('info', message, context)
  }

  warn(message: string, context?: LogContext) {
    this.log('warn', message, context)
  }

  error(message: string, error: Error, context?: LogContext) {
    this.log('error', message, {
      ...context,
      error: error.message,
      stack: error.stack
    })
  }
}

const logger = new Logger()

// Uso
export async function GET(request: Request) {
  const requestId = crypto.randomUUID()

  logger.info('Fetching markets', {
    requestId,
    method: 'GET',
    path: '/api/markets'
  })

  try {
    const markets = await fetchMarkets()
    return NextResponse.json({ success: true, data: markets })
  } catch (error) {
    logger.error('Failed to fetch markets', error as Error, { requestId })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

**Recuerda**: Los patrones backend permiten aplicaciones del lado del servidor escalables y mantenibles. Elige los patrones que se ajusten a tu nivel de complejidad.
