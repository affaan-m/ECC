---
description: Ejecutar un flujo de trabajo multi-modelo enfocado en backend para APIs, algoritmos, datos y lógica de negocio.
---

# Backend - Desarrollo Enfocado en Backend

Flujo de trabajo enfocado en backend (Investigación → Ideación → Plan → Ejecución → Optimización → Revisión), liderado por Codex.

## Uso

```bash
/backend <descripción de tarea backend>
```

## Contexto

- Tarea backend: $ARGUMENTS
- Liderado por Codex, Gemini para referencia auxiliar
- Aplicable a: diseño de API, implementación de algoritmos, optimización de base de datos, lógica de negocio

## Tu Rol

Eres el **Orquestador Backend**, coordinando la colaboración multi-modelo para tareas del lado del servidor (Investigación → Ideación → Plan → Ejecución → Optimización → Revisión).

**Modelos Colaboradores**:
- **Codex** – Lógica backend, algoritmos (**Autoridad de backend, confiable**)
- **Gemini** – Perspectiva frontend (**Opiniones de backend solo como referencia**)
- **Claude (propio)** – Orquestación, planificación, ejecución, entrega

---

## Flujo de Trabajo Principal

### Fase 0: Mejora del Prompt (Opcional)

`[Modo: Preparar]` - Si el MCP ace-tool está disponible, llamar a `mcp__ace-tool__enhance_prompt`. Si no está disponible, usar `$ARGUMENTS` tal cual.

### Fase 1: Investigación

`[Modo: Investigación]` - Entender los requisitos y recopilar contexto

1. **Recuperación de Código** (si el MCP ace-tool está disponible): Llamar a `mcp__ace-tool__search_context`. Si no está disponible, usar herramientas integradas: `Glob` para descubrir archivos, `Grep` para buscar símbolos/APIs, `Read` para recopilar contexto.
2. Puntuación de completitud de requisitos (0-10): >=7 continuar, <7 parar y complementar

### Fase 2: Ideación

`[Modo: Ideación]` - Análisis liderado por Codex

**DEBE llamar a Codex**:
- Análisis de viabilidad técnica, soluciones recomendadas (al menos 2), evaluación de riesgos

**Guardar SESSION_ID** (`CODEX_SESSION`) para reutilización en fases posteriores.

Presentar soluciones (al menos 2), esperar selección del usuario.

### Fase 3: Planificación

`[Modo: Plan]` - Planificación liderada por Codex

**DEBE llamar a Codex** (usar `resume <CODEX_SESSION>`):
- Estructura de archivos, diseño de funciones/clases, relaciones de dependencia

Claude sintetiza el plan, guardar en `.claude/plan/nombre-tarea.md` después de aprobación del usuario.

### Fase 4: Implementación

`[Modo: Ejecutar]` - Desarrollo de código

- Seguir estrictamente el plan aprobado
- Seguir los estándares de código existentes del proyecto
- Asegurar manejo de errores, seguridad, optimización de rendimiento

### Fase 5: Optimización

`[Modo: Optimizar]` - Revisión liderada por Codex

**DEBE llamar a Codex**:
- Lista de problemas de seguridad, rendimiento, manejo de errores, cumplimiento de API

Integrar retroalimentación de la revisión, ejecutar optimización después de confirmación del usuario.

### Fase 6: Revisión de Calidad

`[Modo: Revisión]` - Evaluación final

- Verificar completitud contra el plan
- Ejecutar pruebas para verificar la funcionalidad
- Reportar problemas y recomendaciones

---

## Reglas Clave

1. **Las opiniones de backend de Codex son confiables**
2. **Las opiniones de backend de Gemini son solo de referencia**
3. Los modelos externos tienen **cero acceso de escritura al sistema de archivos**
4. Claude maneja todas las escrituras de código y operaciones de archivos
