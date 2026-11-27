---
name: backend-patterns
description: Node.js, Express ve Next.js API routes için backend mimari kalıpları, API tasarımı, veritabanı optimizasyonu ve sunucu tarafı en iyi uygulamalar.
origin: ECC
---

# Backend Geliştirme Kalıpları

Ölçeklenebilir sunucu tarafı uygulamalar için backend mimari kalıpları ve en iyi uygulamalar.

## Ne Zaman Aktifleştirmelisiniz

- REST veya GraphQL API endpoint'leri tasarlarken
- Repository, service veya controller katmanları uygularken
- Veritabanı sorgularını optimize ederken (N+1, indeksleme, bağlantı havuzu)
- Önbellekleme eklerken (Redis, in-memory, HTTP cache başlıkları)
- Arka plan işleri veya async işleme ayarlarken
- API'ler için hata yönetimi ve doğrulama yapılandırırken
- Middleware oluştururken (auth, logging, rate limiting)

## API Tasarım Kalıpları

### RESTful API Yapısı

```typescript
// PASS: Kaynak tabanlı URL'ler
GET    /api/markets                 # Kaynakları listele
GET    /api/markets/:id             # Tek kaynak getir
POST   /api/markets                 # Kaynak oluştur
PUT    /api/markets/:id             # Kaynağı değiştir (tam)
PATCH  /api/markets/:id             # Kaynağı güncelle (kısmi)
DELETE /api/markets/:id             # Kaynağı sil

// PASS: Filtreleme, sıralama, sayfalama için query parametreleri
GET /api/markets?status=active&sort=volume&limit=20&offset=0
```

### Repository Kalıbı

```typescript
// Veri erişim mantığını soyutla
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

  // Diğer metodlar...
}
```

### Service Katmanı Kalıbı

```typescript
// İş mantığı veri erişiminden ayrılmış
class MarketService {
  constructor(private marketRepo: MarketRepository) {}

  async searchMarkets(query: string, limit: number = 10): Promise<Market[]> {
    // İş mantığı
    const embedding = await generateEmbedding(query)
    const results = await this.vectorSearch(embedding, limit)

    // Tam veriyi getir
    const markets = await this.marketRepo.findByIds(results.map(r => r.id))

    // Benzerliğe göre sırala
    return markets.sort((a, b) => {
      const scoreA = results.find(r => r.id === a.id)?.score || 0
      const scoreB = results.find(r => r.id === b.id)?.score || 0
      return scoreA - scoreB
    })
  }

  private async vectorSearch(embedding: number[], limit: number) {
    // Vector arama implementasyonu
  }
}
```

### Middleware Kalıbı

```typescript
// Request/response işleme hattı
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

// Kullanım
export default withAuth(async (req, res) => {
  // Handler req.user'a erişebilir
})
```

## Veritabanı Kalıpları

### Sorgu Optimizasyonu

```typescript
// PASS: İYİ: Sadece gerekli sütunları seç
const { data } = await supabase
  .from('markets')
  .select('id, name, status, volume')
  .eq('status', 'active')
  .order('volume', { ascending: false })
  .limit(10)

// FAIL: KÖTÜ: Her şeyi seç
const { data } = await supabase
  .from('markets')
  .select('*')
```

### N+1 Sorgu Önleme

```typescript
// FAIL: KÖTÜ: N+1 sorgu problemi
const markets = await getMarkets()
for (const market of markets) {
  market.creator = await getUser(market.creator_id)  // N sorgu
}

// PASS: İYİ: Toplu getirme
const markets = await getMarkets()
const creatorIds = markets.map(m => m.creator_id)
const creators = await getUsers(creatorIds)  // 1 sorgu
const creatorMap = new Map(creators.map(c => [c.id, c]))

markets.forEach(market => {
  market.creator = creatorMap.get(market.creator_id)
})
```

### Transaction Kalıbı

```typescript
async function createMarketWithPosition(
  marketData: CreateMarketDto,
  positionData: CreatePositionDto
) {
  // Supabase transaction kullan
  const { data, error } = await supabase.rpc('create_market_with_position', {
    market_data: marketData,
    position_data: positionData
  })

  if (error) throw new Error('Transaction failed')
  return data
}

// Supabase'de SQL fonksiyonu
CREATE OR REPLACE FUNCTION create_market_with_position(
  market_data jsonb,
  position_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  -- Transaction otomatik başlar
  INSERT INTO markets VALUES (market_data);
  INSERT INTO positions VALUES (position_data);
  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    -- Rollback otomatik olur
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
```

## Önbellekleme Stratejileri

### Redis Önbellekleme Katmanı

```typescript
class CachedMarketRepository implements MarketRepository {
  constructor(
    private baseRepo: MarketRepository,
    private redis: RedisClient
  ) {}

  async findById(id: string): Promise<Market | null> {
    // Önce önbelleği kontrol et
    const cached = await this.redis.get(`market:${id}`)

    if (cached) {
      return JSON.parse(cached)
    }

    // Cache miss - veritabanından getir
    const market = await this.baseRepo.findById(id)

    if (market) {
      // 5 dakika önbellekle
      await this.redis.setex(`market:${id}`, 300, JSON.stringify(market))
    }

    return market
  }

  async invalidateCache(id: string): Promise<void> {
    await this.redis.del(`market:${id}`)
  }
}
```

### Cache-Aside Kalıbı

```typescript
async function getMarketWithCache(id: string): Promise<Market> {
  const cacheKey = `market:${id}`

  // Önbelleği dene
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  // Cache miss - DB'den getir
  const market = await db.markets.findUnique({ where: { id } })

  if (!market) throw new Error('Market not found')

  // Önbelleği güncelle
  await redis.setex(cacheKey, 300, JSON.stringify(market))

  return market
}
```

## Hata Yönetimi Kalıpları

### Merkezi Hata Yöneticisi

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

  // Beklenmeyen hataları logla
  console.error('Unexpected error:', error)

  return NextResponse.json({
    success: false,
    error: 'Internal server error'
  }, { status: 500 })
}

// Kullanım
export async function GET(request: Request) {
  try {
    const data = await fetchData()
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return errorHandler(error, request)
  }
}
```

### Exponential Backoff ile Tekrar Deneme

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
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, i) * 1000
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError!
}

// Kullanım
const data = await fetchWithRetry(() => fetchFromAPI())
```

## Kimlik Doğrulama ve Yetkilendirme

### JWT Token Doğrulama

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

// API route'unda kullanım
export async function GET(request: Request) {
  const user = await requireAuth(request)

  const data = await getDataForUser(user.userId)

  return NextResponse.json({ success: true, data })
}
```

### Rol Tabanlı Erişim Kontrolü

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

// Kullanım - HOF handler'ı sarar
export const DELETE = requirePermission('delete')(
  async (request: Request, user: User) => {
    // Handler doğrulanmış yetki ile kullanıcı alır
    return new Response('Deleted', { status: 200 })
  }
)
```

## Rate Limiting

### Basit In-Memory Rate Limiter

```typescript
class RateLimiter {
  private requests = new Map<string, number[]>()

  async checkLimit(
    identifier: string,
    maxRequests: number,
    windowMs: number
  ): Promise<boolean> {
    const now = Date.now()
    const requests = this.requests.get(identifier) || []

    // Pencere dışındaki eski istekleri kaldır
    const recentRequests = requests.filter(time => now - time < windowMs)

    if (recentRequests.length >= maxRequests) {
      return false  // Rate limit aşıldı
    }

    // Mevcut isteği ekle
    recentRequests.push(now)
    this.requests.set(identifier, recentRequests)

    return true
  }
}

const limiter = new RateLimiter()

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'

  const allowed = await limiter.checkLimit(ip, 100, 60000)  // 100 req/dak

  if (!allowed) {
    return NextResponse.json({
      error: 'Rate limit exceeded'
    }, { status: 429 })
  }

  // İstekle devam et
}
```

## Arka Plan İşleri ve Kuyruklar

### Basit Kuyruk Kalıbı

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
    // İş yürütme mantığı
  }
}

// Market indeksleme için kullanım
interface IndexJob {
  marketId: string
}

const indexQueue = new JobQueue<IndexJob>()

export async function POST(request: Request) {
  const { marketId } = await request.json()

  // Bloke etmek yerine kuyruğa ekle
  await indexQueue.add({ marketId })

  return NextResponse.json({ success: true, message: 'Job queued' })
}
```

## Loglama ve İzleme

### Yapılandırılmış Loglama

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

// Kullanım
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

**Unutmayın**: Backend kalıpları ölçeklenebilir, sürdürülebilir sunucu tarafı uygulamalar sağlar. Karmaşıklık seviyenize uyan kalıpları seçin.
