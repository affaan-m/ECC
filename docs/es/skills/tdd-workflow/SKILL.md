---
name: tdd-workflow
description: Usar este skill al escribir nuevas funcionalidades, corregir bugs o refactorizar código. Aplica el desarrollo guiado por pruebas con 80%+ de cobertura incluyendo pruebas unitarias, de integración y E2E.
origin: ECC
---

# Flujo de Trabajo de Desarrollo Guiado por Pruebas

Este skill garantiza que todo el desarrollo de código siga los principios TDD con cobertura de pruebas completa.

## Cuándo Activar

- Escribir nuevas funcionalidades
- Corregir bugs o problemas
- Refactorizar código existente
- Agregar endpoints de API
- Crear nuevos componentes

## Principios Fundamentales

### 1. Pruebas ANTES del Código
SIEMPRE escribir primero las pruebas, luego implementar el código para que pasen.

### 2. Requisitos de Cobertura
- Mínimo 80% de cobertura (unit + integración + E2E)
- Todos los casos borde cubiertos
- Escenarios de error probados
- Condiciones de frontera verificadas

### 3. Tipos de Prueba

#### Pruebas Unitarias
- Funciones y utilidades individuales
- Lógica de componentes
- Funciones puras
- Helpers y utilidades

#### Pruebas de Integración
- Endpoints de API
- Operaciones de base de datos
- Interacciones entre servicios
- Llamadas a APIs externas

#### Pruebas E2E (Playwright)
- Flujos críticos de usuario
- Flujos de trabajo completos
- Automatización del navegador
- Interacciones con la UI

### 4. Checkpoints de Git
- Si el repositorio está bajo Git, crear un commit de checkpoint después de cada etapa TDD
- No hacer squash ni reescribir estos commits de checkpoint hasta completar el flujo de trabajo
- Cada mensaje de commit de checkpoint debe describir la etapa y la evidencia capturada exacta
- Contar solo commits creados en la rama activa actual para la tarea actual
- No tratar commits de otras ramas, trabajo anterior no relacionado o historial lejano de ramas como evidencia válida de checkpoint
- Antes de tratar un checkpoint como satisfecho, verificar que el commit sea alcanzable desde el `HEAD` actual en la rama activa y pertenezca a la secuencia de la tarea actual
- El flujo de trabajo compacto preferido es:
  - un commit para la prueba fallida agregada y ROJO validado
  - un commit para la corrección mínima aplicada y VERDE validado
  - un commit opcional para refactor completo
- No se requieren commits separados solo de evidencia si el commit de prueba claramente corresponde a ROJO y el commit de corrección claramente corresponde a VERDE

## Pasos del Flujo de Trabajo TDD

### Paso 1: Escribir Journeys de Usuario
```
Como [rol], quiero [acción], para que [beneficio]

Ejemplo:
Como usuario, quiero buscar mercados semánticamente,
para encontrar mercados relevantes incluso sin palabras clave exactas.
```

### Paso 2: Generar Casos de Prueba
Para cada journey de usuario, crear casos de prueba completos:

```typescript
describe('Semantic Search', () => {
  it('returns relevant markets for query', async () => {
    // Implementación de la prueba
  })

  it('handles empty query gracefully', async () => {
    // Probar caso borde
  })

  it('falls back to substring search when Redis unavailable', async () => {
    // Probar comportamiento de fallback
  })

  it('sorts results by similarity score', async () => {
    // Probar lógica de ordenamiento
  })
})
```

### Paso 3: Ejecutar Pruebas (Deben Fallar)
```bash
npm test
# Las pruebas deben fallar — aún no hemos implementado
```

Este paso es obligatorio y es la compuerta ROJO para todos los cambios en producción.

Antes de modificar lógica de negocio u otro código de producción, se debe verificar un estado ROJO válido mediante una de estas rutas:
- ROJO en tiempo de ejecución:
  - El objetivo de la prueba relevante compila exitosamente
  - La prueba nueva o modificada se ejecuta efectivamente
  - El resultado es ROJO
- ROJO en tiempo de compilación:
  - La nueva prueba instancia, referencia o ejercita la ruta del código con el bug
  - El fallo de compilación es en sí mismo la señal ROJO intencionada
- En cualquier caso, el fallo está causado por el bug de lógica de negocio, comportamiento indefinido o implementación faltante prevista
- El fallo no está causado solo por errores de sintaxis no relacionados, configuración de pruebas rota, dependencias faltantes o regresiones no relacionadas

Una prueba que solo se escribió pero no se compiló y ejecutó no cuenta como ROJO.

No editar código de producción hasta que este estado ROJO esté confirmado.

Si el repositorio está bajo Git, crear un commit de checkpoint inmediatamente después de que esta etapa esté validada.
Formato de mensaje de commit recomendado:
- `test: add reproducer for <feature or bug>`
- Este commit también puede servir como checkpoint de validación ROJO si el reproductor fue compilado, ejecutado y falló por la razón prevista
- Verificar que este commit de checkpoint esté en la rama activa actual antes de continuar

### Paso 4: Implementar el Código
Escribir el código mínimo para que las pruebas pasen:

```typescript
// Implementación guiada por las pruebas
export async function searchMarkets(query: string) {
  // Implementación aquí
}
```

Si el repositorio está bajo Git, preparar la corrección mínima ahora pero diferir el commit de checkpoint hasta que VERDE esté validado en el Paso 5.

### Paso 5: Ejecutar Pruebas Nuevamente
```bash
npm test
# Las pruebas ahora deben pasar
```

Volver a ejecutar el mismo objetivo de prueba relevante después de la corrección y confirmar que la prueba anteriormente fallida ahora está en VERDE.

Solo después de un resultado VERDE válido se puede proceder a refactorizar.

Si el repositorio está bajo Git, crear un commit de checkpoint inmediatamente después de que VERDE esté validado.
Formato de mensaje de commit recomendado:
- `fix: <feature or bug>`
- El commit de corrección también puede servir como checkpoint de validación VERDE si el mismo objetivo de prueba relevante fue re-ejecutado y pasó
- Verificar que este commit de checkpoint esté en la rama activa actual antes de continuar

### Paso 6: Refactorizar
Mejorar la calidad del código manteniendo las pruebas en verde:
- Eliminar duplicación
- Mejorar nombres
- Optimizar rendimiento
- Mejorar legibilidad

Si el repositorio está bajo Git, crear un commit de checkpoint inmediatamente después de que el refactor esté completo y las pruebas sigan en verde.
Formato de mensaje de commit recomendado:
- `refactor: clean up after <feature or bug> implementation`
- Verificar que este commit de checkpoint esté en la rama activa actual antes de considerar el ciclo TDD completo

### Paso 7: Verificar Cobertura
```bash
npm run test:coverage
# Verificar que se alcanzó 80%+ de cobertura
```

## Patrones de Prueba

### Patrón de Prueba Unitaria (Jest/Vitest)
```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './Button'

describe('Button Component', () => {
  it('renders with correct text', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('calls onClick when clicked', () => {
    const handleClick = jest.fn()
    render(<Button onClick={handleClick}>Click</Button>)

    fireEvent.click(screen.getByRole('button'))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Click</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
```

### Patrón de Prueba de Integración de API
```typescript
import { NextRequest } from 'next/server'
import { GET } from './route'

describe('GET /api/markets', () => {
  it('returns markets successfully', async () => {
    const request = new NextRequest('http://localhost/api/markets')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(Array.isArray(data.data)).toBe(true)
  })

  it('validates query parameters', async () => {
    const request = new NextRequest('http://localhost/api/markets?limit=invalid')
    const response = await GET(request)

    expect(response.status).toBe(400)
  })

  it('handles database errors gracefully', async () => {
    // Mockear fallo de base de datos
    const request = new NextRequest('http://localhost/api/markets')
    // Probar manejo de errores
  })
})
```

### Patrón de Prueba E2E (Playwright)
```typescript
import { test, expect } from '@playwright/test'

test('user can search and filter markets', async ({ page }) => {
  // Navegar a la página de mercados
  await page.goto('/')
  await page.click('a[href="/markets"]')

  // Verificar que la página cargó
  await expect(page.locator('h1')).toContainText('Markets')

  // Buscar mercados
  await page.fill('input[placeholder="Search markets"]', 'election')

  // Esperar debounce y resultados
  await page.waitForTimeout(600)

  // Verificar resultados de búsqueda mostrados
  const results = page.locator('[data-testid="market-card"]')
  await expect(results).toHaveCount(5, { timeout: 5000 })

  // Verificar que los resultados contienen el término de búsqueda
  const firstResult = results.first()
  await expect(firstResult).toContainText('election', { ignoreCase: true })

  // Filtrar por estado
  await page.click('button:has-text("Active")')

  // Verificar resultados filtrados
  await expect(results).toHaveCount(3)
})

test('user can create a new market', async ({ page }) => {
  // Hacer login primero
  await page.goto('/creator-dashboard')

  // Completar formulario de creación de mercado
  await page.fill('input[name="name"]', 'Test Market')
  await page.fill('textarea[name="description"]', 'Test description')
  await page.fill('input[name="endDate"]', '2025-12-31')

  // Enviar formulario
  await page.click('button[type="submit"]')

  // Verificar mensaje de éxito
  await expect(page.locator('text=Market created successfully')).toBeVisible()

  // Verificar redirección a la página del mercado
  await expect(page).toHaveURL(/\/markets\/test-market/)
})
```

## Organización de Archivos de Prueba

```
src/
├── components/
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.test.tsx          # Pruebas unitarias
│   │   └── Button.stories.tsx       # Storybook
│   └── MarketCard/
│       ├── MarketCard.tsx
│       └── MarketCard.test.tsx
├── app/
│   └── api/
│       └── markets/
│           ├── route.ts
│           └── route.test.ts         # Pruebas de integración
└── e2e/
    ├── markets.spec.ts               # Pruebas E2E
    ├── trading.spec.ts
    └── auth.spec.ts
```

## Mocking de Servicios Externos

### Mock de Supabase
```typescript
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({
          data: [{ id: 1, name: 'Test Market' }],
          error: null
        }))
      }))
    }))
  }
}))
```

### Mock de Redis
```typescript
jest.mock('@/lib/redis', () => ({
  searchMarketsByVector: jest.fn(() => Promise.resolve([
    { slug: 'test-market', similarity_score: 0.95 }
  ])),
  checkRedisHealth: jest.fn(() => Promise.resolve({ connected: true }))
}))
```

### Mock de OpenAI
```typescript
jest.mock('@/lib/openai', () => ({
  generateEmbedding: jest.fn(() => Promise.resolve(
    new Array(1536).fill(0.1) // Mock de embedding de 1536 dimensiones
  ))
}))
```

## Verificación de Cobertura de Pruebas

### Ejecutar Reporte de Cobertura
```bash
npm run test:coverage
```

### Umbrales de Cobertura
```json
{
  "jest": {
    "coverageThresholds": {
      "global": {
        "branches": 80,
        "functions": 80,
        "lines": 80,
        "statements": 80
      }
    }
  }
}
```

## Errores Comunes de Pruebas a Evitar

### FALLA: INCORRECTO: Probar Detalles de Implementación
```typescript
// No probar estado interno
expect(component.state.count).toBe(5)
```

### PASA: CORRECTO: Probar Comportamiento Visible para el Usuario
```typescript
// Probar lo que los usuarios ven
expect(screen.getByText('Count: 5')).toBeInTheDocument()
```

### FALLA: INCORRECTO: Selectores Frágiles
```typescript
// Se rompe fácilmente
await page.click('.css-class-xyz')
```

### PASA: CORRECTO: Selectores Semánticos
```typescript
// Resiliente a cambios
await page.click('button:has-text("Submit")')
await page.click('[data-testid="submit-button"]')
```

### FALLA: INCORRECTO: Sin Aislamiento de Pruebas
```typescript
// Las pruebas dependen unas de otras
test('creates user', () => { /* ... */ })
test('updates same user', () => { /* depende de la prueba anterior */ })
```

### PASA: CORRECTO: Pruebas Independientes
```typescript
// Cada prueba configura sus propios datos
test('creates user', () => {
  const user = createTestUser()
  // Lógica de prueba
})

test('updates user', () => {
  const user = createTestUser()
  // Lógica de actualización
})
```

## Pruebas Continuas

### Modo Watch Durante el Desarrollo
```bash
npm test -- --watch
# Las pruebas se ejecutan automáticamente al cambiar archivos
```

### Hook Pre-Commit
```bash
# Se ejecuta antes de cada commit
npm test && npm run lint
```

### Integración CI/CD
```yaml
# GitHub Actions
- name: Run Tests
  run: npm test -- --coverage
- name: Upload Coverage
  uses: codecov/codecov-action@v3
```

## Buenas Prácticas

1. **Escribir Pruebas Primero** — Siempre TDD
2. **Una Aserción por Prueba** — Enfocarse en un solo comportamiento
3. **Nombres de Prueba Descriptivos** — Explicar qué se prueba
4. **Arrange-Act-Assert** — Estructura clara de la prueba
5. **Mockear Dependencias Externas** — Aislar pruebas unitarias
6. **Probar Casos Borde** — Null, undefined, vacío, grande
7. **Probar Rutas de Error** — No solo los caminos felices
8. **Mantener Pruebas Rápidas** — Pruebas unitarias < 50ms cada una
9. **Limpiar Después de las Pruebas** — Sin efectos secundarios
10. **Revisar Reportes de Cobertura** — Identificar gaps

## Métricas de Éxito

- 80%+ de cobertura de código alcanzada
- Todas las pruebas pasando (verde)
- Sin pruebas omitidas o deshabilitadas
- Ejecución rápida de pruebas (< 30s para pruebas unitarias)
- Pruebas E2E cubren flujos críticos de usuario
- Las pruebas detectan bugs antes de producción

---

**Recuerda**: Las pruebas no son opcionales. Son la red de seguridad que permite refactorización con confianza, desarrollo rápido y confiabilidad en producción.
