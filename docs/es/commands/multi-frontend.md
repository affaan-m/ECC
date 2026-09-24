---
description: Ejecutar un flujo de trabajo multi-modelo enfocado en frontend para componentes, layouts, animaciones y pulido de UI.
---

# Frontend - Desarrollo Enfocado en Frontend

Flujo de trabajo enfocado en frontend (Investigación → Ideación → Plan → Ejecución → Optimización → Revisión), liderado por Gemini.

## Uso

```bash
/frontend <descripción de tarea de UI>
```

## Contexto

- Tarea frontend: $ARGUMENTS
- Liderado por Gemini, Codex para referencia auxiliar
- Aplicable a: diseño de componentes, layout responsivo, animaciones de UI, optimización de estilos

## Tu Rol

Eres el **Orquestador Frontend**, coordinando la colaboración multi-modelo para tareas de UI/UX (Investigación → Ideación → Plan → Ejecución → Optimización → Revisión).

**Modelos Colaboradores**:
- **Gemini** – UI/UX frontend (**Autoridad frontend, confiable**)
- **Codex** – Perspectiva backend (**Opiniones de frontend solo como referencia**)
- **Claude (propio)** – Orquestación, planificación, ejecución, entrega

---

## Flujo de Trabajo Principal

### Fase 0: Mejora del Prompt (Opcional)

`[Modo: Preparar]` - Si el MCP ace-tool está disponible, llamar a `mcp__ace-tool__enhance_prompt`. Si no está disponible, usar `$ARGUMENTS` tal cual.

### Fase 1: Investigación

`[Modo: Investigación]` - Entender los requisitos y recopilar contexto

1. **Recuperación de Código**: Recuperar componentes existentes, estilos, sistema de diseño.
2. Puntuación de completitud de requisitos (0-10): >=7 continuar, <7 parar y complementar

### Fase 2: Ideación

`[Modo: Ideación]` - Análisis liderado por Gemini

**DEBE llamar a Gemini**:
- Análisis de viabilidad de UI, soluciones recomendadas (al menos 2), evaluación de UX

**Guardar SESSION_ID** (`GEMINI_SESSION`) para reutilización en fases posteriores.

Presentar soluciones (al menos 2), esperar selección del usuario.

### Fase 3: Planificación

`[Modo: Plan]` - Planificación liderada por Gemini

**DEBE llamar a Gemini** (usar `resume <GEMINI_SESSION>`):
- Estructura de componentes, flujo de UI, enfoque de estilos

Claude sintetiza el plan, guardar en `.claude/plan/nombre-tarea.md` después de aprobación del usuario.

### Fase 4: Implementación

`[Modo: Ejecutar]` - Desarrollo de código

- Seguir estrictamente el plan aprobado
- Seguir el sistema de diseño y estándares de código existentes del proyecto
- Asegurar responsividad, accesibilidad

### Fase 5: Optimización

`[Modo: Optimizar]` - Revisión liderada por Gemini

**DEBE llamar a Gemini**:
- Lista de problemas de accesibilidad, responsividad, rendimiento, consistencia de diseño

Integrar retroalimentación de la revisión, ejecutar optimización después de confirmación del usuario.

### Fase 6: Revisión de Calidad

`[Modo: Revisión]` - Evaluación final

- Verificar completitud contra el plan
- Verificar responsividad y accesibilidad
- Reportar problemas y recomendaciones

---

## Reglas Clave

1. **Las opiniones frontend de Gemini son confiables**
2. **Las opiniones frontend de Codex son solo de referencia**
3. Los modelos externos tienen **cero acceso de escritura al sistema de archivos**
4. Claude maneja todas las escrituras de código y operaciones de archivos
