---
name: coding-standards
description: Convenciones de codificación base entre proyectos para nomenclatura, legibilidad, inmutabilidad y revisión de calidad de código. Usar skills de frontend o backend para patrones específicos de frameworks.
origin: ECC
---

# Estándares de Codificación y Buenas Prácticas

Convenciones de codificación base aplicables en todos los proyectos.

Este skill es el suelo compartido, no el manual detallado de frameworks.

- Usar `frontend-patterns` para React, estado, formularios, renderizado y arquitectura UI.
- Usar `backend-patterns` o `api-design` para capas de repositorio/servicio, diseño de endpoints, validación y aspectos específicos del servidor.
- Usar `rules/common/coding-style.md` cuando necesites la capa de reglas reutilizables más corta en lugar de un recorrido completo del skill.

## Cuándo Activar

- Iniciar un nuevo proyecto o módulo
- Revisar código para calidad y mantenibilidad
- Refactorizar código existente para seguir convenciones
- Hacer cumplir consistencia en nomenclatura, formato o estructura
- Configurar reglas de linting, formato o verificación de tipos
- Incorporar nuevos colaboradores a las convenciones de codificación

## Límites de Alcance

Activar este skill para:
- nomenclatura descriptiva
- valores predeterminados de inmutabilidad
- legibilidad, KISS, DRY y aplicación de YAGNI
- expectativas de manejo de errores y revisión de code smells

No usar este skill como fuente principal para:
- Composición, hooks o patrones de renderizado de React
- Arquitectura backend, diseño de API o capas de base de datos
- Orientación específica de frameworks cuando ya existe un skill ECC más específico

## Principios de Calidad de Código

### 1. Legibilidad Primero
- El código se lee más de lo que se escribe
- Nombres claros para variables y funciones
- Código auto-documentado preferido sobre comentarios
- Formato consistente

### 2. KISS (Keep It Simple, Stupid)
- La solución más simple que funcione
- Evitar sobreingeniería
- Sin optimización prematura
- Fácil de entender > código inteligente

### 3. DRY (Don't Repeat Yourself)
- Extraer lógica común en funciones
- Crear componentes reutilizables
- Compartir utilidades entre módulos
- Evitar programación por copiar y pegar

### 4. YAGNI (You Aren't Gonna Need It)
- No construir features antes de que sean necesarias
- Evitar generalidad especulativa
- Agregar complejidad solo cuando sea requerido
- Empezar simple, refactorizar cuando sea necesario

## Estándares TypeScript/JavaScript

### Nomenclatura de Variables

```typescript
// PASS: BIEN: Nombres descriptivos
const marketSearchQuery = 'election'
const isUserAuthenticated = true
const totalRevenue = 1000

// FAIL: MAL: Nombres poco claros
const q = 'election'
const flag = true
const x = 1000
```

### Nomenclatura de Funciones

```typescript
// PASS: BIEN: Patrón verbo-sustantivo
async function fetchMarketData(marketId: string) { }
function calculateSimilarity(a: number[], b: number[]) { }
function isValidEmail(email: string): boolean { }

// FAIL: MAL: Poco claro o solo sustantivo
async function market(id: string) { }
function similarity(a, b) { }
function email(e) { }
```

### Patrón de Inmutabilidad (CRÍTICO)

```typescript
// PASS: SIEMPRE usar el operador spread
const updatedUser = {
  ...user,
  name: 'New Name'
}

const updatedArray = [...items, newItem]

// FAIL: NUNCA mutar directamente
user.name = 'New Name'  // MAL
items.push(newItem)     // MAL
```

### Manejo de Errores

```typescript
// PASS: BIEN: Manejo de errores comprensivo
async function fetchData(url: string) {
  try {
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error('Fetch failed:', error)
    throw new Error('Failed to fetch data')
  }
}

// FAIL: MAL: Sin manejo de errores
async function fetchData(url) {
  const response = await fetch(url)
  return response.json()
}
```

### Buenas Prácticas de Async/Await

```typescript
// PASS: BIEN: Ejecución paralela cuando sea posible
const [users, markets, stats] = await Promise.all([
  fetchUsers(),
  fetchMarkets(),
  fetchStats()
])

// FAIL: MAL: Secuencial cuando no es necesario
const users = await fetchUsers()
const markets = await fetchMarkets()
const stats = await fetchStats()
```

### Seguridad de Tipos

```typescript
// PASS: BIEN: Tipos apropiados
interface Market {
  id: string
  name: string
  status: 'active' | 'resolved' | 'closed'
  created_at: Date
}

function getMarket(id: string): Promise<Market> {
  // Implementación
}

// FAIL: MAL: Usar 'any'
function getMarket(id: any): Promise<any> {
  // Implementación
}
```

## Buenas Prácticas de React

### Estructura de Componentes

```typescript
// PASS: BIEN: Componente funcional con tipos
interface ButtonProps {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary'
}

export function Button({
  children,
  onClick,
  disabled = false,
  variant = 'primary'
}: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`btn btn-${variant}`}
    >
      {children}
    </button>
  )
}

// FAIL: MAL: Sin tipos, estructura poco clara
export function Button(props) {
  return <button onClick={props.onClick}>{props.children}</button>
}
```

### Custom Hooks

```typescript
// PASS: BIEN: Custom hook reutilizable
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

// Uso
const debouncedQuery = useDebounce(searchQuery, 500)
```

### Gestión de Estado

```typescript
// PASS: BIEN: Actualizaciones de estado correctas
const [count, setCount] = useState(0)

// Actualización funcional para estado basado en el estado previo
setCount(prev => prev + 1)

// FAIL: MAL: Referencia de estado directa
setCount(count + 1)  // Puede estar obsoleta en escenarios async
```

### Renderizado Condicional

```typescript
// PASS: BIEN: Renderizado condicional claro
{isLoading && <Spinner />}
{error && <ErrorMessage error={error} />}
{data && <DataDisplay data={data} />}

// FAIL: MAL: Infierno de ternarios
{isLoading ? <Spinner /> : error ? <ErrorMessage error={error} /> : data ? <DataDisplay data={data} /> : null}
```

## Estándares de Diseño de API

### Convenciones de API REST

```
GET    /api/markets              # Listar todos los markets
GET    /api/markets/:id          # Obtener market específico
POST   /api/markets              # Crear nuevo market
PUT    /api/markets/:id          # Actualizar market (completo)
PATCH  /api/markets/:id          # Actualizar market (parcial)
DELETE /api/markets/:id          # Eliminar market

# Parámetros de consulta para filtrado
GET /api/markets?status=active&limit=10&offset=0
```

### Formato de Respuesta

```typescript
// PASS: BIEN: Estructura de respuesta consistente
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    total: number
    page: number
    limit: number
  }
}

// Respuesta exitosa
return NextResponse.json({
  success: true,
  data: markets,
  meta: { total: 100, page: 1, limit: 10 }
})

// Respuesta de error
return NextResponse.json({
  success: false,
  error: 'Invalid request'
}, { status: 400 })
```

### Validación de Entrada

```typescript
import { z } from 'zod'

// PASS: BIEN: Validación con esquema
const CreateMarketSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  endDate: z.string().datetime(),
  categories: z.array(z.string()).min(1)
})

export async function POST(request: Request) {
  const body = await request.json()

  try {
    const validated = CreateMarketSchema.parse(body)
    // Proceder con datos validados
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: 'Validation failed',
        details: error.errors
      }, { status: 400 })
    }
  }
}
```

## Organización de Archivos

### Estructura del Proyecto

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # Rutas API
│   ├── markets/           # Páginas de markets
│   └── (auth)/           # Páginas de auth (grupos de rutas)
├── components/            # Componentes React
│   ├── ui/               # Componentes UI genéricos
│   ├── forms/            # Componentes de formulario
│   └── layouts/          # Componentes de layout
├── hooks/                # Custom React hooks
├── lib/                  # Utilidades y configuraciones
│   ├── api/             # Clientes API
│   ├── utils/           # Funciones auxiliares
│   └── constants/       # Constantes
├── types/                # Tipos TypeScript
└── styles/              # Estilos globales
```

### Nomenclatura de Archivos

```
components/Button.tsx          # PascalCase para componentes
hooks/useAuth.ts              # camelCase con prefijo 'use'
lib/formatDate.ts             # camelCase para utilidades
types/market.types.ts         # camelCase con sufijo .types
```

## Comentarios y Documentación

### Cuándo Comentar

```typescript
// PASS: BIEN: Explicar el POR QUÉ, no el QUÉ
// Usar backoff exponencial para evitar sobrecargar la API durante interrupciones
const delay = Math.min(1000 * Math.pow(2, retryCount), 30000)

// Usando mutación deliberadamente aquí por rendimiento con arrays grandes
items.push(newItem)

// FAIL: MAL: Declarar lo obvio
// Incrementar contador en 1
count++

// Establecer nombre al nombre del usuario
name = user.name
```

### JSDoc para APIs Públicas

```typescript
/**
 * Busca markets usando similitud semántica.
 *
 * @param query - Consulta de búsqueda en lenguaje natural
 * @param limit - Número máximo de resultados (por defecto: 10)
 * @returns Array de markets ordenados por puntuación de similitud
 * @throws {Error} Si la API de OpenAI falla o Redis no está disponible
 *
 * @example
 * ```typescript
 * const results = await searchMarkets('election', 5)
 * console.log(results[0].name) // "Trump vs Biden"
 * ```
 */
export async function searchMarkets(
  query: string,
  limit: number = 10
): Promise<Market[]> {
  // Implementación
}
```

## Buenas Prácticas de Rendimiento

### Memoización

```typescript
import { useMemo, useCallback } from 'react'

// PASS: BIEN: Memoizar cómputos costosos
const sortedMarkets = useMemo(() => {
  return markets.sort((a, b) => b.volume - a.volume)
}, [markets])

// PASS: BIEN: Memoizar callbacks
const handleSearch = useCallback((query: string) => {
  setSearchQuery(query)
}, [])
```

### Carga Diferida

```typescript
import { lazy, Suspense } from 'react'

// PASS: BIEN: Cargar componentes pesados de forma diferida
const HeavyChart = lazy(() => import('./HeavyChart'))

export function Dashboard() {
  return (
    <Suspense fallback={<Spinner />}>
      <HeavyChart />
    </Suspense>
  )
}
```

### Consultas de Base de Datos

```typescript
// PASS: BIEN: Seleccionar solo las columnas necesarias
const { data } = await supabase
  .from('markets')
  .select('id, name, status')
  .limit(10)

// FAIL: MAL: Seleccionar todo
const { data } = await supabase
  .from('markets')
  .select('*')
```

## Estándares de Pruebas

### Estructura de Pruebas (Patrón AAA)

```typescript
test('calculates similarity correctly', () => {
  // Arrange (Preparar)
  const vector1 = [1, 0, 0]
  const vector2 = [0, 1, 0]

  // Act (Actuar)
  const similarity = calculateCosineSimilarity(vector1, vector2)

  // Assert (Verificar)
  expect(similarity).toBe(0)
})
```

### Nomenclatura de Pruebas

```typescript
// PASS: BIEN: Nombres de prueba descriptivos
test('returns empty array when no markets match query', () => { })
test('throws error when OpenAI API key is missing', () => { })
test('falls back to substring search when Redis unavailable', () => { })

// FAIL: MAL: Nombres de prueba vagos
test('works', () => { })
test('test search', () => { })
```

## Detección de Code Smells

Vigilar estos anti-patrones:

### 1. Funciones Largas
```typescript
// FAIL: MAL: Función > 50 líneas
function processMarketData() {
  // 100 líneas de código
}

// PASS: BIEN: Dividir en funciones más pequeñas
function processMarketData() {
  const validated = validateData()
  const transformed = transformData(validated)
  return saveData(transformed)
}
```

### 2. Anidamiento Profundo
```typescript
// FAIL: MAL: 5+ niveles de anidamiento
if (user) {
  if (user.isAdmin) {
    if (market) {
      if (market.isActive) {
        if (hasPermission) {
          // Hacer algo
        }
      }
    }
  }
}

// PASS: BIEN: Retornos tempranos
if (!user) return
if (!user.isAdmin) return
if (!market) return
if (!market.isActive) return
if (!hasPermission) return

// Hacer algo
```

### 3. Números Mágicos
```typescript
// FAIL: MAL: Números sin explicación
if (retryCount > 3) { }
setTimeout(callback, 500)

// PASS: BIEN: Constantes con nombre
const MAX_RETRIES = 3
const DEBOUNCE_DELAY_MS = 500

if (retryCount > MAX_RETRIES) { }
setTimeout(callback, DEBOUNCE_DELAY_MS)
```

**Recuerda**: La calidad del código no es negociable. El código claro y mantenible permite el desarrollo rápido y la refactorización confiada.
