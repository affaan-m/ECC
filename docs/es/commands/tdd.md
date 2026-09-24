---
description: Aplicar el flujo de trabajo de desarrollo guiado por pruebas (TDD). Diseña interfaces, crea las pruebas PRIMERO, luego implementa el código mínimo. Garantiza 80%+ de cobertura de código.
---

# Comando TDD

Este comando invoca al agente **tdd-guide** para aplicar la metodología de desarrollo guiado por pruebas.

## Qué Hace Este Comando

1. **Diseñar Interfaces** - Definir primero los tipos/interfaces
2. **Crear Pruebas Primero** - Escribir pruebas que fallan (RED)
3. **Implementar Código Mínimo** - Escribir el código justo para que pasen (GREEN)
4. **Refactorizar** - Mejorar el código mientras las pruebas siguen en verde (REFACTOR)
5. **Verificar Cobertura** - Garantizar 80%+ de cobertura de pruebas

## Cuándo Usarlo

Usa el comando `/tdd` cuando:
- Implementes nuevas features
- Agregues nuevas funciones/componentes
- Corrijas bugs (primero escribe la prueba que reproduce el bug)
- Refactorices código existente
- Construyas lógica de negocio crítica

## Cómo Funciona

El agente tdd-guide:

1. **Definirá las interfaces** para entradas/salidas
2. **Escribirá pruebas que FALLARÁN** (porque el código aún no existe)
3. **Ejecutará las pruebas** y verificará que fallen por la razón correcta
4. **Escribirá la implementación mínima** para que las pruebas pasen
5. **Ejecutará las pruebas** y verificará que pasen
6. **Refactorizará el código** mientras las pruebas siguen en verde
7. **Verificará la cobertura** y agregará más pruebas si está por debajo del 80%

## El Ciclo TDD

```
ROJO → VERDE → REFACTORIZAR → REPETIR

ROJO:        Escribir una prueba que falla
VERDE:       Escribir el código mínimo para que pase
REFACTORIZAR: Mejorar el código, las pruebas siguen pasando
REPETIR:     Siguiente feature/escenario
```

## Ejemplo de Uso

```
Usuario: /tdd Necesito una función para calcular el puntaje de liquidez de un mercado

Agente (tdd-guide):
# Sesión TDD: Calculadora de Puntaje de Liquidez de Mercado

## Paso 1: Definir Interface (SCAFFOLD)

```typescript
// lib/liquidity.ts
export interface MarketData {
  totalVolume: number
  bidAskSpread: number
  activeTraders: number
  lastTradeTime: Date
}

export function calculateLiquidityScore(market: MarketData): number {
  // TODO: Implementación
  throw new Error('Not implemented')
}
```

## Paso 2: Escribir Prueba que Falla (ROJO)

```typescript
// lib/liquidity.test.ts
import { calculateLiquidityScore } from './liquidity'

describe('calculateLiquidityScore', () => {
  it('debe retornar puntaje alto para mercado líquido', () => {
    const market = {
      totalVolume: 100000,
      bidAskSpread: 0.01,
      activeTraders: 500,
      lastTradeTime: new Date()
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBeGreaterThan(80)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('debe retornar puntaje bajo para mercado poco líquido', () => {
    const market = {
      totalVolume: 100,
      bidAskSpread: 0.5,
      activeTraders: 2,
      lastTradeTime: new Date(Date.now() - 86400000) // hace 1 día
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBeLessThan(30)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('debe manejar caso límite: volumen cero', () => {
    const market = {
      totalVolume: 0,
      bidAskSpread: 0,
      activeTraders: 0,
      lastTradeTime: new Date()
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBe(0)
  })
})
```

## Paso 3: Ejecutar Pruebas - Verificar el Fallo

```bash
npm test lib/liquidity.test.ts

FAIL lib/liquidity.test.ts
  ✕ debe retornar puntaje alto para mercado líquido (2 ms)
    Error: Not implemented

1 test failed, 0 passed
```

PASS: Las pruebas fallan como se esperaba. Listo para implementar.

## Paso 4: Implementar Código Mínimo (VERDE)

```typescript
// lib/liquidity.ts
export function calculateLiquidityScore(market: MarketData): number {
  // Manejar caso límite de volumen cero
  if (market.totalVolume === 0) {
    return 0
  }

  // Calcular puntajes de componentes (escala 0-100)
  const volumeScore = Math.min(market.totalVolume / 1000, 100)
  const spreadScore = Math.max(100 - (market.bidAskSpread * 1000), 0)
  const traderScore = Math.min(market.activeTraders / 10, 100)

  // Bonus por actividad reciente
  const hoursSinceLastTrade = (Date.now() - market.lastTradeTime.getTime()) / (1000 * 60 * 60)
  const recencyScore = Math.max(100 - (hoursSinceLastTrade * 10), 0)

  // Promedio ponderado
  const score = (
    volumeScore * 0.4 +
    spreadScore * 0.3 +
    traderScore * 0.2 +
    recencyScore * 0.1
  )

  return Math.min(Math.max(score, 0), 100) // Limitar entre 0-100
}
```

## Paso 5: Ejecutar Pruebas - Verificar el Éxito

```bash
npm test lib/liquidity.test.ts

PASS lib/liquidity.test.ts
  ✓ debe retornar puntaje alto para mercado líquido (3 ms)
  ✓ debe retornar puntaje bajo para mercado poco líquido (2 ms)
  ✓ debe manejar caso límite: volumen cero (1 ms)

3 tests passed
```

PASS: ¡Todas las pruebas pasan!

## Paso 6: Refactorizar (MEJORAR)

```typescript
// lib/liquidity.ts - Refactorizado con constantes y mejor legibilidad
const WEIGHTS = {
  VOLUME: 0.4,
  SPREAD: 0.3,
  TRADERS: 0.2,
  RECENCY: 0.1,
} as const

const SCALE_FACTORS = {
  VOLUME: 1000,
  SPREAD: 1000,
  TRADERS: 10,
  RECENCY_PENALTY: 10,
} as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function calculateLiquidityScore(market: MarketData): number {
  if (market.totalVolume === 0) return 0

  const volumeScore = Math.min(market.totalVolume / SCALE_FACTORS.VOLUME, 100)
  const spreadScore = clamp(100 - (market.bidAskSpread * SCALE_FACTORS.SPREAD), 0, 100)
  const traderScore = Math.min(market.activeTraders / SCALE_FACTORS.TRADERS, 100)

  const hoursSinceLastTrade = (Date.now() - market.lastTradeTime.getTime()) / (1000 * 60 * 60)
  const recencyScore = clamp(100 - (hoursSinceLastTrade * SCALE_FACTORS.RECENCY_PENALTY), 0, 100)

  const weightedScore =
    volumeScore * WEIGHTS.VOLUME +
    spreadScore * WEIGHTS.SPREAD +
    traderScore * WEIGHTS.TRADERS +
    recencyScore * WEIGHTS.RECENCY

  return clamp(weightedScore, 0, 100)
}
```

## Paso 7: Verificar que las Pruebas Siguen Pasando

```bash
npm test lib/liquidity.test.ts

PASS lib/liquidity.test.ts
  ✓ debe retornar puntaje alto para mercado líquido (3 ms)
  ✓ debe retornar puntaje bajo para mercado poco líquido (2 ms)
  ✓ debe manejar caso límite: volumen cero (1 ms)

3 tests passed
```

PASS: ¡Refactoring completo, las pruebas siguen pasando!

## Paso 8: Verificar Cobertura

```bash
npm test -- --coverage lib/liquidity.test.ts

File           | % Stmts | % Branch | % Funcs | % Lines
---------------|---------|----------|---------|--------
liquidity.ts   |   100   |   100    |   100   |   100

Coverage: 100% PASS (Objetivo: 80%)
```

PASS: ¡Sesión TDD completada!
```

## Buenas Prácticas de TDD

**HAZ:**
- PASS: Escribe la prueba ANTES de cualquier implementación
- PASS: Ejecuta las pruebas y verifica que fallen antes de implementar
- PASS: Escribe el código mínimo para que las pruebas pasen
- PASS: Refactoriza después de que las pruebas estén en verde
- PASS: Agrega casos límite y escenarios de error
- PASS: Apunta a 80%+ de cobertura (100% para código crítico)

**NO HAGAS:**
- FAIL: No escribas implementación antes de las pruebas
- FAIL: No omitas ejecutar las pruebas después de cada cambio
- FAIL: No escribas demasiado código de una vez
- FAIL: No ignores pruebas que fallan
- FAIL: No pruebes detalles de implementación (prueba el comportamiento)
- FAIL: No hagas mock de todo (prefiere pruebas de integración)

## Tipos de Pruebas a Incluir

**Pruebas Unitarias** (nivel de función):
- Escenarios de camino feliz
- Casos límite (vacío, null, valores máximos)
- Condiciones de error
- Valores límite

**Pruebas de Integración** (nivel de componente):
- Endpoints de API
- Operaciones de base de datos
- Llamadas a servicios externos
- Componentes React con hooks

**Pruebas E2E** (usar el comando `/e2e`):
- Flujos de usuario críticos
- Procesos de múltiples pasos
- Integración full stack

## Requisitos de Cobertura

- **Mínimo 80%** para todo el código
- **100% requerido**:
  - Cálculos financieros
  - Lógica de autenticación
  - Código crítico de seguridad
  - Lógica de negocio principal

## Notas Importantes

**OBLIGATORIO**: Las pruebas deben escribirse ANTES de la implementación. El ciclo TDD:

1. **ROJO** - Escribir prueba que falla
2. **VERDE** - Implementar para que pase
3. **REFACTORIZAR** - Mejorar el código

Nunca omitas la fase ROJO. Nunca escribas código antes de las pruebas.

## Integración con Otros Comandos

- Usa `/plan` primero para entender qué construir
- Usa `/tdd` para implementar con pruebas
- Usa `/build-fix` si surgen errores de build
- Usa `/code-review` para revisar la implementación
- Usa `/test-coverage` para verificar la cobertura

## Agentes Relacionados

Este comando invoca al agente `tdd-guide` proporcionado por ECC.

La skill relacionada `tdd-workflow` también viene incluida con ECC.

Para instalaciones manuales, los archivos fuente se encuentran en:
- `agents/tdd-guide.md`
- `skills/tdd-workflow/SKILL.md`
