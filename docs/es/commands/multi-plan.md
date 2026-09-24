---
description: Crear un plan de implementación multi-modelo sin modificar código de producción.
---

# Plan - Planificación Colaborativa Multi-Modelo

Planificación colaborativa multi-modelo - Recuperación de contexto + Análisis de doble modelo → Generar plan de implementación paso a paso.

$ARGUMENTS

---

## Protocolos Principales

- **Solo Planificación**: Este comando permite leer contexto y escribir en archivos de plan `.claude/plan/*`, pero **NUNCA modificar código de producción**
- **Soberanía del Código**: Los modelos externos tienen **cero acceso de escritura al sistema de archivos**, todas las modificaciones por Claude
- **Paralelo Obligatorio**: Las llamadas a Codex/Gemini DEBEN usar `run_in_background: true`

---

## Flujo de Ejecución

**Tarea de Planificación**: $ARGUMENTS

### Fase 1: Recuperación Completa de Contexto

`[Modo: Investigación]`

1. **Mejora del Prompt** (si el MCP ace-tool está disponible)
2. **Recuperación de Contexto**: Obtener definiciones y firmas completas para clases, funciones y variables relevantes
3. **Verificación de Completitud**: Si los requisitos aún tienen ambigüedad, **DEBE** presentar preguntas guía al usuario

### Fase 2: Análisis Colaborativo Multi-Modelo

`[Modo: Análisis]`

**Llamadas en Paralelo** a Codex y Gemini:

1. **Análisis Backend de Codex**: Viabilidad técnica, impacto arquitectónico, consideraciones de rendimiento
2. **Análisis Frontend de Gemini**: Impacto en UI/UX, experiencia de usuario, diseño visual

**Guardar SESSION_ID** (`CODEX_SESSION` y `GEMINI_SESSION`).

**Validación Cruzada**:
1. Identificar consenso (señal fuerte)
2. Identificar divergencia (necesita ponderación)
3. Fortalezas complementarias: lógica backend sigue a Codex, diseño frontend sigue a Gemini

### Fase 2: Generar Plan de Implementación (Versión Final de Claude)

Sintetizar ambos análisis, generar **Plan de Implementación Paso a Paso**:

```markdown
## Plan de Implementación: <Nombre de Tarea>

### Tipo de Tarea
- [ ] Frontend (→ Gemini)
- [ ] Backend (→ Codex)
- [ ] Fullstack (→ Paralelo)

### Solución Técnica
<Solución óptima sintetizada del análisis de Codex + Gemini>

### Pasos de Implementación
1. <Paso 1> - Entregable esperado
2. <Paso 2> - Entregable esperado
...

### Archivos Clave
| Archivo | Operación | Descripción |
|---------|-----------|-------------|
| ruta/al/archivo.ts:L10-L50 | Modificar | Descripción |

### SESSION_ID (para uso de /ccg:execute)
- CODEX_SESSION: <session_id>
- GEMINI_SESSION: <session_id>
```

### Fin de Fase 2: Entrega del Plan (No Ejecución)

**Las responsabilidades de `/ccg:plan` terminan aquí**:

1. Presentar el plan completo al usuario
2. Guardar el plan en `.claude/plan/<nombre-característica>.md`
3. Solicitar revisión del usuario

**ABSOLUTAMENTE PROHIBIDO**:
- Preguntar "Y/N" y luego auto-ejecutar (la ejecución es responsabilidad de `/ccg:execute`)
- Cualquier operación de escritura en código de producción
- Llamar automáticamente a `/ccg:execute` o cualquier acción de implementación

---

## Reglas Clave

1. **Solo planificación, sin implementación** – Este comando no ejecuta ningún cambio de código
2. **Sin prompts Y/N** – Solo presentar el plan, dejar que el usuario decida los próximos pasos
3. **Reglas de Confianza** – Backend sigue a Codex, Frontend sigue a Gemini
4. Los modelos externos tienen **cero acceso de escritura al sistema de archivos**
5. **Traspaso de SESSION_ID** – El plan debe incluir `CODEX_SESSION` / `GEMINI_SESSION` al final
