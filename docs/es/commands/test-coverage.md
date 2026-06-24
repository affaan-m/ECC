---
description: Analizar la cobertura, identificar brechas y generar pruebas faltantes hacia el umbral objetivo.
---

# Cobertura de Pruebas

Analizar la cobertura de pruebas, identificar brechas y generar las pruebas faltantes para alcanzar 80%+ de cobertura.

## Paso 1: Detectar el Framework de Pruebas

| Indicador | Comando de Cobertura |
|-----------|---------------------|
| `jest.config.*` o `package.json` jest | `npx jest --coverage --coverageReporters=json-summary` |
| `vitest.config.*` | `npx vitest run --coverage` |
| `pytest.ini` / `pyproject.toml` pytest | `pytest --cov=src --cov-report=json` |
| `Cargo.toml` | `cargo llvm-cov --json` |
| `pom.xml` con JaCoCo | `mvn test jacoco:report` |
| `go.mod` | `go test -coverprofile=coverage.out ./...` |

## Paso 2: Analizar el Reporte de Cobertura

1. Ejecutar el comando de cobertura
2. Parsear la salida (resumen JSON o salida del terminal)
3. Listar archivos **por debajo del 80% de cobertura**, ordenados del peor al mejor
4. Para cada archivo con cobertura insuficiente, identificar:
   - Funciones o métodos no probados
   - Cobertura de ramas faltante (if/else, switch, rutas de error)
   - Código muerto que infla el denominador

## Paso 3: Generar Pruebas Faltantes

Para cada archivo con cobertura insuficiente, generar pruebas siguiendo esta prioridad:

1. **Ruta feliz** — Funcionalidad principal con entradas válidas
2. **Manejo de errores** — Entradas inválidas, datos faltantes, fallos de red
3. **Casos límite** — Arrays vacíos, null/undefined, valores límite (0, -1, MAX_INT)
4. **Cobertura de ramas** — Cada if/else, case de switch, ternario

### Reglas de Generación de Pruebas

- Colocar pruebas adyacentes al fuente: `foo.ts` → `foo.test.ts` (o convención del proyecto)
- Usar patrones de prueba existentes del proyecto (estilo de import, librería de afirmaciones, enfoque de mocking)
- Mockear dependencias externas (base de datos, APIs, sistema de archivos)
- Cada prueba debe ser independiente — sin estado mutable compartido entre pruebas
- Nombrar las pruebas descriptivamente: `test_create_user_with_duplicate_email_returns_409`

## Paso 4: Verificar

1. Ejecutar la suite de pruebas completa — todas las pruebas deben pasar
2. Re-ejecutar la cobertura — verificar mejora
3. Si aún está por debajo del 80%, repetir el Paso 3 para las brechas restantes

## Paso 5: Reportar

Mostrar comparación antes/después:

```
Reporte de Cobertura
──────────────────────────────
Archivo                    Antes  Después
src/services/auth.ts       45%    88%
src/utils/validation.ts    32%    82%
──────────────────────────────
Total:                     67%    84%  ✓
```

## Áreas de Enfoque

- Funciones con ramificación compleja (alta complejidad ciclomática)
- Manejadores de errores y bloques catch
- Funciones de utilidad usadas en toda la base de código
- Manejadores de endpoints de API (flujo solicitud → respuesta)
- Casos límite: null, undefined, string vacío, array vacío, cero, números negativos
