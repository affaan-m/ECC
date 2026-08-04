---
description: Sincronizar la documentación desde archivos de fuente de verdad como scripts, schemas, rutas y exportaciones.
---

# Actualizar Documentación

Sincronizar la documentación con el código base, generándola desde archivos de fuente de verdad.

## Paso 1: Identificar Fuentes de Verdad

| Fuente | Genera |
|--------|--------|
| Scripts de `package.json` | Referencia de comandos disponibles |
| `.env.example` | Documentación de variables de entorno |
| `openapi.yaml` / archivos de rutas | Referencia de endpoints de API |
| Exportaciones del código fuente | Documentación de la API pública |
| `Dockerfile` / `docker-compose.yml` | Docs de configuración de infraestructura |

## Paso 2: Generar Referencia de Scripts

1. Leer `package.json` (o `Makefile`, `Cargo.toml`, `pyproject.toml`)
2. Extraer todos los scripts/comandos con sus descripciones
3. Generar una tabla de referencia:

```markdown
| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Iniciar servidor de desarrollo con recarga en caliente |
| `npm run build` | Build de producción con verificación de tipos |
| `npm test` | Ejecutar suite de pruebas con cobertura |
```

## Paso 3: Generar Documentación de Entorno

1. Leer `.env.example` (o `.env.template`, `.env.sample`)
2. Extraer todas las variables con sus propósitos
3. Categorizar como requeridas vs opcionales
4. Documentar el formato esperado y los valores válidos

```markdown
| Variable | Requerida | Descripción | Ejemplo |
|----------|-----------|-------------|---------|
| `DATABASE_URL` | Sí | String de conexión PostgreSQL | `postgres://user:pass@host:5432/db` |
| `LOG_LEVEL` | No | Verbosidad de logging (por defecto: info) | `debug`, `info`, `warn`, `error` |
```

## Paso 4: Actualizar Guía de Contribución

Generar o actualizar `docs/CONTRIBUTING.md` con:
- Configuración del entorno de desarrollo (prerrequisitos, pasos de instalación)
- Scripts disponibles y sus propósitos
- Procedimientos de testing (cómo ejecutar, cómo escribir nuevas pruebas)
- Aplicación del estilo de código (linter, formateador, hooks de pre-commit)
- Lista de verificación para envío de PRs

## Paso 5: Actualizar Runbook

Generar o actualizar `docs/RUNBOOK.md` con:
- Procedimientos de despliegue (paso a paso)
- Endpoints de health check y monitoreo
- Problemas comunes y sus soluciones
- Procedimientos de rollback
- Rutas de alertas y escalada

## Paso 6: Verificación de Obsolescencia

1. Encontrar archivos de documentación no modificados en 90+ días
2. Hacer referencia cruzada con cambios recientes en el código fuente
3. Marcar documentos potencialmente desactualizados para revisión manual

## Paso 7: Mostrar Resumen

```
Actualización de Documentación
──────────────────────────────
Actualizado:  docs/CONTRIBUTING.md (tabla de scripts)
Actualizado:  docs/ENV.md (3 nuevas variables)
Marcado:      docs/DEPLOY.md (142 días sin actualizar)
Omitido:      docs/API.md (sin cambios detectados)
──────────────────────────────
```

## Reglas

- **Fuente única de verdad**: Siempre generar desde el código, nunca editar manualmente secciones generadas
- **Preservar secciones manuales**: Solo actualizar secciones generadas; dejar la prosa escrita a mano intacta
- **Marcar contenido generado**: Usar marcadores `<!-- AUTO-GENERATED -->` alrededor de las secciones generadas
- **No crear docs sin instrucción**: Solo crear nuevos archivos de documentación si el comando lo solicita explícitamente
