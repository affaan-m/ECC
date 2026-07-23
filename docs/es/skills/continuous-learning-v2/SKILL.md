---
name: continuous-learning-v2
description: Sistema de aprendizaje basado en instintos que observa sesiones mediante hooks, crea instintos atómicos con puntuación de confianza y los evoluciona en skills/comandos/agentes. v2.1 agrega instintos con alcance de proyecto para prevenir contaminación entre proyectos.
origin: ECC
version: 2.1.0
---

# Aprendizaje Continuo v2.1 - Arquitectura Basada en Instintos

Un sistema de aprendizaje avanzado que convierte tus sesiones de Claude Code en conocimiento reutilizable a través de "instintos" atómicos — pequeños comportamientos aprendidos con puntuación de confianza.

**v2.1** agrega **instintos con alcance de proyecto** — los patrones de React se quedan en tu proyecto React, las convenciones de Python se quedan en tu proyecto Python, y los patrones universales (como "siempre validar la entrada") se comparten globalmente.

## Cuándo Activar

- Configurar aprendizaje automático desde sesiones de Claude Code
- Configurar extracción de comportamientos basada en instintos mediante hooks
- Ajustar umbrales de confianza para comportamientos aprendidos
- Revisar, exportar o importar librerías de instintos
- Evolucionar instintos en skills, comandos o agentes completos
- Gestionar instintos con alcance de proyecto vs globales
- Promover instintos de alcance de proyecto a global

## Qué hay de Nuevo en v2.1

| Característica | v2.0 | v2.1 |
|----------------|------|------|
| Almacenamiento | Global (`~/.claude/homunculus/`) | Con alcance de proyecto (`${XDG_DATA_HOME:-~/.local/share}/ecc-homunculus/projects/<hash>/`) |
| Alcance | Todos los instintos aplican en todas partes | Con alcance de proyecto + global |
| Detección | Ninguna | URL remota de git / ruta del repositorio |
| Promoción | N/A | Proyecto → global cuando se ve en 2+ proyectos |
| Comandos | 4 (status/evolve/export/import) | 6 (+promote/projects) |
| Entre proyectos | Riesgo de contaminación | Aislado por defecto |

## Qué hay de Nuevo en v2 (vs v1)

| Característica | v1 | v2 |
|----------------|----|----|
| Observación | Hook Stop (fin de sesión) | PreToolUse/PostToolUse (100% confiable) |
| Análisis | Contexto principal | Agente en segundo plano (Haiku) |
| Granularidad | Skills completos | "Instintos" atómicos |
| Confianza | Ninguna | Ponderada 0.3-0.9 |
| Evolución | Directamente a skill | Instintos → cluster → skill/comando/agente |
| Compartir | Ninguno | Exportar/importar instintos |

## El Modelo de Instinto

Un instinto es un pequeño comportamiento aprendido:

```yaml
---
id: prefer-functional-style
trigger: "when writing new functions"
confidence: 0.7
domain: "code-style"
source: "session-observation"
scope: project
project_id: "a1b2c3d4e5f6"
project_name: "my-react-app"
---

# Prefer Functional Style

## Action
Use functional patterns over classes when appropriate.

## Evidence
- Observed 5 instances of functional pattern preference
- User corrected class-based approach to functional on 2025-01-15
```

**Propiedades:**
- **Atómico** — un disparador, una acción
- **Ponderado por confianza** — 0.3 = tentativo, 0.9 = casi seguro
- **Etiquetado por dominio** — code-style, testing, git, debugging, workflow, etc.
- **Respaldado por evidencia** — rastrea qué observaciones lo crearon
- **Consciente del alcance** — `project` (por defecto) o `global`

## Cómo Funciona

```
Actividad de Sesión (en un repositorio git)
      |
      | Los hooks capturan prompts + uso de herramientas (100% confiable)
      | + detectan contexto del proyecto (git remote / ruta del repo)
      v
+---------------------------------------------+
|  projects/<project-hash>/observations.jsonl  |
|   (prompts, llamadas de herramientas, resultados, proyecto)   |
+---------------------------------------------+
      |
      | El agente observador lee (segundo plano, Haiku)
      v
+---------------------------------------------+
|          DETECCIÓN DE PATRONES               |
|   * Correcciones de usuario -> instinto      |
|   * Resoluciones de errores -> instinto      |
|   * Flujos de trabajo repetidos -> instinto  |
|   * Decisión de alcance: ¿proyecto o global? |
+---------------------------------------------+
      |
      | Crea/actualiza
      v
+---------------------------------------------+
|  projects/<project-hash>/instincts/personal/ |
|   * prefer-functional.yaml (0.7) [project]   |
|   * use-react-hooks.yaml (0.9) [project]     |
+---------------------------------------------+
|  instincts/personal/  (GLOBAL)               |
|   * always-validate-input.yaml (0.85) [global]|
|   * grep-before-edit.yaml (0.6) [global]     |
+---------------------------------------------+
      |
      | /evolve clusters + /promote
      v
+---------------------------------------------+
|  projects/<hash>/evolved/ (project-scoped)   |
|  evolved/ (global)                           |
|   * commands/new-feature.md                  |
|   * skills/testing-workflow.md               |
|   * agents/refactor-specialist.md            |
+---------------------------------------------+
```

## Detección de Proyecto

El sistema detecta automáticamente tu proyecto actual:

1. **Variable de entorno `CLAUDE_PROJECT_DIR`** (máxima prioridad)
2. **`git remote get-url origin`** — hasheado para crear un ID de proyecto portable (el mismo repo en diferentes máquinas obtiene el mismo ID)
3. **`git rev-parse --show-toplevel`** — respaldo usando la ruta del repo (específica de la máquina)
4. **Respaldo global** — si no se detecta ningún proyecto, los instintos van al alcance global

Cada proyecto obtiene un ID hash de 12 caracteres (ej. `a1b2c3d4e5f6`). Un archivo de registro en `${XDG_DATA_HOME:-~/.local/share}/ecc-homunculus/projects.json` mapea IDs a nombres legibles.

### Directorio de Datos

Continuous-learning-v2 almacena los datos del observador fuera de `~/.claude` para que el guard de rutas sensibles de Claude Code no bloquee las escrituras de instintos en segundo plano:

1. `CLV2_HOMUNCULUS_DIR` cuando se establece a una ruta absoluta
2. `$XDG_DATA_HOME/ecc-homunculus`
3. `$HOME/.local/share/ecc-homunculus`

Los usuarios existentes con datos en `~/.claude/homunculus` pueden migrar una vez:

```bash
bash skills/continuous-learning-v2/scripts/migrate-homunculus.sh
```

## Inicio Rápido

### 1. Habilitar Hooks de Observación

**Si está instalado como plugin** (recomendado):

No se requiere bloque extra de hooks en `settings.json`. Claude Code v2.1+ carga automáticamente el `hooks/hooks.json` del plugin, y `observe.sh` ya está registrado allí.

**Si está instalado manualmente** en `~/.claude/skills`, agregar esto a tu `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/skills/continuous-learning-v2/hooks/observe.sh"
      }]
    }]
  }
}
```

### 2. Usar los Comandos de Instinto

```bash
/instinct-status     # Mostrar instintos aprendidos (proyecto + global)
/evolve              # Agrupar instintos relacionados en skills/comandos
/instinct-export     # Exportar instintos a archivo
/instinct-import     # Importar instintos de otros
/promote             # Promover instintos de proyecto a alcance global
/projects            # Listar todos los proyectos conocidos y sus conteos de instintos
```

## Guía de Decisión de Alcance

| Tipo de Patrón | Alcance | Ejemplos |
|----------------|---------|---------|
| Convenciones de lenguaje/framework | **project** | "Usar React hooks", "Seguir patrones Django REST" |
| Preferencias de estructura de archivos | **project** | "Pruebas en `__tests__`/", "Componentes en src/components/" |
| Estilo de código | **project** | "Usar estilo funcional", "Preferir dataclasses" |
| Estrategias de manejo de errores | **project** | "Usar tipo Result para errores" |
| Prácticas de seguridad | **global** | "Validar entrada de usuario", "Sanitizar SQL" |
| Buenas prácticas generales | **global** | "Escribir pruebas primero", "Siempre manejar errores" |
| Preferencias de flujo de trabajo de herramientas | **global** | "Grep antes de Edit", "Read antes de Write" |
| Prácticas de Git | **global** | "Conventional commits", "Commits pequeños y enfocados" |

## Puntuación de Confianza

La confianza evoluciona con el tiempo:

| Puntuación | Significado | Comportamiento |
|------------|-------------|----------------|
| 0.3 | Tentativo | Sugerido pero no aplicado |
| 0.5 | Moderado | Aplicado cuando es relevante |
| 0.7 | Fuerte | Auto-aprobado para aplicación |
| 0.9 | Casi seguro | Comportamiento central |

**La confianza aumenta** cuando:
- El patrón se observa repetidamente
- El usuario no corrige el comportamiento sugerido
- Instintos similares de otras fuentes coinciden

**La confianza disminuye** cuando:
- El usuario corrige explícitamente el comportamiento
- El patrón no se observa por períodos extendidos
- Aparece evidencia contradictoria

## Privacidad

- Las observaciones permanecen **locales** en tu máquina
- Los instintos con alcance de proyecto están aislados por proyecto
- Solo los **instintos** (patrones) pueden exportarse — no las observaciones brutas
- No se comparte código real ni contenido de conversaciones
- Tú controlas qué se exporta y promueve
