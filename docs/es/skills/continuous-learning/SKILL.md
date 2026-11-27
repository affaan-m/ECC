---
name: continuous-learning
description: "[OBSOLETO - usar continuous-learning-v2] Extractor de skill por hook Stop v1 heredado. v2 es un superconjunto estricto con aprendizaje basado en instintos, con alcance de proyecto y hooks confiables. No invocar v1; dirigir solicitudes de aprendizaje continuo, aprendizaje de sesión y extracción de patrones a continuous-learning-v2."
origin: ECC
---

# Skill de Aprendizaje Continuo - OBSOLETO

> **OBSOLETO el 2026-04-28.** Usar `continuous-learning-v2` en su lugar. v2 es un superconjunto estricto: la observación por hook Stop se convierte en observación PreToolUse/PostToolUse, los skills completos se convierten en instintos atómicos con puntuación de confianza, y el almacenamiento solo global se convierte en almacenamiento con alcance de proyecto más promoción global.
>
> Este archivo se mantiene como referencia de archivo y compatibilidad retroactiva con instalaciones existentes.

---

## Documentación Original v1 (archivo)

Evalúa automáticamente las sesiones de Claude Code al terminar para extraer patrones reutilizables que pueden guardarse como skills aprendidos.

## Cuándo Activar

- Configurar extracción automática de patrones desde sesiones de Claude Code
- Configurar el hook Stop para evaluación de sesiones
- Revisar o curar skills aprendidos en `~/.claude/skills/learned/`
- Ajustar umbrales de extracción o categorías de patrones
- Comparar enfoques v1 (este) vs v2 (basado en instintos)

## Estado

Este skill v1 sigue siendo compatible, pero `continuous-learning-v2` es la ruta preferida para nuevas instalaciones. Mantener v1 cuando explícitamente quieras el flujo de extracción por hook Stop más simple o necesites compatibilidad con flujos de trabajo de skills aprendidos más antiguos.

## Cómo Funciona

Este skill se ejecuta como un **hook Stop** al final de cada sesión:

1. **Evaluación de Sesión**: Verifica si la sesión tiene suficientes mensajes (por defecto: 10+)
2. **Detección de Patrones**: Identifica patrones extraíbles de la sesión
3. **Extracción de Skills**: Guarda patrones útiles en `~/.claude/skills/learned/`

## Configuración

Editar `config.json` para personalizar:

```json
{
  "min_session_length": 10,
  "extraction_threshold": "medium",
  "auto_approve": false,
  "learned_skills_path": "~/.claude/skills/learned/",
  "patterns_to_detect": [
    "error_resolution",
    "user_corrections",
    "workarounds",
    "debugging_techniques",
    "project_specific"
  ],
  "ignore_patterns": [
    "simple_typos",
    "one_time_fixes",
    "external_api_issues"
  ]
}
```

## Tipos de Patrones

| Patrón | Descripción |
|--------|-------------|
| `error_resolution` | Cómo se resolvieron errores específicos |
| `user_corrections` | Patrones de correcciones del usuario |
| `workarounds` | Soluciones a peculiaridades de frameworks/librerías |
| `debugging_techniques` | Enfoques efectivos de depuración |
| `project_specific` | Convenciones específicas del proyecto |

## Configuración del Hook

Agregar a tu `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning/evaluate-session.sh"
      }]
    }]
  }
}
```

## Por Qué Hook Stop?

- **Ligero**: Se ejecuta una vez al final de la sesión
- **No bloqueante**: No agrega latencia a cada mensaje
- **Contexto completo**: Tiene acceso a la transcripción completa de la sesión

## Relacionado

- `/learn` — Extracción manual de patrones a mitad de sesión

---

## Notas de Comparación (Investigación: Ene 2025)

### vs Homunculus

Homunculus v2 adopta un enfoque más sofisticado:

| Característica | Nuestro Enfoque | Homunculus v2 |
|----------------|-----------------|---------------|
| Observación | Hook Stop (fin de sesión) | Hooks PreToolUse/PostToolUse (100% confiable) |
| Análisis | Contexto principal | Agente en segundo plano (Haiku) |
| Granularidad | Skills completos | "Instintos" atómicos |
| Confianza | Ninguna | Ponderada 0.3-0.9 |
| Evolución | Directamente a skill | Instintos → cluster → skill/comando/agente |
| Compartir | Ninguno | Exportar/importar instintos |

**Insight clave de homunculus:**
> "v1 dependía de skills para observar. Los skills son probabilísticos — se activan ~50-80% del tiempo. v2 usa hooks para la observación (100% confiable) e instintos como unidad atómica de comportamiento aprendido."

### Mejoras Potenciales v2

1. **Aprendizaje basado en instintos** — Comportamientos más pequeños y atómicos con puntuación de confianza
2. **Observador en segundo plano** — Agente Haiku analizando en paralelo
3. **Decaimiento de confianza** — Los instintos pierden confianza si son contradichos
4. **Etiquetado de dominio** — code-style, testing, git, debugging, etc.
5. **Ruta de evolución** — Agrupar instintos relacionados en skills/comandos

Ver: `docs/continuous-learning-v2-spec.md` para la especificación completa.
