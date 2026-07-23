---
description: Crear y ejecutar pruebas end-to-end con Playwright. Genera flujos de prueba, ejecuta los tests, captura capturas de pantalla/videos/trazas y sube artefactos.
---

# Comando E2E

Este comando invoca al agente **e2e-runner** para crear, mantener y ejecutar pruebas end-to-end usando Playwright.

## Qué Hace Este Comando

1. **Crear Flujos de Prueba** - Generar pruebas Playwright para flujos de usuario
2. **Ejecutar Pruebas E2E** - Ejecutar los tests en múltiples navegadores
3. **Capturar Artefactos** - Capturas de pantalla, videos y trazas en caso de error
4. **Subir Resultados** - Reportes HTML y JUnit XML
5. **Identificar Pruebas Inestables** - Poner en cuarentena tests no deterministas

## Cuándo Usarlo

Usa el comando `/e2e` cuando:
- Pruebes flujos de usuario críticos (login, transacciones, pagos)
- Verifiques que flujos de múltiples pasos funcionen de extremo a extremo
- Pruebes interacciones de UI y navegación
- Valides la integración entre frontend y backend
- Te prepares para despliegue a producción

## Cómo Funciona

El agente e2e-runner:

1. **Analizará el flujo de usuario** e identificará los escenarios de prueba
2. **Generará la prueba Playwright** usando el patrón Page Object Model
3. **Ejecutará las pruebas** (Chrome, Firefox, Safari)
4. **Capturará los fallos** con capturas de pantalla, videos y trazas
5. **Generará un reporte** con los resultados y artefactos
6. **Identificará pruebas inestables** y sugerirá correcciones

## Ejemplo de Uso

```
Usuario: /e2e Probar el flujo de búsqueda y visualización de mercados

Agente (e2e-runner):
# Creación de Prueba E2E: Flujo de Búsqueda y Visualización de Mercados

## Escenario de Prueba Identificado

**Flujo de Usuario:** Búsqueda de Mercados → Ver Resultados → Click en Mercado → Ver Detalles

**Cobertura de Prueba:**
1. Ir a la página de mercados
2. Realizar búsqueda semántica
3. Validar resultados de búsqueda
4. Click en el primer resultado
5. Validar que carga la página de detalles del mercado
6. Validar que el gráfico se renderiza

## Código de Prueba Generado

```typescript
// tests/e2e/markets/search-and-view.spec.ts
import { test, expect } from '@playwright/test'
import { MarketsPage } from '../../pages/MarketsPage'
import { MarketDetailsPage } from '../../pages/MarketDetailsPage'

test.describe('Market Search and View Flow', () => {
  test('el usuario puede buscar mercados y ver detalles', async ({ page }) => {
    // 1. Ir a la página de mercados
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Validar que la página cargó
    await expect(page).toHaveTitle(/Markets/)
    await expect(page.locator('h1')).toContainText('Markets')

    // 2. Realizar búsqueda semántica
    await marketsPage.searchMarkets('election')

    // Esperar respuesta de la API
    await page.waitForResponse(resp =>
      resp.url().includes('/api/markets/search') && resp.status() === 200
    )

    // 3. Validar resultados de búsqueda
    const marketCards = marketsPage.marketCards
    await expect(marketCards.first()).toBeVisible()
    const resultCount = await marketCards.count()
    expect(resultCount).toBeGreaterThan(0)

    // Tomar captura de pantalla de los resultados
    await page.screenshot({ path: 'artifacts/search-results.png' })

    // 4. Click en el primer resultado
    const firstMarketTitle = await marketCards.first().textContent()
    await marketCards.first().click()

    // 5. Validar que carga la página de detalles del mercado
    await expect(page).toHaveURL(/\/markets\/[a-z0-9-]+/)

    const detailsPage = new MarketDetailsPage(page)
    await expect(detailsPage.marketName).toBeVisible()
    await expect(detailsPage.marketDescription).toBeVisible()

    // 6. Validar que el gráfico se renderiza
    await expect(detailsPage.priceChart).toBeVisible()

    // Verificar que el nombre del mercado coincide
    const detailsTitle = await detailsPage.marketName.textContent()
    expect(detailsTitle?.toLowerCase()).toContain(
      firstMarketTitle?.toLowerCase().substring(0, 20) || ''
    )

    // Tomar captura de pantalla de los detalles del mercado
    await page.screenshot({ path: 'artifacts/market-details.png' })
  })

  test('búsqueda sin resultados debe mostrar estado vacío', async ({ page }) => {
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Buscar un mercado que no existe
    await marketsPage.searchMarkets('xyznonexistentmarket123456')

    // Validar estado vacío
    await expect(page.locator('[data-testid="no-results"]')).toBeVisible()
    await expect(page.locator('[data-testid="no-results"]')).toContainText(
      /no.*results|no.*markets/i
    )

    const marketCount = await marketsPage.marketCards.count()
    expect(marketCount).toBe(0)
  })

  test('puede limpiar la búsqueda y ver todos los mercados de nuevo', async ({ page }) => {
    const marketsPage = new MarketsPage(page)
    await marketsPage.goto()

    // Cantidad inicial de mercados
    const initialCount = await marketsPage.marketCards.count()

    // Realizar búsqueda
    await marketsPage.searchMarkets('trump')
    await page.waitForLoadState('networkidle')

    // Validar resultados filtrados
    const filteredCount = await marketsPage.marketCards.count()
    expect(filteredCount).toBeLessThan(initialCount)

    // Limpiar búsqueda
    await marketsPage.searchInput.clear()
    await page.waitForLoadState('networkidle')

    // Validar que se muestran todos los mercados de nuevo
    const finalCount = await marketsPage.marketCards.count()
    expect(finalCount).toBe(initialCount)
  })
})
```

## Ejecutar las Pruebas

```bash
# Ejecutar la prueba generada
npx playwright test tests/e2e/markets/search-and-view.spec.ts

Corriendo 3 pruebas usando 3 workers

  ✓  [chromium] › search-and-view.spec.ts:5:3 › el usuario puede buscar mercados y ver detalles (4.2s)
  ✓  [chromium] › search-and-view.spec.ts:52:3 › búsqueda sin resultados muestra estado vacío (1.8s)
  ✓  [chromium] › search-and-view.spec.ts:67:3 › puede limpiar búsqueda y ver todos los mercados (2.9s)

  3 passed (9.1s)

Artefactos generados:
- artifacts/search-results.png
- artifacts/market-details.png
- playwright-report/index.html
```

## Reporte de Pruebas

```
╔══════════════════════════════════════════════════════════════╗
║                 Resultados de Pruebas E2E                    ║
╠══════════════════════════════════════════════════════════════╣
║ Estado:     PASS: TODAS LAS PRUEBAS PASARON                  ║
║ Total:      3 pruebas                                        ║
║ Pasaron:    3 (100%)                                         ║
║ Fallaron:   0                                                ║
║ Inestables: 0                                                ║
║ Duración:   9.1s                                             ║
╚══════════════════════════════════════════════════════════════╝

Artefactos:
 Capturas de pantalla: 2 archivos
 Videos: 0 archivos (solo en fallo)
 Trazas: 0 archivos (solo en fallo)
 Reporte HTML: playwright-report/index.html

Ver reporte: npx playwright show-report
```

PASS: ¡Suite de pruebas E2E lista para integración CI/CD!
```

## Artefactos de Prueba

Cuando las pruebas se ejecutan, se capturan estos artefactos:

**En Todas las Pruebas:**
- Reporte HTML con cronología y resultados
- JUnit XML para integración CI

**Solo en Caso de Fallo:**
- Captura de pantalla del estado fallido
- Grabación de video de la prueba
- Archivo de traza para depuración (reproducción paso a paso)
- Logs de red
- Logs de consola

## Ver Artefactos

```bash
# Ver reporte HTML en el navegador
npx playwright show-report

# Ver archivo de traza específico
npx playwright show-trace artifacts/trace-abc123.zip

# Las capturas de pantalla se guardan en el directorio artifacts/
open artifacts/search-results.png
```

## Detección de Pruebas Inestables

Si una prueba falla de forma intermitente:

```
ADVERTENCIA: PRUEBA INESTABLE DETECTADA: tests/e2e/markets/trade.spec.ts

La prueba pasó 7 de 10 ejecuciones (70% de tasa de éxito)

Fallo más frecuente:
"Timeout esperando elemento '[data-testid="confirm-btn"]'"

Correcciones sugeridas:
1. Agregar espera explícita: await page.waitForSelector('[data-testid="confirm-btn"]')
2. Aumentar timeout: { timeout: 10000 }
3. Verificar condiciones de carrera en el componente
4. Validar que el elemento no está oculto por animación

Sugerencia de cuarentena: Marcar como test.fixme() hasta que se corrija
```

## Configuración de Navegadores

Las pruebas se ejecutan en múltiples navegadores por defecto:
- PASS: Chromium (Desktop Chrome)
- PASS: Firefox (Desktop)
- PASS: WebKit (Desktop Safari)
- PASS: Mobile Chrome (opcional)

Configura `playwright.config.ts` para ajustar los navegadores.

## Integración CI/CD

Agregar a tu pipeline CI:

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

## Buenas Prácticas

**HAZ:**
- PASS: Usa Page Object Model para mantenibilidad
- PASS: Usa atributos data-testid para los selectores
- PASS: Espera respuestas de API, no timeouts arbitrarios
- PASS: Prueba los flujos de usuario críticos de extremo a extremo
- PASS: Ejecuta las pruebas antes de hacer merge a main
- PASS: Inspecciona los artefactos cuando las pruebas fallen

**NO HAGAS:**
- FAIL: No uses selectores frágiles (las clases CSS pueden cambiar)
- FAIL: No pruebes detalles de implementación
- FAIL: No ejecutes pruebas contra producción
- FAIL: No ignores pruebas inestables
- FAIL: No omitas la inspección de artefactos en fallos
- FAIL: No pruebes todos los casos límite con E2E (usa pruebas unitarias)

## Comandos Rápidos

```bash
# Ejecutar todas las pruebas E2E
npx playwright test

# Ejecutar archivo de prueba específico
npx playwright test tests/e2e/markets/search.spec.ts

# Ejecutar en modo headed (ver el navegador)
npx playwright test --headed

# Depurar prueba
npx playwright test --debug

# Generar código de prueba
npx playwright codegen http://localhost:3000

# Ver reporte
npx playwright show-report
```

## Agentes Relacionados

Este comando invoca al agente `e2e-runner` proporcionado por ECC.

Para instalaciones manuales, el archivo fuente se encuentra en:
`agents/e2e-runner.md`

## Integración con Otros Comandos

- Usa `/plan` para identificar los flujos críticos a probar
- Usa `/tdd` para pruebas unitarias (más rápidas, más detalladas)
- Usa `/e2e` para pruebas de integración y flujos de usuario
- Usa `/code-review` para validar la calidad de las pruebas
