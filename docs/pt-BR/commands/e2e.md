---
description: Gere e rode testes end-to-end com Playwright. Cria jornadas de teste, executa testes, captura screenshots/videos/traces e faz upload de artefatos.
---

# Comando E2E

Este comando invoca o agente **e2e-runner** para gerar, manter e executar testes end-to-end usando Playwright.

## O Que Este Comando Faz

1. **Gerar Jornadas de Teste** - Cria testes Playwright para fluxos de usuário
2. **Rodar Testes E2E** - Executa testes em múltiplos navegadores
3. **Capturar Artefatos** - Screenshots, vídeos, traces em falhas
4. **Upload de Resultados** - Relatórios HTML e JUnit XML
5. **Identificar Testes Flaky** - Coloca testes instáveis em quarentena

## Quando Usar

Use `/e2e` quando:
- Testar jornadas críticas de usuário (login, trading, pagamentos)
- Verificar fluxos multi-etapa de ponta a ponta
- Testar interações de UI e navegação
- Validar integração entre frontend e backend
- Preparar para deploy em produção

## Como Funciona

O agente e2e-runner vai:

1. **Analisar o fluxo de usuário** e identificar cenários de teste
2. **Gerar teste Playwright** usando padrão Page Object Model
3. **Rodar testes** em múltiplos navegadores (Chrome, Firefox, Safari)
4. **Capturar falhas** com screenshots, vídeos e traces
5. **Gerar relatório** com resultados e artefatos
6. **Identificar testes flaky** e recomendar correções

## Exemplo de Uso

```
User: /e2e Test the market search and view flow

Agent (e2e-runner):
# E2E Test Generation: Market Search and View Flow

## Test Scenario Identified

**User Journey:** Market Search → View Results → Click Market → View Details

**Test Coverage:**
1. Navigate to markets page
2. Perform semantic search
3. Verify search results
4. Click on first result
5. Verify market details page loads
6. Verify chart renders

## Generated Test Code

```typescript
// tests/e2e/markets/search-and-view.spec.ts
import { test, expect } from '@playwright/test'
import { MarketsPage } from '../../pages/MarketsPage'
import { MarketDetailsPage } from '../../pages/MarketDetailsPage'

test.describe('Market Search and View Flow', () => {
  test('user can search markets and view details', async ({ page }) => {
    // 1. Navigate to markets page
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Verify page loaded
    await expect(page).toHaveTitle(/Markets/)
    await expect(page.locator('h1')).toContainText('Markets')

    // 2. Perform semantic search
    await marketsPage.searchMarkets('election')

    // Wait for API response
    await page.waitForResponse(resp =>
      resp.url().includes('/api/markets/search') && resp.status() === 200
    )

    // 3. Verify search results
    const marketCards = marketsPage.marketCards
    await expect(marketCards.first()).toBeVisible()
    const resultCount = await marketCards.count()
    expect(resultCount).toBeGreaterThan(0)

    // Take screenshot of search results
    await page.screenshot({ path: 'artifacts/search-results.png' })

    // 4. Click on first result
    const firstMarketTitle = await marketCards.first().textContent()
    await marketCards.first().click()

    // 5. Verify market details page loads
    await expect(page).toHaveURL(/\/markets\/[a-z0-9-]+/)

    const detailsPage = new MarketDetailsPage(page)
    await expect(detailsPage.marketName).toBeVisible()
    await expect(detailsPage.marketDescription).toBeVisible()

    // 6. Verify chart renders
    await expect(detailsPage.priceChart).toBeVisible()

    // Verify market name matches
    const detailsTitle = await detailsPage.marketName.textContent()
    expect(detailsTitle?.toLowerCase()).toContain(
      firstMarketTitle?.toLowerCase().substring(0, 20) || ''
    )

    // Take screenshot of market details
    await page.screenshot({ path: 'artifacts/market-details.png' })
  })

  test('search with no results shows empty state', async ({ page }) => {
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Search for non-existent market
    await marketsPage.searchMarkets('xyznonexistentmarket123456')

    // Verify empty state
    await expect(page.locator('[data-testid="no-results"]')).toBeVisible()
    await expect(page.locator('[data-testid="no-results"]')).toContainText(
      /no.*results|no.*markets/i
    )

    const marketCount = await marketsPage.marketCards.count()
    expect(marketCount).toBe(0)
  })

  test('can clear search and see all markets again', async ({ page }) => {
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Initial market count
    const initialCount = await marketsPage.marketCards.count()

    // Perform search
    await marketsPage.searchMarkets('trump')
    await page.waitForLoadState('networkidle')

    // Verify filtered results
    const filteredCount = await marketsPage.marketCards.count()
    expect(filteredCount).toBeLessThan(initialCount)

    // Clear search
    await marketsPage.searchInput.clear()
    await page.waitForLoadState('networkidle')

    // Verify all markets shown again
    const finalCount = await marketsPage.marketCards.count()
    expect(finalCount).toBe(initialCount)
  })
})
```

## Rodando os Testes

```bash
# Run the generated test
npx playwright test tests/e2e/markets/search-and-view.spec.ts

Running 3 tests using 3 workers

  ✓  [chromium] › search-and-view.spec.ts:5:3 › user can search markets and view details (4.2s)
  ✓  [chromium] › search-and-view.spec.ts:52:3 › search with no results shows empty state (1.8s)
  ✓  [chromium] › search-and-view.spec.ts:67:3 › can clear search and see all markets again (2.9s)

  3 passed (9.1s)

Artifacts generated:
- artifacts/search-results.png
- artifacts/market-details.png
- playwright-report/index.html
```

## Relatório de Teste

```
╔══════════════════════════════════════════════════════════════╗
║                    E2E Test Results                          ║
╠══════════════════════════════════════════════════════════════╣
║ Status:     PASS: ALL TESTS PASSED                              ║
║ Total:      3 tests                                          ║
║ Passed:     3 (100%)                                         ║
║ Failed:     0                                                ║
║ Flaky:      0                                                ║
║ Duration:   9.1s                                             ║
╚══════════════════════════════════════════════════════════════╝

Artifacts:
 Screenshots: 2 files
 Videos: 0 files (only on failure)
 Traces: 0 files (only on failure)
 HTML Report: playwright-report/index.html

View report: npx playwright show-report
```

PASS: E2E test suite ready for CI/CD integration!
```

## Artefatos de Teste

Quando os testes rodam, os seguintes artefatos são capturados:

**Em Todos os Testes:**
- Relatório HTML com timeline e resultados
- JUnit XML para integração com CI

**Somente em Falha:**
- Screenshot do estado de falha
- Gravação em vídeo do teste
- Arquivo de trace para debug (replay passo a passo)
- Logs de rede
- Logs de console

## Visualizando Artefatos

```bash
# View HTML report in browser
npx playwright show-report

# View specific trace file
npx playwright show-trace artifacts/trace-abc123.zip

# Screenshots are saved in artifacts/ directory
open artifacts/search-results.png
```

## Detecção de Teste Flaky

Se um teste falhar de forma intermitente:

```
WARNING:  FLAKY TEST DETECTED: tests/e2e/markets/trade.spec.ts

Test passed 7/10 runs (70% pass rate)

Common failure:
"Timeout waiting for element '[data-testid="confirm-btn"]'"

Recommended fixes:
1. Add explicit wait: await page.waitForSelector('[data-testid="confirm-btn"]')
2. Increase timeout: { timeout: 10000 }
3. Check for race conditions in component
4. Verify element is not hidden by animation

Quarantine recommendation: Mark as test.fixme() until fixed
```

## Configuração de Navegador

Os testes rodam em múltiplos navegadores por padrão:
- PASS: Chromium (Desktop Chrome)
- PASS: Firefox (Desktop)
- PASS: WebKit (Desktop Safari)
- PASS: Mobile Chrome (optional)

Configure em `playwright.config.ts` para ajustar navegadores.

## Integração CI/CD

Adicione ao seu pipeline de CI:

```yaml
# .github/workflows/e2e.yml
- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: npx playwright test

- name: Upload artifacts
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## Fluxos Críticos Específicos do PMX

Para PMX, priorize estes testes E2E:

**CRITICAL (Must Always Pass):**
1. User can connect wallet
2. User can browse markets
3. User can search markets (semantic search)
4. User can view market details
5. User can place trade (with test funds)
6. Market resolves correctly
7. User can withdraw funds

**IMPORTANT:**
1. Market creation flow
2. User profile updates
3. Real-time price updates
4. Chart rendering
5. Filter and sort markets
6. Mobile responsive layout

## Boas Práticas

**DO:**
- PASS: Use Page Object Model para manutenção
- PASS: Use atributos data-testid para seletores
- PASS: Aguarde respostas de API, não timeouts arbitrários
- PASS: Teste jornadas críticas de usuário end-to-end
- PASS: Rode testes antes de mergear em main
- PASS: Revise artefatos quando testes falharem

**DON'T:**
- FAIL: Use seletores frágeis (classes CSS podem mudar)
- FAIL: Teste detalhes de implementação
- FAIL: Rode testes contra produção
- FAIL: Ignore testes flaky
- FAIL: Pule revisão de artefatos em falhas
- FAIL: Teste todo edge case com E2E (use testes unitários)

## Notas Importantes

**CRITICAL para PMX:**
- Testes E2E envolvendo dinheiro real DEVEM rodar apenas em testnet/staging
- Nunca rode testes de trading em produção
- Defina `test.skip(process.env.NODE_ENV === 'production')` para testes financeiros
- Use carteiras de teste com fundos de teste pequenos apenas

## Integração com Outros Comandos

- Use `/plan` para identificar jornadas críticas a testar
- Use `/tdd` para testes unitários (mais rápidos e granulares)
- Use `/e2e` para integração e jornadas de usuário
- Use `/code-review` para verificar qualidade dos testes

## Agentes Relacionados

Este comando invoca o agente `e2e-runner` fornecido pelo ECC.

Para instalações manuais, o arquivo fonte fica em:
`agents/e2e-runner.md`

## Comandos Rápidos

```bash
# Run all E2E tests
npx playwright test

# Run specific test file
npx playwright test tests/e2e/markets/search.spec.ts

# Run in headed mode (see browser)
npx playwright test --headed

# Debug test
npx playwright test --debug

# Generate test code
npx playwright codegen http://localhost:3000

# View report
npx playwright show-report
```
