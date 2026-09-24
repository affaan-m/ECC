---
description: Revisión de código — cambios locales no confirmados o PR de GitHub (pasa número/URL del PR para modo PR)
argument-hint: [número-pr | url-pr | vacío para revisión local]
---

# Revisión de Código

> Modo de revisión de PR adaptado de PRPs-agentic-eng por Wirasm. Parte de la serie de flujos de trabajo PRP.

**Entrada**: $ARGUMENTS

---

## Selección de Modo

Si `$ARGUMENTS` contiene un número de PR, URL de PR, o `--pr`:
→ Ir a **Modo de Revisión de PR** más abajo.

De lo contrario:
→ Usar **Modo de Revisión Local**.

---

## Modo de Revisión Local

Revisión exhaustiva de seguridad y calidad de los cambios no confirmados.

### Fase 1 — RECOPILAR

```bash
git diff --name-only HEAD
```

Si no hay archivos modificados, detener: "Nada que revisar."

### Fase 2 — REVISAR

Leer cada archivo modificado completo. Verificar:

**Problemas de Seguridad (CRÍTICO):**
- Credenciales, claves de API, tokens hardcodeados
- Vulnerabilidades de inyección SQL
- Vulnerabilidades XSS
- Validación de entrada faltante
- Dependencias inseguras
- Riesgos de path traversal

**Calidad de Código (ALTO):**
- Funciones de más de 50 líneas
- Archivos de más de 800 líneas
- Profundidad de anidamiento mayor a 4 niveles
- Manejo de errores faltante
- Sentencias console.log
- Comentarios TODO/FIXME
- JSDoc faltante para APIs públicas

**Buenas Prácticas (MEDIO):**
- Patrones de mutación (usar inmutable en su lugar)
- Uso de emojis en código/comentarios
- Pruebas faltantes para código nuevo
- Problemas de accesibilidad (a11y)

### Fase 3 — REPORTE

Generar reporte con:
- Severidad: CRÍTICO, ALTO, MEDIO, BAJO
- Ubicación del archivo y números de línea
- Descripción del problema
- Corrección sugerida

Bloquear commit si se encuentran problemas CRÍTICOS o ALTOS.
Nunca aprobar código con vulnerabilidades de seguridad.

---

## Modo de Revisión de PR

Revisión exhaustiva de PR de GitHub — obtiene el diff, lee los archivos completos, ejecuta validación, publica la revisión.

### Fase 1 — OBTENER

Parsear la entrada para determinar el PR:

| Entrada | Acción |
|---|---|
| Número (ej. `42`) | Usar como número de PR |
| URL (`github.com/.../pull/42`) | Extraer número de PR |
| Nombre de branch | Encontrar PR via `gh pr list --head <branch>` |

```bash
gh pr view <NÚMERO> --json number,title,body,author,baseRefName,headRefName,changedFiles,additions,deletions
gh pr diff <NÚMERO>
```

Si no se encuentra el PR, detener con error. Almacenar metadatos del PR para fases posteriores.

### Fase 2 — CONTEXTO

Construir contexto de revisión:

1. **Reglas del proyecto** — Leer `CLAUDE.md`, `.claude/docs/`, y cualquier guía de contribución
2. **Artefactos de planificación** — Verificar `.claude/prds/`, `.claude/plans/`, `.claude/reviews/`, y legacy `.claude/PRPs/{prds,plans,reports,reviews}/` para contexto relacionado con este PR
3. **Intención del PR** — Parsear la descripción del PR para objetivos, issues vinculados, planes de prueba
4. **Archivos modificados** — Listar todos los archivos modificados y categorizar por tipo (fuente, prueba, config, docs)

### Fase 3 — REVISAR

Leer cada archivo modificado **completo** (no solo los hunks del diff — se necesita el contexto circundante).

Para revisiones de PR, obtener el contenido completo del archivo en la revisión head del PR:
```bash
gh pr diff <NÚMERO> --name-only | while IFS= read -r file; do
  gh api "repos/{owner}/{repo}/contents/$file?ref=<head-branch>" --jq '.content' | base64 -d
done
```

Aplicar la lista de verificación de revisión en 7 categorías:

| Categoría | Qué Verificar |
|---|---|
| **Corrección** | Errores lógicos, off-by-ones, manejo de null, casos límite, condiciones de carrera |
| **Seguridad de Tipos** | Incompatibilidades de tipos, castings inseguros, uso de `any`, generics faltantes |
| **Cumplimiento de Patrones** | Coincide con convenciones del proyecto (nomenclatura, estructura de archivos, manejo de errores, imports) |
| **Seguridad** | Inyección, brechas de auth, exposición de secretos, SSRF, path traversal, XSS |
| **Rendimiento** | Consultas N+1, índices faltantes, bucles sin límite, fugas de memoria, payloads grandes |
| **Completitud** | Pruebas faltantes, manejo de errores faltante, migraciones incompletas, docs faltante |
| **Mantenibilidad** | Código muerto, números mágicos, anidamiento profundo, nomenclatura poco clara, tipos faltantes |

Asignar severidad a cada hallazgo:

| Severidad | Significado | Acción |
|---|---|---|
| **CRÍTICO** | Vulnerabilidad de seguridad o riesgo de pérdida de datos | Debe corregirse antes de merge |
| **ALTO** | Bug o error lógico que probablemente causará problemas | Debería corregirse antes de merge |
| **MEDIO** | Problema de calidad de código o buena práctica faltante | Se recomienda corregir |
| **BAJO** | Detalle de estilo o sugerencia menor | Opcional |

### Fase 4 — VALIDAR

Ejecutar comandos de validación disponibles:

Detectar el tipo de proyecto desde los archivos de configuración (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, etc.), luego ejecutar los comandos apropiados:

**Node.js / TypeScript** (tiene `package.json`):
```bash
npm run typecheck 2>/dev/null || npx tsc --noEmit 2>/dev/null  # Verificación de tipos
npm run lint                                                    # Lint
npm test                                                        # Pruebas
npm run build                                                   # Build
```

**Rust** (tiene `Cargo.toml`):
```bash
cargo clippy -- -D warnings  # Lint
cargo test                   # Pruebas
cargo build                  # Build
```

**Go** (tiene `go.mod`):
```bash
go vet ./...    # Lint
go test ./...   # Pruebas
go build ./...  # Build
```

**Python** (tiene `pyproject.toml` / `setup.py`):
```bash
pytest  # Pruebas
```

Ejecutar solo los comandos que apliquen al tipo de proyecto detectado. Registrar pass/fail para cada uno.

### Fase 5 — DECIDIR

Formular recomendación basada en los hallazgos:

| Condición | Decisión |
|---|---|
| Cero problemas CRÍTICOS/ALTOS, validación pasa | **APROBAR** |
| Solo problemas MEDIO/BAJO, validación pasa | **APROBAR** con comentarios |
| Cualquier problema ALTO o fallos de validación | **SOLICITAR CAMBIOS** |
| Cualquier problema CRÍTICO | **BLOQUEAR** — debe corregirse antes del merge |

Casos especiales:
- PR en borrador → Siempre usar **COMENTAR** (no aprobar/bloquear)
- Solo cambios de docs/config → Revisión más ligera, enfocada en corrección
- Flag explícito `--approve` o `--request-changes` → Anular decisión (pero reportar todos los hallazgos)

### Fase 6 — REPORTE

Crear artefacto de revisión en `.claude/reviews/pr-<NÚMERO>-review.md` a menos que el repositorio ya use el legacy `.claude/PRPs/reviews/` para este flujo:

```markdown
# Revisión de PR: #<NÚMERO> — <TÍTULO>

**Revisado**: <fecha>
**Autor**: <autor>
**Branch**: <head> → <base>
**Decisión**: APROBAR | SOLICITAR CAMBIOS | BLOQUEAR

## Resumen
<evaluación general en 1-2 oraciones>

## Hallazgos

### CRÍTICO
<hallazgos o "Ninguno">

### ALTO
<hallazgos o "Ninguno">

### MEDIO
<hallazgos o "Ninguno">

### BAJO
<hallazgos o "Ninguno">

## Resultados de Validación

| Verificación | Resultado |
|---|---|
| Verificación de tipos | Pass / Fail / Omitido |
| Lint | Pass / Fail / Omitido |
| Pruebas | Pass / Fail / Omitido |
| Build | Pass / Fail / Omitido |

## Archivos Revisados
<lista de archivos con tipo de cambio: Agregado/Modificado/Eliminado>
```

### Fase 7 — PUBLICAR

Publicar la revisión en GitHub:

```bash
# Si APROBAR
gh pr review <NÚMERO> --approve --body "<resumen de la revisión>"

# Si SOLICITAR CAMBIOS
gh pr review <NÚMERO> --request-changes --body "<resumen con correcciones requeridas>"

# Si solo COMENTAR (PR en borrador o informativo)
gh pr review <NÚMERO> --comment --body "<resumen>"
```

Para comentarios en línea en líneas específicas, usar la API de comentarios de revisión de GitHub:
```bash
gh api "repos/{owner}/{repo}/pulls/<NÚMERO>/comments" \
  -f body="<comentario>" \
  -f path="<archivo>" \
  -F line=<número-de-línea> \
  -f side="RIGHT" \
  -f commit_id="$(gh pr view <NÚMERO> --json headRefOid --jq .headRefOid)"
```

Alternativamente, publicar una sola revisión con múltiples comentarios en línea a la vez:
```bash
gh api "repos/{owner}/{repo}/pulls/<NÚMERO>/reviews" \
  -f event="COMMENT" \
  -f body="<resumen general>" \
  --input comments.json  # [{"path": "archivo", "line": N, "body": "comentario"}, ...]
```

### Fase 8 — SALIDA

Reportar al usuario:

```
PR #<NÚMERO>: <TÍTULO>
Decisión: <APROBAR|SOLICITAR_CAMBIOS|BLOQUEAR>

Problemas: <cantidad_críticos> críticos, <cantidad_altos> altos, <cantidad_medios> medios, <cantidad_bajos> bajos
Validación: <cantidad_pass>/<total> verificaciones pasaron

Artefactos:
  Revisión: .claude/reviews/pr-<NÚMERO>-review.md
  GitHub: <URL del PR>

Próximos pasos:
  - <sugerencias contextuales basadas en la decisión>
```

---

## Casos Límite

- **Sin CLI `gh`**: Volver a revisión solo local (leer el diff, omitir publicación en GitHub). Advertir al usuario.
- **Branches divergidos**: Sugerir `git fetch origin && git rebase origin/<base>` antes de la revisión.
- **PRs grandes (>50 archivos)**: Advertir sobre el alcance de la revisión. Enfocarse primero en cambios de fuente, luego pruebas, luego config/docs.
