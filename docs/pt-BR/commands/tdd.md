---
description: Impõe fluxo de desenvolvimento orientado a testes. Estruture interfaces, gere testes PRIMEIRO e depois implemente código mínimo para passar. Garanta cobertura de 80%+.
---

# Comando TDD

Este comando invoca o agente **tdd-guide** para impor a metodologia de desenvolvimento orientado a testes.

## O Que Este Comando Faz

1. **Estruturar Interfaces** - Definir tipos/interfaces primeiro
2. **Gerar Testes Primeiro** - Escrever testes que falham (RED)
3. **Implementar Código Mínimo** - Escrever apenas o suficiente para passar (GREEN)
4. **Refatorar** - Melhorar o código mantendo testes verdes (REFACTOR)
5. **Verificar Cobertura** - Garantir cobertura de testes de 80%+

## Quando Usar

Use `/tdd` quando:
- Implementar novas features
- Adicionar novas funções/componentes
- Corrigir bugs (escrever primeiro teste que reproduz o bug)
- Refatorar código existente
- Construir lógica de negócio crítica

## Como Funciona

O agente tdd-guide vai:

1. **Definir interfaces** para entradas/saídas
2. **Escrever testes que vão FALHAR** (porque o código ainda não existe)
3. **Rodar testes** e verificar que falham pelo motivo correto
4. **Escrever implementação mínima** para fazer testes passarem
5. **Rodar testes** e verificar que passam
6. **Refatorar** código mantendo testes verdes
7. **Checar cobertura** e adicionar mais testes se estiver abaixo de 80%

## Ciclo TDD

```
RED → GREEN → REFACTOR → REPEAT

RED:      Write a failing test
GREEN:    Write minimal code to pass
REFACTOR: Improve code, keep tests passing
REPEAT:   Next feature/scenario
```

## Exemplo de Uso

```
Usuário: /tdd Preciso de uma função para calcular a pontuação de liquidez do mercado

Agent (tdd-guide):
# Sessão TDD: Calculadora de Pontuação de Liquidez de Mercado

## Etapa 1: Definir Interface (SCAFFOLD)

```typescript
// lib/liquidity.ts
export interface MarketData {
  totalVolume: number
  bidAskSpread: number
  activeTraders: number
  lastTradeTime: Date
}

export function calculateLiquidityScore(market: MarketData): number {
  // TODO: Implementation
  throw new Error('Not implemented')
}
```

## Etapa 2: Escreva o teste com falha (VERMELHO)

```typescript
// lib/liquidity.test.ts
import { calculateLiquidityScore } from './liquidity'

describe('calculateLiquidityScore', () => {
  it('should return high score for liquid market', () => {
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

  it('should return low score for illiquid market', () => {
    const market = {
      totalVolume: 100,
      bidAskSpread: 0.5,
      activeTraders: 2,
      lastTradeTime: new Date(Date.now() - 86400000) // 1 day ago
    }

    const score = calculateLiquidityScore(market)

    expect(score).toBeLessThan(30)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('should handle edge case: zero volume', () => {
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

## Etapa 3: Executar testes - Verificar FALHA

```bash
npm test lib/liquidity.test.ts

FAIL lib/liquidity.test.ts
  ✕ should return high score for liquid market (2 ms)
    Error: Not implemented

1 test failed, 0 passed
```

PASS: Os testes falharam conforme o esperado. Pronto para implementação.

## Etapa 4: Implementar o código mínimo (VERDE)

```typescript
// lib/liquidity.ts
export function calculateLiquidityScore(market: MarketData): number {
  // Handle zero volume edge case
  if (market.totalVolume === 0) {
    return 0
  }

  // Calculate component scores (0-100 scale)
  const volumeScore = Math.min(market.totalVolume / 1000, 100)
  const spreadScore = Math.max(100 - (market.bidAskSpread * 1000), 0)
  const traderScore = Math.min(market.activeTraders / 10, 100)

  // Recent activity bonus
  const hoursSinceLastTrade = (Date.now() - market.lastTradeTime.getTime()) / (1000 * 60 * 60)
  const recencyScore = Math.max(100 - (hoursSinceLastTrade * 10), 0)

  // Weighted average
  const score = (
    volumeScore * 0.4 +
    spreadScore * 0.3 +
    traderScore * 0.2 +
    recencyScore * 0.1
  )

  return Math.min(Math.max(score, 0), 100) // Clamp to 0-100
}
```

## Etapa 5: Executar testes - Verificar se foi aprovado

```bash
npm test lib/liquidity.test.ts

PASS lib/liquidity.test.ts
  ✓ should return high score for liquid market (3 ms)
  ✓ should return low score for illiquid market (2 ms)
  ✓ should handle edge case: zero volume (1 ms)

3 tests passed
```

PASS: Todos os testes passando

## Etapa 6: Refatorar (MELHORAR)

```typescript
// lib/liquidity.ts - Refatorado com constantes e melhor legibilidade.
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

## Etapa 7: Verificar se os testes ainda são aprovados

```bash
npm test lib/liquidity.test.ts

PASS lib/liquidity.test.ts
  ✓ should return high score for liquid market (3 ms)
  ✓ should return low score for illiquid market (2 ms)
  ✓ should handle edge case: zero volume (1 ms)

3 tests passed
```

PASS: Refatoração concluída, testes ainda passando!

## Etapa 8: Verificar a cobertura

```bash
npm test -- --coverage lib/liquidity.test.ts

File           | % Stmts | % Branch | % Funcs | % Lines
---------------|---------|----------|---------|--------
liquidity.ts   |   100   |   100    |   100   |   100

Coverage: 100% PASS: (Target: 80%)
```

PASS: TDD sessão completa!
```

## Boas Práticas de TDD

**Fazer:**
- PASS: Escreva o teste PRIMEIRO, antes da implementação
- PASS: Rode testes e confirme que FALHAM antes de implementar
- PASS: Escreva código mínimo para fazer passar
- PASS: Refatore só depois que os testes estiverem verdes
- PASS: Adicione casos de borda e cenários de erro
- PASS: Mire 80%+ de cobertura (100% para código crítico)

**Não fazer:**
- FAIL: Escrever implementação antes de testes
- FAIL: Pular execução de testes após cada mudança
- FAIL: Escrever código demais de uma vez
- FAIL: Ignorar testes falhando
- FAIL: Testar detalhes de implementação (teste comportamento)
- FAIL: Fazer mock de tudo (prefira testes de integração)

## Tipos de Teste a Incluir

**Testes Unitários** (nível de função):
- Cenários happy path
- Casos de borda (vazio, null, valores máximos)
- Condições de erro
- Valores de fronteira

**Testes de Integração** (nível de componente):
- Endpoints de API
- Operações de banco de dados
- Chamadas a serviços externos
- Componentes React com hooks

**Testes E2E** (use comando `/e2e`):
- Fluxos críticos de usuário
- Processos multi-etapa
- Integração full stack

## Requisitos de Cobertura

- **Mínimo de 80%** para todo o código
- **100% obrigatório** para:
  - Cálculos financeiros
  - Lógica de autenticação
  - Código crítico de segurança
  - Lógica de negócio central

## Notas Importantes

**MANDATÓRIO**: Os testes devem ser escritos ANTES da implementação. O ciclo TDD é:

1. **RED** - Escrever teste que falha
2. **GREEN** - Implementar para passar
3. **REFACTOR** - Melhorar código

Nunca pule a fase RED. Nunca escreva código antes dos testes.

## Integração com Outros Comandos

- Use `/plan` primeiro para entender o que construir
- Use `/tdd` para implementar com testes
- Use `/build-fix` se ocorrerem erros de build
- Use `/code-review` para revisar implementação
- Use `/test-coverage` para verificar cobertura

## Agentes Relacionados

Este comando invoca o agente `tdd-guide` fornecido pelo ECC.

A skill relacionada `tdd-workflow` também é distribuída com o ECC.

Para instalações manuais, os arquivos fonte ficam em:
- `agents/tdd-guide.md`
- `skills/tdd-workflow/SKILL.md`
