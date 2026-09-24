---
description: Guía de orquestación secuencial y tmux/worktree para flujos de trabajo multi-agente.
---

# Comando Orchestrate

Flujo de trabajo secuencial de agentes para tareas complejas.

## Uso

`/orchestrate [tipo-workflow] [descripción-de-tarea]`

## Tipos de Workflow

### feature
Flujo de trabajo completo de implementación de feature:
```
planner -> tdd-guide -> code-reviewer -> security-reviewer
```

### bugfix
Flujo de trabajo de investigación y corrección de bugs:
```
planner -> tdd-guide -> code-reviewer
```

### refactor
Flujo de trabajo de refactoring seguro:
```
architect -> code-reviewer -> tdd-guide
```

### security
Revisión enfocada en seguridad:
```
security-reviewer -> code-reviewer -> architect
```

## Patrón de Ejecución

Para cada agente en el flujo de trabajo:

1. **Invocar el agente** con el contexto del agente anterior
2. **Recopilar la salida** como documento de handoff estructurado
3. **Pasarlo al siguiente agente** en la cadena
4. **Consolidar los resultados** en el reporte final

## Formato del Documento de Handoff

Entre agentes, crear el documento de handoff:

```markdown
## HANDOFF: [agente-anterior] -> [agente-siguiente]

### Context
[Resumen de lo que se hizo]

### Findings
[Descubrimientos o decisiones clave]

### Files Modified
[Lista de archivos tocados]

### Open Questions
[Elementos sin resolver para el siguiente agente]

### Recommendations
[Próximos pasos recomendados]
```

## Ejemplo: Flujo de Trabajo Feature

```
/orchestrate feature "Agregar autenticación de usuarios"
```

Ejecuta:

1. **Agente Planner**
   - Analiza los requisitos
   - Crea un plan de implementación
   - Identifica dependencias
   - Salida: `HANDOFF: planner -> tdd-guide`

2. **Agente TDD Guide**
   - Lee el handoff del planner
   - Escribe las pruebas primero
   - Implementa para que las pruebas pasen
   - Salida: `HANDOFF: tdd-guide -> code-reviewer`

3. **Agente Code Reviewer**
   - Revisa la implementación
   - Verifica problemas
   - Sugiere mejoras
   - Salida: `HANDOFF: code-reviewer -> security-reviewer`

4. **Agente Security Reviewer**
   - Auditoría de seguridad
   - Verificación de vulnerabilidades
   - Aprobación final
   - Salida: Reporte Final

## Formato del Reporte Final

```
ORCHESTRATION REPORT
====================
Workflow: feature
Task: Agregar autenticación de usuarios
Agents: planner -> tdd-guide -> code-reviewer -> security-reviewer

SUMMARY
-------
[Resumen en un párrafo]

AGENT OUTPUTS
-------------
Planner: [resumen]
TDD Guide: [resumen]
Code Reviewer: [resumen]
Security Reviewer: [resumen]

FILES CHANGED
-------------
[Lista de todos los archivos modificados]

TEST RESULTS
------------
[Resumen de pruebas pasadas/fallidas]

SECURITY STATUS
---------------
[Hallazgos de seguridad]

RECOMMENDATION
--------------
[SHIP / NEEDS WORK / BLOCKED]
```

## Ejecución Paralela

Para verificaciones independientes, ejecutar agentes en paralelo:

```markdown
### Fase Paralela
Ejecutar simultáneamente:
- code-reviewer (calidad)
- security-reviewer (seguridad)
- architect (diseño)

### Combinar Resultados
Combinar las salidas en un único reporte
```

Para workers externos en tmux pane con git worktrees separados, usar `node scripts/orchestrate-worktrees.js plan.json --execute`. El patrón de orquestación integrado permanece en proceso; el helper sirve para sesiones de larga duración o cross-harness.

Cuando los workers necesiten ver archivos locales no rastreados o sucios del checkout principal, agregar `seedPaths` al archivo de plan. ECC superpone solo esas rutas seleccionadas en cada worktree de worker después de `git worktree add`; esto muestra scripts, planes o documentos locales en progreso mientras mantiene el branch aislado.

```json
{
  "sessionName": "workflow-e2e",
  "seedPaths": [
    "scripts/orchestrate-worktrees.js",
    "scripts/lib/tmux-worktree-orchestrator.js",
    ".claude/plan/workflow-e2e-test.json"
  ],
  "workers": [
    { "name": "docs", "task": "Actualizar documentación de orquestación." }
  ]
}
```

Para exportar un snapshot del plano de control de una sesión tmux/worktree activa, ejecutar:

```bash
node scripts/orchestration-status.js .claude/plan/workflow-visual-proof.json
```

El snapshot contiene actividad de sesión, metadatos de pane de tmux, estados de workers, objetivos, seed overlays y resúmenes de handoff recientes en formato JSON.

## Handoff al Centro de Control del Operador

Cuando el flujo de trabajo se extiende a múltiples sesiones, worktrees o panes de tmux, agregar un bloque de plano de control al handoff final:

```markdown
CONTROL PLANE
-------------
Sessions:
- ID o alias de sesión activa
- branch + ruta de worktree para cada worker activo
- nombre del pane de tmux o sesión detached donde aplique

Diffs:
- resumen de git status
- git diff --stat de archivos tocados
- notas de riesgo de merge/conflictos

Approvals:
- aprobaciones de usuario pendientes
- pasos bloqueados esperando aprobación

Telemetry:
- timestamp de última actividad o señal de idle
- deriva estimada de tokens o costos
- eventos de política reportados por hooks o revisores
```

Esto mantiene al planner, implementador, revisor y workers del loop comprensibles desde la superficie del operador.

## Argumentos

$ARGUMENTS:
- `feature <descripción>` - Flujo de trabajo completo de feature
- `bugfix <descripción>` - Flujo de trabajo de corrección de bug
- `refactor <descripción>` - Flujo de trabajo de refactoring
- `security <descripción>` - Flujo de trabajo de revisión de seguridad
- `custom <agentes> <descripción>` - Secuencia de agentes personalizada

## Ejemplo de Workflow Personalizado

```
/orchestrate custom "architect,tdd-guide,code-reviewer" "Rediseñar la capa de caché"
```

## Consejos

1. **Comenzar con planner para features complejas**
2. **Siempre incluir code-reviewer antes del merge**
3. **Usar security-reviewer para auth/pagos/PII**
4. **Mantener los handoffs concisos** - enfocarse en lo que el siguiente agente necesita
5. **Ejecutar validación entre agentes si es necesario**
