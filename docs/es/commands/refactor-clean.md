---
description: Identificar y eliminar de forma segura código muerto con verificación después de cada cambio.
---

# Refactor Clean

Identificar y eliminar de forma segura código muerto con verificación de pruebas en cada paso.

## Paso 1: Detectar Código Muerto

Ejecutar herramientas de análisis según el tipo de proyecto:

| Herramienta | Qué Encuentra | Comando |
|-------------|--------------|---------|
| knip | Exportaciones, archivos, dependencias no usadas | `npx knip` |
| depcheck | Dependencias npm no usadas | `npx depcheck` |
| ts-prune | Exportaciones TypeScript no usadas | `npx ts-prune` |
| vulture | Código Python no usado | `vulture src/` |
| deadcode | Código Go no usado | `deadcode ./...` |
| cargo-udeps | Dependencias Rust no usadas | `cargo +nightly udeps` |

Si no hay ninguna herramienta disponible, usar Grep para encontrar exportaciones con cero imports.

## Paso 2: Categorizar Hallazgos

Ordenar los hallazgos en niveles de seguridad:

| Nivel | Ejemplos | Acción |
|-------|----------|--------|
| **SEGURO** | Utilidades no usadas, helpers de prueba, funciones internas | Eliminar con confianza |
| **PRECAUCIÓN** | Componentes, rutas de API, middleware | Verificar que no haya imports dinámicos ni consumidores externos |
| **PELIGRO** | Archivos de config, puntos de entrada, definiciones de tipos | Investigar antes de tocar |

## Paso 3: Bucle de Eliminación Segura

Para cada elemento SEGURO:

1. **Ejecutar la suite de pruebas completa** — Establecer línea base (todo verde)
2. **Eliminar el código muerto** — Usar la herramienta Edit para eliminación quirúrgica
3. **Re-ejecutar la suite de pruebas** — Verificar que nada se rompió
4. **Si las pruebas fallan** — Revertir inmediatamente con `git checkout -- <archivo>` y omitir este elemento
5. **Si las pruebas pasan** — Continuar con el siguiente elemento

## Paso 4: Manejar Elementos de PRECAUCIÓN

Antes de eliminar elementos de PRECAUCIÓN:
- Buscar imports dinámicos: `import()`, `require()`, `__import__`
- Buscar referencias de string: nombres de rutas, nombres de componentes en configs
- Verificar si se exporta desde una API pública de paquete
- Verificar que no haya consumidores externos (revisar dependientes si está publicado)

## Paso 5: Consolidar Duplicados

Después de eliminar código muerto, buscar:
- Funciones casi duplicadas (>80% similares) — fusionar en una
- Definiciones de tipo redundantes — consolidar
- Funciones wrapper que no añaden valor — inline
- Re-exports que no tienen propósito — eliminar la indirección

## Paso 6: Resumen

Reportar resultados:

```
Limpieza de Código Muerto
──────────────────────────────
Eliminado:  12 funciones no usadas
            3 archivos no usados
            5 dependencias no usadas
Omitido:    2 elementos (pruebas fallaron)
Guardado:   ~450 líneas eliminadas
──────────────────────────────
Todas las pruebas pasando ✓
```

## Reglas

- **Nunca eliminar sin ejecutar las pruebas primero**
- **Una eliminación a la vez** — Los cambios atómicos facilitan el rollback
- **Omitir si hay incertidumbre** — Mejor conservar código muerto que romper producción
- **No refactorizar mientras se limpia** — Separar las preocupaciones (limpiar primero, refactorizar después)
