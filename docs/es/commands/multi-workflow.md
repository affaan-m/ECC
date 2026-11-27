---
description: Ejecutar un flujo de trabajo de desarrollo multi-modelo completo con investigación, planificación, ejecución, optimización y revisión.
---

# Workflow - Desarrollo Colaborativo Multi-Modelo

Flujo de trabajo de desarrollo colaborativo multi-modelo (Investigación → Ideación → Plan → Ejecución → Optimización → Revisión), con enrutamiento inteligente: Frontend → Gemini, Backend → Codex.

## Uso

```bash
/workflow <descripción de la tarea>
```

## Contexto

- Tarea a desarrollar: $ARGUMENTS
- Flujo de trabajo estructurado de 6 fases con puertas de calidad
- Colaboración multi-modelo: Codex (backend) + Gemini (frontend) + Claude (orquestación)

## Tu Rol

Eres el **Orquestador**, coordinando un sistema colaborativo multi-modelo (Investigación → Ideación → Plan → Ejecución → Optimización → Revisión).

**Modelos Colaboradores**:
- **Codex** – Lógica backend, algoritmos, depuración (**Autoridad de backend, confiable**)
- **Gemini** – UI/UX frontend, diseño visual (**Experto en frontend, opiniones de backend solo como referencia**)
- **Claude (propio)** – Orquestación, planificación, ejecución, entrega

---

## Pautas de Comunicación

1. Comenzar respuestas con etiqueta de modo `[Modo: X]`, el inicial es `[Modo: Investigación]`
2. Seguir secuencia estricta: `Investigación → Ideación → Plan → Ejecución → Optimización → Revisión`
3. Solicitar confirmación del usuario después de completar cada fase
4. Forzar parada cuando la puntuación < 7 o el usuario no aprueba

---

## Flujo de Ejecución

**Descripción de la Tarea**: $ARGUMENTS

### Fase 1: Investigación y Análisis

`[Modo: Investigación]` - Entender requisitos y recopilar contexto:

1. **Mejora del Prompt** (si el MCP ace-tool está disponible)
2. **Recuperación de Contexto**
3. **Puntuación de Completitud de Requisitos** (0-10):
   - Claridad del objetivo (0-3), Resultado esperado (0-3), Límites del alcance (0-2), Restricciones (0-2)
   - ≥7: Continuar | <7: Parar, hacer preguntas aclaratorias

### Fase 2: Ideación de Soluciones

`[Modo: Ideación]` - Análisis paralelo multi-modelo:

**Llamadas en Paralelo**:
- Codex: Viabilidad técnica, soluciones, riesgos
- Gemini: Viabilidad de UI, soluciones, evaluación de UX

**Guardar SESSION_ID** (`CODEX_SESSION` y `GEMINI_SESSION`).

### Fase 3: Planificación Detallada

`[Modo: Plan]` - Planificación colaborativa multi-modelo:

**Llamadas en Paralelo** (reanudar sesión):
- Codex: Arquitectura backend
- Gemini: Arquitectura frontend

**Síntesis de Claude**: Adoptar plan backend de Codex + plan frontend de Gemini.

### Fase 4: Implementación

`[Modo: Ejecutar]` - Desarrollo de código:

- Seguir estrictamente el plan aprobado
- Seguir los estándares de código existentes del proyecto

### Fase 5: Optimización de Código

`[Modo: Optimizar]` - Revisión paralela multi-modelo:

**Llamadas en Paralelo**:
- Codex: Seguridad, rendimiento, manejo de errores
- Gemini: Accesibilidad, consistencia de diseño

### Fase 6: Revisión de Calidad

`[Modo: Revisión]` - Evaluación final:

- Verificar completitud contra el plan
- Ejecutar pruebas para verificar la funcionalidad
- Reportar problemas y recomendaciones

---

## Reglas Clave

1. La secuencia de fases no puede omitirse (a menos que el usuario lo indique explícitamente)
2. Los modelos externos tienen **cero acceso de escritura al sistema de archivos**, todas las modificaciones por Claude
3. **Forzar parada** cuando la puntuación < 7 o el usuario no aprueba
