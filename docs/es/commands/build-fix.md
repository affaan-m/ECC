---
description: Detectar el sistema de build del proyecto y corregir incrementalmente errores de build/tipos con cambios mínimos y seguros.
---

# Build y Corrección

Corregir incrementalmente errores de build y de tipos con cambios mínimos y seguros.

## Paso 1: Detectar el Sistema de Build

Identificar la herramienta de build del proyecto y ejecutar el build:

| Indicador | Comando de Build |
|-----------|-----------------|
| `package.json` con script `build` | `npm run build` o `pnpm build` |
| `tsconfig.json` (solo TypeScript) | `npx tsc --noEmit` |
| `Cargo.toml` | `cargo build 2>&1` |
| `pom.xml` | `mvn compile` |
| `build.gradle` | `./gradlew compileJava` |
| `go.mod` | `go build ./...` |
| `pyproject.toml` | `python -m compileall -q .` o `mypy .` |

## Paso 2: Parsear y Agrupar Errores

1. Ejecutar el comando de build y capturar stderr
2. Agrupar errores por ruta de archivo
3. Ordenar por orden de dependencia (corregir imports/tipos antes que errores de lógica)
4. Contar errores totales para seguimiento del progreso

## Paso 3: Bucle de Corrección (Un Error a la Vez)

Para cada error:

1. **Leer el archivo** — Usar la herramienta Read para ver el contexto del error (10 líneas alrededor del error)
2. **Diagnosticar** — Identificar la causa raíz (import faltante, tipo incorrecto, error de sintaxis)
3. **Corregir mínimamente** — Usar la herramienta Edit para el cambio más pequeño que resuelva el error
4. **Re-ejecutar el build** — Verificar que el error desapareció y que no se introdujeron nuevos errores
5. **Continuar** — Seguir con los errores restantes

## Paso 4: Salvaguardas

Parar y preguntar al usuario si:
- Una corrección introduce **más errores de los que resuelve**
- El **mismo error persiste después de 3 intentos** (probablemente un problema más profundo)
- La corrección requiere **cambios arquitectónicos** (no es solo una corrección de build)
- Los errores de build provienen de **dependencias faltantes** (se necesita `npm install`, `cargo add`, etc.)

## Paso 5: Resumen

Mostrar resultados:
- Errores corregidos (con rutas de archivos)
- Errores restantes (si los hay)
- Nuevos errores introducidos (debe ser cero)
- Próximos pasos sugeridos para problemas no resueltos

## Estrategias de Recuperación

| Situación | Acción |
|-----------|--------|
| Módulo/import faltante | Verificar si el paquete está instalado; sugerir comando de instalación |
| Incompatibilidad de tipos | Leer ambas definiciones de tipo; corregir el tipo más restrictivo |
| Dependencia circular | Identificar el ciclo con el grafo de imports; sugerir extracción |
| Conflicto de versiones | Verificar `package.json` / `Cargo.toml` para restricciones de versión |
| Mala configuración de herramienta de build | Leer el archivo de configuración; comparar con valores por defecto funcionales |

Corregir un error a la vez por seguridad. Preferir diffs mínimos sobre refactorización.
